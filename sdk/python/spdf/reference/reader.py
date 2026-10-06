"""SPDF Reference Reader - Minimal implementation for reading .spdf files.

This module provides a minimal, dependency-light implementation of the SPDF
reader that can be used as a reference for porting to other languages.

Dependencies:
- Python 3.9+ standard library (gzip, sqlite3, json, tempfile)
- numpy (for embedding vectors only)

Example:
    from spdf.reference import read_spdf

    data = read_spdf("file.spdf")
    print(data['metadata']['title'])
    for chunk in data['chunks']:
        print(f"Page {chunk['book_page']}: {chunk['text'][:50]}...")

v1.1 Example (with embedded model):
    data = read_spdf("file.spdf")
    if data.has_model_checkpoint:
        # Extract embedded model to temp file for inference
        model_path = data.extract_model_checkpoint("/tmp/model.gguf")
        print(f"Model extracted to: {model_path}")
"""

import gzip
import json
import sqlite3
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Dict, Any, Optional, Union

import numpy as np


# Supported extensions
SUPPORTED_EXTENSIONS = [".spdf", ".scholaris", ".scpdf"]


@dataclass
class ModelCheckpoint:
    """Model checkpoint information (v1.1)."""
    model_name: str
    model_version: str
    model_hash: str
    source_url: Optional[str]
    license: Optional[str]
    quantization: Optional[str]
    format: str
    storage_mode: str  # "embedded", "external", "api"
    checkpoint_blob: Optional[bytes]
    checkpoint_size: Optional[int]
    external_path: Optional[str]
    embedding_dim: int
    max_tokens: Optional[int]
    prefix_query: Optional[str]
    prefix_document: Optional[str]
    normalize_embeddings: bool

    @property
    def is_embedded(self) -> bool:
        return self.storage_mode == "embedded" and self.checkpoint_blob is not None

    @property
    def is_external(self) -> bool:
        return self.storage_mode == "external"

    @property
    def is_api(self) -> bool:
        return self.storage_mode == "api"


@dataclass
class EmbeddingV2:
    """Multi-model embedding entry (v1.1)."""
    chunk_id: int
    model_id: str
    vector: np.ndarray
    created_at: Optional[str]


@dataclass
class SearchResult:
    """Result from FTS5 full-text search."""
    chunk_id: int
    text: str
    book_page: int
    pdf_page: int
    score: float  # BM25 score (lower is better match)
    snippet: Optional[str] = None  # Highlighted snippet if requested


@dataclass
class SPDFData:
    """Container for SPDF file contents."""
    metadata: Dict[str, str]
    pages: List[Dict[str, Any]]
    chunks: List[Dict[str, Any]]
    embeddings: List[np.ndarray]
    previews: List[Dict[str, Any]]
    # v1.1 additions
    model_checkpoint: Optional[ModelCheckpoint] = None
    embeddings_v2: List[EmbeddingV2] = field(default_factory=list)

    @property
    def citation_key(self) -> str:
        return self.metadata.get('citation_key', '')

    @property
    def title(self) -> str:
        return self.metadata.get('title', '')

    @property
    def authors(self) -> List[str]:
        return json.loads(self.metadata.get('authors', '[]'))

    @property
    def year(self) -> int:
        return int(self.metadata.get('year', 0))

    @property
    def embedding_dim(self) -> int:
        return int(self.metadata.get('embedding_dim', 768))

    @property
    def schema_version(self) -> int:
        return int(self.metadata.get('schema_version', 1))

    @property
    def has_model_checkpoint(self) -> bool:
        """Check if this file has a model checkpoint (v1.1)."""
        return self.model_checkpoint is not None

    @property
    def is_reproducible(self) -> bool:
        """Check if embeddings can be regenerated locally."""
        if not self.model_checkpoint:
            return False
        return self.model_checkpoint.storage_mode in ("embedded", "external")

    def get_embedding_matrix(self) -> np.ndarray:
        """Get all embeddings as a numpy matrix.

        Returns:
            Array of shape (n_chunks, embedding_dim)
        """
        if not self.embeddings:
            return np.array([])
        return np.vstack(self.embeddings)

    def get_text_for_page(self, book_page: int) -> str:
        """Get concatenated text for a specific book page."""
        page_chunks = [c for c in self.chunks if c['book_page'] == book_page]
        return ' '.join(c['text'] for c in sorted(page_chunks, key=lambda x: x['chunk_index']))

    def extract_model_checkpoint(self, output_path: Union[str, Path]) -> Optional[Path]:
        """Extract embedded model checkpoint to a file.

        Args:
            output_path: Path to write the model file

        Returns:
            Path to extracted model, or None if not embedded
        """
        if not self.model_checkpoint or not self.model_checkpoint.is_embedded:
            return None

        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(self.model_checkpoint.checkpoint_blob)
        return output_path

    def get_embeddings_for_model(self, model_id: str) -> List[EmbeddingV2]:
        """Get v2 embeddings for a specific model.

        Args:
            model_id: Model identifier to filter by

        Returns:
            List of EmbeddingV2 entries for that model
        """
        return [e for e in self.embeddings_v2 if e.model_id == model_id]

    def list_embedding_models(self) -> List[str]:
        """List all model IDs in embeddings_v2.

        Returns:
            List of unique model IDs
        """
        return list(set(e.model_id for e in self.embeddings_v2))


class SPDFReader:
    """Reader for SPDF files.

    Example:
        reader = SPDFReader()
        data = reader.read("file.spdf")
        print(data.title)
    """

    def __init__(self):
        pass

    def read(self, path: Union[str, Path]) -> SPDFData:
        """Read an SPDF file.

        Args:
            path: Path to .spdf file

        Returns:
            SPDFData containing all file contents

        Raises:
            FileNotFoundError: If file doesn't exist
            ValueError: If file has invalid extension or format
        """
        path = Path(path)

        # Validate path
        if not path.exists():
            raise FileNotFoundError(f"File not found: {path}")

        if path.suffix.lower() not in SUPPORTED_EXTENSIONS:
            raise ValueError(f"Invalid extension: {path.suffix}. Expected: {SUPPORTED_EXTENSIONS}")

        # Decompress
        try:
            with gzip.open(path, 'rb') as f:
                db_bytes = f.read()
        except gzip.BadGzipFile as e:
            raise ValueError(f"File is not gzip-compressed: {e}")

        # Write to temp file (SQLite requires file path)
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
            tmp.write(db_bytes)
            tmp_path = tmp.name

        try:
            conn = sqlite3.connect(tmp_path)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()

            # Read metadata
            cursor.execute("SELECT key, value FROM metadata")
            metadata = {row['key']: row['value'] for row in cursor.fetchall()}

            # Read pages
            cursor.execute("SELECT * FROM pages ORDER BY id")
            pages = [dict(row) for row in cursor.fetchall()]

            # Read chunks
            cursor.execute("SELECT * FROM chunks ORDER BY id")
            chunks = [dict(row) for row in cursor.fetchall()]

            # Read embeddings
            cursor.execute("SELECT chunk_id, vector FROM embeddings ORDER BY chunk_id")
            embeddings = [
                np.frombuffer(row['vector'], dtype=np.float32)
                for row in cursor.fetchall()
            ]

            # Read previews
            cursor.execute("SELECT * FROM previews ORDER BY pdf_page")
            previews = [dict(row) for row in cursor.fetchall()]

            # ================================================================
            # v1.1: Read model checkpoint (if exists)
            # ================================================================
            model_checkpoint = None
            if self._table_exists(cursor, "model_checkpoint"):
                cursor.execute("SELECT * FROM model_checkpoint WHERE id = 1")
                row = cursor.fetchone()
                if row:
                    model_checkpoint = ModelCheckpoint(
                        model_name=row["model_name"],
                        model_version=row["model_version"],
                        model_hash=row["model_hash"],
                        source_url=row["source_url"],
                        license=row["license"],
                        quantization=row["quantization"],
                        format=row["format"],
                        storage_mode=row["storage_mode"],
                        checkpoint_blob=row["checkpoint_blob"],
                        checkpoint_size=row["checkpoint_size"],
                        external_path=row["external_path"],
                        embedding_dim=row["embedding_dim"],
                        max_tokens=row["max_tokens"],
                        prefix_query=row["prefix_query"],
                        prefix_document=row["prefix_document"],
                        normalize_embeddings=bool(row["normalize_embeddings"]),
                    )

            # ================================================================
            # v1.1: Read embeddings_v2 (if exists)
            # ================================================================
            embeddings_v2 = []
            if self._table_exists(cursor, "embeddings_v2"):
                cursor.execute("SELECT * FROM embeddings_v2 ORDER BY chunk_id, model_id")
                for row in cursor.fetchall():
                    embeddings_v2.append(EmbeddingV2(
                        chunk_id=row["chunk_id"],
                        model_id=row["model_id"],
                        vector=np.frombuffer(row["vector"], dtype=np.float32),
                        created_at=row["created_at"],
                    ))

            conn.close()

            return SPDFData(
                metadata=metadata,
                pages=pages,
                chunks=chunks,
                embeddings=embeddings,
                previews=previews,
                model_checkpoint=model_checkpoint,
                embeddings_v2=embeddings_v2,
            )

        finally:
            Path(tmp_path).unlink(missing_ok=True)

    @staticmethod
    def _table_exists(cursor: sqlite3.Cursor, table_name: str) -> bool:
        """Check if a table exists in the database."""
        cursor.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            (table_name,)
        )
        return cursor.fetchone() is not None

    def read_metadata_only(self, path: Union[str, Path]) -> Dict[str, str]:
        """Read only metadata from an SPDF file (faster than full read).

        Args:
            path: Path to .spdf file

        Returns:
            Metadata dictionary
        """
        path = Path(path)

        if not path.exists():
            raise FileNotFoundError(f"File not found: {path}")

        with gzip.open(path, 'rb') as f:
            db_bytes = f.read()

        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
            tmp.write(db_bytes)
            tmp_path = tmp.name

        try:
            conn = sqlite3.connect(tmp_path)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()

            cursor.execute("SELECT key, value FROM metadata")
            metadata = {row['key']: row['value'] for row in cursor.fetchall()}

            conn.close()
            return metadata

        finally:
            Path(tmp_path).unlink(missing_ok=True)

    def info(self, path: Union[str, Path]) -> Dict[str, Any]:
        """Get summary info about an SPDF file.

        Args:
            path: Path to .spdf file

        Returns:
            Dictionary with file info
        """
        path = Path(path)
        file_size = path.stat().st_size / 1024 / 1024  # MB

        metadata = self.read_metadata_only(path)

        info = {
            "citation_key": metadata.get('citation_key', ''),
            "title": metadata.get('title', ''),
            "authors": json.loads(metadata.get('authors', '[]')),
            "year": int(metadata.get('year', 0)),
            "pages": int(metadata.get('total_pages', 0)),
            "chunks": int(metadata.get('total_chunks', 0)),
            "size_mb": round(file_size, 2),
            "embedding_dim": int(metadata.get('embedding_dim', 768)),
            "schema_version": int(metadata.get('schema_version', 1)),
        }

        # v1.1 additions
        if metadata.get('model_storage_mode'):
            info["model_storage_mode"] = metadata.get('model_storage_mode')
            info["model_reproducible"] = metadata.get('model_reproducible') == "true"
            info["embedding_source"] = metadata.get('embedding_source', 'unknown')

        return info

    def search(
        self,
        path: Union[str, Path],
        query: str,
        limit: int = 10,
        snippet_tokens: int = 64,
    ) -> List[SearchResult]:
        """Search for text using FTS5 full-text search.

        Uses BM25 ranking for relevance scoring. Supports FTS5 query syntax:
        - Simple terms: "machine learning"
        - Phrases: '"neural network"'
        - Boolean: "deep AND learning"
        - Prefix: "optim*"
        - NEAR: "NEAR(word1 word2, 5)"

        Args:
            path: Path to .spdf file
            query: FTS5 search query
            limit: Maximum results to return
            snippet_tokens: Tokens in each snippet (0 to disable snippets)

        Returns:
            List of SearchResult objects sorted by relevance
        """
        path = Path(path)

        if not path.exists():
            raise FileNotFoundError(f"File not found: {path}")

        with gzip.open(path, 'rb') as f:
            db_bytes = f.read()

        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
            tmp.write(db_bytes)
            tmp_path = tmp.name

        try:
            conn = sqlite3.connect(tmp_path)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()

            # Check if FTS5 table exists
            if not self._table_exists(cursor, "chunks_fts"):
                conn.close()
                raise ValueError("FTS5 index not found. File may be from older SPDF version.")

            # Build query with optional snippets
            if snippet_tokens > 0:
                sql = """
                    SELECT
                        c.id as chunk_id,
                        c.text,
                        c.book_page,
                        c.pdf_page,
                        bm25(chunks_fts) as score,
                        snippet(chunks_fts, 0, '<b>', '</b>', '...', ?) as snippet
                    FROM chunks_fts
                    JOIN chunks c ON chunks_fts.rowid = c.id
                    WHERE chunks_fts MATCH ?
                    ORDER BY score
                    LIMIT ?
                """
                cursor.execute(sql, (snippet_tokens, query, limit))
            else:
                sql = """
                    SELECT
                        c.id as chunk_id,
                        c.text,
                        c.book_page,
                        c.pdf_page,
                        bm25(chunks_fts) as score
                    FROM chunks_fts
                    JOIN chunks c ON chunks_fts.rowid = c.id
                    WHERE chunks_fts MATCH ?
                    ORDER BY score
                    LIMIT ?
                """
                cursor.execute(sql, (query, limit))

            results = []
            for row in cursor.fetchall():
                results.append(SearchResult(
                    chunk_id=row["chunk_id"],
                    text=row["text"],
                    book_page=row["book_page"],
                    pdf_page=row["pdf_page"],
                    score=row["score"],
                    snippet=row["snippet"] if snippet_tokens > 0 else None,
                ))

            conn.close()
            return results

        finally:
            Path(tmp_path).unlink(missing_ok=True)

    def search_hybrid(
        self,
        path: Union[str, Path],
        query: str,
        query_embedding: np.ndarray,
        limit: int = 10,
        fts_weight: float = 0.3,
        vector_weight: float = 0.7,
    ) -> List[SearchResult]:
        """Hybrid search combining FTS5 and vector similarity.

        Retrieves candidates using FTS5, then re-ranks using vector similarity.
        This combines keyword matching with semantic understanding.

        Args:
            path: Path to .spdf file
            query: FTS5 search query for initial retrieval
            query_embedding: Query vector for re-ranking
            limit: Maximum results to return
            fts_weight: Weight for FTS5 BM25 score (0-1)
            vector_weight: Weight for vector similarity (0-1)

        Returns:
            List of SearchResult objects with combined scores
        """
        path = Path(path)

        if not path.exists():
            raise FileNotFoundError(f"File not found: {path}")

        # Get more FTS candidates than final limit for re-ranking
        fts_limit = min(limit * 3, 100)

        with gzip.open(path, 'rb') as f:
            db_bytes = f.read()

        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
            tmp.write(db_bytes)
            tmp_path = tmp.name

        try:
            conn = sqlite3.connect(tmp_path)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()

            # Get FTS candidates
            cursor.execute("""
                SELECT
                    c.id as chunk_id,
                    c.text,
                    c.book_page,
                    c.pdf_page,
                    bm25(chunks_fts) as fts_score
                FROM chunks_fts
                JOIN chunks c ON chunks_fts.rowid = c.id
                WHERE chunks_fts MATCH ?
                ORDER BY fts_score
                LIMIT ?
            """, (query, fts_limit))

            candidates = []
            chunk_ids = []
            for row in cursor.fetchall():
                candidates.append({
                    "chunk_id": row["chunk_id"],
                    "text": row["text"],
                    "book_page": row["book_page"],
                    "pdf_page": row["pdf_page"],
                    "fts_score": row["fts_score"],
                })
                chunk_ids.append(row["chunk_id"])

            if not candidates:
                conn.close()
                return []

            # Get embeddings for candidates
            placeholders = ",".join("?" * len(chunk_ids))
            cursor.execute(f"""
                SELECT chunk_id, vector FROM embeddings
                WHERE chunk_id IN ({placeholders})
            """, chunk_ids)

            embeddings_map = {}
            for row in cursor.fetchall():
                embeddings_map[row["chunk_id"]] = np.frombuffer(row["vector"], dtype=np.float32)

            conn.close()

            # Normalize query embedding
            query_norm = query_embedding / np.linalg.norm(query_embedding)

            # Compute hybrid scores
            results = []
            for cand in candidates:
                chunk_id = cand["chunk_id"]
                if chunk_id not in embeddings_map:
                    continue

                # Cosine similarity (higher is better, so negate for sorting)
                emb = embeddings_map[chunk_id]
                emb_norm = emb / np.linalg.norm(emb)
                cosine_sim = np.dot(query_norm, emb_norm)

                # Normalize FTS score (BM25 is negative, more negative = better)
                # Convert to 0-1 range where higher is better
                fts_normalized = 1.0 / (1.0 + abs(cand["fts_score"]))

                # Combined score (higher is better)
                hybrid_score = (fts_weight * fts_normalized) + (vector_weight * cosine_sim)

                # Negate for sorting (we want highest scores first but store negative for consistency)
                results.append(SearchResult(
                    chunk_id=chunk_id,
                    text=cand["text"],
                    book_page=cand["book_page"],
                    pdf_page=cand["pdf_page"],
                    score=-hybrid_score,  # Negative so lower = better (consistent with BM25)
                ))

            # Sort by score (lower is better)
            results.sort(key=lambda x: x.score)
            return results[:limit]

        finally:
            Path(tmp_path).unlink(missing_ok=True)


def read_spdf(path: Union[str, Path]) -> SPDFData:
    """Convenience function to read an SPDF file.

    Args:
        path: Path to .spdf file

    Returns:
        SPDFData containing all file contents
    """
    return SPDFReader().read(path)
