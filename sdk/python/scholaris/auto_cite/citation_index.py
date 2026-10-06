"""CitationIndex: Runtime index for citation matching across multiple sources.

Loads multiple .spdf files and provides unified search and citation generation.
Supports auto-processing of bibliography folders.
"""

import logging
from pathlib import Path
from typing import List, Dict, Any, Optional, Union, Tuple
from dataclasses import dataclass

import numpy as np

import re

from .processed_pdf import ProcessedPDF, SUPPORTED_EXTENSIONS
from .models import CitationStyle, RetrievedChunk, CitationResult

logger = logging.getLogger(__name__)


@dataclass
class IndexedSource:
    """A source in the citation index."""
    citation_key: str
    processed_pdf: ProcessedPDF
    chunk_offset: int  # Offset in global embedding matrix
    chunk_count: int
    source_type: str  # "spdf" or "auto-processed"


class CitationIndex:
    """Runtime index for citation matching across multiple sources.

    Loads multiple .spdf files and provides:
    - Unified vector search across all sources
    - Citation generation with verified page numbers
    - Bibliography folder auto-processing

    Example usage:
        # From bibliography folder
        index = CitationIndex.from_bibliography(
            folder="./bibliography/",
            gemini_api_key="...",
            auto_process=True,
        )

        # Generate citations
        citations = index.cite(
            document_text="Your research...",
            style=CitationStyle.APA7,
        )

        # Or build manually
        index = CitationIndex()
        index.add(ProcessedPDF.load("source1.spdf"))
        index.add(ProcessedPDF.load("source2.spdf"))
    """

    def __init__(self, gemini_api_key: Optional[str] = None):
        """Initialize empty index.

        Args:
            gemini_api_key: API key for querying (embeddings) and citations
        """
        self._sources: Dict[str, IndexedSource] = {}
        self._embedding_matrix: Optional[np.ndarray] = None
        self._chunk_lookup: List[Tuple[str, int]] = []  # (citation_key, chunk_id) for each row
        self._gemini_api_key = gemini_api_key
        self._embedder = None
        self._bibliography_folder: Optional[Path] = None
        self._needs_rebuild = False

    def add(self, processed_pdf: ProcessedPDF) -> None:
        """Add a processed PDF to the index.

        Args:
            processed_pdf: ProcessedPDF instance to add
        """
        if not processed_pdf.metadata:
            raise ValueError("ProcessedPDF has no metadata")

        citation_key = processed_pdf.metadata.citation_key

        if citation_key in self._sources:
            logger.warning(f"Replacing existing source: {citation_key}")
            # Remove old entries from chunk_lookup and rebuild
            del self._sources[citation_key]
            self._chunk_lookup = []
            for source in self._sources.values():
                source.chunk_offset = len(self._chunk_lookup)
                for i, chunk in enumerate(source.processed_pdf.chunks):
                    self._chunk_lookup.append((source.citation_key, i))

        chunk_offset = len(self._chunk_lookup)

        self._sources[citation_key] = IndexedSource(
            citation_key=citation_key,
            processed_pdf=processed_pdf,
            chunk_offset=chunk_offset,
            chunk_count=len(processed_pdf.chunks),
            source_type="spdf",
        )

        # Add to chunk lookup - store index position, not chunk.id
        for i, chunk in enumerate(processed_pdf.chunks):
            self._chunk_lookup.append((citation_key, i))  # Use index, not chunk.id

        self._needs_rebuild = True
        logger.info(f"Added source: {citation_key} ({len(processed_pdf.chunks)} chunks)")

    def add_many(self, processed_pdfs: List[ProcessedPDF]) -> None:
        """Add multiple processed PDFs.

        Args:
            processed_pdfs: List of ProcessedPDF instances
        """
        for pdf in processed_pdfs:
            self.add(pdf)

    def add_directory(self, folder: Union[str, Path]) -> int:
        """Load all .spdf files from a directory.

        Args:
            folder: Path to directory

        Returns:
            Number of files loaded
        """
        folder = Path(folder)
        if not folder.is_dir():
            raise ValueError(f"Not a directory: {folder}")

        count = 0
        for ext in SUPPORTED_EXTENSIONS:
            for path in folder.glob(f"*{ext}"):
                try:
                    processed = ProcessedPDF.load(path)
                    self.add(processed)
                    count += 1
                except Exception as e:
                    logger.error(f"Failed to load {path}: {e}")

        logger.info(f"Loaded {count} .spdf files from {folder}")
        return count

    @classmethod
    def from_bibliography(
        cls,
        folder: Union[str, Path],
        gemini_api_key: Optional[str] = None,
        auto_process: bool = True,
        save_processed: bool = True,
        include_previews: bool = True,
        metadata_map: Optional[Dict[str, Dict[str, Any]]] = None,
    ) -> "CitationIndex":
        """Create index from a bibliography folder.

        Automatically:
        1. Loads all .spdf/.scholaris/.scpdf files
        2. Processes .pdf files that don't have corresponding .spdf
        3. Optionally saves processed files for future reuse

        Args:
            folder: Path to bibliography folder
            gemini_api_key: API key for processing and querying
            auto_process: Process PDFs without existing .spdf
            save_processed: Save .spdf files after processing
            include_previews: Include previews in processed files
            metadata_map: Dict mapping PDF filename to metadata:
                {"paper.pdf": {"citation_key": "...", "authors": [...], ...}}

        Returns:
            CitationIndex with all sources loaded
        """
        folder = Path(folder)
        if not folder.is_dir():
            raise ValueError(f"Not a directory: {folder}")

        index = cls(gemini_api_key=gemini_api_key)
        index._bibliography_folder = folder

        # Find all spdf files
        spdf_files = []
        for ext in SUPPORTED_EXTENSIONS:
            spdf_files.extend(folder.glob(f"*{ext}"))

        spdf_keys = set()
        for path in spdf_files:
            # Get citation key from the file
            stem = path.stem
            spdf_keys.add(stem)

        # Load existing spdf files
        logger.info(f"Found {len(spdf_files)} .spdf files in {folder}")
        for path in spdf_files:
            try:
                processed = ProcessedPDF.load(path)
                index.add(processed)
            except Exception as e:
                logger.error(f"Failed to load {path}: {e}")

        # Find PDFs without corresponding spdf
        if auto_process and gemini_api_key:
            pdf_files = list(folder.glob("*.pdf")) + list(folder.glob("*.PDF"))

            pdfs_to_process = []
            for pdf_path in pdf_files:
                stem = pdf_path.stem
                # Check if any spdf exists for this PDF
                has_spdf = any(
                    (folder / f"{stem}{ext}").exists()
                    for ext in SUPPORTED_EXTENSIONS
                )
                if not has_spdf:
                    pdfs_to_process.append(pdf_path)

            if pdfs_to_process:
                logger.info(f"Auto-processing {len(pdfs_to_process)} PDF files...")

                for pdf_path in pdfs_to_process:
                    try:
                        # Get metadata from map or generate defaults
                        meta = (metadata_map or {}).get(pdf_path.name, {})
                        citation_key = meta.get("citation_key", pdf_path.stem)
                        authors = meta.get("authors", [])
                        year = meta.get("year", 0)
                        title = meta.get("title", pdf_path.stem)

                        logger.info(f"Processing: {pdf_path.name}")

                        processed = ProcessedPDF.from_pdf(
                            pdf_path=pdf_path,
                            citation_key=citation_key,
                            authors=authors,
                            year=year,
                            title=title,
                            gemini_api_key=gemini_api_key,
                            include_previews=include_previews,
                        )

                        # Save if requested
                        if save_processed:
                            spdf_path = pdf_path.with_suffix(".spdf")
                            processed.save(spdf_path)
                            logger.info(f"Saved: {spdf_path.name}")

                        # Mark as auto-processed
                        index.add(processed)
                        if citation_key in index._sources:
                            index._sources[citation_key].source_type = "auto-processed"

                    except Exception as e:
                        logger.error(f"Failed to process {pdf_path}: {e}")

        # Build the index
        index._build_index()

        return index

    def _build_index(self) -> None:
        """Build the embedding matrix for fast search."""
        if not self._sources:
            self._embedding_matrix = None
            return

        # Collect all embeddings
        embeddings = []
        for source in self._sources.values():
            embeddings.extend(source.processed_pdf.embeddings)

        if embeddings:
            self._embedding_matrix = np.vstack(embeddings)
            logger.info(f"Built index: {self._embedding_matrix.shape[0]} chunks, {self._embedding_matrix.shape[1]} dims")
        else:
            self._embedding_matrix = None

        self._needs_rebuild = False

    def _ensure_index(self) -> None:
        """Ensure index is built."""
        if self._needs_rebuild or self._embedding_matrix is None:
            self._build_index()

    def _get_embedder(self):
        """Get or create embedder."""
        if self._embedder is None:
            if not self._gemini_api_key:
                raise ValueError("No API key provided for embedding queries")
            from .page_aware_rag import GeminiEmbedder
            self._embedder = GeminiEmbedder(self._gemini_api_key)
        return self._embedder

    def query(
        self,
        text: str,
        n_results: int = 20,
        min_similarity: float = 0.3,
        filter_sources: Optional[List[str]] = None,
    ) -> List[RetrievedChunk]:
        """Query the index for relevant chunks.

        Args:
            text: Query text
            n_results: Maximum results
            min_similarity: Minimum cosine similarity threshold
            filter_sources: Optional list of citation_keys to filter by

        Returns:
            List of RetrievedChunk objects
        """
        self._ensure_index()

        if self._embedding_matrix is None or len(self._embedding_matrix) == 0:
            return []

        # Embed query
        embedder = self._get_embedder()
        query_embedding = np.array(embedder.embed(text), dtype=np.float32)

        # Compute cosine similarities
        # Normalize query
        query_norm_val = np.linalg.norm(query_embedding)
        if query_norm_val < 1e-10:
            return []
        query_norm = query_embedding / query_norm_val

        # Normalize matrix (row-wise)
        norms = np.linalg.norm(self._embedding_matrix, axis=1, keepdims=True)
        # Avoid division by zero
        norms = np.where(norms < 1e-10, 1.0, norms)
        matrix_norm = self._embedding_matrix / norms

        # Dot product for cosine similarity
        similarities = np.dot(matrix_norm, query_norm)
        # Handle any NaN values
        similarities = np.nan_to_num(similarities, nan=0.0)

        # Get top indices
        top_indices = np.argsort(similarities)[::-1]

        # Build results
        chunks = []
        for idx in top_indices:
            if len(chunks) >= n_results:
                break

            similarity = float(similarities[idx])
            if similarity < min_similarity:
                continue

            citation_key, chunk_id = self._chunk_lookup[idx]

            # Apply source filter
            if filter_sources and citation_key not in filter_sources:
                continue

            source = self._sources[citation_key]
            chunk_data = source.processed_pdf.chunks[chunk_id]

            chunk_text = chunk_data.text if chunk_data.text else ""
            chunks.append(RetrievedChunk(
                chunk_id=f"{citation_key}_p{chunk_data.book_page}_c{chunk_data.chunk_index}",
                citation_key=citation_key,
                text=chunk_text,
                book_page=chunk_data.book_page,
                pdf_page=chunk_data.pdf_page,
                similarity=similarity,
                authors=", ".join(source.processed_pdf.metadata.authors) if source.processed_pdf.metadata.authors else "",
                year=source.processed_pdf.metadata.year,
                title=source.processed_pdf.metadata.title,
                chunk_index=chunk_data.chunk_index,
            ))

        return chunks

    def cite(
        self,
        document_text: str,
        style: CitationStyle = CitationStyle.APA7,
        max_citations_per_claim: int = 3,
        batch_size: int = 4,
        exporter: Optional[Any] = None,
    ) -> List[Any]:
        """Generate citations for a document.

        Args:
            document_text: Text to add citations to
            style: Citation style (APA7 or CHICAGO17)
            max_citations_per_claim: Maximum citations per claim
            batch_size: Paragraphs to process in parallel
            exporter: Optional CitationExporter for tracking

        Returns:
            List of GroundedCitation objects
        """
        if not self._gemini_api_key:
            raise ValueError("No API key provided for citation generation")

        self._ensure_index()

        from .citation_engine import GeminiCitationEngine

        engine = GeminiCitationEngine(api_key=self._gemini_api_key, model="gemini-3-flash-preview")

        # Create a RAG-like interface for the engine
        index_rag = _CitationIndexRAGAdapter(self)

        citations = engine.analyze_with_grounded_rag(
            document_text=document_text,
            rag=index_rag,
            style=style,
            max_citations_per_claim=max_citations_per_claim,
            batch_size=batch_size,
            exporter=exporter,
        )

        return citations

    def sources(self) -> List[Dict[str, Any]]:
        """List all sources in the index.

        Returns:
            List of source info dicts
        """
        result = []
        for key, source in self._sources.items():
            meta = source.processed_pdf.metadata
            result.append({
                "citation_key": key,
                "title": meta.title if meta else "",
                "authors": meta.authors if meta else [],
                "year": meta.year if meta else 0,
                "chunks": source.chunk_count,
                "pages": meta.total_pages if meta else 0,
                "source_type": source.source_type,
            })
        return result

    def get_source(self, citation_key: str) -> Optional[ProcessedPDF]:
        """Get a specific source by citation key.

        Args:
            citation_key: Citation key to look up

        Returns:
            ProcessedPDF or None
        """
        source = self._sources.get(citation_key)
        return source.processed_pdf if source else None

    def remove(self, citation_key: str) -> bool:
        """Remove a source from the index.

        Args:
            citation_key: Citation key to remove

        Returns:
            True if removed, False if not found
        """
        if citation_key not in self._sources:
            return False

        del self._sources[citation_key]

        # Rebuild chunk lookup - use index, not chunk.id
        self._chunk_lookup = []
        for source in self._sources.values():
            source.chunk_offset = len(self._chunk_lookup)
            for i, chunk in enumerate(source.processed_pdf.chunks):
                self._chunk_lookup.append((source.citation_key, i))

        self._needs_rebuild = True
        logger.info(f"Removed source: {citation_key}")
        return True

    def refresh(self) -> int:
        """Re-scan bibliography folder for new files.

        Returns:
            Number of new files processed
        """
        if not self._bibliography_folder:
            raise ValueError("No bibliography folder set. Use from_bibliography() first.")

        if not self._gemini_api_key:
            raise ValueError("No API key available for processing new files")

        # Find new PDFs
        existing_keys = set(self._sources.keys())
        folder = self._bibliography_folder

        new_count = 0

        # Check for new spdf files
        for ext in SUPPORTED_EXTENSIONS:
            for path in folder.glob(f"*{ext}"):
                stem = path.stem
                if stem not in existing_keys:
                    try:
                        processed = ProcessedPDF.load(path)
                        self.add(processed)
                        new_count += 1
                    except Exception as e:
                        logger.error(f"Failed to load {path}: {e}")

        # Check for new PDFs without spdf
        for pdf_path in folder.glob("*.pdf"):
            stem = pdf_path.stem
            if stem not in existing_keys and stem not in self._sources:
                has_spdf = any(
                    (folder / f"{stem}{ext}").exists()
                    for ext in SUPPORTED_EXTENSIONS
                )
                if not has_spdf:
                    try:
                        processed = ProcessedPDF.from_pdf(
                            pdf_path=pdf_path,
                            citation_key=stem,
                            authors=[],
                            year=0,
                            title=stem,
                            gemini_api_key=self._gemini_api_key,
                        )
                        processed.save(pdf_path.with_suffix(".spdf"))
                        self.add(processed)
                        self._sources[stem].source_type = "auto-processed"
                        new_count += 1
                    except Exception as e:
                        logger.error(f"Failed to process {pdf_path}: {e}")

        if new_count > 0:
            self._build_index()

        logger.info(f"Refresh complete: {new_count} new sources")
        return new_count

    def save(self, path: Union[str, Path]) -> str:
        """Save index state for faster reload.

        Note: This saves the index metadata, not the full data.
        The .spdf files must still exist for full reload.

        Args:
            path: Output path (will add .idx extension)

        Returns:
            Path to saved file
        """
        import json

        path = Path(path)
        if path.suffix != ".idx":
            path = path.with_suffix(".idx")

        data = {
            "version": 1,
            "bibliography_folder": str(self._bibliography_folder) if self._bibliography_folder else None,
            "sources": [
                {
                    "citation_key": s.citation_key,
                    "source_type": s.source_type,
                    "chunk_count": s.chunk_count,
                    "source_path": s.processed_pdf._source_path,
                }
                for s in self._sources.values()
            ],
        }

        path.write_text(json.dumps(data, indent=2), encoding="utf-8")
        logger.info(f"Saved index: {path}")
        return str(path)

    @classmethod
    def load_index(cls, path: Union[str, Path], gemini_api_key: Optional[str] = None) -> "CitationIndex":
        """Load index state and reload sources.

        Args:
            path: Path to .idx file
            gemini_api_key: API key for querying

        Returns:
            CitationIndex with sources reloaded
        """
        import json

        path = Path(path)
        if not path.exists():
            raise FileNotFoundError(f"Index file not found: {path}")

        data = json.loads(path.read_text(encoding="utf-8"))

        index = cls(gemini_api_key=gemini_api_key)

        if data.get("bibliography_folder"):
            index._bibliography_folder = Path(data["bibliography_folder"])

        # Reload sources
        for source_info in data.get("sources", []):
            source_path = source_info.get("source_path")
            if source_path and Path(source_path).exists():
                try:
                    processed = ProcessedPDF.load(source_path)
                    index.add(processed)
                    index._sources[processed.metadata.citation_key].source_type = source_info.get("source_type", "spdf")
                except Exception as e:
                    logger.error(f"Failed to reload {source_path}: {e}")

        index._build_index()
        return index

    def cite_document(
        self,
        document_text: str,
        style: CitationStyle = CitationStyle.APA7,
        max_citations_per_claim: int = 3,
        batch_size: int = 4,
        min_confidence: float = 0.7,
        include_bibliography: bool = True,
    ) -> CitationResult:
        """Generate citations and insert them into the document.

        This is the main method for automatic citation. Takes an uncited
        document and returns the document with inline citations inserted,
        plus a formatted bibliography.

        Args:
            document_text: The uncited document text
            style: Citation style (APA7 or CHICAGO17)
            max_citations_per_claim: Maximum citations per claim
            batch_size: Number of paragraphs to process together
            min_confidence: Minimum confidence threshold for citations
            include_bibliography: Whether to append bibliography at end

        Returns:
            CitationResult with:
            - modified_document: Document with inline citations
            - citations: List of all citations inserted
            - metadata: Statistics and bibliography

        Example:
            >>> index = CitationIndex.from_bibliography("./bib/", api_key)
            >>> result = index.cite_document(essay_text)
            >>> print(result.modified_document)
        """
        if not self._gemini_api_key:
            raise ValueError("No API key provided for citation generation")

        self._ensure_index()

        from .citation_engine import GeminiCitationEngine

        engine = GeminiCitationEngine(api_key=self._gemini_api_key, model="gemini-3-flash-preview")
        index_rag = _CitationIndexRAGAdapter(self)

        # Generate citations using grounded RAG
        logger.info(f"Analyzing document ({len(document_text)} chars) with batch_size={batch_size}")

        all_citations = engine.analyze_with_grounded_rag(
            document_text=document_text,
            rag=index_rag,
            style=style,
            max_citations_per_claim=max_citations_per_claim,
            batch_size=batch_size,
        )

        # Filter by confidence
        citations = [c for c in all_citations if c.confidence >= min_confidence]
        filtered_count = len(all_citations) - len(citations)

        logger.info(f"Generated {len(all_citations)} citations, {len(citations)} meet threshold (≥{min_confidence})")

        # Insert citations into document
        modified_document, insertion_stats = self._insert_citations(
            document_text, citations, style
        )

        # Generate bibliography if requested
        bibliography = ""
        if include_bibliography and citations:
            bibliography = self._generate_bibliography(citations, style)

        # Collect warnings
        warnings = []
        if filtered_count > 0:
            warnings.append(f"Filtered {filtered_count} low-confidence citations (< {min_confidence})")
        if insertion_stats.get("failed_insertions", 0) > 0:
            warnings.append(
                f"Failed to insert {insertion_stats['failed_insertions']} citations "
                f"(claim text not found in document)"
            )
        if insertion_stats.get("temporal_warnings", 0) > 0:
            warnings.append(
                f"Detected {insertion_stats['temporal_warnings']} temporal impossibilities "
                f"(old source cited for modern NLP concepts)"
            )
        if insertion_stats.get("framework_rewrites", 0) > 0:
            warnings.append(
                f"Performed {insertion_stats['framework_rewrites']} framework application rewrites "
                f"(text modified for proper attribution)"
            )

        # Build final document with bibliography
        final_document = modified_document
        if bibliography:
            final_document = modified_document + "\n\n" + bibliography

        # Build metadata
        used_sources = set(c.citation_key for c in citations)

        # Detect orphan references (in bibliography but never cited)
        all_sources = set(self._sources.keys())
        orphan_references = sorted(all_sources - used_sources)
        if orphan_references:
            warnings.append(
                f"Orphan references (in bibliography but never cited): {', '.join(orphan_references)}"
            )

        # Detect missing references (mentioned in text but not in sources)
        # Look for patterns like (Author, Year) or Author (Year) that don't match our sources
        import re
        potential_citations = set()
        # Match patterns like (Author, 2023) or (Author & Other, 2023) or Author (2023)
        patterns = [
            r'\(([A-Z][a-zé]+(?:\s+(?:&|y|and)\s+[A-Z][a-zé]+)?),?\s*((?:19|20)\d{2})[^)]*\)',  # (Author, 2023)
            r'([A-Z][a-zé]+(?:\s+(?:&|y|and)\s+[A-Z][a-zé]+)?)\s+\(((?:19|20)\d{2})\)',  # Author (2023)
        ]
        doc_lower = document_text.lower()
        for pattern in patterns:
            for match in re.finditer(pattern, document_text, re.IGNORECASE):
                author_part = match.group(1).lower().strip()
                year_part = match.group(2)
                # Check if any source matches this author/year
                found = False
                for key, source in self._sources.items():
                    meta = source.processed_pdf.metadata
                    if meta.year and str(meta.year) == year_part:
                        # Check if author matches
                        for author in meta.authors:
                            if author_part in author.lower() or author.lower().split()[-1] in author_part:
                                found = True
                                break
                    if found:
                        break
                if not found:
                    potential_citations.add(f"{match.group(1)} ({year_part})")

        if potential_citations:
            warnings.append(
                f"Potential missing references (cited but not in bibliography): {', '.join(sorted(potential_citations)[:5])}"
            )

        metadata = {
            "total_citations": len(citations),
            "unique_sources": len(used_sources),
            "sources_used": sorted(used_sources),
            "successful_insertions": insertion_stats.get("successful_insertions", 0),
            "failed_insertions": insertion_stats.get("failed_insertions", 0),
            "framework_rewrites": insertion_stats.get("framework_rewrites", 0),
            "temporal_warnings": insertion_stats.get("temporal_warnings", 0),
            "orphan_references": orphan_references,
            "potential_missing_references": list(potential_citations)[:10],
            "style": style.value,
            "min_confidence": min_confidence,
            "bibliography": bibliography,
        }

        return CitationResult(
            modified_document=final_document,
            citations=citations,
            warnings=warnings,
            metadata=metadata,
        )

    def _insert_citations(
        self,
        document: str,
        citations: List[Any],
        style: CitationStyle,
    ) -> Tuple[str, Dict[str, int]]:
        """Insert citations into document at the correct positions.

        Handles different citation types:
        - direct_support/background_context: Insert citation after claim
        - framework_application: Replace claim with suggested_rewrite (has citation embedded)
        - novel_contribution/temporal_impossible: Skip (or warn)

        Args:
            document: Original document text
            citations: List of GroundedCitation objects
            style: Citation style

        Returns:
            Tuple of (modified_document, stats_dict)
        """
        from .citation_engine import CitationType

        modified = document
        successful = 0
        failed = 0
        rewrites = 0
        temporal_warnings = 0
        insertions = []  # (position, operation_type, old_text, new_text, citation)

        for citation in citations:
            claim = citation.claim_text
            cite_str = citation.citation_string
            citation_type = getattr(citation, 'citation_type', CitationType.DIRECT_SUPPORT)
            suggested_rewrite = getattr(citation, 'suggested_rewrite', None)

            # Check for temporal warnings
            if getattr(citation, 'temporal_warning', None):
                temporal_warnings += 1
                logger.warning(citation.temporal_warning)

            # Skip novel contributions - they don't need citations
            if citation_type == CitationType.NOVEL_CONTRIBUTION:
                logger.info(f"Skipping novel contribution (no citation needed): '{claim[:50]}...'")
                continue

            # Try to find the claim in the document
            pos, matched_length = self._find_claim_position(modified, claim)

            if pos == -1:
                logger.warning(f"Could not locate claim: '{claim[:60]}...'")
                failed += 1
                continue

            # Handle based on citation type
            if citation_type == CitationType.FRAMEWORK_APPLICATION and suggested_rewrite:
                # REWRITE: Replace the claim with the suggested rewrite
                # The suggested_rewrite should already contain the citation embedded
                # Use matched_length instead of len(claim) to handle markdown differences
                insertions.append((
                    pos,  # start position
                    "rewrite",
                    matched_length,  # actual length of text to replace in document
                    suggested_rewrite,  # new text (with citation)
                    citation
                ))
                rewrites += 1
                successful += 1
                logger.info(f"Framework application rewrite: '{claim[:40]}...' -> '{suggested_rewrite[:50]}...'")

            else:
                # DIRECT SUPPORT: Just insert citation after claim
                # Use matched_length instead of len(claim) to handle markdown differences
                insert_pos = pos + matched_length

                if style == CitationStyle.APA7:
                    formatted_cite = f" {cite_str}"
                else:
                    formatted_cite = f" {cite_str}"

                insertions.append((
                    insert_pos,
                    "insert",
                    "",  # no old text for insertion
                    formatted_cite,
                    citation
                ))
                successful += 1

        # Sort by position (reverse order) to preserve positions during modification
        # For rewrites, use start position; for inserts, use insertion position
        insertions.sort(key=lambda x: x[0], reverse=True)

        # Apply modifications from end to start
        for pos, op_type, length_or_empty, new_text, _ in insertions:
            if op_type == "rewrite":
                # Replace text of given length with new_text
                # length_or_empty is the matched_length (integer) for rewrites
                end_pos = pos + length_or_empty
                modified = modified[:pos] + new_text + modified[end_pos:]
            else:
                # Insert new_text at position
                # length_or_empty is "" for inserts (unused)
                modified = modified[:pos] + new_text + modified[pos:]

        stats = {
            "successful_insertions": successful,
            "failed_insertions": failed,
            "framework_rewrites": rewrites,
            "temporal_warnings": temporal_warnings,
        }

        return modified, stats

    def _find_claim_position(self, document: str, claim: str) -> tuple:
        """Find the position of a claim in the document with fallbacks.

        Args:
            document: The document text
            claim: The claim text to find

        Returns:
            Tuple of (position, matched_length) or (-1, 0) if not found.
            matched_length is the actual length of text in the document that was matched,
            which may differ from len(claim) when markdown formatting is present.
        """
        # Try 1: Exact match
        pos = document.find(claim)
        if pos != -1:
            return (pos, len(claim))

        # Try 2: Normalized whitespace (collapse multiple spaces/newlines)
        normalized_claim = ' '.join(claim.split())
        normalized_doc = ' '.join(document.split())

        norm_pos = normalized_doc.find(normalized_claim)
        if norm_pos != -1:
            # Map back to original document position (approximate)
            # Count characters up to the normalized position
            char_count = 0
            orig_pos = 0
            for i, char in enumerate(document):
                if char_count >= norm_pos:
                    orig_pos = i
                    break
                if not (char.isspace() and (i > 0 and document[i-1].isspace())):
                    char_count += 1
            return (orig_pos, len(claim))

        # Try 3: Case-insensitive search
        lower_pos = document.lower().find(claim.lower())
        if lower_pos != -1:
            logger.warning(f"Used case-insensitive match for: '{claim[:40]}...'")
            return (lower_pos, len(claim))

        # Try 4: Strip markdown formatting and search with regex
        # This handles cases like *Centering* vs Centering
        import re

        # Create a regex pattern that matches the claim with optional markdown
        # around each word
        def make_markdown_tolerant_pattern(text: str) -> str:
            """Create a regex that matches text with optional markdown formatting."""
            words = text.split()
            pattern_parts = []
            for word in words:
                # Escape regex special chars in the word
                escaped = re.escape(word)
                # Allow optional markdown formatting around each word
                # Matches: *word*, **word**, _word_, __word__, or plain word
                pattern_parts.append(r'[*_]{0,2}' + escaped + r'[*_]{0,2}')
            # Join with flexible whitespace
            return r'\s+'.join(pattern_parts)

        try:
            pattern = make_markdown_tolerant_pattern(claim)
            match = re.search(pattern, document, re.IGNORECASE)
            if match:
                logger.warning(f"Used markdown-tolerant match for: '{claim[:40]}...'")
                # Return the actual matched length from the document
                matched_text = match.group(0)
                return (match.start(), len(matched_text))
        except re.error:
            pass  # Fallback if regex fails

        # Try 5: Strip ALL markdown from both claim and document, then map back
        # This handles cases like "*in silico*" vs "in silico" (markdown around phrases)
        def strip_markdown(text: str) -> tuple:
            """Strip markdown and return (stripped_text, position_map).
            position_map[i] = original position of stripped char i
            """
            result = []
            pos_map = []
            i = 0
            while i < len(text):
                # Skip markdown characters
                if text[i] in '*_':
                    # Check for ** or __
                    if i + 1 < len(text) and text[i+1] == text[i]:
                        i += 2
                    else:
                        i += 1
                else:
                    result.append(text[i])
                    pos_map.append(i)
                    i += 1
            return (''.join(result), pos_map)

        stripped_claim, _ = strip_markdown(claim)
        stripped_doc, doc_pos_map = strip_markdown(document)

        # Try to find stripped claim in stripped document
        stripped_pos = stripped_doc.lower().find(stripped_claim.lower())
        if stripped_pos != -1:
            # Map back to original document position
            orig_start = doc_pos_map[stripped_pos]
            # Find the end position by mapping the end of the match
            stripped_end = stripped_pos + len(stripped_claim)
            if stripped_end < len(doc_pos_map):
                orig_end = doc_pos_map[stripped_end]
            else:
                orig_end = len(document)
            matched_length = orig_end - orig_start
            logger.warning(f"Used markdown-stripped match for: '{claim[:40]}...'")
            return (orig_start, matched_length)

        return (-1, 0)

    def _generate_bibliography(
        self,
        citations: List[Any],
        style: CitationStyle,
    ) -> str:
        """Generate a formatted bibliography from the citations used.

        Args:
            citations: List of GroundedCitation objects
            style: Citation style

        Returns:
            Formatted bibliography string
        """
        # Get unique sources
        used_keys = set(c.citation_key for c in citations)

        references = []
        for key in sorted(used_keys):
            source = self._sources.get(key)
            if source and source.processed_pdf.metadata:
                meta = source.processed_pdf.metadata
                ref = self._format_reference_apa7(meta)
                references.append(ref)

        if not references:
            return ""

        if style == CitationStyle.APA7:
            header = "## Referencias"
        else:
            header = "## Bibliografía"

        return header + "\n\n" + "\n\n".join(references)

    def _format_reference_apa7(self, meta) -> str:
        """Format a single reference in APA7 style.

        Args:
            meta: ProcessedPDF metadata with authors, year, title

        Returns:
            Formatted reference string
        """
        # Particles that should stay with surname
        particles = {"van", "von", "de", "del", "della", "di", "da", "le", "la", "el"}

        def format_author_name(full_name: str) -> str:
            """Format a single author name as 'Surname, F. M.'"""
            parts = full_name.split()
            if not parts:
                return full_name

            # Find surname (last word, or particle + last word)
            surname_parts = []
            initials = []

            i = len(parts) - 1
            # Get surname (with particles)
            while i >= 0:
                word = parts[i]
                if word.lower() in particles:
                    surname_parts.insert(0, word.lower())
                    i -= 1
                elif not surname_parts:
                    surname_parts.insert(0, word)
                    i -= 1
                    break
                else:
                    break

            # Capitalize first letter of surname (but not particles)
            if surname_parts:
                surname_parts[0] = surname_parts[0].capitalize() if surname_parts[0].lower() not in particles else surname_parts[0]
                # Capitalize the actual surname part
                for j, part in enumerate(surname_parts):
                    if part.lower() not in particles:
                        surname_parts[j] = part.capitalize()

            surname = " ".join(surname_parts)

            # Get initials from remaining parts
            for j in range(i + 1):
                word = parts[j]
                if word and word[0].isalpha():
                    initials.append(f"{word[0].upper()}.")

            if initials:
                return f"{surname}, {' '.join(initials)}"
            return surname

        # Format authors
        authors = meta.authors or []
        if not authors:
            author_str = "Unknown"
        elif len(authors) == 1:
            author_str = format_author_name(authors[0])
        else:
            formatted = []
            for i, author in enumerate(authors[:7]):
                formatted_name = format_author_name(author)
                if i == len(authors) - 1 and i > 0:
                    formatted.append(f"& {formatted_name}")
                else:
                    formatted.append(formatted_name)
            if len(authors) > 7:
                formatted.append(". . .")
            author_str = ", ".join(formatted)

        year = meta.year or "n.d."

        # Convert title to sentence case (APA requirement)
        title = meta.title or "Untitled"
        title_sentence_case = self._to_sentence_case(title)

        # Build reference with available fields
        ref_parts = [f"{author_str} ({year}). *{title_sentence_case}*."]

        # Add source (journal/conference/publisher) if available
        source = getattr(meta, 'source', '') or ''
        volume = getattr(meta, 'volume', '') or ''
        issue = getattr(meta, 'issue', '') or ''
        pages = getattr(meta, 'pages', '') or ''
        doi = getattr(meta, 'doi', '') or ''

        if source:
            source_part = f"*{source}*"
            if volume:
                source_part += f", *{volume}*"
                if issue:
                    source_part += f"({issue})"
            if pages:
                source_part += f", {pages}"
            ref_parts.append(source_part + ".")

        if doi:
            ref_parts.append(f"https://doi.org/{doi}")

        return " ".join(ref_parts)

    def _to_sentence_case(self, title: str) -> str:
        """Convert title to sentence case (APA style).

        Capitalizes first word and proper nouns, lowercases rest.
        Preserves capitalization after colons.
        """
        if not title:
            return title

        # Words to keep capitalized (proper nouns, acronyms)
        preserve = {"BPE", "RST", "NMT", "NLP", "AI", "BERT", "GPT", "LLM",
                    "English", "Spanish", "French", "German", "Chinese",
                    "Transformer", "Transformers"}

        words = title.split()
        result = []

        capitalize_next = True
        for i, word in enumerate(words):
            # Check if word should be preserved
            clean_word = word.strip(".,;:!?\"'()[]")
            if clean_word in preserve or clean_word.isupper() and len(clean_word) <= 4:
                result.append(word)
            elif capitalize_next:
                result.append(word.capitalize())
                capitalize_next = False
            else:
                result.append(word.lower())

            # Capitalize after colon
            if word.endswith(":"):
                capitalize_next = True

        return " ".join(result)

    @property
    def total_chunks(self) -> int:
        """Total number of chunks across all sources."""
        return len(self._chunk_lookup)

    @property
    def total_sources(self) -> int:
        """Number of sources in the index."""
        return len(self._sources)

    def __len__(self) -> int:
        return len(self._sources)

    def __contains__(self, citation_key: str) -> bool:
        return citation_key in self._sources

    def __repr__(self) -> str:
        return f"CitationIndex({len(self._sources)} sources, {len(self._chunk_lookup)} chunks)"


class _CitationIndexRAGAdapter:
    """Adapter to make CitationIndex compatible with GeminiCitationEngine.

    Provides the same interface as PageAwareRAG.query_for_paragraph().
    """

    def __init__(self, index: CitationIndex):
        self._index = index

    def query_for_paragraph(self, paragraph: str, n_results: int = 30) -> List[RetrievedChunk]:
        """Query method matching PageAwareRAG interface."""
        return self._index.query(paragraph, n_results=n_results, min_similarity=0.25)

    def query(self, text: str, n_results: int = 20) -> List[RetrievedChunk]:
        """Generic query method."""
        return self._index.query(text, n_results=n_results)

    def get_chunks_by_source_and_page(
        self,
        citation_key: str,
        book_page: int,
        include_adjacent: bool = True,
    ) -> List[RetrievedChunk]:
        """Get all chunks from a specific source and page.

        Args:
            citation_key: Source identifier
            book_page: Page number
            include_adjacent: If True, also include chunks from adjacent pages

        Returns:
            List of chunks from the specified page(s)
        """
        chunks = []

        if citation_key not in self._index._sources:
            return chunks

        source = self._index._sources[citation_key]
        pdf = source.processed_pdf

        # Get pages to include
        pages_to_check = {book_page}
        if include_adjacent:
            pages_to_check.add(book_page - 1)
            pages_to_check.add(book_page + 1)

        for chunk in pdf.chunks:
            if chunk.book_page in pages_to_check:
                chunk_text = chunk.text if chunk.text else ""
                chunks.append(RetrievedChunk(
                    chunk_id=f"{citation_key}_p{chunk.book_page}_c{chunk.chunk_index}",
                    citation_key=citation_key,
                    book_page=chunk.book_page,
                    pdf_page=chunk.pdf_page,
                    text=chunk_text,
                    similarity=1.0,  # Not from similarity search
                    authors=", ".join(pdf.metadata.authors) if pdf.metadata.authors else "",
                    year=pdf.metadata.year,
                    title=pdf.metadata.title,
                    chunk_index=chunk.chunk_index,  # Use actual chunk_index, not id
                ))

        # Sort by page and chunk index
        chunks.sort(key=lambda x: (x.book_page, x.chunk_index or 0))
        return chunks
