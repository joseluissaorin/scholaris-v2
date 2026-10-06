-- SPDF Schema v1.0
-- Scholaris Processed Document Format
--
-- This is the canonical schema for SPDF version 1.
-- See SPEC.md for full documentation.

-- ============================================================================
-- METADATA TABLE
-- Key-value store for document metadata
-- ============================================================================

CREATE TABLE metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Required metadata keys:
--   citation_key      - Unique identifier (e.g., "smith2023")
--   authors           - JSON array of author names
--   year              - Publication year (as string)
--   title             - Document title
--   source_pdf_hash   - SHA256 hash with "sha256:" prefix
--   source_pdf_filename - Original PDF filename
--   processed_at      - ISO 8601 timestamp
--   ocr_model         - OCR model used
--   embedding_model   - Embedding model used
--   embedding_dim     - Embedding dimensions (as string)
--   schema_version    - Schema version (as string, currently "1")
--   total_pages       - Number of pages (as string)
--   total_chunks      - Number of chunks (as string)

-- ============================================================================
-- PAGES TABLE
-- OCR-extracted pages with verified page numbers
-- ============================================================================

CREATE TABLE pages (
    id INTEGER PRIMARY KEY,
    pdf_page INTEGER NOT NULL,              -- 1-indexed PDF page number
    book_page INTEGER NOT NULL,             -- Printed page number
                                            --   Positive: normal pages (1, 2, 3...)
                                            --   Negative: roman numerals (-1=i, -2=ii)
                                            --   Zero: no page number detected
    text TEXT NOT NULL,                     -- OCR text content
    confidence REAL NOT NULL                -- OCR confidence (0.0-1.0)
        CHECK (confidence >= 0.0 AND confidence <= 1.0),
    is_landscape_half INTEGER NOT NULL      -- 1 if half of landscape double-page
        DEFAULT 0
        CHECK (is_landscape_half IN (0, 1))
);

CREATE INDEX idx_pages_pdf_page ON pages(pdf_page);

-- ============================================================================
-- CHUNKS TABLE
-- Text segments for semantic search
-- ============================================================================

CREATE TABLE chunks (
    id INTEGER PRIMARY KEY,
    page_id INTEGER NOT NULL,               -- Foreign key to pages.id
    chunk_index INTEGER NOT NULL,           -- Chunk index within page (0-indexed)
    text TEXT NOT NULL,                     -- Chunk text content
    book_page INTEGER NOT NULL,             -- Denormalized for fast lookup
    pdf_page INTEGER NOT NULL,              -- Denormalized for fast lookup
    FOREIGN KEY (page_id) REFERENCES pages(id)
);

CREATE INDEX idx_chunks_book_page ON chunks(book_page);
CREATE INDEX idx_chunks_page_id ON chunks(page_id);

-- ============================================================================
-- EMBEDDINGS TABLE
-- Vector embeddings for semantic search
-- ============================================================================

CREATE TABLE embeddings (
    chunk_id INTEGER PRIMARY KEY,           -- Foreign key to chunks.id
    vector BLOB NOT NULL,                   -- Little-endian float32 array
                                            -- Size: embedding_dim * 4 bytes
    FOREIGN KEY (chunk_id) REFERENCES chunks(id)
);

-- ============================================================================
-- PREVIEWS TABLE
-- Optional low-resolution page images for recovery
-- ============================================================================

CREATE TABLE previews (
    pdf_page INTEGER PRIMARY KEY,           -- PDF page number (1-indexed)
    thumbnail BLOB NOT NULL,                -- JPEG image bytes
    width INTEGER NOT NULL                  -- Image width in pixels
        CHECK (width > 0),
    height INTEGER NOT NULL                 -- Image height in pixels
        CHECK (height > 0)
);

-- ============================================================================
-- SCHEMA INFO
-- This comment documents the schema version for reference
-- ============================================================================

-- Schema Version: 1
-- Created: 2026-01-01
-- Compatibility: SQLite 3.x
