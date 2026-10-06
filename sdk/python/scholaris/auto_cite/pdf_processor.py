"""PDF text extraction with page-level tracking for citations.

This module extracts text from PDFs while maintaining accurate page-by-page
tracking, which is essential for citation insertion with correct page numbers.
"""

import logging
from pathlib import Path
from typing import List, Optional, Dict, Any

import fitz  # PyMuPDF

try:
    import pdfplumber
    PDFPLUMBER_AVAILABLE = True
except ImportError:
    PDFPLUMBER_AVAILABLE = False
    logging.warning("pdfplumber not available - using PyMuPDF only")

from .models import PDFPage, PageAwarePDF, PageOffsetResult
from .page_offset import PageOffsetDetector

logger = logging.getLogger(__name__)


class PDFProcessor:
    """Processes PDFs for the auto-citation system.

    This class handles:
    - Text extraction from PDFs (PyMuPDF primary, pdfplumber fallback)
    - Page-level text tracking
    - Integration with page offset detection
    - Creation of PageAwarePDF objects ready for citation
    """

    def __init__(
        self,
        page_offset_detector: Optional[PageOffsetDetector] = None,
        min_chars_per_page: int = 50,
    ):
        """Initialize PDF processor.

        Args:
            page_offset_detector: Page offset detector instance (will create if None)
            min_chars_per_page: Minimum characters to consider a page valid
        """
        self.page_offset_detector = page_offset_detector or PageOffsetDetector()
        self.min_chars_per_page = min_chars_per_page

    def process_pdf(
        self,
        pdf_path: str,
        citation_key: str,
        reference: Any,  # Type: scholaris.core.models.Reference
        bib_entry: Dict[str, Any],
    ) -> PageAwarePDF:
        """Process a PDF file into a PageAwarePDF object.

        This is the main entry point for PDF processing. It:
        1. Extracts text from all pages
        2. Detects page offset
        3. Creates PageAwarePDF with accurate page mapping

        Args:
            pdf_path: Path to PDF file
            citation_key: BibTeX citation key (e.g., "smith2023")
            reference: Reference object from scholaris.core.models
            bib_entry: BibTeX entry dictionary

        Returns:
            PageAwarePDF object ready for citation insertion

        Raises:
            FileNotFoundError: If PDF file doesn't exist
            ValueError: If PDF is empty or unreadable
        """
        pdf_path = Path(pdf_path)
        if not pdf_path.exists():
            raise FileNotFoundError(f"PDF not found: {pdf_path}")

        logger.info(f"Processing PDF: {pdf_path.name}")

        # Step 1: Extract text from all pages
        pages = self._extract_pages(str(pdf_path))
        if not pages:
            raise ValueError(f"No text extracted from PDF: {pdf_path}")

        logger.info(f"Extracted text from {len(pages)} pages")

        # Step 2: Detect page offset
        page_offset_result = self.page_offset_detector.detect_offset(
            str(pdf_path),
            bib_entry
        )

        logger.info(f"Page offset detection: {page_offset_result}")

        # Step 3: Update journal page numbers in PDFPage objects
        for page in pages:
            page.journal_page_number = page.pdf_page_number + page_offset_result.offset
            if page_offset_result.uses_pdf_pagination:
                page.journal_page_number = page.pdf_page_number

        # Step 4: Create PageAwarePDF
        page_aware_pdf = PageAwarePDF(
            pdf_path=str(pdf_path),
            citation_key=citation_key,
            reference=reference,
            page_offset_result=page_offset_result,
            pages=pages,
            total_pages=len(pages),
            metadata={
                'file_size': pdf_path.stat().st_size,
                'total_chars': sum(p.char_count for p in pages),
            }
        )

        logger.info(
            f"✓ Created PageAwarePDF: {len(pages)} pages, "
            f"offset={page_offset_result.offset}, "
            f"confidence={page_offset_result.confidence:.2f}"
        )

        return page_aware_pdf

    def _extract_pages(self, pdf_path: str) -> List[PDFPage]:
        """Extract text from all pages in PDF.

        Tries PyMuPDF first (faster), falls back to pdfplumber for complex layouts.

        Args:
            pdf_path: Path to PDF file

        Returns:
            List of PDFPage objects with extracted text
        """
        pages = []

        try:
            # Primary: PyMuPDF (faster, works for most PDFs)
            pages = self._extract_with_pymupdf(pdf_path)

            # Check if extraction was successful
            total_chars = sum(p.char_count for p in pages)
            if total_chars < self.min_chars_per_page * len(pages) / 2:
                # Low text density - might be scanned or complex layout
                logger.warning(
                    f"Low text density detected ({total_chars} chars across {len(pages)} pages). "
                    f"Trying pdfplumber fallback..."
                )
                if PDFPLUMBER_AVAILABLE:
                    pages = self._extract_with_pdfplumber(pdf_path)

        except Exception as e:
            logger.error(f"PyMuPDF extraction failed: {e}")
            if PDFPLUMBER_AVAILABLE:
                logger.info("Trying pdfplumber fallback...")
                try:
                    pages = self._extract_with_pdfplumber(pdf_path)
                except Exception as e2:
                    logger.error(f"pdfplumber extraction also failed: {e2}")
                    pages = []

        return pages

    def _extract_with_pymupdf(self, pdf_path: str) -> List[PDFPage]:
        """Extract text using PyMuPDF (fitz).

        Args:
            pdf_path: Path to PDF file

        Returns:
            List of PDFPage objects
        """
        pages = []
        doc = fitz.open(pdf_path)

        try:
            for page_num in range(len(doc)):
                page = doc[page_num]
                text = page.get_text()

                # Check if page has text layer
                has_text_layer = len(text.strip()) > 0

                pdf_page = PDFPage(
                    pdf_page_number=page_num + 1,  # 1-indexed
                    journal_page_number=page_num + 1,  # Will be updated later
                    text_content=text,
                    has_text_layer=has_text_layer,
                    extraction_method="pymupdf"
                )

                pages.append(pdf_page)

        finally:
            doc.close()

        return pages

    def _extract_with_pdfplumber(self, pdf_path: str) -> List[PDFPage]:
        """Extract text using pdfplumber (better for complex layouts).

        Args:
            pdf_path: Path to PDF file

        Returns:
            List of PDFPage objects
        """
        if not PDFPLUMBER_AVAILABLE:
            logger.warning("pdfplumber not available, cannot use fallback")
            return []

        pages = []

        with pdfplumber.open(pdf_path) as pdf:
            for page_num, page in enumerate(pdf.pages):
                text = page.extract_text() or ""

                pdf_page = PDFPage(
                    pdf_page_number=page_num + 1,  # 1-indexed
                    journal_page_number=page_num + 1,  # Will be updated later
                    text_content=text,
                    has_text_layer=len(text.strip()) > 0,
                    extraction_method="pdfplumber"
                )

                pages.append(pdf_page)

        return pages

    def batch_process_pdfs(
        self,
        pdf_paths: List[str],
        citation_keys: List[str],
        references: List[Any],  # List[scholaris.core.models.Reference]
        bib_entries: List[Dict[str, Any]],
    ) -> List[PageAwarePDF]:
        """Process multiple PDFs in batch.

        Args:
            pdf_paths: List of PDF file paths
            citation_keys: List of citation keys
            references: List of Reference objects
            bib_entries: List of BibTeX entry dictionaries

        Returns:
            List of PageAwarePDF objects

        Raises:
            ValueError: If input lists have different lengths
        """
        if not (len(pdf_paths) == len(citation_keys) == len(references) == len(bib_entries)):
            raise ValueError(
                f"All input lists must have same length. Got: "
                f"pdfs={len(pdf_paths)}, keys={len(citation_keys)}, "
                f"refs={len(references)}, bibs={len(bib_entries)}"
            )

        logger.info(f"Batch processing {len(pdf_paths)} PDFs...")

        page_aware_pdfs = []
        for pdf_path, citation_key, reference, bib_entry in zip(
            pdf_paths, citation_keys, references, bib_entries
        ):
            try:
                page_aware_pdf = self.process_pdf(
                    pdf_path=pdf_path,
                    citation_key=citation_key,
                    reference=reference,
                    bib_entry=bib_entry
                )
                page_aware_pdfs.append(page_aware_pdf)
            except Exception as e:
                logger.error(f"Failed to process {pdf_path}: {e}")
                # Continue with other PDFs
                continue

        logger.info(
            f"✓ Batch processing complete: {len(page_aware_pdfs)}/{len(pdf_paths)} successful"
        )

        return page_aware_pdfs


# ==================== Helper Functions ====================

def extract_text_from_pdf(pdf_path: str) -> str:
    """Simple utility to extract all text from a PDF.

    Args:
        pdf_path: Path to PDF file

    Returns:
        All text from PDF concatenated into single string
    """
    processor = PDFProcessor()
    pages = processor._extract_pages(pdf_path)
    return "\n\n".join(page.text_content for page in pages)


def get_page_text(pdf_path: str, page_number: int) -> Optional[str]:
    """Extract text from a specific page.

    Args:
        pdf_path: Path to PDF file
        page_number: Page number (1-indexed)

    Returns:
        Text from the specified page, or None if page doesn't exist
    """
    try:
        doc = fitz.open(pdf_path)
        if page_number < 1 or page_number > len(doc):
            doc.close()
            return None

        page = doc[page_number - 1]  # Convert to 0-indexed
        text = page.get_text()
        doc.close()
        return text

    except Exception as e:
        logger.error(f"Failed to extract page {page_number} from {pdf_path}: {e}")
        return None


def count_pages(pdf_path: str) -> int:
    """Count total pages in a PDF.

    Args:
        pdf_path: Path to PDF file

    Returns:
        Number of pages in PDF
    """
    try:
        doc = fitz.open(pdf_path)
        count = len(doc)
        doc.close()
        return count
    except Exception as e:
        logger.error(f"Failed to count pages in {pdf_path}: {e}")
        return 0
