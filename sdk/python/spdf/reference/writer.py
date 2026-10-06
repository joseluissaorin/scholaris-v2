"""SPDF Reference Writer - Minimal implementation for writing .spdf files.

This module provides a minimal, dependency-light implementation of the SPDF
writer that can be used as a reference for porting to other languages.

Dependencies:
- Python 3.9+ standard library (gzip, sqlite3, json, tempfile, hashlib)
- numpy (for embedding vectors only)

Example:
    from spdf.reference import write_spdf

    write_spdf(
        path="output.spdf",
        metadata={...},
        pages=[...],
        chunks=[...],
        embeddings=[...],
    )

v1.1 Example (with embedded model):
    from spdf.reference import SPDFWriter
    from spdf.models import ModelStore

    writer = SPDFWriter()
    writer.set_metadata(...)
    writer.add_page(...)
    writer.add_chunk(...)
    writer.add_embedding(...)

    # Embed model checkpoint for reproducibility
    store = ModelStore()
    model_path = store.get_model("nomic-embed-text-v2-moe-Q2_K")
    writer.embed_model_checkpoint(model_path, storage_mode="embedded")

    writer.save("output.spdf")
"""

import gzip
import hashlib
import json
import sqlite3
import tempfile
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional, Union

import numpy as np


# Supported extensions
SUPPORTED_EXTENSIONS = [".spdf", ".scholaris", ".scpdf"]
DEFAULT_EXTENSION = ".spdf"

# Schema versions
SCHEMA_VERSION_V1 = 1  # Original schema
SCHEMA_VERSION_V11 = 2  # v1.1 with model checkpoint support

# SQL schema v1.0 (backward compatible base)
SCHEMA_SQL_V1 = """
CREATE TABLE metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE pages (
    id INTEGER PRIMARY KEY,
    pdf_page INTEGER NOT NULL,
    book_page INTEGER NOT NULL,
    text TEXT NOT NULL,
    confidence REAL NOT NULL,
    is_landscape_half INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE chunks (
    id INTEGER PRIMARY KEY,
    page_id INTEGER NOT NULL,
    chunk_index INTEGER NOT NULL,
    text TEXT NOT NULL,
    book_page INTEGER NOT NULL,
    pdf_page INTEGER NOT NULL,
    FOREIGN KEY (page_id) REFERENCES pages(id)
);

CREATE TABLE embeddings (
    chunk_id INTEGER PRIMARY KEY,
    vector BLOB NOT NULL,
    FOREIGN KEY (chunk_id) REFERENCES chunks(id)
);

CREATE TABLE previews (
    pdf_page INTEGER PRIMARY KEY,
    thumbnail BLOB NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL
);

CREATE INDEX idx_chunks_book_page ON chunks(book_page);
CREATE INDEX idx_pages_pdf_page ON pages(pdf_page);

-- FTS5 Full-Text Search index on chunks
-- Uses Porter stemming and Unicode tokenization for better search
CREATE VIRTUAL TABLE chunks_fts USING fts5(
    text,
    content='chunks',
    content_rowid='id',
    tokenize='porter unicode61 remove_diacritics 1'
);

-- Triggers to keep FTS index synchronized with chunks table
CREATE TRIGGER chunks_fts_insert AFTER INSERT ON chunks BEGIN
    INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
END;

CREATE TRIGGER chunks_fts_delete AFTER DELETE ON chunks BEGIN
    INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;

CREATE TRIGGER chunks_fts_update AFTER UPDATE ON chunks BEGIN
    INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
    INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
END;
"""

# SQL schema v1.1 additions (model checkpoint support)
SCHEMA_SQL_V11 = """
-- Model checkpoint for reproducible embeddings
CREATE TABLE model_checkpoint (
    id INTEGER PRIMARY KEY DEFAULT 1,
    model_name TEXT NOT NULL,
    model_version TEXT NOT NULL,
    model_hash TEXT NOT NULL,
    source_url TEXT,
    license TEXT,
    quantization TEXT,
    format TEXT NOT NULL CHECK (format IN ('gguf', 'onnx', 'safetensors')),
    storage_mode TEXT NOT NULL CHECK (storage_mode IN ('embedded', 'external', 'api')),
    checkpoint_blob BLOB,
    checkpoint_size INTEGER,
    external_path TEXT,
    embedding_dim INTEGER NOT NULL,
    max_tokens INTEGER,
    prefix_query TEXT,
    prefix_document TEXT,
    normalize_embeddings INTEGER DEFAULT 1 CHECK (normalize_embeddings IN (0, 1)),
    CHECK (
        (storage_mode = 'embedded' AND checkpoint_blob IS NOT NULL) OR
        (storage_mode = 'external' AND external_path IS NOT NULL) OR
        (storage_mode = 'api')
    )
);

-- Multi-model embedding support
CREATE TABLE embeddings_v2 (
    chunk_id INTEGER NOT NULL,
    model_id TEXT NOT NULL,
    vector BLOB NOT NULL,
    created_at TEXT,
    PRIMARY KEY (chunk_id, model_id),
    FOREIGN KEY (chunk_id) REFERENCES chunks(id)
);

CREATE INDEX idx_embeddings_v2_model ON embeddings_v2(model_id);
"""

# Combined schema for convenience
SCHEMA_SQL = SCHEMA_SQL_V1


class SPDFWriter:
    """Writer for SPDF files.

    Example:
        writer = SPDFWriter()
        writer.set_metadata(
            citation_key="smith2023",
            authors=["John Smith"],
            year=2023,
            title="Example Paper",
            source_pdf_path="source.pdf",
            ocr_model="gemini-2.0-flash-lite",
            embedding_model="gemini-embedding-exp-03-07",
            embedding_dim=768,
        )
        writer.add_page(pdf_page=1, book_page=1, text="...", confidence=0.95)
        writer.add_chunk(page_id=0, chunk_index=0, text="...", book_page=1, pdf_page=1)
        writer.add_embedding(np.array([...]))
        writer.save("output.spdf")

    v1.1 Example (with embedded model):
        writer = SPDFWriter()
        writer.set_metadata(...)
        # ... add pages, chunks, embeddings ...
        writer.embed_model_checkpoint(
            model_path="/path/to/model.gguf",
            model_name="nomic-embed-text-v2-moe",
            storage_mode="embedded",  # or "external" or "api"
        )
        writer.save("output.spdf")
    """

    def __init__(self):
        self._metadata: Dict[str, str] = {}
        self._pages: List[Dict[str, Any]] = []
        self._chunks: List[Dict[str, Any]] = []
        self._embeddings: List[np.ndarray] = []
        self._previews: List[Dict[str, Any]] = []
        # v1.1 additions
        self._model_checkpoint: Optional[Dict[str, Any]] = None
        self._embeddings_v2: List[Dict[str, Any]] = []  # {chunk_id, model_id, vector, created_at}

    def set_metadata(
        self,
        citation_key: str,
        authors: List[str],
        year: int,
        title: str,
        source_pdf_path: Optional[Union[str, Path]] = None,
        source_pdf_hash: Optional[str] = None,
        source_pdf_filename: Optional[str] = None,
        ocr_model: str = "unknown",
        embedding_model: str = "unknown",
        embedding_dim: int = 768,
    ) -> None:
        """Set document metadata.

        Args:
            citation_key: Unique identifier for this source
            authors: List of author names
            year: Publication year
            title: Document title
            source_pdf_path: Path to source PDF (for hash computation)
            source_pdf_hash: Pre-computed hash (if source_pdf_path not provided)
            source_pdf_filename: Original filename (if source_pdf_path not provided)
            ocr_model: OCR model used
            embedding_model: Embedding model used
            embedding_dim: Embedding dimensions
        """
        # Compute hash if path provided
        if source_pdf_path:
            source_pdf_path = Path(source_pdf_path)
            source_pdf_hash = self._compute_file_hash(source_pdf_path)
            source_pdf_filename = source_pdf_path.name
        elif not source_pdf_hash:
            source_pdf_hash = "sha256:0" * 64
            source_pdf_filename = source_pdf_filename or "unknown"

        self._metadata = {
            'citation_key': citation_key,
            'authors': json.dumps(authors),
            'year': str(year),
            'title': title,
            'source_pdf_hash': source_pdf_hash,
            'source_pdf_filename': source_pdf_filename or "unknown",
            'processed_at': datetime.now().isoformat(),
            'ocr_model': ocr_model,
            'embedding_model': embedding_model,
            'embedding_dim': str(embedding_dim),
            'schema_version': str(SCHEMA_VERSION_V1),  # Updated to V11 if v1.1 features used
            'total_pages': '0',  # Updated on save
            'total_chunks': '0',  # Updated on save
        }

    def add_page(
        self,
        pdf_page: int,
        book_page: int,
        text: str,
        confidence: float,
        is_landscape_half: bool = False,
    ) -> int:
        """Add a page.

        Args:
            pdf_page: PDF page number (1-indexed)
            book_page: Printed page number
            text: OCR text content
            confidence: OCR confidence (0.0-1.0)
            is_landscape_half: True if half of landscape double-page

        Returns:
            Page ID (0-indexed)
        """
        page_id = len(self._pages)
        self._pages.append({
            'id': page_id,
            'pdf_page': pdf_page,
            'book_page': book_page,
            'text': text,
            'confidence': confidence,
            'is_landscape_half': int(is_landscape_half),
        })
        return page_id

    def add_chunk(
        self,
        page_id: int,
        chunk_index: int,
        text: str,
        book_page: int,
        pdf_page: int,
    ) -> int:
        """Add a text chunk.

        Args:
            page_id: Reference to page ID
            chunk_index: Chunk index within page
            text: Chunk text
            book_page: Book page number
            pdf_page: PDF page number

        Returns:
            Chunk ID (0-indexed)
        """
        chunk_id = len(self._chunks)
        self._chunks.append({
            'id': chunk_id,
            'page_id': page_id,
            'chunk_index': chunk_index,
            'text': text,
            'book_page': book_page,
            'pdf_page': pdf_page,
        })
        return chunk_id

    def add_embedding(self, vector: np.ndarray) -> None:
        """Add an embedding vector.

        Args:
            vector: Embedding vector (must match embedding_dim)
        """
        self._embeddings.append(vector.astype(np.float32))

    def add_preview(
        self,
        pdf_page: int,
        thumbnail: bytes,
        width: int,
        height: int,
    ) -> None:
        """Add a page preview.

        Args:
            pdf_page: PDF page number
            thumbnail: JPEG image bytes
            width: Image width
            height: Image height
        """
        self._previews.append({
            'pdf_page': pdf_page,
            'thumbnail': thumbnail,
            'width': width,
            'height': height,
        })

    # =========================================================================
    # v1.1 Methods: Model Checkpoint Support
    # =========================================================================

    def embed_model_checkpoint(
        self,
        model_path: Union[str, Path],
        model_name: str,
        model_version: str = "1.0",
        storage_mode: str = "embedded",
        embedding_dim: int = 768,
        max_tokens: Optional[int] = 8192,
        prefix_query: Optional[str] = "search_query: ",
        prefix_document: Optional[str] = "search_document: ",
        normalize: bool = True,
        source_url: Optional[str] = None,
        license_info: Optional[str] = "Apache-2.0",
        quantization: Optional[str] = None,
        model_format: str = "gguf",
        external_path: Optional[str] = None,
    ) -> str:
        """Embed a model checkpoint for reproducible embeddings (v1.1).

        This method enables fully reproducible embedding generation by storing
        the exact model used within the .spdf file or referencing an external copy.

        Args:
            model_path: Path to the model file (GGUF, ONNX, etc.)
            model_name: Human-readable model name
            model_version: Model version string
            storage_mode: "embedded" (in file), "external" (reference), or "api"
            embedding_dim: Embedding dimensions
            max_tokens: Maximum tokens per text
            prefix_query: Query prefix for asymmetric models
            prefix_document: Document prefix for asymmetric models
            normalize: Whether to L2-normalize vectors
            source_url: Download URL for the model
            license_info: Model license
            quantization: Quantization level (e.g., "Q2_K", "Q4_K_M")
            model_format: Model format ("gguf", "onnx", "safetensors")
            external_path: Path for external storage mode

        Returns:
            SHA256 hash of the model file

        Raises:
            FileNotFoundError: If model_path doesn't exist (for embedded/external)
            ValueError: If storage_mode is invalid
        """
        if storage_mode not in ("embedded", "external", "api"):
            raise ValueError(f"Invalid storage_mode: {storage_mode}. Use 'embedded', 'external', or 'api'")

        model_path = Path(model_path) if model_path else None
        model_hash = None
        model_bytes = None
        model_size = None

        # For embedded or external mode, read the model file
        if storage_mode in ("embedded", "external"):
            if not model_path or not model_path.exists():
                raise FileNotFoundError(f"Model file not found: {model_path}")

            model_hash = self._compute_file_hash(model_path)
            model_size = model_path.stat().st_size

            if storage_mode == "embedded":
                # Read model bytes (stored uncompressed in gzip container)
                model_bytes = model_path.read_bytes()

        # Infer quantization from filename if not provided
        if not quantization and model_path:
            name = model_path.name.lower()
            for q in ["q2_k", "q4_k_m", "q4_k_s", "q5_k_m", "q6_k", "q8_0", "f16", "f32"]:
                if q in name:
                    quantization = q.upper()
                    break

        self._model_checkpoint = {
            "model_name": model_name,
            "model_version": model_version,
            "model_hash": model_hash or "sha256:unknown",
            "source_url": source_url,
            "license": license_info,
            "quantization": quantization,
            "format": model_format,
            "storage_mode": storage_mode,
            "checkpoint_blob": model_bytes,
            "checkpoint_size": model_size,
            "external_path": external_path or (str(model_path) if storage_mode == "external" else None),
            "embedding_dim": embedding_dim,
            "max_tokens": max_tokens,
            "prefix_query": prefix_query,
            "prefix_document": prefix_document,
            "normalize_embeddings": 1 if normalize else 0,
        }

        # Update metadata to indicate model checkpoint presence
        self._metadata["model_storage_mode"] = storage_mode
        self._metadata["model_checkpoint_hash"] = model_hash or "unknown"
        self._metadata["model_reproducible"] = "true" if storage_mode in ("embedded", "external") else "false"
        self._metadata["embedding_source"] = "local" if storage_mode != "api" else "api"

        return model_hash or "unknown"

    def add_embedding_v2(
        self,
        chunk_id: int,
        model_id: str,
        vector: np.ndarray,
        created_at: Optional[str] = None,
    ) -> None:
        """Add an embedding to the v2 multi-model embedding table.

        Use this to store embeddings from multiple models in the same file.
        The primary "embeddings" table remains for backward compatibility.

        Args:
            chunk_id: Reference to chunk ID
            model_id: Model identifier (e.g., "local:nomic-v2", "api:gemini-exp")
            vector: Embedding vector
            created_at: ISO 8601 timestamp (defaults to now)
        """
        self._embeddings_v2.append({
            "chunk_id": chunk_id,
            "model_id": model_id,
            "vector": vector.astype(np.float32),
            "created_at": created_at or datetime.now().isoformat(),
        })

    @property
    def has_model_checkpoint(self) -> bool:
        """Check if a model checkpoint has been configured."""
        return self._model_checkpoint is not None

    @property
    def has_v2_embeddings(self) -> bool:
        """Check if v2 embeddings have been added."""
        return len(self._embeddings_v2) > 0

    def save(self, path: Union[str, Path], compression_level: int = 6) -> str:
        """Save to .spdf file.

        Args:
            path: Output path
            compression_level: Gzip compression level (1-9)

        Returns:
            Path to saved file
        """
        path = Path(path)

        # Ensure valid extension
        if path.suffix.lower() not in SUPPORTED_EXTENSIONS:
            path = path.with_suffix(DEFAULT_EXTENSION)

        # Validate
        if not self._metadata:
            raise ValueError("Metadata not set. Call set_metadata() first.")

        if len(self._embeddings) != len(self._chunks):
            raise ValueError(
                f"Embedding count ({len(self._embeddings)}) != chunk count ({len(self._chunks)})"
            )

        # Update counts in metadata
        self._metadata['total_pages'] = str(len(self._pages))
        self._metadata['total_chunks'] = str(len(self._chunks))

        # Determine if we need v1.1 schema
        use_v11 = self.has_model_checkpoint or self.has_v2_embeddings

        # Upgrade schema version if v1.1 features are used
        if use_v11:
            self._metadata['schema_version'] = str(SCHEMA_VERSION_V11)

        # Create temp database
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
            tmp_path = tmp.name

        try:
            conn = sqlite3.connect(tmp_path)
            cursor = conn.cursor()

            # Create schema (v1.0 base)
            cursor.executescript(SCHEMA_SQL_V1)

            # Add v1.1 tables if needed
            if use_v11:
                cursor.executescript(SCHEMA_SQL_V11)

            # Insert metadata
            for key, value in self._metadata.items():
                cursor.execute("INSERT INTO metadata (key, value) VALUES (?, ?)", (key, value))

            # Insert pages
            for page in self._pages:
                cursor.execute(
                    "INSERT INTO pages (id, pdf_page, book_page, text, confidence, is_landscape_half) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (page['id'], page['pdf_page'], page['book_page'], page['text'],
                     page['confidence'], page['is_landscape_half'])
                )

            # Insert chunks
            for chunk in self._chunks:
                cursor.execute(
                    "INSERT INTO chunks (id, page_id, chunk_index, text, book_page, pdf_page) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (chunk['id'], chunk['page_id'], chunk['chunk_index'], chunk['text'],
                     chunk['book_page'], chunk['pdf_page'])
                )

            # Insert embeddings (v1 table for backward compatibility)
            for i, embedding in enumerate(self._embeddings):
                vector_bytes = embedding.tobytes()
                cursor.execute(
                    "INSERT INTO embeddings (chunk_id, vector) VALUES (?, ?)",
                    (i, vector_bytes)
                )

            # Insert previews
            for preview in self._previews:
                cursor.execute(
                    "INSERT INTO previews (pdf_page, thumbnail, width, height) VALUES (?, ?, ?, ?)",
                    (preview['pdf_page'], preview['thumbnail'], preview['width'], preview['height'])
                )

            # ================================================================
            # v1.1: Insert model checkpoint
            # ================================================================
            if self._model_checkpoint:
                mc = self._model_checkpoint
                cursor.execute(
                    """INSERT INTO model_checkpoint (
                        model_name, model_version, model_hash, source_url, license,
                        quantization, format, storage_mode, checkpoint_blob, checkpoint_size,
                        external_path, embedding_dim, max_tokens, prefix_query,
                        prefix_document, normalize_embeddings
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        mc["model_name"], mc["model_version"], mc["model_hash"],
                        mc["source_url"], mc["license"], mc["quantization"], mc["format"],
                        mc["storage_mode"], mc["checkpoint_blob"], mc["checkpoint_size"],
                        mc["external_path"], mc["embedding_dim"], mc["max_tokens"],
                        mc["prefix_query"], mc["prefix_document"], mc["normalize_embeddings"],
                    )
                )

            # ================================================================
            # v1.1: Insert embeddings_v2 (multi-model support)
            # ================================================================
            for emb in self._embeddings_v2:
                cursor.execute(
                    "INSERT INTO embeddings_v2 (chunk_id, model_id, vector, created_at) VALUES (?, ?, ?, ?)",
                    (emb["chunk_id"], emb["model_id"], emb["vector"].tobytes(), emb["created_at"])
                )

            conn.commit()
            conn.close()

            # Read and compress
            with open(tmp_path, 'rb') as f:
                db_bytes = f.read()

            compressed = gzip.compress(db_bytes, compresslevel=compression_level)

            # Write to final path
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(compressed)

            return str(path)

        finally:
            Path(tmp_path).unlink(missing_ok=True)

    def clear(self) -> None:
        """Clear all data to reuse writer."""
        self._metadata = {}
        self._pages = []
        self._chunks = []
        self._embeddings = []
        self._previews = []
        # v1.1 additions
        self._model_checkpoint = None
        self._embeddings_v2 = []

    @staticmethod
    def _compute_file_hash(path: Union[str, Path]) -> str:
        """Compute SHA256 hash of a file."""
        sha256 = hashlib.sha256()
        with open(path, 'rb') as f:
            for chunk in iter(lambda: f.read(8192), b''):
                sha256.update(chunk)
        return f"sha256:{sha256.hexdigest()}"


def write_spdf(
    path: Union[str, Path],
    metadata: Dict[str, str],
    pages: List[Dict[str, Any]],
    chunks: List[Dict[str, Any]],
    embeddings: List[np.ndarray],
    previews: Optional[List[Dict[str, Any]]] = None,
    compression_level: int = 6,
) -> str:
    """Convenience function to write an SPDF file.

    Args:
        path: Output path
        metadata: Metadata dictionary (must include all required keys)
        pages: List of page dictionaries
        chunks: List of chunk dictionaries
        embeddings: List of embedding vectors
        previews: Optional list of preview dictionaries
        compression_level: Gzip compression level (1-9)

    Returns:
        Path to saved file
    """
    path = Path(path)

    if path.suffix.lower() not in SUPPORTED_EXTENSIONS:
        path = path.with_suffix(DEFAULT_EXTENSION)

    # Update counts
    metadata = metadata.copy()
    metadata['total_pages'] = str(len(pages))
    metadata['total_chunks'] = str(len(chunks))

    # Create temp database
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        conn = sqlite3.connect(tmp_path)
        cursor = conn.cursor()

        # Create schema
        cursor.executescript(SCHEMA_SQL)

        # Insert metadata
        for key, value in metadata.items():
            cursor.execute("INSERT INTO metadata (key, value) VALUES (?, ?)", (key, value))

        # Insert pages
        for page in pages:
            cursor.execute(
                "INSERT INTO pages (id, pdf_page, book_page, text, confidence, is_landscape_half) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (page['id'], page['pdf_page'], page['book_page'], page['text'],
                 page['confidence'], page.get('is_landscape_half', 0))
            )

        # Insert chunks
        for chunk in chunks:
            cursor.execute(
                "INSERT INTO chunks (id, page_id, chunk_index, text, book_page, pdf_page) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (chunk['id'], chunk['page_id'], chunk['chunk_index'], chunk['text'],
                 chunk['book_page'], chunk['pdf_page'])
            )

        # Insert embeddings
        for i, embedding in enumerate(embeddings):
            vector_bytes = embedding.astype(np.float32).tobytes()
            cursor.execute(
                "INSERT INTO embeddings (chunk_id, vector) VALUES (?, ?)",
                (i, vector_bytes)
            )

        # Insert previews
        if previews:
            for preview in previews:
                cursor.execute(
                    "INSERT INTO previews (pdf_page, thumbnail, width, height) VALUES (?, ?, ?, ?)",
                    (preview['pdf_page'], preview['thumbnail'], preview['width'], preview['height'])
                )

        conn.commit()
        conn.close()

        # Read and compress
        with open(tmp_path, 'rb') as f:
            db_bytes = f.read()

        compressed = gzip.compress(db_bytes, compresslevel=compression_level)

        # Write to final path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(compressed)

        return str(path)

    finally:
        Path(tmp_path).unlink(missing_ok=True)
