"""SPDF Validator - Validate .spdf files against the specification.

This module provides comprehensive validation of SPDF files including:
- File format validation (gzip-compressed SQLite)
- Schema validation (required tables and columns)
- Data integrity checks (foreign keys, counts, dimensions)
- Metadata completeness checks
"""

import gzip
import json
import sqlite3
import tempfile
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import List, Dict, Any, Optional, Union


class ValidationSeverity(Enum):
    """Severity level for validation issues."""
    ERROR = "error"      # File is invalid
    WARNING = "warning"  # File may have issues but is usable
    INFO = "info"        # Informational note


@dataclass
class ValidationError:
    """A single validation error or warning."""
    code: str
    message: str
    severity: ValidationSeverity
    details: Optional[Dict[str, Any]] = None

    def __str__(self) -> str:
        prefix = {
            ValidationSeverity.ERROR: "[ERROR]",
            ValidationSeverity.WARNING: "[WARNING]",
            ValidationSeverity.INFO: "[INFO]",
        }[self.severity]
        return f"{prefix} {self.code}: {self.message}"


@dataclass
class ValidationResult:
    """Result of validating an SPDF file."""
    valid: bool
    errors: List[ValidationError] = field(default_factory=list)
    metadata: Optional[Dict[str, str]] = None
    stats: Optional[Dict[str, Any]] = None

    @property
    def error_count(self) -> int:
        return sum(1 for e in self.errors if e.severity == ValidationSeverity.ERROR)

    @property
    def warning_count(self) -> int:
        return sum(1 for e in self.errors if e.severity == ValidationSeverity.WARNING)

    def __str__(self) -> str:
        status = "VALID" if self.valid else "INVALID"
        lines = [f"Validation Result: {status}"]
        if self.errors:
            lines.append(f"  Errors: {self.error_count}, Warnings: {self.warning_count}")
            for error in self.errors:
                lines.append(f"  - {error}")
        if self.stats:
            lines.append(f"  Stats: {self.stats}")
        return "\n".join(lines)


class SPDFValidator:
    """Validator for SPDF files.

    Validates .spdf files against the SPDF specification v1.0.

    Example:
        validator = SPDFValidator()
        result = validator.validate("file.spdf")
        if result.valid:
            print("File is valid!")
        else:
            for error in result.errors:
                print(error)
    """

    # Supported extensions
    SUPPORTED_EXTENSIONS = [".spdf", ".scholaris", ".scpdf"]

    # Required tables
    REQUIRED_TABLES = ["metadata", "pages", "chunks", "embeddings", "previews"]

    # FTS5 virtual table (required for full-text search)
    FTS5_TABLE = "chunks_fts"

    # Required metadata keys
    REQUIRED_METADATA = [
        "citation_key",
        "authors",
        "year",
        "title",
        "source_pdf_hash",
        "source_pdf_filename",
        "processed_at",
        "ocr_model",
        "embedding_model",
        "embedding_dim",
        "schema_version",
        "total_pages",
        "total_chunks",
    ]

    # Expected columns per table
    TABLE_COLUMNS = {
        "metadata": ["key", "value"],
        "pages": ["id", "pdf_page", "book_page", "text", "confidence", "is_landscape_half"],
        "chunks": ["id", "page_id", "chunk_index", "text", "book_page", "pdf_page"],
        "embeddings": ["chunk_id", "vector"],
        "previews": ["pdf_page", "thumbnail", "width", "height"],
    }

    def __init__(self, strict: bool = True):
        """Initialize validator.

        Args:
            strict: If True, treat warnings as errors
        """
        self.strict = strict

    def validate(self, path: Union[str, Path]) -> ValidationResult:
        """Validate an SPDF file.

        Args:
            path: Path to .spdf file

        Returns:
            ValidationResult with validation status and any errors
        """
        path = Path(path)
        errors: List[ValidationError] = []
        metadata: Optional[Dict[str, str]] = None
        stats: Optional[Dict[str, Any]] = None

        # Check file exists
        if not path.exists():
            errors.append(ValidationError(
                code="FILE_NOT_FOUND",
                message=f"File not found: {path}",
                severity=ValidationSeverity.ERROR
            ))
            return ValidationResult(valid=False, errors=errors)

        # Check extension
        if path.suffix.lower() not in self.SUPPORTED_EXTENSIONS:
            errors.append(ValidationError(
                code="INVALID_EXTENSION",
                message=f"Invalid extension: {path.suffix}. Expected: {self.SUPPORTED_EXTENSIONS}",
                severity=ValidationSeverity.ERROR
            ))
            return ValidationResult(valid=False, errors=errors)

        # Try to decompress
        try:
            with gzip.open(path, 'rb') as f:
                db_bytes = f.read()
        except gzip.BadGzipFile:
            errors.append(ValidationError(
                code="NOT_GZIP",
                message="File is not gzip-compressed",
                severity=ValidationSeverity.ERROR
            ))
            return ValidationResult(valid=False, errors=errors)
        except Exception as e:
            errors.append(ValidationError(
                code="DECOMPRESS_ERROR",
                message=f"Failed to decompress: {e}",
                severity=ValidationSeverity.ERROR
            ))
            return ValidationResult(valid=False, errors=errors)

        # Write to temp file and validate SQLite
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
            tmp.write(db_bytes)
            tmp_path = tmp.name

        try:
            # Try to open as SQLite
            try:
                conn = sqlite3.connect(tmp_path)
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                # This is the first query that will fail if not a valid SQLite db
                cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
            except sqlite3.Error as e:
                errors.append(ValidationError(
                    code="NOT_SQLITE",
                    message=f"File is not a valid SQLite database: {e}",
                    severity=ValidationSeverity.ERROR
                ))
                return ValidationResult(valid=False, errors=errors)

            # Check tables exist
            tables = {row['name'] for row in cursor.fetchall()}

            for table in self.REQUIRED_TABLES:
                if table not in tables:
                    errors.append(ValidationError(
                        code="MISSING_TABLE",
                        message=f"Missing required table: {table}",
                        severity=ValidationSeverity.ERROR
                    ))

            # Check FTS5 virtual table exists
            if self.FTS5_TABLE not in tables:
                errors.append(ValidationError(
                    code="MISSING_FTS5",
                    message=f"Missing FTS5 full-text search index: {self.FTS5_TABLE}",
                    severity=ValidationSeverity.WARNING  # Warning for backward compat
                ))

            if any(e.severity == ValidationSeverity.ERROR for e in errors):
                conn.close()
                return ValidationResult(valid=False, errors=errors)

            # Check table columns
            for table, expected_cols in self.TABLE_COLUMNS.items():
                cursor.execute(f"PRAGMA table_info({table})")
                actual_cols = {row['name'] for row in cursor.fetchall()}

                for col in expected_cols:
                    if col not in actual_cols:
                        errors.append(ValidationError(
                            code="MISSING_COLUMN",
                            message=f"Missing column '{col}' in table '{table}'",
                            severity=ValidationSeverity.ERROR
                        ))

            # Load and validate metadata
            cursor.execute("SELECT key, value FROM metadata")
            metadata = {row['key']: row['value'] for row in cursor.fetchall()}

            for key in self.REQUIRED_METADATA:
                if key not in metadata:
                    errors.append(ValidationError(
                        code="MISSING_METADATA",
                        message=f"Missing required metadata key: {key}",
                        severity=ValidationSeverity.ERROR
                    ))

            if any(e.severity == ValidationSeverity.ERROR for e in errors):
                conn.close()
                return ValidationResult(valid=False, errors=errors, metadata=metadata)

            # Validate schema version (1 = v1.0, 2 = v1.1 with model checkpoint)
            schema_version = int(metadata.get('schema_version', 0))
            if schema_version not in (1, 2):
                errors.append(ValidationError(
                    code="INVALID_SCHEMA_VERSION",
                    message=f"Unsupported schema version: {schema_version}. Expected: 1 or 2",
                    severity=ValidationSeverity.ERROR
                ))

            # Validate hash format
            source_hash = metadata.get('source_pdf_hash', '')
            if not source_hash.startswith('sha256:'):
                errors.append(ValidationError(
                    code="INVALID_HASH_FORMAT",
                    message=f"Invalid hash format: {source_hash[:20]}... Expected: sha256:...",
                    severity=ValidationSeverity.ERROR
                ))

            # Validate authors JSON
            try:
                authors = json.loads(metadata.get('authors', '[]'))
                if not isinstance(authors, list):
                    errors.append(ValidationError(
                        code="INVALID_AUTHORS",
                        message="authors must be a JSON array",
                        severity=ValidationSeverity.ERROR
                    ))
            except json.JSONDecodeError as e:
                errors.append(ValidationError(
                    code="INVALID_AUTHORS_JSON",
                    message=f"Invalid JSON in authors: {e}",
                    severity=ValidationSeverity.ERROR
                ))

            # Count records
            cursor.execute("SELECT COUNT(*) as count FROM pages")
            page_count = cursor.fetchone()['count']

            cursor.execute("SELECT COUNT(*) as count FROM chunks")
            chunk_count = cursor.fetchone()['count']

            cursor.execute("SELECT COUNT(*) as count FROM embeddings")
            embedding_count = cursor.fetchone()['count']

            cursor.execute("SELECT COUNT(*) as count FROM previews")
            preview_count = cursor.fetchone()['count']

            stats = {
                "pages": page_count,
                "chunks": chunk_count,
                "embeddings": embedding_count,
                "previews": preview_count,
            }

            # Validate counts match metadata
            expected_pages = int(metadata.get('total_pages', 0))
            expected_chunks = int(metadata.get('total_chunks', 0))

            if page_count != expected_pages:
                errors.append(ValidationError(
                    code="PAGE_COUNT_MISMATCH",
                    message=f"Page count mismatch: metadata says {expected_pages}, found {page_count}",
                    severity=ValidationSeverity.ERROR
                ))

            if chunk_count != expected_chunks:
                errors.append(ValidationError(
                    code="CHUNK_COUNT_MISMATCH",
                    message=f"Chunk count mismatch: metadata says {expected_chunks}, found {chunk_count}",
                    severity=ValidationSeverity.ERROR
                ))

            # Validate embedding count matches chunk count
            if embedding_count != chunk_count:
                errors.append(ValidationError(
                    code="EMBEDDING_COUNT_MISMATCH",
                    message=f"Embedding count ({embedding_count}) != chunk count ({chunk_count})",
                    severity=ValidationSeverity.ERROR
                ))

            # Validate embedding dimensions
            embedding_dim = int(metadata.get('embedding_dim', 768))
            expected_bytes = embedding_dim * 4  # float32

            cursor.execute("SELECT chunk_id, LENGTH(vector) as vec_len FROM embeddings LIMIT 10")
            for row in cursor.fetchall():
                if row['vec_len'] != expected_bytes:
                    errors.append(ValidationError(
                        code="INVALID_EMBEDDING_DIM",
                        message=f"Embedding {row['chunk_id']} has {row['vec_len']} bytes, expected {expected_bytes}",
                        severity=ValidationSeverity.ERROR
                    ))
                    break  # Only report first error

            # Validate foreign keys (chunks -> pages)
            cursor.execute("""
                SELECT c.id, c.page_id
                FROM chunks c
                LEFT JOIN pages p ON c.page_id = p.id
                WHERE p.id IS NULL
                LIMIT 5
            """)
            orphan_chunks = cursor.fetchall()
            if orphan_chunks:
                errors.append(ValidationError(
                    code="ORPHAN_CHUNKS",
                    message=f"Found {len(orphan_chunks)} chunks with invalid page_id",
                    severity=ValidationSeverity.ERROR,
                    details={"chunk_ids": [row['id'] for row in orphan_chunks]}
                ))

            # Validate confidence values
            cursor.execute("""
                SELECT id, confidence FROM pages
                WHERE confidence < 0.0 OR confidence > 1.0
                LIMIT 5
            """)
            invalid_confidence = cursor.fetchall()
            if invalid_confidence:
                errors.append(ValidationError(
                    code="INVALID_CONFIDENCE",
                    message=f"Found {len(invalid_confidence)} pages with invalid confidence values",
                    severity=ValidationSeverity.ERROR,
                    details={"page_ids": [row['id'] for row in invalid_confidence]}
                ))

            # Check for empty text (warning)
            cursor.execute("SELECT COUNT(*) as count FROM pages WHERE text = '' OR text IS NULL")
            empty_pages = cursor.fetchone()['count']
            if empty_pages > 0:
                errors.append(ValidationError(
                    code="EMPTY_PAGES",
                    message=f"Found {empty_pages} pages with empty text",
                    severity=ValidationSeverity.WARNING
                ))

            # Check for missing previews (info only)
            if preview_count == 0:
                errors.append(ValidationError(
                    code="NO_PREVIEWS",
                    message="No preview images stored (recovery not possible)",
                    severity=ValidationSeverity.INFO
                ))
            elif preview_count < page_count:
                errors.append(ValidationError(
                    code="PARTIAL_PREVIEWS",
                    message=f"Only {preview_count}/{page_count} pages have previews",
                    severity=ValidationSeverity.INFO
                ))

            conn.close()

        finally:
            Path(tmp_path).unlink(missing_ok=True)

        # Determine validity
        has_errors = any(e.severity == ValidationSeverity.ERROR for e in errors)
        has_warnings = any(e.severity == ValidationSeverity.WARNING for e in errors)

        if self.strict:
            valid = not has_errors and not has_warnings
        else:
            valid = not has_errors

        return ValidationResult(
            valid=valid,
            errors=errors,
            metadata=metadata,
            stats=stats
        )

    def validate_hash(self, spdf_path: Union[str, Path], pdf_path: Union[str, Path]) -> bool:
        """Verify that an SPDF file matches a source PDF.

        Args:
            spdf_path: Path to .spdf file
            pdf_path: Path to source PDF

        Returns:
            True if hashes match
        """
        import hashlib

        result = self.validate(spdf_path)
        if not result.metadata:
            return False

        stored_hash = result.metadata.get('source_pdf_hash', '')

        # Compute hash of PDF
        sha256 = hashlib.sha256()
        with open(pdf_path, 'rb') as f:
            for chunk in iter(lambda: f.read(8192), b''):
                sha256.update(chunk)

        computed_hash = f"sha256:{sha256.hexdigest()}"

        return stored_hash == computed_hash


def validate_file(path: Union[str, Path], strict: bool = False) -> ValidationResult:
    """Convenience function to validate an SPDF file.

    Args:
        path: Path to .spdf file
        strict: If True, treat warnings as errors

    Returns:
        ValidationResult
    """
    validator = SPDFValidator(strict=strict)
    return validator.validate(path)
