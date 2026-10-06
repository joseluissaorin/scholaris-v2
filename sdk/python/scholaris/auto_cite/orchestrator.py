"""Citation orchestrator - main controller for auto-citation system.

This module handles the complete citation insertion workflow:
1. Load and process bibliography PDFs with Vision OCR
2. Index PDFs in Page-Aware RAG with verified page numbers
3. Analyze user document with grounded citation matching
4. Insert formatted citations (APA 7th or Chicago 17th)
5. Generate preview for user validation

ENHANCED: Vision OCR + Page-Aware RAG for accurate page citations.
"""

import logging
import re
from pathlib import Path
from typing import List, Optional, Dict, Any, Literal, Union, Tuple

from .models import (
    CitationRequest,
    CitationResult,
    CitationStyle,
    PageAwarePDF,
    Citation,
    OCRPage,
)
from .pdf_processor import PDFProcessor
from .formatters import format_citation
from .citation_engine import GeminiCitationEngine, GroundedCitation
from .document_formats import DocumentFormatHandler, DocumentFormat

# Vision OCR and Page-Aware RAG (new components)
try:
    from .vision_ocr import VisionOCRProcessor
    from .page_aware_rag import PageAwareRAG
    from .metadata_extractor import MetadataExtractor, batch_extract_metadata
    VISION_RAG_AVAILABLE = True
except ImportError:
    VISION_RAG_AVAILABLE = False
    VisionOCRProcessor = None
    PageAwareRAG = None
    MetadataExtractor = None
    batch_extract_metadata = None

# Legacy RAG engine (optional - only if ChromaDB installed)
try:
    from .rag_engine import RAGCitationEngine
    RAG_AVAILABLE = True
except ImportError:
    RAG_AVAILABLE = False
    RAGCitationEngine = None

logger = logging.getLogger(__name__)


class CitationOrchestrator:
    """Main controller for the auto-citation system.

    This class orchestrates all components to provide end-to-end
    citation insertion functionality.
    """

    def __init__(
        self,
        gemini_api_key: str,
        pdf_threshold: int = 50,
        use_rag_mode: bool = True,
        use_grounded_rag: bool = True,  # NEW: Use Vision OCR + Page-Aware RAG
        mistral_api_key: Optional[str] = None,
        crossref_email: Optional[str] = None,
        chroma_db_path: str = "./chroma_citations",
    ):
        """Initialize citation orchestrator.

        Args:
            gemini_api_key: API key for Google Gemini
            pdf_threshold: Threshold for switching to RAG mode (default: 50)
            use_rag_mode: Whether to use RAG for large bibliographies
            use_grounded_rag: Use Vision OCR + Page-Aware RAG (recommended)
            mistral_api_key: API key for Mistral Pixtral (OCR)
            crossref_email: Email for Crossref API polite pool
            chroma_db_path: Path to ChromaDB database for Page-Aware RAG
        """
        self.gemini_api_key = gemini_api_key
        self.pdf_threshold = pdf_threshold
        self.use_rag_mode = use_rag_mode
        self.use_grounded_rag = use_grounded_rag
        self.mistral_api_key = mistral_api_key
        self.crossref_email = crossref_email
        self.chroma_db_path = chroma_db_path

        # Initialize PDF processor (legacy mode)
        from .page_offset import PageOffsetDetector
        page_offset_detector = PageOffsetDetector(
            crossref_email=crossref_email,
            mistral_api_key=mistral_api_key,
            gemini_api_key=gemini_api_key,
        )
        self.pdf_processor = PDFProcessor(page_offset_detector=page_offset_detector)

        # Initialize Gemini citation engine
        self.citation_engine = GeminiCitationEngine(api_key=gemini_api_key)

        # Initialize Vision OCR processor (NEW)
        self.vision_ocr = None
        if use_grounded_rag and VISION_RAG_AVAILABLE:
            self.vision_ocr = VisionOCRProcessor(gemini_api_key)
            logger.info("Vision OCR processor initialized")

        # Initialize Page-Aware RAG (NEW)
        self.page_rag = None
        if use_grounded_rag and VISION_RAG_AVAILABLE:
            self.page_rag = PageAwareRAG(gemini_api_key, db_path=chroma_db_path)
            logger.info(f"Page-Aware RAG initialized at {chroma_db_path}")

        # Initialize legacy RAG citation engine (for large bibliographies)
        self.rag_engine = None
        if use_rag_mode and not use_grounded_rag:
            if RAG_AVAILABLE:
                self.rag_engine = RAGCitationEngine(api_key=gemini_api_key)
                logger.info("Legacy RAG engine initialized")
            else:
                logger.warning(
                    "RAG mode requested but ChromaDB not installed. "
                    "Install with: pip install chromadb"
                )

        logger.info(
            f"CitationOrchestrator initialized: "
            f"grounded_rag={use_grounded_rag and VISION_RAG_AVAILABLE}, "
            f"legacy_rag={use_rag_mode and RAG_AVAILABLE and not use_grounded_rag}"
        )

    def insert_citations(
        self,
        request: CitationRequest,
    ) -> CitationResult:
        """Insert citations into user document.

        This is the main entry point for citation insertion.

        Workflow:
        1. Use Gemini to analyze document and suggest citations
        2. Filter citations by confidence threshold
        3. Insert citations into document (or generate preview)
        4. Return result with metadata and warnings

        Args:
            request: CitationRequest with document and bibliography

        Returns:
            CitationResult with modified document and metadata
        """
        logger.info(
            f"Citation insertion requested: "
            f"{len(request.bibliography)} sources, "
            f"style={request.style.value}, "
            f"preview={request.preview_mode}"
        )

        warnings = []

        # Step 1: Determine which engine to use (Full Context vs RAG)
        num_papers = len(request.bibliography)
        use_rag = (
            self.use_rag_mode and
            self.rag_engine is not None and
            num_papers >= self.pdf_threshold
        )

        if use_rag:
            logger.info(
                f"Using RAG mode ({num_papers} papers >= {self.pdf_threshold} threshold)"
            )
            engine = self.rag_engine
            mode_name = "RAG"
        else:
            logger.info(
                f"Using Full Context mode ({num_papers} papers < {self.pdf_threshold} threshold)"
            )
            engine = self.citation_engine
            mode_name = "Full Context"

        # Step 2: Analyze document and suggest citations
        logger.info(f"Analyzing document with {mode_name} engine...")
        try:
            suggested_citations = engine.analyze_and_cite(
                document_text=request.document_text,
                bibliography=request.bibliography,
                style=request.style,
                max_citations_per_claim=request.max_citations_per_claim,
            )
        except Exception as e:
            logger.error(f"{mode_name} citation analysis failed: {e}")
            return CitationResult(
                modified_document=request.document_text,
                citations=[],
                warnings=[f"Citation analysis failed: {str(e)}"],
                metadata={'mode': mode_name, 'error': str(e)}
            )

        # Step 3: Filter by confidence threshold
        citations = [
            c for c in suggested_citations
            if c.confidence >= request.min_confidence
        ]

        logger.info(
            f"Suggested {len(suggested_citations)} citations, "
            f"{len(citations)} meet confidence threshold (≥{request.min_confidence})"
        )

        if len(citations) < len(suggested_citations):
            warnings.append(
                f"Filtered out {len(suggested_citations) - len(citations)} "
                f"low-confidence citations"
            )

        # Step 3: Check for low-confidence page detections
        for citation in citations:
            if not citation.source_pdf.page_offset_result.is_reliable:
                warnings.append(
                    f"Low-confidence page detection for {citation.source_pdf.citation_key}"
                )
            if citation.source_pdf.page_offset_result.uses_pdf_pagination:
                warnings.append(
                    f"Using PDF pagination for {citation.source_pdf.citation_key} - "
                    f"may not match published page numbers"
                )

        # Step 4: Insert citations (or generate preview)
        if request.preview_mode:
            # Preview mode - don't modify document, just show what would change
            modified_document = request.document_text
            preview_data = self._generate_preview(request.document_text, citations, request.style)
        else:
            # Apply mode - actually insert citations
            modified_document = self._insert_citations_into_document(
                document=request.document_text,
                citations=citations,
                style=request.style,
            )
            preview_data = {}

        # Step 5: Build result
        result = CitationResult(
            modified_document=modified_document,
            citations=citations,
            preview_data=preview_data,
            warnings=warnings,
            metadata={
                'mode': mode_name,
                'num_papers': num_papers,
                'threshold': self.pdf_threshold,
                'total_suggested': len(suggested_citations),
                'total_inserted': len(citations),
                'confidence_threshold': request.min_confidence,
                'style': request.style.value,
                'preview_mode': request.preview_mode,
            }
        )

        logger.info(
            f"✓ Citation insertion complete: {len(citations)} citations, "
            f"{len(warnings)} warnings"
        )

        return result

    def insert_citations_grounded(
        self,
        document_text: str,
        style: CitationStyle = CitationStyle.APA7,
        min_confidence: float = 0.5,
        preview_mode: bool = False,
    ) -> CitationResult:
        """Insert citations using grounded Page-Aware RAG.

        This method uses verified page numbers from Vision OCR.
        Must call process_bibliography_with_ocr() first to populate the RAG.

        Args:
            document_text: Document to cite
            style: Citation style (APA7 or Chicago17)
            min_confidence: Minimum confidence threshold
            preview_mode: If True, preview only

        Returns:
            CitationResult with grounded citations
        """
        if not self.page_rag:
            raise RuntimeError(
                "Page-Aware RAG not initialized. "
                "Call process_bibliography_with_ocr() first."
            )

        logger.info(f"Analyzing document with grounded RAG ({len(document_text)} chars)")

        # Use grounded RAG mode
        try:
            grounded_citations = self.citation_engine.analyze_with_grounded_rag(
                document_text=document_text,
                rag=self.page_rag,
                style=style,
            )
        except Exception as e:
            logger.error(f"Grounded RAG citation analysis failed: {e}")
            return CitationResult(
                modified_document=document_text,
                citations=[],
                warnings=[f"Citation analysis failed: {str(e)}"],
                metadata={'mode': 'Grounded RAG', 'error': str(e)}
            )

        # Filter by confidence
        citations = [c for c in grounded_citations if c.confidence >= min_confidence]

        logger.info(
            f"Generated {len(grounded_citations)} grounded citations, "
            f"{len(citations)} meet threshold (≥{min_confidence})"
        )

        warnings = []
        if len(citations) < len(grounded_citations):
            warnings.append(
                f"Filtered {len(grounded_citations) - len(citations)} low-confidence citations"
            )

        # Insert citations or preview
        if preview_mode:
            modified_document = document_text
            preview_data = self._generate_grounded_preview(document_text, citations, style)
        else:
            modified_document = self._insert_grounded_citations(
                document=document_text,
                citations=citations,
                style=style,
            )
            preview_data = {}

        return CitationResult(
            modified_document=modified_document,
            citations=citations,
            preview_data=preview_data,
            warnings=warnings,
            metadata={
                'mode': 'Grounded RAG',
                'total_chunks': self.page_rag.get_total_chunks(),
                'indexed_sources': len(self.page_rag.get_indexed_sources()),
                'total_suggested': len(grounded_citations),
                'total_inserted': len(citations),
                'confidence_threshold': min_confidence,
                'style': style.value,
                'preview_mode': preview_mode,
            }
        )

    def process_bibliography_with_ocr(
        self,
        pdf_paths: List[str],
        citation_keys: List[str],
        references: List[Any],
        force_reindex: bool = False,
        skip_indexed: bool = True,
        progress_callback: Optional[callable] = None,
    ) -> Dict[str, int]:
        """Process bibliography with Vision OCR and index in Page-Aware RAG.

        This is the recommended method for accurate page citations.
        Each PDF is processed with Vision OCR to extract:
        - Verified page numbers from the actual page images
        - Full text content (even for scanned PDFs)
        - Landscape scan detection (2 pages per PDF page)

        Args:
            pdf_paths: List of PDF file paths
            citation_keys: List of citation keys matching the PDFs
            references: List of Reference objects with metadata
            force_reindex: If True, clear existing index and rebuild
            skip_indexed: If True, skip sources already in index
            progress_callback: Optional callback(phase, source, current, total)

        Returns:
            Dictionary of {citation_key: chunks_indexed}
        """
        if not self.vision_ocr or not self.page_rag:
            raise RuntimeError(
                "Vision OCR and Page-Aware RAG not available. "
                "Ensure use_grounded_rag=True and dependencies installed."
            )

        if force_reindex:
            logger.info("Clearing existing RAG index...")
            self.page_rag.clear_collection()
            skip_indexed = False  # Don't skip if we just cleared

        indexed_counts = {}
        total_sources = len(pdf_paths)
        skipped_count = 0

        for i, (pdf_path, citation_key, reference) in enumerate(
            zip(pdf_paths, citation_keys, references)
        ):
            # Check if already indexed
            if skip_indexed and self.page_rag.is_source_indexed(citation_key):
                existing_chunks = self.page_rag.get_indexed_source_count(citation_key)
                logger.info(f"Skipping {citation_key} (already indexed: {existing_chunks} chunks)")
                indexed_counts[citation_key] = existing_chunks
                skipped_count += 1
                if progress_callback:
                    progress_callback("skip", citation_key, i + 1, total_sources)
                continue

            if progress_callback:
                progress_callback("ocr", citation_key, i + 1, total_sources)

            logger.info(f"Processing {citation_key} ({i+1}/{total_sources})...")

            try:
                # Step 1: Vision OCR
                ocr_pages = self.vision_ocr.process_pdf(
                    pdf_path=pdf_path,
                    progress_callback=lambda cur, tot: progress_callback(
                        "ocr_page", citation_key, cur, tot
                    ) if progress_callback else None,
                )

                logger.info(f"  OCR: {len(ocr_pages)} pages extracted")

                # Step 2: Index in Page-Aware RAG
                if progress_callback:
                    progress_callback("index", citation_key, i + 1, total_sources)

                chunks_added = self.page_rag.index_pdf(
                    citation_key=citation_key,
                    ocr_pages=ocr_pages,
                    authors=reference.authors if hasattr(reference, 'authors') else [],
                    year=reference.year if hasattr(reference, 'year') else 0,
                    title=reference.title if hasattr(reference, 'title') else "",
                )

                indexed_counts[citation_key] = chunks_added
                logger.info(f"  Indexed: {chunks_added} chunks")

            except Exception as e:
                logger.error(f"Failed to process {citation_key}: {e}")
                indexed_counts[citation_key] = 0

        total_chunks = sum(indexed_counts.values())
        logger.info(
            f"✓ Bibliography indexed: {len(indexed_counts)} sources, "
            f"{total_chunks} total chunks "
            f"({skipped_count} skipped - already indexed)"
        )

        return indexed_counts

    def process_pdfs_auto(
        self,
        pdf_paths: List[str],
        existing_metadata: Optional[List[Dict[str, Any]]] = None,
        force_reindex: bool = False,
        progress_callback: Optional[callable] = None,
    ) -> Tuple[Dict[str, int], List[Dict[str, Any]]]:
        """Process PDFs with automatic metadata extraction.

        This method:
        1. Extracts or completes metadata using AI (from first pages)
        2. Processes PDFs with Vision OCR
        3. Indexes in Page-Aware RAG

        Args:
            pdf_paths: List of PDF file paths
            existing_metadata: Optional list of partial metadata dicts
            force_reindex: If True, reprocess all PDFs
            progress_callback: Optional callback(phase, source, current, total)

        Returns:
            Tuple of (indexed_counts dict, complete_metadata list)
        """
        if not VISION_RAG_AVAILABLE:
            raise RuntimeError("Vision RAG components not available")

        logger.info(f"Processing {len(pdf_paths)} PDFs with auto metadata extraction...")

        # Step 1: Extract/complete metadata
        if progress_callback:
            progress_callback("metadata", "Extracting metadata...", 0, len(pdf_paths))

        existing = existing_metadata or [{}] * len(pdf_paths)

        metadata_list = batch_extract_metadata(
            pdf_paths=pdf_paths,
            gemini_api_key=self.gemini_api_key,
            existing_metadata=existing,
            progress_callback=lambda cur, tot, key: progress_callback(
                "metadata", key, cur, tot
            ) if progress_callback else None,
        )

        # Create simple reference-like objects
        class SimpleReference:
            def __init__(self, meta):
                self.title = meta.get("title", "")
                self.authors = meta.get("authors", [])
                self.year = meta.get("year", 0)
                self.source = meta.get("source", "")

        references = [SimpleReference(m) for m in metadata_list]
        citation_keys = [m.get("citation_key", f"source{i}") for i, m in enumerate(metadata_list)]

        # Step 2: Process with OCR and index
        indexed_counts = self.process_bibliography_with_ocr(
            pdf_paths=pdf_paths,
            citation_keys=citation_keys,
            references=references,
            force_reindex=force_reindex,
            skip_indexed=not force_reindex,
            progress_callback=progress_callback,
        )

        return indexed_counts, metadata_list

    def _generate_grounded_preview(
        self,
        document_text: str,
        citations: List[GroundedCitation],
        style: CitationStyle,
    ) -> Dict[str, Any]:
        """Generate preview for grounded citations."""
        preview_items = []

        for i, citation in enumerate(citations, 1):
            claim_start = document_text.find(citation.claim_text)
            claim_end = claim_start + len(citation.claim_text) if claim_start != -1 else -1

            preview_item = {
                'citation_number': i,
                'claim_text': citation.claim_text,
                'claim_position': claim_start,
                'citation_string': citation.citation_string,
                'source_key': citation.citation_key,
                'page_number': citation.page_number,
                'pdf_page_number': citation.pdf_page_number,
                'confidence': citation.confidence,
                'evidence': citation.evidence_text,
                'verified': True,  # Page number is verified via OCR
            }

            if claim_start != -1:
                context_start = max(0, claim_start - 50)
                context_end = min(len(document_text), claim_end + 50)
                preview_item['context'] = document_text[context_start:context_end]
            else:
                preview_item['context'] = None
                preview_item['warning'] = 'Claim text not found in document'

            preview_items.append(preview_item)

        return {
            'total_citations': len(citations),
            'style': style.value,
            'all_pages_verified': True,
            'citations': preview_items,
        }

    def _insert_grounded_citations(
        self,
        document: str,
        citations: List[GroundedCitation],
        style: CitationStyle,
    ) -> str:
        """Insert grounded citations into document."""
        modified_document = document

        # Sort by position (reverse order)
        citations_with_positions = []
        for citation in citations:
            position = modified_document.find(citation.claim_text)
            if position != -1:
                citations_with_positions.append((position, citation))

        citations_with_positions.sort(key=lambda x: x[0], reverse=True)

        for position, citation in citations_with_positions:
            claim_end = position + len(citation.claim_text)

            if style == CitationStyle.APA7:
                insertion = f" {citation.citation_string}"
            else:
                insertion = citation.citation_string

            modified_document = (
                modified_document[:claim_end] +
                insertion +
                modified_document[claim_end:]
            )

        return modified_document

    def insert_citations_from_file(
        self,
        input_file: str,
        bibliography: List[PageAwarePDF],
        style: CitationStyle = CitationStyle.APA7,
        preview_mode: bool = False,
        min_confidence: float = 0.7,
        max_citations_per_claim: int = 3,
        input_format: Optional[DocumentFormat] = None,
    ) -> CitationResult:
        """Insert citations from a document file (multi-format support).

        Supports: TXT, MD, DOCX, PDF, HTML, RTF, ODT, LaTeX

        Args:
            input_file: Path to input document
            bibliography: Processed bibliography (from process_bibliography)
            style: Citation style (APA7 or CHICAGO17)
            preview_mode: If True, preview without modifying
            min_confidence: Minimum confidence for citation insertion
            max_citations_per_claim: Maximum citations per claim
            input_format: Document format (auto-detected if None)

        Returns:
            CitationResult with modified document text

        Example:
            >>> orchestrator = CitationOrchestrator(gemini_api_key="...")
            >>> bibliography = orchestrator.process_bibliography(...)
            >>> result = orchestrator.insert_citations_from_file(
            ...     input_file="draft.docx",
            ...     bibliography=bibliography,
            ...     style=CitationStyle.APA7
            ... )
            >>> print(result.modified_document)
        """
        logger.info(f"Reading document from file: {input_file}")

        # Read document text
        try:
            document_text = DocumentFormatHandler.read_document(
                input_file,
                format=input_format
            )
        except Exception as e:
            logger.error(f"Failed to read document: {e}")
            return CitationResult(
                modified_document="",
                citations=[],
                warnings=[f"Failed to read document: {str(e)}"],
                metadata={'error': str(e)}
            )

        logger.info(
            f"✓ Document loaded: {len(document_text)} characters "
            f"({len(document_text.split())} words)"
        )

        # Create citation request
        request = CitationRequest(
            document_text=document_text,
            bibliography=bibliography,
            style=style,
            preview_mode=preview_mode,
            min_confidence=min_confidence,
            max_citations_per_claim=max_citations_per_claim,
        )

        # Process citations
        return self.insert_citations(request)

    def insert_citations_with_export(
        self,
        input_file: str,
        output_file: str,
        bibliography: List[PageAwarePDF],
        style: CitationStyle = CitationStyle.APA7,
        min_confidence: float = 0.7,
        max_citations_per_claim: int = 3,
        input_format: Optional[DocumentFormat] = None,
        output_format: Optional[DocumentFormat] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> CitationResult:
        """Complete workflow: Read document → Insert citations → Export to file.

        Supports input/output in multiple formats:
        - Plain text (.txt)
        - Markdown (.md)
        - Microsoft Word (.docx)
        - PDF (.pdf) - input only
        - HTML (.html)
        - Rich Text Format (.rtf)
        - OpenDocument Text (.odt)
        - LaTeX (.tex)

        Args:
            input_file: Path to input document
            output_file: Path to save cited document
            bibliography: Processed bibliography (from process_bibliography)
            style: Citation style (APA7 or CHICAGO17)
            min_confidence: Minimum confidence for citation insertion
            max_citations_per_claim: Maximum citations per claim
            input_format: Input document format (auto-detected if None)
            output_format: Output document format (auto-detected if None)
            metadata: Document metadata (title, author, date)

        Returns:
            CitationResult with statistics and warnings

        Example:
            >>> orchestrator = CitationOrchestrator(gemini_api_key="...")
            >>> bibliography = orchestrator.process_bibliography(...)
            >>> result = orchestrator.insert_citations_with_export(
            ...     input_file="draft.docx",
            ...     output_file="cited_paper.docx",
            ...     bibliography=bibliography,
            ...     style=CitationStyle.APA7,
            ...     metadata={"title": "My Research", "author": "John Doe"}
            ... )
            >>> print(f"✓ Inserted {len(result.citations)} citations")
        """
        logger.info(
            f"Complete citation workflow: {input_file} → {output_file}"
        )

        # Step 1: Read and process document
        result = self.insert_citations_from_file(
            input_file=input_file,
            bibliography=bibliography,
            style=style,
            preview_mode=False,  # Actually insert citations
            min_confidence=min_confidence,
            max_citations_per_claim=max_citations_per_claim,
            input_format=input_format,
        )

        if result.warnings and any('Failed to read' in w for w in result.warnings):
            logger.error("Failed to process document - aborting export")
            return result

        # Step 2: Export cited document
        logger.info(f"Exporting cited document to: {output_file}")
        try:
            # Map citation style for format handler
            citation_style_str = "apa" if style == CitationStyle.APA7 else "chicago"

            DocumentFormatHandler.write_document(
                text=result.modified_document,
                output_path=output_file,
                format=output_format,
                citation_style=citation_style_str,
                metadata=metadata or {},
            )

            logger.info(
                f"✓ Export complete: {len(result.citations)} citations inserted"
            )

            # Add export info to metadata
            result.metadata['input_file'] = input_file
            result.metadata['output_file'] = output_file
            result.metadata['export_format'] = str(
                output_format or DocumentFormatHandler.detect_format(output_file)
            )

        except Exception as e:
            logger.error(f"Failed to export document: {e}")
            result.warnings.append(f"Export failed: {str(e)}")
            result.metadata['export_error'] = str(e)

        return result

    def process_bibliography(
        self,
        pdf_paths: List[str],
        citation_keys: List[str],
        references: List[Any],  # List[scholaris.core.models.Reference]
        bib_entries: List[Dict[str, Any]],
    ) -> List[PageAwarePDF]:
        """Process a bibliography of PDFs into PageAwarePDF objects.

        This method:
        1. Extracts text from all PDFs
        2. Detects page offsets for accurate citations
        3. Creates PageAwarePDF objects

        Args:
            pdf_paths: List of PDF file paths
            citation_keys: List of citation keys
            references: List of Reference objects
            bib_entries: List of BibTeX entries

        Returns:
            List of PageAwarePDF objects ready for citation
        """
        logger.info(f"Processing bibliography of {len(pdf_paths)} PDFs...")

        page_aware_pdfs = self.pdf_processor.batch_process_pdfs(
            pdf_paths=pdf_paths,
            citation_keys=citation_keys,
            references=references,
            bib_entries=bib_entries,
        )

        # Log page detection results
        if page_aware_pdfs:
            reliable_count = sum(
                1 for pdf in page_aware_pdfs
                if pdf.page_offset_result.is_reliable
            )
            logger.info(
                f"✓ Bibliography processed: {len(page_aware_pdfs)} PDFs, "
                f"{reliable_count} with reliable page detection "
                f"({reliable_count/len(page_aware_pdfs)*100:.1f}%)"
            )
        else:
            logger.warning("No PDFs to process")

        # Log warnings for low-confidence detections
        for pdf in page_aware_pdfs:
            if not pdf.page_offset_result.is_reliable:
                logger.warning(
                    f"Low confidence page detection for {pdf.citation_key}: "
                    f"{pdf.page_offset_result}"
                )

        return page_aware_pdfs

    def _generate_preview(
        self,
        document_text: str,
        citations: List[Citation],
        style: CitationStyle,
    ) -> Dict[str, Any]:
        """Generate preview data showing what citations will be inserted.

        Args:
            document_text: Original document text
            citations: List of citations to preview
            style: Citation style

        Returns:
            Preview data dictionary
        """
        preview_items = []

        for i, citation in enumerate(citations, 1):
            # Find claim position in document
            claim_start = document_text.find(citation.claim_text)
            claim_end = claim_start + len(citation.claim_text) if claim_start != -1 else -1

            # Build preview item
            preview_item = {
                'citation_number': i,
                'claim_text': citation.claim_text,
                'claim_position': claim_start,
                'citation_string': citation.citation_string,
                'source_key': citation.source_pdf.citation_key,
                'source_title': citation.source_pdf.reference.title,
                'page_number': citation.journal_page,
                'confidence': citation.confidence,
                'evidence': citation.evidence_text,
            }

            # Add context (50 chars before/after)
            if claim_start != -1:
                context_start = max(0, claim_start - 50)
                context_end = min(len(document_text), claim_end + 50)
                preview_item['context'] = document_text[context_start:context_end]
            else:
                preview_item['context'] = None
                preview_item['warning'] = 'Claim text not found in document'

            preview_items.append(preview_item)

        return {
            'total_citations': len(citations),
            'style': style.value,
            'citations': preview_items,
        }

    def _insert_citations_into_document(
        self,
        document: str,
        citations: List[Citation],
        style: CitationStyle,
    ) -> str:
        """Insert citation strings into document.

        Args:
            document: Original document text
            citations: List of citations to insert
            style: Citation style

        Returns:
            Modified document with citations inserted
        """
        modified_document = document

        # Sort citations by position in document (reverse order to maintain positions)
        citations_with_positions = []
        for citation in citations:
            position = modified_document.find(citation.claim_text)
            if position != -1:
                citations_with_positions.append((position, citation))

        # Sort by position (descending) to insert from end to start
        citations_with_positions.sort(key=lambda x: x[0], reverse=True)

        # Insert citations
        for position, citation in citations_with_positions:
            claim_end = position + len(citation.claim_text)

            if style == CitationStyle.APA7:
                # APA: Insert inline citation after claim
                insertion = f" {citation.citation_string}"
                modified_document = (
                    modified_document[:claim_end] +
                    insertion +
                    modified_document[claim_end:]
                )
            else:  # Chicago17
                # Chicago: Insert superscript footnote number
                # Note: Full footnotes would be added at bottom in real implementation
                insertion = citation.citation_string  # Already contains superscript
                modified_document = (
                    modified_document[:claim_end] +
                    insertion +
                    modified_document[claim_end:]
                )

        return modified_document


# ==================== Helper Functions ====================

def validate_bibliography(
    page_aware_pdfs: List[PageAwarePDF],
    min_confidence: float = 0.7,
) -> Dict[str, Any]:
    """Validate a processed bibliography.

    Args:
        page_aware_pdfs: List of PageAwarePDF objects
        min_confidence: Minimum acceptable confidence

    Returns:
        Validation report with statistics and warnings
    """
    total = len(page_aware_pdfs)
    reliable = sum(1 for pdf in page_aware_pdfs if pdf.page_offset_result.is_reliable)
    uses_pdf_pagination = sum(
        1 for pdf in page_aware_pdfs
        if pdf.page_offset_result.uses_pdf_pagination
    )

    # Calculate average confidence
    avg_confidence = sum(
        pdf.page_offset_result.confidence for pdf in page_aware_pdfs
    ) / total if total > 0 else 0

    # Identify problematic PDFs
    warnings = []
    for pdf in page_aware_pdfs:
        if pdf.page_offset_result.confidence < min_confidence:
            warnings.append(
                f"{pdf.citation_key}: Low confidence "
                f"({pdf.page_offset_result.confidence:.2f})"
            )

    report = {
        'total_pdfs': total,
        'reliable_count': reliable,
        'reliable_percentage': (reliable / total * 100) if total > 0 else 0,
        'uses_pdf_pagination': uses_pdf_pagination,
        'avg_confidence': avg_confidence,
        'warnings': warnings,
    }

    return report
