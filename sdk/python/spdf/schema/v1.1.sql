-- SPDF Schema v1.1
-- Scholaris Processed Document Format
--
-- This schema extends v1.0 with model checkpoint support for reproducibility.
-- See SPEC.md for full documentation.

-- ============================================================================
-- V1.0 TABLES (unchanged)
-- ============================================================================

CREATE TABLE metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE pages (
    id INTEGER PRIMARY KEY,
    pdf_page INTEGER NOT NULL,
    book_page INTEGER NOT NULL,
    text TEXT NOT NULL,
    confidence REAL NOT NULL
        CHECK (confidence >= 0.0 AND confidence <= 1.0),
    is_landscape_half INTEGER NOT NULL
        DEFAULT 0
        CHECK (is_landscape_half IN (0, 1))
);

CREATE INDEX idx_pages_pdf_page ON pages(pdf_page);

CREATE TABLE chunks (
    id INTEGER PRIMARY KEY,
    page_id INTEGER NOT NULL,
    chunk_index INTEGER NOT NULL,
    text TEXT NOT NULL,
    book_page INTEGER NOT NULL,
    pdf_page INTEGER NOT NULL,
    FOREIGN KEY (page_id) REFERENCES pages(id)
);

CREATE INDEX idx_chunks_book_page ON chunks(book_page);
CREATE INDEX idx_chunks_page_id ON chunks(page_id);

-- FTS5 Full-Text Search index on chunks
-- Enables fast keyword search with BM25 ranking
CREATE VIRTUAL TABLE chunks_fts USING fts5(
    text,                                   -- Indexed text content
    content='chunks',                       -- Shadow table (contentless FTS)
    content_rowid='id',                     -- Maps to chunks.id
    tokenize='porter unicode61 remove_diacritics 1'  -- Porter stemming + Unicode
);

-- Triggers to keep FTS index synchronized
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

CREATE TABLE embeddings (
    chunk_id INTEGER PRIMARY KEY,
    vector BLOB NOT NULL,
    FOREIGN KEY (chunk_id) REFERENCES chunks(id)
);

CREATE TABLE previews (
    pdf_page INTEGER PRIMARY KEY,
    thumbnail BLOB NOT NULL,
    width INTEGER NOT NULL
        CHECK (width > 0),
    height INTEGER NOT NULL
        CHECK (height > 0)
);

-- ============================================================================
-- V1.1 ADDITIONS: MODEL CHECKPOINT SUPPORT
-- ============================================================================

-- Model checkpoint for reproducible embeddings
-- This table is OPTIONAL - v1.0 files won't have it
CREATE TABLE model_checkpoint (
    id INTEGER PRIMARY KEY DEFAULT 1,

    -- Model identification
    model_name TEXT NOT NULL,               -- "nomic-embed-text-v2-moe"
    model_version TEXT NOT NULL,            -- "v2.0"
    model_hash TEXT NOT NULL,               -- "sha256:abc123..." (hash of model file)

    -- Source information for re-download
    source_url TEXT,                        -- HuggingFace URL
    license TEXT,                           -- "Apache-2.0"

    -- Quantization info
    quantization TEXT,                      -- "Q2_K", "Q4_K_M", "F16", etc.
    format TEXT NOT NULL                    -- "gguf", "onnx"
        CHECK (format IN ('gguf', 'onnx', 'safetensors')),

    -- Storage mode determines where model lives
    storage_mode TEXT NOT NULL              -- "embedded" | "external" | "api"
        CHECK (storage_mode IN ('embedded', 'external', 'api')),

    -- The actual model bytes (ONLY if storage_mode = "embedded")
    -- Stored UNCOMPRESSED within the gzip container (GGUF is already compressed)
    checkpoint_blob BLOB,
    checkpoint_size INTEGER,                -- Size in bytes (for validation)

    -- For external mode: reference to model store
    external_path TEXT,                     -- "~/.spdf/models/sha256_abc123/"

    -- Inference parameters (required for correct embedding generation)
    embedding_dim INTEGER NOT NULL,         -- 768
    max_tokens INTEGER,                     -- 8192
    prefix_query TEXT,                      -- "search_query: " (for asymmetric models)
    prefix_document TEXT,                   -- "search_document: "
    normalize_embeddings INTEGER            -- 1 = L2 normalize output vectors
        DEFAULT 1
        CHECK (normalize_embeddings IN (0, 1)),

    -- Constraints
    CHECK (
        (storage_mode = 'embedded' AND checkpoint_blob IS NOT NULL) OR
        (storage_mode = 'external' AND external_path IS NOT NULL) OR
        (storage_mode = 'api')
    )
);

-- Multi-model embedding support
-- Allows storing embeddings from multiple models in the same file
-- The primary "embeddings" table remains for backward compatibility
CREATE TABLE embeddings_v2 (
    chunk_id INTEGER NOT NULL,
    model_id TEXT NOT NULL,                 -- "local:nomic-v2" or "api:gemini-embedding-exp-03-07"
    vector BLOB NOT NULL,
    created_at TEXT,                        -- ISO 8601 timestamp
    PRIMARY KEY (chunk_id, model_id),
    FOREIGN KEY (chunk_id) REFERENCES chunks(id)
);

CREATE INDEX idx_embeddings_v2_model ON embeddings_v2(model_id);

-- ============================================================================
-- REQUIRED METADATA KEYS (v1.1)
-- ============================================================================

-- V1.0 keys (required):
--   citation_key, authors, year, title, source_pdf_hash, source_pdf_filename,
--   processed_at, ocr_model, embedding_model, embedding_dim, schema_version,
--   total_pages, total_chunks

-- V1.1 keys (optional, present if model_checkpoint exists):
--   model_storage_mode    - "embedded" | "external" | "api"
--   model_checkpoint_hash - SHA256 hash of the model file
--   model_reproducible    - "true" if embeddings can be regenerated locally
--   embedding_source      - "local" | "api" - how current embeddings were made

-- ============================================================================
-- SCHEMA INFO
-- ============================================================================

-- Schema Version: 2 (indicates v1.1 features available)
-- Created: 2026-01-01
-- Compatibility: SQLite 3.x
-- Backward Compatible: Yes (v1.0 readers ignore new tables)
