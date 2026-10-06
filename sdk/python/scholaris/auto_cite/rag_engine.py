"""RAG (Retrieval-Augmented Generation) engine for large bibliographies.

This module implements a vector-based retrieval system for handling bibliographies
with 50+ papers. Instead of loading all papers into context, it:
1. Stores paper chunks in ChromaDB vector database
2. Retrieves only relevant chunks for each claim
3. Sends targeted context to Gemini for citation matching

This dramatically reduces token usage, cost, and processing time while maintaining
accuracy for large bibliographies.
"""

import logging
import hashlib
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass
from pathlib import Path

try:
    import chromadb
    from chromadb.config import Settings
    CHROMADB_AVAILABLE = True
except ImportError:
    CHROMADB_AVAILABLE = False
    chromadb = None

import google.generativeai as genai

from .models import PageAwarePDF, Citation, CitationStyle

logger = logging.getLogger(__name__)


@dataclass
class PaperChunk:
    """A chunk of text from a paper with metadata."""
    chunk_id: str
    citation_key: str
    pdf_page_number: int
    journal_page_number: int
    text: str
    chunk_index: int
    metadata: Dict[str, Any]


class RAGCitationEngine:
    """Citation engine using RAG for large bibliographies (50+ papers).

    This engine uses vector similarity search to retrieve only relevant
    paper chunks for each claim, dramatically reducing token usage and cost.
    """

    def __init__(
        self,
        api_key: str,
        model: str = "gemini-3-flash-preview",
        embedding_model: str = "models/gemini-embedding-001",
        chunk_size: int = 800,
        chunk_overlap: int = 100,
        top_k_chunks: int = 20,
        db_path: str = "./chroma_db",
    ):
        """Initialize RAG citation engine.

        Args:
            api_key: Google Gemini API key
            model: Gemini model for citation matching (default: gemini-3-flash-preview)
            embedding_model: Gemini embedding model (default: gemini-embedding-001)
            chunk_size: Size of text chunks in tokens (approximate)
            chunk_overlap: Overlap between chunks in tokens
            top_k_chunks: Number of chunks to retrieve per claim
            db_path: Path to ChromaDB storage
        """
        if not CHROMADB_AVAILABLE:
            raise ImportError(
                "ChromaDB not installed. Install with: pip install chromadb"
            )

        self.api_key = api_key
        self.model = model
        self.embedding_model = embedding_model
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.top_k_chunks = top_k_chunks
        self.db_path = Path(db_path)

        # Configure Gemini
        genai.configure(api_key=api_key)
        self.client = genai.GenerativeModel(model)

        # Initialize ChromaDB
        self.chroma_client = chromadb.PersistentClient(
            path=str(self.db_path),
            settings=Settings(anonymized_telemetry=False)
        )

        logger.info(f"RAG citation engine initialized: model={model}, db={db_path}")

    def index_bibliography(
        self,
        bibliography: List[PageAwarePDF],
        collection_name: str = "citations",
    ) -> str:
        """Index bibliography into vector database.

        Args:
            bibliography: List of PageAwarePDF objects
            collection_name: ChromaDB collection name

        Returns:
            Collection ID for future retrieval
        """
        logger.info(f"Indexing {len(bibliography)} papers into vector database...")

        # Create unique collection name based on bibliography
        bib_hash = self._hash_bibliography(bibliography)
        collection_id = f"{collection_name}_{bib_hash}"

        # Check if already indexed
        try:
            collection = self.chroma_client.get_collection(collection_id)
            logger.info(f"✓ Bibliography already indexed: {collection_id}")
            return collection_id
        except Exception:
            # Collection doesn't exist, create it
            pass

        # Create collection
        collection = self.chroma_client.create_collection(
            name=collection_id,
            metadata={"description": f"Citation corpus with {len(bibliography)} papers"}
        )

        # Chunk all papers
        logger.info("Chunking papers...")
        all_chunks = []
        for pdf in bibliography:
            chunks = self._chunk_paper(pdf)
            all_chunks.extend(chunks)

        logger.info(f"✓ Created {len(all_chunks)} chunks from {len(bibliography)} papers")

        # Embed and store chunks in batches
        batch_size = 100
        for i in range(0, len(all_chunks), batch_size):
            batch = all_chunks[i:i + batch_size]
            self._embed_and_store_batch(batch, collection)
            logger.info(f"  Indexed {min(i + batch_size, len(all_chunks))}/{len(all_chunks)} chunks")

        logger.info(f"✓ Bibliography indexed: {collection_id}")
        return collection_id

    def retrieve_relevant_sources(
        self,
        claim: str,
        collection_id: str,
        top_k: Optional[int] = None,
    ) -> List[Tuple[PaperChunk, float]]:
        """Retrieve relevant paper chunks for a claim.

        Args:
            claim: Claim text to find sources for
            collection_id: ChromaDB collection ID
            top_k: Number of chunks to retrieve (default: self.top_k_chunks)

        Returns:
            List of (chunk, similarity_score) tuples
        """
        if top_k is None:
            top_k = self.top_k_chunks

        # Get collection
        collection = self.chroma_client.get_collection(collection_id)

        # Embed claim
        claim_embedding = self._embed_text(claim)

        # Query vector database
        results = collection.query(
            query_embeddings=[claim_embedding],
            n_results=top_k,
            include=["documents", "metadatas", "distances"]
        )

        # Convert to PaperChunk objects
        chunks = []
        for i, (doc, metadata, distance) in enumerate(zip(
            results['documents'][0],
            results['metadatas'][0],
            results['distances'][0]
        )):
            chunk = PaperChunk(
                chunk_id=metadata['chunk_id'],
                citation_key=metadata['citation_key'],
                pdf_page_number=metadata['pdf_page_number'],
                journal_page_number=metadata['journal_page_number'],
                text=doc,
                chunk_index=metadata['chunk_index'],
                metadata=metadata
            )
            # Convert distance to similarity (smaller distance = higher similarity)
            similarity = 1 / (1 + distance)
            chunks.append((chunk, similarity))

        return chunks

    def analyze_and_cite(
        self,
        document_text: str,
        bibliography: List[PageAwarePDF],
        style: CitationStyle,
        max_citations_per_claim: int = 3,
    ) -> List[Citation]:
        """Analyze document and generate citations using RAG mode.

        Args:
            document_text: User's document text
            bibliography: List of PageAwarePDF objects
            style: Citation style
            max_citations_per_claim: Max citations per claim

        Returns:
            List of Citation objects
        """
        logger.info(
            f"RAG mode: Analyzing document ({len(document_text)} chars) "
            f"against {len(bibliography)} sources"
        )

        # Index bibliography
        collection_id = self.index_bibliography(bibliography)

        # Extract claims from document
        claims = self._extract_claims(document_text)
        logger.info(f"Extracted {len(claims)} claims from document")

        # Process each claim
        all_citations = []
        for i, claim in enumerate(claims, 1):
            logger.info(f"Processing claim {i}/{len(claims)}: {claim[:60]}...")

            # Retrieve relevant chunks
            relevant_chunks = self.retrieve_relevant_sources(claim, collection_id)

            # Group chunks by source paper
            sources_by_paper = self._group_chunks_by_paper(relevant_chunks, bibliography)

            # Generate citations for this claim
            citations = self._generate_citations_for_claim(
                claim=claim,
                sources=sources_by_paper,
                style=style,
                max_citations=max_citations_per_claim
            )

            all_citations.extend(citations)

        logger.info(f"✓ Generated {len(all_citations)} citations using RAG mode")
        return all_citations

    def _hash_bibliography(self, bibliography: List[PageAwarePDF]) -> str:
        """Create hash of bibliography for collection ID."""
        keys = sorted([pdf.citation_key for pdf in bibliography])
        hash_input = "|".join(keys).encode()
        return hashlib.md5(hash_input).hexdigest()[:8]

    def _chunk_paper(self, pdf: PageAwarePDF) -> List[PaperChunk]:
        """Split paper into chunks with metadata.

        Args:
            pdf: PageAwarePDF object

        Returns:
            List of PaperChunk objects
        """
        chunks = []
        chunk_index = 0

        for page in pdf.pages:
            # Split page text into paragraphs
            paragraphs = page.text_content.split('\n\n')

            current_chunk = []
            current_length = 0

            for paragraph in paragraphs:
                para_length = len(paragraph.split())

                # If adding this paragraph exceeds chunk size, save current chunk
                if current_length + para_length > self.chunk_size and current_chunk:
                    chunk_text = '\n\n'.join(current_chunk)
                    chunk_id = f"{pdf.citation_key}_p{page.pdf_page_number}_c{chunk_index}"

                    chunks.append(PaperChunk(
                        chunk_id=chunk_id,
                        citation_key=pdf.citation_key,
                        pdf_page_number=page.pdf_page_number,
                        journal_page_number=page.journal_page_number,
                        text=chunk_text,
                        chunk_index=chunk_index,
                        metadata={
                            'chunk_id': chunk_id,
                            'citation_key': pdf.citation_key,
                            'pdf_page_number': page.pdf_page_number,
                            'journal_page_number': page.journal_page_number,
                            'chunk_index': chunk_index,
                            'title': pdf.reference.title,
                            'authors': ', '.join(pdf.reference.authors[:3]),
                            'year': pdf.reference.year,
                        }
                    ))

                    # Start new chunk with overlap
                    if self.chunk_overlap > 0:
                        current_chunk = current_chunk[-1:]  # Keep last paragraph for overlap
                        current_length = len(current_chunk[0].split()) if current_chunk else 0
                    else:
                        current_chunk = []
                        current_length = 0

                    chunk_index += 1

                current_chunk.append(paragraph)
                current_length += para_length

            # Save remaining chunk
            if current_chunk:
                chunk_text = '\n\n'.join(current_chunk)
                chunk_id = f"{pdf.citation_key}_p{page.pdf_page_number}_c{chunk_index}"

                chunks.append(PaperChunk(
                    chunk_id=chunk_id,
                    citation_key=pdf.citation_key,
                    pdf_page_number=page.pdf_page_number,
                    journal_page_number=page.journal_page_number,
                    text=chunk_text,
                    chunk_index=chunk_index,
                    metadata={
                        'chunk_id': chunk_id,
                        'citation_key': pdf.citation_key,
                        'pdf_page_number': page.pdf_page_number,
                        'journal_page_number': page.journal_page_number,
                        'chunk_index': chunk_index,
                        'title': pdf.reference.title,
                        'authors': ', '.join(pdf.reference.authors[:3]),
                        'year': pdf.reference.year,
                    }
                ))
                chunk_index += 1

        return chunks

    def _embed_text(self, text: str) -> List[float]:
        """Generate embedding for text using Gemini.

        Args:
            text: Text to embed

        Returns:
            Embedding vector
        """
        result = genai.embed_content(
            model=self.embedding_model,
            content=text,
            task_type="retrieval_document"
        )
        return result['embedding']

    def _embed_and_store_batch(
        self,
        chunks: List[PaperChunk],
        collection: Any,
    ):
        """Embed and store a batch of chunks.

        Args:
            chunks: List of PaperChunk objects
            collection: ChromaDB collection
        """
        # Prepare data for batch embedding
        texts = [chunk.text for chunk in chunks]

        # Embed batch
        embeddings = []
        for text in texts:
            embedding = self._embed_text(text)
            embeddings.append(embedding)

        # Store in ChromaDB
        collection.add(
            embeddings=embeddings,
            documents=texts,
            metadatas=[chunk.metadata for chunk in chunks],
            ids=[chunk.chunk_id for chunk in chunks]
        )

    def _extract_claims(self, document_text: str) -> List[str]:
        """Extract individual claims from document.

        For now, splits by sentences. In future, could use more
        sophisticated claim extraction.

        Args:
            document_text: Full document text

        Returns:
            List of claim sentences
        """
        # Simple sentence splitting (improved version can use NLP)
        import re
        sentences = re.split(r'[.!?]+', document_text)
        claims = [s.strip() for s in sentences if len(s.strip()) > 20]
        return claims

    def _group_chunks_by_paper(
        self,
        chunks_with_scores: List[Tuple[PaperChunk, float]],
        bibliography: List[PageAwarePDF],
    ) -> Dict[str, Dict[str, Any]]:
        """Group retrieved chunks by source paper.

        Args:
            chunks_with_scores: List of (chunk, similarity) tuples
            bibliography: Full bibliography

        Returns:
            Dict mapping citation_key to {pdf, chunks, max_similarity}
        """
        sources = {}

        for chunk, similarity in chunks_with_scores:
            key = chunk.citation_key

            if key not in sources:
                # Find PDF in bibliography
                pdf = next((p for p in bibliography if p.citation_key == key), None)
                if not pdf:
                    continue

                sources[key] = {
                    'pdf': pdf,
                    'chunks': [],
                    'max_similarity': 0.0
                }

            sources[key]['chunks'].append((chunk, similarity))
            sources[key]['max_similarity'] = max(
                sources[key]['max_similarity'],
                similarity
            )

        return sources

    def _generate_citations_for_claim(
        self,
        claim: str,
        sources: Dict[str, Dict[str, Any]],
        style: CitationStyle,
        max_citations: int,
    ) -> List[Citation]:
        """Generate citations for a single claim using retrieved sources.

        Args:
            claim: Claim text
            sources: Dict of sources with chunks
            style: Citation style
            max_citations: Max citations to generate

        Returns:
            List of Citation objects
        """
        # Build compact context from top sources
        sorted_sources = sorted(
            sources.items(),
            key=lambda x: x[1]['max_similarity'],
            reverse=True
        )[:max_citations]

        if not sorted_sources:
            return []

        # Build prompt with retrieved context
        context_parts = []
        for citation_key, source_data in sorted_sources:
            pdf = source_data['pdf']
            chunks = source_data['chunks'][:3]  # Top 3 chunks per source

            header = f"\n[Source: {citation_key}]\n"
            header += f"Title: {pdf.reference.title}\n"
            header += f"Authors: {', '.join(pdf.reference.authors[:3])}\n"
            header += f"Year: {pdf.reference.year}\n\n"

            chunk_texts = []
            for chunk, similarity in chunks:
                chunk_texts.append(
                    f"[Page {chunk.journal_page_number}]: {chunk.text[:500]}..."
                )

            context_parts.append(header + '\n\n'.join(chunk_texts))

        full_context = '\n'.join(context_parts)

        # Prompt Gemini for citation
        prompt = f"""You are an expert academic citation assistant. Determine if the following claim needs citations from the provided sources.

Claim: "{claim}"

Relevant Sources:
{full_context}

Task: If this claim should be cited with any of these sources, respond with JSON:
{{
  "should_cite": true,
  "citations": [
    {{
      "citation_key": "key",
      "page_number": 123,
      "confidence": 0.9,
      "reason": "brief explanation"
    }}
  ]
}}

If no citation needed, respond with: {{"should_cite": false}}

Be conservative - only suggest citations with clear evidence."""

        try:
            response = self.client.generate_content(prompt)
            # Parse response and create Citation objects
            import json
            response_text = response.text

            # Extract JSON
            if "```json" in response_text:
                json_start = response_text.index("```json") + 7
                json_end = response_text.index("```", json_start)
                json_text = response_text[json_start:json_end].strip()
            elif "{" in response_text:
                json_start = response_text.index("{")
                json_end = response_text.rindex("}") + 1
                json_text = response_text[json_start:json_end]
            else:
                return []

            data = json.loads(json_text)

            if not data.get('should_cite', False):
                return []

            citations = []
            for cite_data in data.get('citations', []):
                citation_key = cite_data['citation_key']
                if citation_key not in sources:
                    continue

                pdf = sources[citation_key]['pdf']

                citation = Citation(
                    source_pdf=pdf,
                    page_number=cite_data['page_number'],
                    claim_text=claim,
                    evidence_text=cite_data.get('reason', ''),
                    confidence=cite_data.get('confidence', 0.7),
                )

                # Format citation
                if style == CitationStyle.APA7:
                    citation.citation_string = citation.format_apa7()
                else:
                    citation.citation_string = citation.format_chicago17()

                citations.append(citation)

            return citations

        except Exception as e:
            logger.error(f"Error generating citation for claim: {e}")
            return []
