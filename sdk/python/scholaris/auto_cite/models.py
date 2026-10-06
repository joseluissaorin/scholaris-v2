"""Data models for auto-citation system."""
from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional, Dict, Any
from datetime import datetime


class CitationStyle(Enum):
    """Supported citation styles."""
    APA7 = "apa7"
    CHICAGO17 = "chicago17"


class PageDetectionStrategy(Enum):
    """Strategies for detecting page offsets."""
    FOOTER_HEADER_PARSING = "footer_header"  # Regex patterns on first/last pages
    BIBTEX_VALIDATION = "bibtex"  # Validate against BibTeX page range
    VISION_OCR = "vision"  # Mistral Pixtral for complex layouts
    DOI_CROSSREF = "crossref"  # Query Crossref API
    ASSUME_PDF_PAGINATION = "assume_pdf"  # Fallback for preprints


@dataclass
class PageOffsetResult:
    """Result of page offset detection.

    Attributes:
        offset: Page number offset (journal_page = pdf_page + offset)
        confidence: Confidence score (0.0-1.0)
        strategy_used: Which detection strategy succeeded
        uses_pdf_pagination: True if using PDF pages (e.g., preprints)
        warning_message: Optional warning if uncertain
        metadata: Additional detection metadata
    """
    offset: int
    confidence: float
    strategy_used: PageDetectionStrategy
    uses_pdf_pagination: bool = False
    warning_message: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    @property
    def is_reliable(self) -> bool:
        """Check if detection is reliable (confidence >= 0.7)."""
        return self.confidence >= 0.7

    def __str__(self) -> str:
        """Human-readable representation."""
        if self.uses_pdf_pagination:
            return f"Using PDF pagination (confidence: {self.confidence:.2f})"
        return f"Offset: {self.offset} (confidence: {self.confidence:.2f}, strategy: {self.strategy_used.value})"


@dataclass
class PDFPage:
    """Represents a single page from a PDF.

    Attributes:
        pdf_page_number: Page number within the PDF (1-indexed)
        journal_page_number: Corresponding journal page number
        text_content: Extracted text content from this page
        char_count: Number of characters on this page
        has_text_layer: Whether page has selectable text
        extraction_method: How text was extracted (pymupdf, pdfplumber, ocr)
    """
    pdf_page_number: int
    journal_page_number: int
    text_content: str
    char_count: int = 0
    has_text_layer: bool = True
    extraction_method: str = "pymupdf"

    def __post_init__(self):
        """Calculate character count."""
        if self.char_count == 0:
            self.char_count = len(self.text_content)

    def get_preview(self, max_chars: int = 200) -> str:
        """Get text preview for this page."""
        if len(self.text_content) <= max_chars:
            return self.text_content
        return self.text_content[:max_chars] + "..."


@dataclass
class PageAwarePDF:
    """PDF with accurate page number mapping for citations.

    This is the core data structure for the auto-citation system.
    It combines PDF extraction, page offset detection, and bibliographic metadata.

    Attributes:
        pdf_path: Path to the PDF file
        citation_key: BibTeX citation key (e.g., "smith2023")
        reference: Reference object from core.models
        page_offset_result: Result of page offset detection
        pages: List of extracted PDF pages with text
        total_pages: Total number of pages
        metadata: Additional PDF metadata
    """
    pdf_path: str
    citation_key: str
    reference: Any  # Type: scholaris.core.models.Reference (avoiding circular import)
    page_offset_result: PageOffsetResult
    pages: List[PDFPage] = field(default_factory=list)
    total_pages: int = 0
    metadata: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(self):
        """Calculate total pages if not provided."""
        if self.total_pages == 0:
            self.total_pages = len(self.pages)

    def get_journal_page(self, pdf_page: int) -> int:
        """Convert PDF page number to journal page number.

        Args:
            pdf_page: Page number in PDF (1-indexed)

        Returns:
            Corresponding journal page number
        """
        if self.page_offset_result.uses_pdf_pagination:
            return pdf_page
        return pdf_page + self.page_offset_result.offset

    def get_citation_page_string(self, pdf_page: int) -> str:
        """Get formatted page string for citation.

        Args:
            pdf_page: Page number in PDF (1-indexed)

        Returns:
            Formatted page string (e.g., "p. 342" or "PDF p. 6")
        """
        journal_page = self.get_journal_page(pdf_page)

        if self.page_offset_result.uses_pdf_pagination:
            return f"PDF p. {pdf_page}"
        return f"p. {journal_page}"

    def get_page_by_pdf_number(self, pdf_page: int) -> Optional[PDFPage]:
        """Get PDFPage object by PDF page number.

        Args:
            pdf_page: Page number in PDF (1-indexed)

        Returns:
            PDFPage object if found, None otherwise
        """
        for page in self.pages:
            if page.pdf_page_number == pdf_page:
                return page
        return None

    def search_text(self, query: str, case_sensitive: bool = False) -> List[tuple[int, str]]:
        """Search for text across all pages.

        Args:
            query: Text to search for
            case_sensitive: Whether search is case-sensitive

        Returns:
            List of (pdf_page_number, matching_context) tuples
        """
        matches = []
        search_query = query if case_sensitive else query.lower()

        for page in self.pages:
            text = page.text_content if case_sensitive else page.text_content.lower()
            if search_query in text:
                # Extract context around match
                idx = text.index(search_query)
                start = max(0, idx - 100)
                end = min(len(text), idx + len(query) + 100)
                context = page.text_content[start:end].strip()
                matches.append((page.pdf_page_number, context))

        return matches


@dataclass
class CitationRequest:
    """Request to insert citations into a document.

    Attributes:
        document_text: User's document text
        bibliography: List of PageAwarePDF objects
        style: Citation style to use (APA7 or Chicago17)
        preview_mode: If True, return preview without modifying document
        min_confidence: Minimum confidence threshold for citations
        max_citations_per_claim: Maximum citations to insert per claim
    """
    document_text: str
    bibliography: List[PageAwarePDF]
    style: CitationStyle = CitationStyle.APA7
    preview_mode: bool = True
    min_confidence: float = 0.7
    max_citations_per_claim: int = 3


@dataclass
class Citation:
    """A single citation to be inserted.

    Attributes:
        source_pdf: The PageAwarePDF being cited
        page_number: PDF page number where evidence was found
        claim_text: The claim/statement being cited
        evidence_text: Supporting text from the PDF
        confidence: Confidence score for this citation
        citation_string: Formatted citation string (e.g., "(Smith, 2023, p. 42)")
    """
    source_pdf: PageAwarePDF
    page_number: int
    claim_text: str
    evidence_text: str
    confidence: float
    citation_string: str = ""

    @property
    def journal_page(self) -> int:
        """Get the journal page number for this citation."""
        return self.source_pdf.get_journal_page(self.page_number)

    def format_apa7(self) -> str:
        """Format citation in APA 7th edition style."""
        # Extract first author's last name
        authors = self.source_pdf.reference.authors
        if not authors:
            author_str = "Unknown"
        elif len(authors) == 1:
            author_str = authors[0].split()[-1]  # Last name
        elif len(authors) == 2:
            author_str = f"{authors[0].split()[-1]} & {authors[1].split()[-1]}"
        else:
            author_str = f"{authors[0].split()[-1]} et al."

        year = self.source_pdf.reference.year
        journal_page = self.journal_page

        # Check if using PDF pagination (should warn)
        if self.source_pdf.page_offset_result.uses_pdf_pagination:
            return f"({author_str}, {year}, PDF p. {self.page_number})"

        return f"({author_str}, {year}, p. {journal_page})"

    def format_chicago17(self) -> str:
        """Format citation in Chicago 17th edition (notes) style.

        Note: This returns the footnote content, not the superscript number.
        """
        authors = self.source_pdf.reference.authors
        if not authors:
            author_str = "Unknown"
        else:
            # First author: First Last
            first_author_parts = authors[0].split()
            if len(first_author_parts) >= 2:
                author_str = f"{first_author_parts[0]} {first_author_parts[-1]}"
            else:
                author_str = authors[0]

            if len(authors) > 1:
                author_str += " et al."

        title = self.source_pdf.reference.title
        source = self.source_pdf.reference.source
        year = self.source_pdf.reference.year
        journal_page = self.journal_page

        # Check if using PDF pagination
        if self.source_pdf.page_offset_result.uses_pdf_pagination:
            return f'{author_str}, "{title}," {source} ({year}): PDF p. {self.page_number}.'

        return f'{author_str}, "{title}," {source} ({year}): {journal_page}.'


@dataclass
class CitationResult:
    """Result of citation insertion operation.

    Attributes:
        modified_document: Document with citations inserted
        citations: List of citations that were inserted
        preview_data: Preview information for user validation
        warnings: List of warning messages
        metadata: Additional result metadata
    """
    modified_document: str
    citations: List[Citation]
    preview_data: Dict[str, Any] = field(default_factory=dict)
    warnings: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)

    @property
    def citation_count(self) -> int:
        """Total number of citations inserted."""
        return len(self.citations)

    @property
    def has_warnings(self) -> bool:
        """Check if there are any warnings."""
        return len(self.warnings) > 0

    def get_summary(self) -> str:
        """Get summary of citation operation."""
        summary_lines = [
            f"Citations inserted: {self.citation_count}",
            f"Warnings: {len(self.warnings)}",
        ]

        if self.warnings:
            summary_lines.append("\nWarnings:")
            for warning in self.warnings[:5]:  # Show first 5 warnings
                summary_lines.append(f"  - {warning}")
            if len(self.warnings) > 5:
                summary_lines.append(f"  ... and {len(self.warnings) - 5} more")

        return "\n".join(summary_lines)


# ==================== Vision OCR Models ====================

@dataclass
class OCRPage:
    """Page extracted via Vision OCR.

    Used for scanned PDFs where text must be extracted from images.
    Also captures printed page numbers directly from the image.

    Attributes:
        pdf_page: Page number in PDF file (1-indexed)
        book_page: Printed page number detected by OCR (the actual book/journal page)
        text: OCR'd text content
        confidence: OCR confidence score (0.0-1.0)
        is_landscape_half: True if this came from splitting a landscape 2-page scan
        layout_type: "single" or "landscape_double"
    """
    pdf_page: int
    book_page: int
    text: str
    confidence: float = 1.0
    is_landscape_half: bool = False
    layout_type: str = "single"

    @property
    def char_count(self) -> int:
        """Character count of extracted text."""
        return len(self.text)

    def to_pdf_page(self) -> PDFPage:
        """Convert to PDFPage for compatibility."""
        return PDFPage(
            pdf_page_number=self.pdf_page,
            journal_page_number=self.book_page,
            text_content=self.text,
            char_count=len(self.text),
            has_text_layer=False,  # OCR means no text layer
            extraction_method="vision_ocr"
        )


@dataclass
class PageChunk:
    """Chunk of text with verified page metadata.

    Used in the Page-Aware RAG system where each chunk
    has a verified page number from OCR.

    Attributes:
        chunk_id: Unique identifier "{citation_key}_p{book_page}_c{idx}"
        text: Chunk text content
        citation_key: Source identifier (e.g., "halliday1976")
        book_page: VERIFIED page number from OCR
        pdf_page: Original PDF page number
        chunk_index: Sequence within page (0, 1, 2, ...)
    """
    chunk_id: str
    text: str
    citation_key: str
    book_page: int
    pdf_page: int
    chunk_index: int

    @classmethod
    def create_id(cls, citation_key: str, book_page: int, chunk_index: int, pdf_page: int = None) -> str:
        """Create standardized chunk ID.

        Includes pdf_page for uniqueness in landscape double-page scans
        where multiple book pages come from the same PDF page.
        """
        if pdf_page is not None:
            return f"{citation_key}_pdf{pdf_page}_p{book_page}_c{chunk_index}"
        return f"{citation_key}_p{book_page}_c{chunk_index}"


@dataclass
class RetrievedChunk:
    """Chunk retrieved from RAG with similarity score.

    Returned by PageAwareRAG.query() with verified page metadata.

    Attributes:
        chunk_id: Unique identifier
        text: Chunk text content
        citation_key: Source identifier
        book_page: VERIFIED page number (from OCR, not guessed)
        pdf_page: Original PDF page
        similarity: Similarity score from vector search (0.0-1.0)
        authors: Author string for citation formatting
        year: Publication year
        title: Source title
        chunk_index: Index within page for ordering context
    """
    chunk_id: str
    text: str
    citation_key: str
    book_page: int
    pdf_page: int
    similarity: float
    authors: str = ""
    year: int = 0
    title: str = ""
    chunk_index: Optional[int] = None  # For ordering within page

    def format_evidence_string(self, max_length: int = 500) -> str:
        """Format for inclusion in LLM prompt."""
        text_preview = self.text[:max_length] + "..." if len(self.text) > max_length else self.text
        return f"[{self.citation_key}, p.{self.book_page}]: {text_preview}"
