-- SPDF Schema v3.0
-- Scholaris Processed Document Format
--
-- This schema extends v2.1 with:
-- - Semantic chunking with boundary detection
-- - Contextual embeddings with surrounding context
-- - Section/chapter detection with tree structure
-- - Scene detection for video (visual boundaries)
-- - Enhanced speaker diarization with speaker turns
-- - Cross-modal linking between content types
--
-- See SPEC.md for full documentation.
-- See PROCESSING_GUIDE.md for implementation guidance.

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
    page_id INTEGER,
    chunk_index INTEGER NOT NULL,
    text TEXT NOT NULL,
    book_page INTEGER,
    pdf_page INTEGER,
    start_ms INTEGER,
    end_ms INTEGER,
    FOREIGN KEY (page_id) REFERENCES pages(id)
);

CREATE INDEX idx_chunks_book_page ON chunks(book_page);
CREATE INDEX idx_chunks_page_id ON chunks(page_id);
CREATE INDEX idx_chunks_time ON chunks(start_ms, end_ms);

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

CREATE TABLE media_blob (
    id INTEGER PRIMARY KEY DEFAULT 1,
    data BLOB NOT NULL,
    mime_type TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    original_size INTEGER NOT NULL,
    sha256_hash TEXT NOT NULL,
    created_at TEXT
);

CREATE TABLE media_segments (
    id INTEGER PRIMARY KEY,
    chunk_id INTEGER NOT NULL,
    start_time REAL,
    end_time REAL,
    frame_number INTEGER,
    FOREIGN KEY (chunk_id) REFERENCES chunks(id)
);

CREATE INDEX idx_media_segments_chunk ON media_segments(chunk_id);
CREATE INDEX idx_media_segments_time ON media_segments(start_time, end_time);

-- ============================================================================
-- V2.1 ADDITIONS: VIDEO/AUDIO METADATA AND DUAL EMBEDDINGS
-- ============================================================================

CREATE TABLE video_metadata (
    id INTEGER PRIMARY KEY DEFAULT 1,
    duration_ms INTEGER NOT NULL,
    width INTEGER,
    height INTEGER,
    fps REAL,
    codec TEXT,
    has_audio INTEGER DEFAULT 1,
    source_filename TEXT,
    source_hash TEXT NOT NULL,
    media_blob_id INTEGER,
    FOREIGN KEY (media_blob_id) REFERENCES media_blob(id)
);

CREATE TABLE video_frames (
    id INTEGER PRIMARY KEY,
    timestamp_ms INTEGER NOT NULL,
    frame_type TEXT NOT NULL,
    thumbnail BLOB NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    scene_description TEXT,
    embedding BLOB
);

CREATE INDEX idx_frames_timestamp ON video_frames(timestamp_ms);

CREATE TABLE video_embeddings (
    id INTEGER PRIMARY KEY,
    vector BLOB NOT NULL,
    embedding_type TEXT NOT NULL CHECK (embedding_type IN ('composite_segment', 'direct_video')),
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    keyframe_ids TEXT,
    chunk_id INTEGER,
    video_clip_hash TEXT,
    created_at TEXT,
    FOREIGN KEY (chunk_id) REFERENCES chunks(id)
);

CREATE INDEX idx_video_embeddings_type ON video_embeddings(embedding_type);
CREATE INDEX idx_video_embeddings_time ON video_embeddings(start_ms, end_ms);

CREATE TABLE video_segments (
    id INTEGER PRIMARY KEY,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    text TEXT NOT NULL,
    speaker_id INTEGER,
    confidence REAL NOT NULL,
    language TEXT,
    FOREIGN KEY (speaker_id) REFERENCES speakers(id)
);

CREATE INDEX idx_video_segments_time ON video_segments(start_ms, end_ms);

CREATE TABLE audio_metadata (
    id INTEGER PRIMARY KEY DEFAULT 1,
    duration_ms INTEGER NOT NULL,
    sample_rate INTEGER,
    channels INTEGER,
    codec TEXT,
    source_filename TEXT,
    source_hash TEXT NOT NULL,
    media_blob_id INTEGER,
    FOREIGN KEY (media_blob_id) REFERENCES media_blob(id)
);

CREATE TABLE audio_segments (
    id INTEGER PRIMARY KEY,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    text TEXT NOT NULL,
    speaker_id INTEGER,
    confidence REAL NOT NULL,
    language TEXT,
    FOREIGN KEY (speaker_id) REFERENCES speakers(id)
);

CREATE INDEX idx_audio_segments_time ON audio_segments(start_ms, end_ms);

CREATE TABLE speakers (
    id INTEGER PRIMARY KEY,
    name TEXT,
    voice_embedding BLOB,
    total_duration_ms INTEGER,
    -- v3.0 additions
    embedding_stable BLOB,          -- Stable voice embedding for re-identification
    confidence REAL DEFAULT 1.0     -- Confidence in speaker identification
);

CREATE TABLE images (
    id INTEGER PRIMARY KEY,
    pdf_page INTEGER NOT NULL,
    book_page INTEGER NOT NULL,
    image_index INTEGER NOT NULL DEFAULT 0,
    mime_type TEXT NOT NULL,
    full_image BLOB NOT NULL,
    thumbnail BLOB NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    ocr_text TEXT,                   -- Text extracted from image (OCR)
    description TEXT,                -- AI-generated description/caption
    embedding BLOB,                  -- Raw image embedding (image only)
    context_embedding BLOB,          -- Contextual embedding (image + text + page)
    context_text TEXT                -- Text context used for contextual embedding
);

CREATE INDEX idx_images_page ON images(pdf_page);
CREATE INDEX idx_images_book_page ON images(book_page);

-- ============================================================================
-- V3.0 ADDITIONS: SECTION DETECTION
-- ============================================================================

-- Section detection (logical structure: chapters, headings, etc.)
-- Embedding and summary are optional inline columns (avoids over-normalized separate table)
CREATE TABLE sections (
    id INTEGER PRIMARY KEY,
    parent_id INTEGER,              -- For nested sections (NULL = top-level)
    section_type TEXT NOT NULL,     -- "chapter", "heading", "abstract", "conclusion", etc.
    title TEXT,                     -- Section title text
    start_page INTEGER NOT NULL,    -- First page (1-indexed)
    end_page INTEGER NOT NULL,      -- Last page (inclusive)
    start_chunk_id INTEGER,         -- First chunk in section
    end_chunk_id INTEGER,           -- Last chunk in section
    depth INTEGER NOT NULL DEFAULT 0,   -- Nesting depth (0 = top-level)
    start_ms INTEGER,               -- For media: start timestamp
    end_ms INTEGER,                 -- For media: end timestamp
    -- Optional section-level embedding (inline, avoids separate table)
    embedding BLOB,                 -- Embedding of section content (nullable)
    summary_text TEXT,              -- Optional section summary (nullable)
    FOREIGN KEY (parent_id) REFERENCES sections(id),
    FOREIGN KEY (start_chunk_id) REFERENCES chunks(id),
    FOREIGN KEY (end_chunk_id) REFERENCES chunks(id)
);

CREATE INDEX idx_sections_parent ON sections(parent_id);
CREATE INDEX idx_sections_pages ON sections(start_page, end_page);
CREATE INDEX idx_sections_type ON sections(section_type);

-- ============================================================================
-- V3.0 ADDITIONS: CONTEXTUAL CHUNKS
-- ============================================================================

-- Contextual information for each chunk (surrounding context)
CREATE TABLE chunk_contexts (
    chunk_id INTEGER PRIMARY KEY,
    context_before TEXT,            -- Previous ~500 chars of context
    context_after TEXT,             -- Next ~500 chars of context
    context_embedding BLOB,         -- Embedding of full context window
    section_id INTEGER,             -- Section this chunk belongs to
    FOREIGN KEY (chunk_id) REFERENCES chunks(id),
    FOREIGN KEY (section_id) REFERENCES sections(id)
);

CREATE INDEX idx_chunk_contexts_section ON chunk_contexts(section_id);

-- ============================================================================
-- V3.0 ADDITIONS: CROSS-MODAL LINKS
-- ============================================================================

-- Links between different content types (text<->image, text<->video, etc.)
CREATE TABLE cross_modal_links (
    id INTEGER PRIMARY KEY,
    source_type TEXT NOT NULL,      -- "chunk", "image", "video_frame", "scene", etc.
    source_id INTEGER NOT NULL,     -- ID in the source table
    target_type TEXT NOT NULL,      -- "chunk", "image", "video_frame", "scene", etc.
    target_id INTEGER NOT NULL,     -- ID in the target table
    link_type TEXT NOT NULL,        -- "references", "illustrates", "transcribes", "describes", "caption"
    confidence REAL NOT NULL DEFAULT 1.0,   -- Confidence in the link (0.0-1.0)
    created_at TEXT,
    CHECK (confidence >= 0.0 AND confidence <= 1.0)
);

CREATE INDEX idx_cross_modal_source ON cross_modal_links(source_type, source_id);
CREATE INDEX idx_cross_modal_target ON cross_modal_links(target_type, target_id);

-- ============================================================================
-- V3.0 ADDITIONS: SCENE DETECTION FOR VIDEO
-- ============================================================================

-- Detected visual scenes in video (scene changes, transitions, etc.)
CREATE TABLE scenes (
    id INTEGER PRIMARY KEY,
    start_ms INTEGER NOT NULL,      -- Scene start timestamp
    end_ms INTEGER NOT NULL,        -- Scene end timestamp
    scene_type TEXT,                -- "static", "motion", "transition", "slide", etc.
    visual_hash TEXT,               -- Perceptual hash for deduplication
    motion_score REAL,              -- Average motion between frames (0.0-1.0)
    description TEXT,               -- Optional scene description
    keyframe_id INTEGER,            -- Representative keyframe
    embedding BLOB,                 -- Scene-level embedding (keyframes + transcription combined)
    FOREIGN KEY (keyframe_id) REFERENCES video_frames(id)
);

CREATE INDEX idx_scenes_time ON scenes(start_ms, end_ms);

-- ============================================================================
-- V3.0 ADDITIONS: AUDIO SCENE DETECTION
-- ============================================================================

-- Detected audio events (speech, music, silence, etc.)
CREATE TABLE audio_scenes (
    id INTEGER PRIMARY KEY,
    start_ms INTEGER NOT NULL,      -- Scene start timestamp
    end_ms INTEGER NOT NULL,        -- Scene end timestamp
    scene_type TEXT NOT NULL,       -- "speech", "music", "silence", "ambient", "applause", etc.
    confidence REAL DEFAULT 1.0     -- Detection confidence (0.0-1.0)
        CHECK (confidence >= 0.0 AND confidence <= 1.0),
    description TEXT                -- Optional description
);

CREATE INDEX idx_audio_scenes_time ON audio_scenes(start_ms, end_ms);
CREATE INDEX idx_audio_scenes_type ON audio_scenes(scene_type);

-- ============================================================================
-- V3.0 ADDITIONS: SPEAKER TURNS
-- ============================================================================

-- Granular speaker turns (who speaks when)
CREATE TABLE speaker_turns (
    id INTEGER PRIMARY KEY,
    speaker_id INTEGER,             -- Reference to speakers table
    start_ms INTEGER NOT NULL,      -- Turn start timestamp
    end_ms INTEGER NOT NULL,        -- Turn end timestamp
    overlap_speaker_id INTEGER,     -- If overlapping speech, other speaker
    confidence REAL DEFAULT 1.0,    -- Confidence in speaker assignment
    FOREIGN KEY (speaker_id) REFERENCES speakers(id),
    FOREIGN KEY (overlap_speaker_id) REFERENCES speakers(id)
);

CREATE INDEX idx_speaker_turns_speaker ON speaker_turns(speaker_id);
CREATE INDEX idx_speaker_turns_time ON speaker_turns(start_ms, end_ms);

-- ============================================================================
-- V3.0 METADATA KEYS
-- ============================================================================

-- Schema version is a monotonically increasing integer (see SPEC.md):
--   1 = v1.0 (core tables)
--   2 = v1.1 (model checkpoint)
--   3 = v2.0 (media blob)
--   4 = v2.1 (video/audio metadata)
--   5 = v2.1+ (PDF page renders required)
--   6 = v3.0 (contextual/semantic features)
--
-- V3.0 metadata keys:
--   schema_version            - 6 (integer)
--   contextual_chunks         - "true" if chunk_contexts table populated
--   context_window_size       - Context window size in chars (default 500)
--   section_count             - Number of detected sections
--   scene_count               - Number of detected scenes (video only)
--   speaker_count             - Number of identified speakers
--   semantic_chunking         - "true" if semantic chunking was used
--   semantic_threshold        - Similarity threshold for semantic boundaries (default 0.7)
--   min_chunk_size            - Minimum chunk size (default 200)
--   max_chunk_size            - Maximum chunk size (default 1000)

-- ============================================================================
-- SCHEMA INFO
-- ============================================================================

-- Schema Version: 6 (v3.0 features)
-- Created: 2026-02-04
-- Compatibility: SQLite 3.x
-- Backward Compatible: Yes (v1.x/v2.x readers ignore new tables)
-- All v3.0 tables are optional
