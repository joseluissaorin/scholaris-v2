-- SPDF Schema v2.0
-- Scholaris Processed Document Format
--
-- This schema extends v1.1 with:
-- - media_blob table for storing original files (images, video, audio)
-- - Qwen3-VL-Embedding-2B support with 2048 dimensions
-- - GLM-OCR-0.9B as primary OCR model
-- - Multimodal-ready architecture
--
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
CREATE VIRTUAL TABLE chunks_fts USING fts5(
    text,
    content='chunks',
    content_rowid='id',
    tokenize='porter unicode61 remove_diacritics 1'
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

CREATE TABLE model_checkpoint (
    id INTEGER PRIMARY KEY DEFAULT 1,
    model_name TEXT NOT NULL,
    model_version TEXT NOT NULL,
    model_hash TEXT NOT NULL,
    source_url TEXT,
    license TEXT,
    quantization TEXT,
    format TEXT NOT NULL
        CHECK (format IN ('gguf', 'onnx', 'safetensors', 'pytorch')),
    storage_mode TEXT NOT NULL
        CHECK (storage_mode IN ('embedded', 'external', 'api')),
    checkpoint_blob BLOB,
    checkpoint_size INTEGER,
    external_path TEXT,
    embedding_dim INTEGER NOT NULL,
    max_tokens INTEGER,
    prefix_query TEXT,
    prefix_document TEXT,
    normalize_embeddings INTEGER
        DEFAULT 1
        CHECK (normalize_embeddings IN (0, 1)),
    CHECK (
        (storage_mode = 'embedded' AND checkpoint_blob IS NOT NULL) OR
        (storage_mode = 'external' AND external_path IS NOT NULL) OR
        (storage_mode = 'api')
    )
);

CREATE TABLE embeddings_v2 (
    chunk_id INTEGER NOT NULL,
    model_id TEXT NOT NULL,
    vector BLOB NOT NULL,
    created_at TEXT,
    PRIMARY KEY (chunk_id, model_id),
    FOREIGN KEY (chunk_id) REFERENCES chunks(id)
);

CREATE INDEX idx_embeddings_v2_model ON embeddings_v2(model_id);

-- ============================================================================
-- V2.0 ADDITIONS: MEDIA BLOB SUPPORT
-- ============================================================================

-- Stores the original source file for multimodal documents
-- For images: the full resolution original image
-- For video: the full video file
-- For audio: the full audio file
-- For PDF: optional (can reconstruct from pages if needed)
CREATE TABLE media_blob (
    id INTEGER PRIMARY KEY DEFAULT 1,
    data BLOB NOT NULL,                     -- Raw file bytes
    mime_type TEXT NOT NULL,                -- "application/pdf", "image/png", "video/mp4", etc.
    original_filename TEXT NOT NULL,        -- Original filename
    original_size INTEGER NOT NULL,         -- Size in bytes (for validation)
    sha256_hash TEXT NOT NULL,              -- "sha256:..." hash of original file
    created_at TEXT                         -- ISO 8601 timestamp
);

-- Timestamps/frames for video/audio content
-- Maps chunks to specific points in time-based media
CREATE TABLE media_segments (
    id INTEGER PRIMARY KEY,
    chunk_id INTEGER NOT NULL,              -- Foreign key to chunks.id
    start_time REAL,                        -- Start time in seconds (for audio/video)
    end_time REAL,                          -- End time in seconds
    frame_number INTEGER,                   -- Frame number (for video)
    FOREIGN KEY (chunk_id) REFERENCES chunks(id)
);

CREATE INDEX idx_media_segments_chunk ON media_segments(chunk_id);
CREATE INDEX idx_media_segments_time ON media_segments(start_time, end_time);

-- ============================================================================
-- V2.0 METADATA KEYS
-- ============================================================================

-- V2.0 keys (for multimodal):
--   media_type         - "pdf" | "image" | "video" | "audio"
--   has_media_blob     - "true" if media_blob table has data
--   duration_seconds   - Total duration for audio/video (float as string)
--   frame_rate         - Frame rate for video (float as string)
--   resolution         - "WIDTHxHEIGHT" for image/video

-- V2.0 recommended models:
--   ocr_model          - "zai-org/GLM-OCR" (GLM-OCR-0.9B)
--   embedding_model    - "Qwen/Qwen3-VL-Embedding-2B"
--   embedding_dim      - "2048"
--   transcription_model - "nvidia/parakeet-tdt-0.6b-v3" (for audio/video)

-- ============================================================================
-- SCHEMA INFO
-- ============================================================================

-- Schema Version: 3 (indicates v2.0 features available)
-- Created: 2026-02-04
-- Compatibility: SQLite 3.x
-- Backward Compatible: Yes (v1.x readers ignore new tables)
-- Embedding Dimensions: 2048 (Qwen3-VL-Embedding-2B)
