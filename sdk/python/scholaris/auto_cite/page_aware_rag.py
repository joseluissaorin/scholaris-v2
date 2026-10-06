"""Page-Aware RAG system with ChromaDB for citation retrieval.

Every chunk has verified page metadata from Vision OCR.
Page numbers come from retrieval, not guessing.
Persists to disk for reuse across sessions.
"""

import hashlib
import json
import logging
import os
import re
import time
from pathlib import Path
from typing import List, Optional, Dict, Any

import chromadb
from chromadb.config import Settings
import google.generativeai as genai

from .models import OCRPage, PageChunk, RetrievedChunk

logger = logging.getLogger(__name__)


class GeminiEmbedder:
    """Embedding generator using Gemini embedding model with rate limiting."""

    # Rate limit: 3000 embeddings per minute = 50 per second
    # We'll be conservative and do 40 per second max
    MAX_PER_MINUTE = 2500
    BATCH_DELAY = 1.5  # Seconds between batches

    def __init__(self, api_key: str, model_name: str = "gemini-embedding-001"):
        """Initialize Gemini embedder.

        Args:
            api_key: Gemini API key
            model_name: Embedding model name
        """
        genai.configure(api_key=api_key)
        self.model_name = model_name

    def embed(self, text: str) -> List[float]:
        """Generate embedding for text.

        Args:
            text: Text to embed

        Returns:
            Embedding vector
        """
        result = genai.embed_content(
            model=self.model_name,
            content=text,
            task_type="retrieval_document",
        )
        return result["embedding"]

    def embed_query(self, text: str) -> List[float]:
        """Generate embedding for query text.

        Args:
            text: Query text to embed

        Returns:
            Embedding vector
        """
        result = genai.embed_content(
            model=self.model_name,
            content=text,
            task_type="retrieval_query",
        )
        return result["embedding"]

    def embed_batch(
        self,
        texts: List[str],
        batch_size: int = 100,
        max_retries: int = 3,
    ) -> List[List[float]]:
        """Generate embeddings for multiple texts with rate limiting.

        Args:
            texts: List of texts to embed
            batch_size: Number of texts per batch
            max_retries: Maximum retries on rate limit errors

        Returns:
            List of embedding vectors
        """
        embeddings = []
        total_batches = (len(texts) + batch_size - 1) // batch_size

        for batch_idx, i in enumerate(range(0, len(texts), batch_size)):
            batch = texts[i:i + batch_size]

            # Retry logic for rate limits
            for attempt in range(max_retries):
                try:
                    result = genai.embed_content(
                        model=self.model_name,
                        content=batch,
                        task_type="retrieval_document",
                    )
                    # Handle both single and batch responses
                    if isinstance(result["embedding"][0], list):
                        embeddings.extend(result["embedding"])
                    else:
                        embeddings.append(result["embedding"])

                    # Rate limiting: pause between batches
                    if batch_idx < total_batches - 1:
                        time.sleep(self.BATCH_DELAY)
                    break

                except Exception as e:
                    error_msg = str(e)
                    if "429" in error_msg or "quota" in error_msg.lower():
                        # Rate limit hit - extract retry delay if available
                        retry_delay = 60  # Default to 60 seconds
                        if "retry in" in error_msg.lower():
                            import re
                            match = re.search(r"retry in (\d+(?:\.\d+)?)", error_msg.lower())
                            if match:
                                retry_delay = float(match.group(1)) + 5  # Add buffer

                        if attempt < max_retries - 1:
                            logger.warning(
                                f"Rate limit hit, waiting {retry_delay:.0f}s before retry "
                                f"(attempt {attempt + 1}/{max_retries})"
                            )
                            time.sleep(retry_delay)
                        else:
                            raise
                    else:
                        raise

        return embeddings


class PageAwareRAG:
    """RAG system with page-preserving indexing.

    Every chunk has verified page metadata from OCR.
    Page numbers come from retrieval, not guessing.
    Persists index metadata to disk for reuse.
    """

    def __init__(
        self,
        gemini_api_key: str,
        db_path: str = "./chroma_citations",
        collection_name: str = "citations",
        chunk_size: int = 500,
        chunk_overlap: int = 100,
    ):
        """Initialize Page-Aware RAG.

        Args:
            gemini_api_key: Gemini API key for embeddings
            db_path: Path to ChromaDB database
            collection_name: Name of the collection
            chunk_size: Target chunk size in characters
            chunk_overlap: Overlap between chunks
        """
        self.embedder = GeminiEmbedder(gemini_api_key)
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap

        # Initialize ChromaDB with persistent storage
        self.db_path = Path(db_path)
        self.db_path.mkdir(parents=True, exist_ok=True)

        self.client = chromadb.PersistentClient(
            path=str(self.db_path),
            settings=Settings(anonymized_telemetry=False),
        )
        self.collection_name = collection_name
        self.collection = self._get_or_create_collection()

        # Metadata file for tracking indexed sources
        self._metadata_file = self.db_path / "index_metadata.json"
        self._indexed_sources: Dict[str, int] = self._load_metadata()

    def _get_or_create_collection(self) -> chromadb.Collection:
        """Get or create the citations collection."""
        return self.client.get_or_create_collection(
            name=self.collection_name,
            metadata={"hnsw:space": "cosine"},
        )

    def _load_metadata(self) -> Dict[str, int]:
        """Load indexed sources metadata from disk."""
        if self._metadata_file.exists():
            try:
                with open(self._metadata_file, "r") as f:
                    data = json.load(f)
                    return data.get("indexed_sources", {})
            except (json.JSONDecodeError, IOError):
                return {}
        return {}

    def _save_metadata(self):
        """Save indexed sources metadata to disk."""
        data = {
            "indexed_sources": self._indexed_sources,
            "collection_name": self.collection_name,
            "chunk_size": self.chunk_size,
            "chunk_overlap": self.chunk_overlap,
        }
        with open(self._metadata_file, "w") as f:
            json.dump(data, f, indent=2)

    def is_source_indexed(self, citation_key: str) -> bool:
        """Check if a source is already indexed.

        Args:
            citation_key: Citation key to check

        Returns:
            True if source is already indexed
        """
        return citation_key in self._indexed_sources and self._indexed_sources[citation_key] > 0

    def get_indexed_source_count(self, citation_key: str) -> int:
        """Get number of chunks indexed for a source.

        Args:
            citation_key: Citation key to check

        Returns:
            Number of chunks indexed (0 if not indexed)
        """
        return self._indexed_sources.get(citation_key, 0)

    def clear_collection(self):
        """Clear all data from the collection."""
        self.client.delete_collection(self.collection_name)
        self.collection = self._get_or_create_collection()
        self._indexed_sources = {}
        self._save_metadata()

    def index_pdf(
        self,
        citation_key: str,
        ocr_pages: List[OCRPage],
        authors: List[str],
        year: int,
        title: str,
        progress_callback: Optional[callable] = None,
    ) -> int:
        """Index PDF with page-aware chunking.

        Args:
            citation_key: BibTeX citation key
            ocr_pages: List of OCRPage objects from Vision OCR
            authors: List of author names
            year: Publication year
            title: Document title
            progress_callback: Optional callback(current, total)

        Returns:
            Number of chunks indexed
        """
        # Format author string
        author_str = authors[0].split()[-1] if authors else "Unknown"
        if len(authors) > 1:
            author_str += " et al."

        chunks_to_add = []
        total_pages = len(ocr_pages)

        for ocr_idx, page in enumerate(ocr_pages):
            if progress_callback:
                progress_callback(ocr_idx + 1, total_pages)

            # Skip empty pages
            if not page.text.strip():
                continue

            # Chunk the page text
            page_chunks = self._chunk_text(page.text)

            for chunk_idx, chunk_text in enumerate(page_chunks):
                # Use ocr_idx to ensure uniqueness for landscape double-page scans
                # where multiple OCR pages can have the same (pdf_page, book_page) pair
                chunk_id = f"{citation_key}_ocr{ocr_idx}_p{page.book_page}_c{chunk_idx}"

                chunks_to_add.append({
                    "id": chunk_id,
                    "text": chunk_text,
                    "metadata": {
                        "citation_key": citation_key,
                        "book_page": page.book_page,
                        "pdf_page": page.pdf_page,
                        "chunk_index": chunk_idx,
                        "authors": author_str,
                        "year": year,
                        "title": title,
                        "page_confidence": page.confidence,
                    },
                })

        if not chunks_to_add:
            return 0

        # Generate embeddings in batches
        texts = [c["text"] for c in chunks_to_add]
        embeddings = self.embedder.embed_batch(texts)

        # Add to ChromaDB
        self.collection.add(
            ids=[c["id"] for c in chunks_to_add],
            embeddings=embeddings,
            documents=texts,
            metadatas=[c["metadata"] for c in chunks_to_add],
        )

        self._indexed_sources[citation_key] = len(chunks_to_add)
        self._save_metadata()  # Persist to disk
        return len(chunks_to_add)

    def _chunk_text(self, text: str) -> List[str]:
        """Split text into overlapping chunks.

        Tries to split on sentence boundaries when possible.

        Args:
            text: Text to chunk

        Returns:
            List of text chunks
        """
        if len(text) <= self.chunk_size:
            return [text] if text.strip() else []

        chunks = []
        current_pos = 0

        while current_pos < len(text):
            # Get chunk end position
            chunk_end = current_pos + self.chunk_size

            if chunk_end >= len(text):
                # Last chunk
                chunks.append(text[current_pos:].strip())
                break

            # Try to find a sentence boundary
            chunk_text = text[current_pos:chunk_end]
            last_period = max(
                chunk_text.rfind(". "),
                chunk_text.rfind(".\n"),
                chunk_text.rfind("? "),
                chunk_text.rfind("! "),
            )

            if last_period > self.chunk_size // 2:
                # Found a good sentence boundary
                chunk_end = current_pos + last_period + 1
                chunks.append(text[current_pos:chunk_end].strip())
                current_pos = chunk_end - self.chunk_overlap
            else:
                # No good boundary, split at word boundary
                last_space = chunk_text.rfind(" ")
                if last_space > self.chunk_size // 2:
                    chunk_end = current_pos + last_space
                chunks.append(text[current_pos:chunk_end].strip())
                current_pos = chunk_end - self.chunk_overlap

            # Ensure we make progress
            if current_pos >= chunk_end:
                current_pos = chunk_end

        return [c for c in chunks if c]

    def query(
        self,
        text: str,
        n_results: int = 20,
        min_similarity: float = 0.3,
        filter_sources: Optional[List[str]] = None,
    ) -> List[RetrievedChunk]:
        """Query across all indexed PDFs.

        Args:
            text: Query text
            n_results: Maximum number of results
            min_similarity: Minimum similarity threshold
            filter_sources: Optional list of citation_keys to filter by

        Returns:
            List of RetrievedChunk objects with verified page numbers
        """
        # Generate query embedding
        query_embedding = self.embedder.embed_query(text)

        # Build where filter if needed
        where_filter = None
        if filter_sources:
            where_filter = {"citation_key": {"$in": filter_sources}}

        # Query ChromaDB
        results = self.collection.query(
            query_embeddings=[query_embedding],
            n_results=n_results,
            where=where_filter,
            include=["documents", "metadatas", "distances"],
        )

        if not results["ids"] or not results["ids"][0]:
            return []

        # Convert to RetrievedChunk objects
        chunks = []
        for i, chunk_id in enumerate(results["ids"][0]):
            # ChromaDB returns distances, convert to similarity
            distance = results["distances"][0][i]
            similarity = 1.0 - distance  # Cosine distance to similarity

            if similarity < min_similarity:
                continue

            metadata = results["metadatas"][0][i]
            document = results["documents"][0][i]

            chunks.append(RetrievedChunk(
                chunk_id=chunk_id,
                text=document,
                citation_key=metadata["citation_key"],
                book_page=metadata["book_page"],
                pdf_page=metadata["pdf_page"],
                similarity=similarity,
                authors=metadata.get("authors", ""),
                year=metadata.get("year", 0),
                title=metadata.get("title", ""),
            ))

        # Sort by similarity (highest first)
        chunks.sort(key=lambda x: x.similarity, reverse=True)
        return chunks

    def query_for_paragraph(
        self,
        paragraph: str,
        n_results: int = 30,
    ) -> List[RetrievedChunk]:
        """Query specifically for citation matching.

        Returns more results and includes diverse sources.

        Args:
            paragraph: Paragraph text to find citations for
            n_results: Number of results to return

        Returns:
            List of RetrievedChunk objects
        """
        return self.query(paragraph, n_results=n_results, min_similarity=0.25)

    def get_indexed_sources(self) -> Dict[str, int]:
        """Get dictionary of indexed sources and chunk counts."""
        return self._indexed_sources.copy()

    def get_total_chunks(self) -> int:
        """Get total number of indexed chunks."""
        return self.collection.count()

    def get_source_chunks(self, citation_key: str) -> List[RetrievedChunk]:
        """Get all chunks for a specific source.

        Args:
            citation_key: Source citation key

        Returns:
            List of all chunks from that source
        """
        results = self.collection.get(
            where={"citation_key": citation_key},
            include=["documents", "metadatas"],
        )

        if not results["ids"]:
            return []

        chunks = []
        for i, chunk_id in enumerate(results["ids"]):
            metadata = results["metadatas"][i]
            document = results["documents"][i]

            chunks.append(RetrievedChunk(
                chunk_id=chunk_id,
                text=document,
                citation_key=metadata["citation_key"],
                book_page=metadata["book_page"],
                pdf_page=metadata["pdf_page"],
                similarity=1.0,  # Not from query
                authors=metadata.get("authors", ""),
                year=metadata.get("year", 0),
                title=metadata.get("title", ""),
            ))

        return chunks


def create_rag_from_ocr_pages(
    gemini_api_key: str,
    bibliography: List[Dict[str, Any]],
    db_path: str = "./chroma_citations",
    progress_callback: Optional[callable] = None,
) -> PageAwareRAG:
    """Create and populate PageAwareRAG from OCR pages.

    Args:
        gemini_api_key: Gemini API key
        bibliography: List of dicts with keys:
            - citation_key: str
            - ocr_pages: List[OCRPage]
            - authors: List[str]
            - year: int
            - title: str
        db_path: Path to ChromaDB database
        progress_callback: Optional callback(source_name, current, total)

    Returns:
        Populated PageAwareRAG instance
    """
    rag = PageAwareRAG(gemini_api_key, db_path)
    rag.clear_collection()  # Start fresh

    total_sources = len(bibliography)
    total_chunks = 0

    for i, entry in enumerate(bibliography):
        if progress_callback:
            progress_callback(entry["citation_key"], i + 1, total_sources)

        chunks_added = rag.index_pdf(
            citation_key=entry["citation_key"],
            ocr_pages=entry["ocr_pages"],
            authors=entry.get("authors", []),
            year=entry.get("year", 0),
            title=entry.get("title", ""),
        )
        total_chunks += chunks_added

    return rag
