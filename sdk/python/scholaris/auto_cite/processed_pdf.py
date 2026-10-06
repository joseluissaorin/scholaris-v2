"""ProcessedPDF: Shareable processed PDF format (.spdf).

A ProcessedPDF file contains everything needed for citation matching:
- Metadata (citation_key, authors, year, title)
- OCR pages with verified page numbers
- Text chunks
- Embeddings for each chunk
- Low-res page previews for recovery

File format: gzip-compressed SQLite database
Supported extensions: .spdf, .scholaris, .scpdf
"""

import gzip
import hashlib
import io
import json
import logging
import sqlite3
import struct
import tempfile
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple, Union

import numpy as np

logger = logging.getLogger(__name__)


# Schema version for migrations
SCHEMA_VERSION = 1

# Supported file extensions
SUPPORTED_EXTENSIONS = [".spdf", ".scholaris", ".scpdf"]
DEFAULT_EXTENSION = ".spdf"


@dataclass
class SPDFMetadata:
    """Metadata stored in a .spdf file."""
    citation_key: str
    authors: List[str]
    year: int
    title: str
    source_pdf_hash: str
    source_pdf_filename: str
    processed_at: str
    ocr_model: str
    embedding_model: str
    embedding_dim: int
    schema_version: int = SCHEMA_VERSION
    total_pages: int = 0
    total_chunks: int = 0
    # Extended bibliographic fields (added in v1.1)
    source: str = ""  # Journal, conference, or publisher name
    volume: str = ""  # Volume number
    issue: str = ""   # Issue number
    pages: str = ""   # Page range (e.g., "1-34")
    doi: str = ""     # Digital Object Identifier
    url: str = ""     # URL if available
    language: str = ""  # ISO 639-1 language code (e.g., "en", "es", "de", "fr")


@dataclass
class SPDFPage:
    """A page extracted via OCR."""
    id: int
    pdf_page: int
    book_page: int
    text: str
    confidence: float
    is_landscape_half: bool = False


@dataclass
class SPDFChunk:
    """A text chunk with embedding."""
    id: int
    page_id: int
    chunk_index: int
    text: str
    book_page: int
    pdf_page: int


@dataclass
class SPDFPreview:
    """Low-res page preview for recovery."""
    pdf_page: int
    thumbnail: bytes  # JPEG bytes
    width: int
    height: int


class ProcessedPDF:
    """A processed PDF ready for citation matching.

    Contains:
    - Metadata (citation_key, authors, year, title, etc.)
    - OCR pages with verified page numbers
    - Text chunks
    - Embeddings for each chunk (768-dim vectors)
    - Low-res page previews for recovery

    File format: gzip-compressed SQLite database
    Supported extensions: .spdf, .scholaris, .scpdf

    Example usage:
        # Process a PDF
        processed = ProcessedPDF.from_pdf(
            pdf_path="beaugrande1981.pdf",
            citation_key="beaugrande1981",
            authors=["R.A. de Beaugrande"],
            year=1981,
            title="Introduction to Text Linguistics",
            gemini_api_key="...",
        )
        processed.save("beaugrande1981.spdf")

        # Load and use
        processed = ProcessedPDF.load("beaugrande1981.spdf")
    """

    SUPPORTED_EXTENSIONS = SUPPORTED_EXTENSIONS
    DEFAULT_EXTENSION = DEFAULT_EXTENSION
    SCHEMA_VERSION = SCHEMA_VERSION

    def __init__(self):
        """Initialize empty ProcessedPDF."""
        self.metadata: Optional[SPDFMetadata] = None
        self.pages: List[SPDFPage] = []
        self.chunks: List[SPDFChunk] = []
        self.embeddings: List[np.ndarray] = []  # List of 768-dim vectors
        self.previews: List[SPDFPreview] = []
        self._source_path: Optional[str] = None

    @classmethod
    def from_pdf(
        cls,
        pdf_path: Union[str, Path],
        citation_key: str,
        authors: List[str],
        year: int,
        title: str,
        gemini_api_key: str,
        include_previews: bool = True,
        preview_dpi: int = 100,
        preview_quality: int = 60,
        start_page: int = 0,
        end_page: Optional[int] = None,
        chunk_size: int = 500,
        chunk_overlap: int = 100,
    ) -> "ProcessedPDF":
        """Process a PDF and create a ProcessedPDF instance.

        Args:
            pdf_path: Path to PDF file
            citation_key: Unique identifier for this source
            authors: List of author names
            year: Publication year
            title: Title of the work
            gemini_api_key: API key for Gemini OCR and embeddings
            include_previews: Store low-res thumbnails for recovery
            preview_dpi: DPI for preview thumbnails
            preview_quality: JPEG quality for previews (1-100)
            start_page: First PDF page to process (0-indexed)
            end_page: Last PDF page to process (None = all)
            chunk_size: Characters per chunk
            chunk_overlap: Overlap between chunks

        Returns:
            ProcessedPDF instance ready to save
        """
        import fitz  # PyMuPDF
        from .vision_ocr import VisionOCRProcessor
        from .page_aware_rag import GeminiEmbedder

        pdf_path = Path(pdf_path)
        if not pdf_path.exists():
            raise FileNotFoundError(f"PDF not found: {pdf_path}")

        logger.info(f"Processing PDF: {pdf_path.name}")

        # Create instance
        instance = cls()
        instance._source_path = str(pdf_path)

        # Compute source hash
        source_hash = cls._compute_file_hash(pdf_path)
        logger.info(f"Source PDF hash: {source_hash[:16]}...")

        # Open PDF
        doc = fitz.open(str(pdf_path))
        total_pdf_pages = len(doc)

        if end_page is None:
            end_page = total_pdf_pages
        end_page = min(end_page, total_pdf_pages)

        pages_to_process = list(range(start_page, end_page))
        logger.info(f"Processing pages {start_page + 1} to {end_page} of {total_pdf_pages}")

        # Step 1: Vision OCR (PRIMARY method - guarantees page numbers)
        logger.info("Step 1: Vision OCR with parallel processing...")
        ocr_processor = VisionOCRProcessor(gemini_api_key)

        # Generate previews first (before closing doc)
        previews = []
        if include_previews:
            logger.info("  Generating previews...")
            for pdf_page_idx in pages_to_process:
                page = doc[pdf_page_idx]
                mat_preview = fitz.Matrix(preview_dpi/72, preview_dpi/72)
                pix_preview = page.get_pixmap(matrix=mat_preview)
                jpeg_bytes = pix_preview.tobytes("jpeg", jpg_quality=preview_quality)

                previews.append(SPDFPreview(
                    pdf_page=pdf_page_idx + 1,
                    thumbnail=jpeg_bytes,
                    width=pix_preview.width,
                    height=pix_preview.height,
                ))
            logger.info(f"  Generated {len(previews)} previews")

        doc.close()

        # Run Vision OCR with parallel processing (5 workers)
        try:
            ocr_pages = ocr_processor.process_pdf(
                str(pdf_path),
                start_page=start_page,
                end_page=end_page,
            )
            extraction_mode = "vision_ocr"
            logger.info(f"  Vision OCR complete: {len(ocr_pages)} pages")

        except Exception as e:
            # Fallback to text layer if Vision OCR fails completely
            logger.warning(f"  Vision OCR failed: {e}")
            logger.info("  Falling back to text layer extraction...")

            ocr_pages = ocr_processor.extract_text_layer(
                str(pdf_path),
                start_page=start_page,
                end_page=end_page,
            )
            extraction_mode = "text_layer_fallback"
            logger.info(f"  Text layer extraction complete: {len(ocr_pages)} pages")

        # Convert OCR pages to SPDFPage objects
        for idx, ocr_page in enumerate(ocr_pages):
            instance.pages.append(SPDFPage(
                id=idx,
                pdf_page=ocr_page.pdf_page,
                book_page=ocr_page.book_page,
                text=ocr_page.text,
                confidence=ocr_page.confidence,
                is_landscape_half=getattr(ocr_page, 'is_landscape_half', False),
            ))

        instance.previews = previews

        # Step 2: Chunk text
        logger.info("Step 2: Chunking text...")
        chunk_id = 0
        for page in instance.pages:
            page_chunks = cls._chunk_text(page.text, chunk_size, chunk_overlap)
            for chunk_idx, chunk_text in enumerate(page_chunks):
                if chunk_text.strip():
                    instance.chunks.append(SPDFChunk(
                        id=chunk_id,
                        page_id=page.id,
                        chunk_index=chunk_idx,
                        text=chunk_text,
                        book_page=page.book_page,
                        pdf_page=page.pdf_page,
                    ))
                    chunk_id += 1

        logger.info(f"  Created {len(instance.chunks)} chunks")

        # Step 3: Generate embeddings
        logger.info("Step 3: Generating embeddings...")
        embedder = GeminiEmbedder(gemini_api_key)

        chunk_texts = [c.text for c in instance.chunks]
        embeddings = embedder.embed_batch(chunk_texts)
        instance.embeddings = [np.array(e, dtype=np.float32) for e in embeddings]

        embedding_dim = len(instance.embeddings[0]) if instance.embeddings else 768
        logger.info(f"  Generated {len(instance.embeddings)} embeddings ({embedding_dim}-dim)")

        # Create metadata
        instance.metadata = SPDFMetadata(
            citation_key=citation_key,
            authors=authors,
            year=year,
            title=title,
            source_pdf_hash=source_hash,
            source_pdf_filename=pdf_path.name,
            processed_at=datetime.now().isoformat(),
            ocr_model=extraction_mode,  # "text_layer" or "vision_ocr"
            embedding_model="gemini-embedding-exp-03-07",
            embedding_dim=embedding_dim,
            schema_version=SCHEMA_VERSION,
            total_pages=len(instance.pages),
            total_chunks=len(instance.chunks),
        )

        logger.info(f"Processing complete: {citation_key}")
        return instance

    @classmethod
    def load(cls, path: Union[str, Path]) -> "ProcessedPDF":
        """Load a .spdf file.

        Args:
            path: Path to .spdf/.scholaris/.scpdf file

        Returns:
            ProcessedPDF instance
        """
        path = Path(path)

        if not path.exists():
            raise FileNotFoundError(f"File not found: {path}")

        if path.suffix.lower() not in SUPPORTED_EXTENSIONS:
            raise ValueError(f"Unsupported extension: {path.suffix}. Supported: {SUPPORTED_EXTENSIONS}")

        logger.info(f"Loading: {path.name}")

        # Decompress and load SQLite
        with gzip.open(path, 'rb') as f:
            db_bytes = f.read()

        # Load from in-memory SQLite
        instance = cls()
        instance._source_path = str(path)

        # Create in-memory database from bytes
        conn = sqlite3.connect(":memory:")
        conn.executescript("")  # Initialize

        # Write bytes to temp file and attach (SQLite limitation)
        with tempfile.NamedTemporaryFile(delete=False, suffix=".db") as tmp:
            tmp.write(db_bytes)
            tmp_path = tmp.name

        try:
            conn = sqlite3.connect(tmp_path)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()

            # Load metadata
            cursor.execute("SELECT key, value FROM metadata")
            meta_dict = {row['key']: row['value'] for row in cursor.fetchall()}

            instance.metadata = SPDFMetadata(
                citation_key=meta_dict.get('citation_key', ''),
                authors=json.loads(meta_dict.get('authors', '[]')),
                year=int(meta_dict.get('year', 0)),
                title=meta_dict.get('title', ''),
                source_pdf_hash=meta_dict.get('source_pdf_hash', ''),
                source_pdf_filename=meta_dict.get('source_pdf_filename', ''),
                processed_at=meta_dict.get('processed_at', ''),
                ocr_model=meta_dict.get('ocr_model', ''),
                embedding_model=meta_dict.get('embedding_model', ''),
                embedding_dim=int(meta_dict.get('embedding_dim', 768)),
                schema_version=int(meta_dict.get('schema_version', 1)),
                total_pages=int(meta_dict.get('total_pages', 0)),
                total_chunks=int(meta_dict.get('total_chunks', 0)),
                # Extended bibliographic fields
                source=meta_dict.get('source', ''),
                volume=meta_dict.get('volume', ''),
                issue=meta_dict.get('issue', ''),
                pages=meta_dict.get('pages', ''),
                doi=meta_dict.get('doi', ''),
                url=meta_dict.get('url', ''),
                language=meta_dict.get('language', ''),
            )

            # Load pages
            cursor.execute("SELECT * FROM pages ORDER BY id")
            for row in cursor.fetchall():
                instance.pages.append(SPDFPage(
                    id=row['id'],
                    pdf_page=row['pdf_page'],
                    book_page=row['book_page'],
                    text=row['text'],
                    confidence=row['confidence'],
                    is_landscape_half=bool(row['is_landscape_half']),
                ))

            # Load chunks
            cursor.execute("SELECT * FROM chunks ORDER BY id")
            for row in cursor.fetchall():
                instance.chunks.append(SPDFChunk(
                    id=row['id'],
                    page_id=row['page_id'],
                    chunk_index=row['chunk_index'],
                    text=row['text'],
                    book_page=row['book_page'],
                    pdf_page=row['pdf_page'],
                ))

            # Load embeddings
            cursor.execute("SELECT chunk_id, vector FROM embeddings ORDER BY chunk_id")
            for row in cursor.fetchall():
                vector = np.frombuffer(row['vector'], dtype=np.float32)
                instance.embeddings.append(vector)

            # Load previews
            cursor.execute("SELECT * FROM previews ORDER BY pdf_page")
            for row in cursor.fetchall():
                instance.previews.append(SPDFPreview(
                    pdf_page=row['pdf_page'],
                    thumbnail=row['thumbnail'],
                    width=row['width'],
                    height=row['height'],
                ))

            conn.close()

        finally:
            # Clean up temp file
            Path(tmp_path).unlink(missing_ok=True)

        logger.info(f"Loaded: {instance.metadata.citation_key} ({len(instance.chunks)} chunks)")
        return instance

    def save(self, path: Union[str, Path]) -> str:
        """Save to .spdf file.

        Args:
            path: Output path (will add .spdf extension if needed)

        Returns:
            Path to saved file
        """
        path = Path(path)

        # Ensure valid extension
        if path.suffix.lower() not in SUPPORTED_EXTENSIONS:
            path = path.with_suffix(DEFAULT_EXTENSION)

        logger.info(f"Saving: {path.name}")

        # Create SQLite database in temp file
        with tempfile.NamedTemporaryFile(delete=False, suffix=".db") as tmp:
            tmp_path = tmp.name

        try:
            conn = sqlite3.connect(tmp_path)
            cursor = conn.cursor()

            # Create schema
            cursor.executescript("""
                CREATE TABLE metadata (
                    key TEXT PRIMARY KEY,
                    value TEXT
                );

                CREATE TABLE pages (
                    id INTEGER PRIMARY KEY,
                    pdf_page INTEGER,
                    book_page INTEGER,
                    text TEXT,
                    confidence REAL,
                    is_landscape_half INTEGER
                );

                CREATE TABLE chunks (
                    id INTEGER PRIMARY KEY,
                    page_id INTEGER,
                    chunk_index INTEGER,
                    text TEXT,
                    book_page INTEGER,
                    pdf_page INTEGER,
                    FOREIGN KEY (page_id) REFERENCES pages(id)
                );

                CREATE TABLE embeddings (
                    chunk_id INTEGER PRIMARY KEY,
                    vector BLOB,
                    FOREIGN KEY (chunk_id) REFERENCES chunks(id)
                );

                CREATE TABLE previews (
                    pdf_page INTEGER PRIMARY KEY,
                    thumbnail BLOB,
                    width INTEGER,
                    height INTEGER
                );

                CREATE INDEX idx_chunks_book_page ON chunks(book_page);
                CREATE INDEX idx_pages_pdf_page ON pages(pdf_page);
            """)

            # Insert metadata
            meta_items = [
                ('citation_key', self.metadata.citation_key),
                ('authors', json.dumps(self.metadata.authors)),
                ('year', str(self.metadata.year)),
                ('title', self.metadata.title),
                ('source_pdf_hash', self.metadata.source_pdf_hash),
                ('source_pdf_filename', self.metadata.source_pdf_filename),
                ('processed_at', self.metadata.processed_at),
                ('ocr_model', self.metadata.ocr_model),
                ('embedding_model', self.metadata.embedding_model),
                ('embedding_dim', str(self.metadata.embedding_dim)),
                ('schema_version', str(self.metadata.schema_version)),
                ('total_pages', str(len(self.pages))),
                ('total_chunks', str(len(self.chunks))),
                # Extended bibliographic fields
                ('source', self.metadata.source),
                ('volume', self.metadata.volume),
                ('issue', self.metadata.issue),
                ('pages', self.metadata.pages),
                ('doi', self.metadata.doi),
                ('url', self.metadata.url),
                ('language', self.metadata.language),
            ]
            cursor.executemany("INSERT INTO metadata (key, value) VALUES (?, ?)", meta_items)

            # Insert pages
            for page in self.pages:
                cursor.execute(
                    "INSERT INTO pages (id, pdf_page, book_page, text, confidence, is_landscape_half) VALUES (?, ?, ?, ?, ?, ?)",
                    (page.id, page.pdf_page, page.book_page, page.text, page.confidence, int(page.is_landscape_half))
                )

            # Insert chunks
            for chunk in self.chunks:
                cursor.execute(
                    "INSERT INTO chunks (id, page_id, chunk_index, text, book_page, pdf_page) VALUES (?, ?, ?, ?, ?, ?)",
                    (chunk.id, chunk.page_id, chunk.chunk_index, chunk.text, chunk.book_page, chunk.pdf_page)
                )

            # Insert embeddings
            for i, embedding in enumerate(self.embeddings):
                vector_bytes = embedding.astype(np.float32).tobytes()
                cursor.execute(
                    "INSERT INTO embeddings (chunk_id, vector) VALUES (?, ?)",
                    (i, vector_bytes)
                )

            # Insert previews
            for preview in self.previews:
                cursor.execute(
                    "INSERT INTO previews (pdf_page, thumbnail, width, height) VALUES (?, ?, ?, ?)",
                    (preview.pdf_page, preview.thumbnail, preview.width, preview.height)
                )

            conn.commit()
            conn.close()

            # Read and compress
            with open(tmp_path, 'rb') as f:
                db_bytes = f.read()

            compressed = gzip.compress(db_bytes, compresslevel=6)

            # Write to final path
            path.parent.mkdir(parents=True, exist_ok=True)
            with open(path, 'wb') as f:
                f.write(compressed)

            # Log compression stats
            original_size = len(db_bytes) / 1024 / 1024
            compressed_size = len(compressed) / 1024 / 1024
            ratio = (1 - compressed_size / original_size) * 100
            logger.info(f"Saved: {path.name} ({compressed_size:.1f} MB, {ratio:.0f}% compression)")

        finally:
            Path(tmp_path).unlink(missing_ok=True)

        return str(path)

    @staticmethod
    def info(path: Union[str, Path]) -> Dict[str, Any]:
        """Get info about a .spdf file without full load.

        Args:
            path: Path to .spdf file

        Returns:
            Dictionary with file info
        """
        path = Path(path)

        if not path.exists():
            raise FileNotFoundError(f"File not found: {path}")

        # Get file size
        file_size = path.stat().st_size / 1024 / 1024  # MB

        # Quick load of metadata only
        with gzip.open(path, 'rb') as f:
            db_bytes = f.read()

        with tempfile.NamedTemporaryFile(delete=False, suffix=".db") as tmp:
            tmp.write(db_bytes)
            tmp_path = tmp.name

        try:
            conn = sqlite3.connect(tmp_path)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()

            cursor.execute("SELECT key, value FROM metadata")
            meta = {row['key']: row['value'] for row in cursor.fetchall()}

            # Check for previews
            cursor.execute("SELECT COUNT(*) as count FROM previews")
            preview_count = cursor.fetchone()['count']

            conn.close()

            return {
                "citation_key": meta.get('citation_key', ''),
                "title": meta.get('title', ''),
                "authors": json.loads(meta.get('authors', '[]')),
                "year": int(meta.get('year', 0)),
                "pages": int(meta.get('total_pages', 0)),
                "chunks": int(meta.get('total_chunks', 0)),
                "size_mb": round(file_size, 2),
                "has_previews": preview_count > 0,
                "preview_pages": preview_count,
                "source_pdf_hash": meta.get('source_pdf_hash', ''),
                "source_pdf_filename": meta.get('source_pdf_filename', ''),
                "processed_at": meta.get('processed_at', ''),
                "ocr_model": meta.get('ocr_model', ''),
                "embedding_model": meta.get('embedding_model', ''),
                "embedding_dim": int(meta.get('embedding_dim', 768)),
                "schema_version": int(meta.get('schema_version', 1)),
                "compressed": True,
            }

        finally:
            Path(tmp_path).unlink(missing_ok=True)

    @staticmethod
    def is_valid_extension(path: Union[str, Path]) -> bool:
        """Check if path has a valid .spdf extension."""
        return Path(path).suffix.lower() in SUPPORTED_EXTENSIONS

    def verify_hash(self, pdf_path: Union[str, Path]) -> bool:
        """Verify this .spdf matches the given PDF.

        Args:
            pdf_path: Path to original PDF

        Returns:
            True if hashes match
        """
        if not self.metadata:
            return False

        current_hash = self._compute_file_hash(pdf_path)
        return current_hash == self.metadata.source_pdf_hash

    def export_preview_pdf(self, output_path: Union[str, Path]) -> str:
        """Export low-res PDF from stored previews.

        Useful for recovery when original PDF is lost.

        Args:
            output_path: Path for output PDF

        Returns:
            Path to saved file
        """
        import fitz  # PyMuPDF

        if not self.previews:
            raise ValueError("No previews stored in this .spdf file")

        output_path = Path(output_path)

        # Create new PDF
        doc = fitz.open()

        for preview in sorted(self.previews, key=lambda p: p.pdf_page):
            # Load JPEG as pixmap
            pix = fitz.Pixmap(preview.thumbnail)

            # Create page with image dimensions
            page = doc.new_page(width=pix.width, height=pix.height)

            # Insert image
            page.insert_image(page.rect, pixmap=pix)

        doc.save(str(output_path))
        doc.close()

        logger.info(f"Exported preview PDF: {output_path} ({len(self.previews)} pages)")
        return str(output_path)

    def export_text(self, output_path: Union[str, Path]) -> str:
        """Export full OCR text.

        Args:
            output_path: Path for output text file

        Returns:
            Path to saved file
        """
        output_path = Path(output_path)

        lines = []
        lines.append(f"# {self.metadata.title}")
        lines.append(f"# {', '.join(self.metadata.authors)} ({self.metadata.year})")
        lines.append(f"# Citation key: {self.metadata.citation_key}")
        lines.append("")

        for page in sorted(self.pages, key=lambda p: (p.pdf_page, p.book_page)):
            lines.append(f"\n--- Page {page.book_page} (PDF page {page.pdf_page}) ---\n")
            lines.append(page.text)

        output_path.write_text("\n".join(lines), encoding="utf-8")

        logger.info(f"Exported text: {output_path}")
        return str(output_path)

    def update_metadata(
        self,
        citation_key: Optional[str] = None,
        authors: Optional[List[str]] = None,
        year: Optional[int] = None,
        title: Optional[str] = None,
    ) -> None:
        """Update metadata without re-processing.

        Args:
            citation_key: New citation key
            authors: New author list
            year: New year
            title: New title
        """
        if not self.metadata:
            raise ValueError("No metadata to update")

        if citation_key is not None:
            self.metadata.citation_key = citation_key
        if authors is not None:
            self.metadata.authors = authors
        if year is not None:
            self.metadata.year = year
        if title is not None:
            self.metadata.title = title

    def get_chunks_for_page(self, book_page: int) -> List[SPDFChunk]:
        """Get all chunks for a specific book page."""
        return [c for c in self.chunks if c.book_page == book_page]

    def get_embedding_matrix(self) -> np.ndarray:
        """Get all embeddings as a numpy matrix.

        Returns:
            Array of shape (n_chunks, embedding_dim)
        """
        if not self.embeddings:
            return np.array([])
        return np.vstack(self.embeddings)

    @staticmethod
    def _compute_file_hash(path: Union[str, Path]) -> str:
        """Compute SHA256 hash of a file."""
        sha256 = hashlib.sha256()
        with open(path, 'rb') as f:
            for chunk in iter(lambda: f.read(8192), b''):
                sha256.update(chunk)
        return f"sha256:{sha256.hexdigest()}"

    @staticmethod
    def _chunk_text(text: str, chunk_size: int = 500, overlap: int = 100) -> List[str]:
        """Split text into overlapping chunks."""
        if not text or len(text) <= chunk_size:
            return [text] if text else []

        chunks = []
        start = 0

        while start < len(text):
            end = start + chunk_size

            # Try to break at sentence boundary
            if end < len(text):
                # Look for sentence end in last 20% of chunk
                search_start = start + int(chunk_size * 0.8)
                best_break = end

                for char in '.!?\n':
                    pos = text.rfind(char, search_start, end)
                    if pos > search_start:
                        best_break = pos + 1
                        break

                end = best_break

            chunk = text[start:end].strip()
            if chunk:
                chunks.append(chunk)

            start = end - overlap if end < len(text) else len(text)

        return chunks

    def __repr__(self) -> str:
        if self.metadata:
            return f"ProcessedPDF({self.metadata.citation_key}, {len(self.chunks)} chunks)"
        return "ProcessedPDF(empty)"
