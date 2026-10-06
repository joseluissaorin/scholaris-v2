# SPDF Format Specification

**Spec Version:** 3.0
**Schema Version:** 6
**Status:** Stable
**Last Updated:** 2026-02-04

## Overview

SPDF (Scholaris Processed Document Format) is a portable, self-contained file format for storing processed documents ready for citation matching. It encapsulates OCR text, verified page numbers, text chunks, semantic embeddings, and rendered page images in a single compressed file.

### Design Goals

1. **Portability** — Single file, no external dependencies
2. **Efficiency** — Gzip compression, ~2-5 MB per 15-page article
3. **Self-contained** — Contains everything needed for citation matching and display
4. **Recoverable** — Rendered page images enable document reconstruction
5. **Verifiable** — Source file hash for integrity checking
6. **Searchable** — FTS5 full-text search with BM25 ranking built-in
7. **Multimodal** — Supports PDF, video, audio, and images

### File Extensions

| Extension | Status |
|-----------|--------|
| `.spdf` | Primary (recommended) |
| `.scholaris` | Alternative |
| `.scpdf` | Alternative |

## File Structure

An SPDF file is a **gzip-compressed SQLite database**.

```
┌────────────────────────────────────────────┐
│            SPDF File (.spdf)               │
├────────────────────────────────────────────┤
│  ┌──────────────────────────────────────┐  │
│  │     Gzip Compression (level 6)       │  │
│  │  ┌────────────────────────────────┐  │  │
│  │  │       SQLite Database          │  │  │
│  │  │                                │  │  │
│  │  │  ┌─────────────────────────┐   │  │  │
│  │  │  │   CORE TABLES (v1.0)   │   │  │  │
│  │  │  │   metadata             │   │  │  │
│  │  │  │   pages                │   │  │  │
│  │  │  │   chunks               │   │  │  │
│  │  │  │   chunks_fts (FTS5)    │   │  │  │
│  │  │  │   embeddings           │   │  │  │
│  │  │  │   previews             │   │  │  │
│  │  │  └─────────────────────────┘   │  │  │
│  │  │                                │  │  │
│  │  │  ┌─────────────────────────┐   │  │  │
│  │  │  │   MEDIA TABLES (v2.0+) │   │  │  │
│  │  │  │   media_blob           │   │  │  │
│  │  │  │   video_segments       │   │  │  │
│  │  │  │   audio_segments       │   │  │  │
│  │  │  │   speakers             │   │  │  │
│  │  │  │   video_frames         │   │  │  │
│  │  │  │   images               │   │  │  │
│  │  │  │   ...                  │   │  │  │
│  │  │  └─────────────────────────┘   │  │  │
│  │  │                                │  │  │
│  │  │  ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┐   │  │  │
│  │  │     OPTIONAL (v3.0)            │  │  │
│  │  │  │ sections               │   │  │  │
│  │  │    chunk_contexts              │  │  │
│  │  │  │ cross_modal_links      │   │  │  │
│  │  │    scenes                      │  │  │
│  │  │  │ audio_scenes           │   │  │  │
│  │  │    speaker_turns               │  │  │
│  │  │  └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┘   │  │  │
│  │  │                                │  │  │
│  │  └────────────────────────────────┘  │  │
│  └──────────────────────────────────────┘  │
└────────────────────────────────────────────┘
```

## Schema Version History

The `schema_version` metadata key is a **monotonically increasing integer**. Higher numbers indicate newer schemas with additional tables.

| Schema Version | Spec Version | Description |
|----------------|--------------|-------------|
| 1 | v1.0 | Initial release: metadata, pages, chunks, embeddings, previews |
| 2 | v1.1 | Model checkpoint support for reproducibility |
| 3 | v2.0 | Multimodal: media_blob, video/audio segments, images |
| 4 | v2.1 | Dual video embeddings (composite + direct) |
| 5 | v2.2 | PDF page renders always included |
| 6 | v3.0 | Semantic chunking, sections, contextual embeddings |

All schemas are backward compatible. Readers should ignore tables they don't recognize.

---

## Schema (v1.0) — Core Tables

### Table: `metadata`

Key-value store for document metadata.

```sql
CREATE TABLE metadata (
    key TEXT PRIMARY KEY,
    value TEXT
);
```

**Required Keys:**

| Key | Type | Description |
|-----|------|-------------|
| `citation_key` | string | Unique identifier (e.g., "smith2023") |
| `authors` | JSON array | List of author names |
| `year` | integer (as string) | Publication year |
| `title` | string | Document title |
| `source_pdf_hash` | string | SHA256 hash with prefix "sha256:..." |
| `source_pdf_filename` | string | Original filename |
| `processed_at` | ISO 8601 | Processing timestamp |
| `ocr_model` | string | OCR model used |
| `embedding_model` | string | Embedding model used |
| `embedding_dim` | integer (as string) | Embedding dimensions |
| `schema_version` | integer (as string) | Schema version (1-6) |
| `total_pages` | integer (as string) | Number of pages |
| `total_chunks` | integer (as string) | Number of chunks |
| `language` | string | ISO 639-1 language code |

### Table: `pages`

OCR-extracted pages with verified page numbers.

```sql
CREATE TABLE pages (
    id INTEGER PRIMARY KEY,
    pdf_page INTEGER NOT NULL,        -- 1-indexed PDF page number
    book_page INTEGER NOT NULL,       -- Printed page number (can be negative for roman numerals)
    text TEXT NOT NULL,               -- OCR text content
    confidence REAL NOT NULL,         -- OCR confidence (0.0-1.0)
    is_landscape_half INTEGER NOT NULL DEFAULT 0  -- 1 if half of landscape double-page
);

CREATE INDEX idx_pages_pdf_page ON pages(pdf_page);
```

**Page Number Conventions:**

- `pdf_page`: Physical PDF page (1-indexed)
- `book_page`: Printed page number from the document
  - Positive integers: Normal pages (1, 2, 3...)
  - Negative integers: Roman numeral front matter (-1 = i, -2 = ii, -12 = xii)
  - Zero: No page number detected

### Table: `chunks`

Text segments for semantic search.

```sql
CREATE TABLE chunks (
    id INTEGER PRIMARY KEY,
    page_id INTEGER,                  -- Foreign key to pages.id (NULL for media)
    chunk_index INTEGER NOT NULL,     -- Chunk index within page
    text TEXT NOT NULL,               -- Chunk text content
    book_page INTEGER,                -- Denormalized for fast lookup
    pdf_page INTEGER,                 -- Denormalized for fast lookup
    start_ms INTEGER,                 -- For media: start timestamp
    end_ms INTEGER,                   -- For media: end timestamp
    FOREIGN KEY (page_id) REFERENCES pages(id)
);

CREATE INDEX idx_chunks_book_page ON chunks(book_page);
CREATE INDEX idx_chunks_time ON chunks(start_ms, end_ms);
```

**Chunking (informational):**

- v1.0-v2.x: Fixed 500-char windows with 100-char overlap
- v3.0+: Variable-size semantic chunks (see metadata flags)

### Virtual Table: `chunks_fts`

FTS5 full-text search index for fast keyword search.

```sql
CREATE VIRTUAL TABLE chunks_fts USING fts5(
    text,
    content='chunks',
    content_rowid='id',
    tokenize='porter unicode61 remove_diacritics 1'
);

-- Synchronization triggers
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
```

**FTS5 Features:**

- **BM25 Ranking**: Results ranked by relevance
- **Porter Stemming**: Matches word variants (e.g., "running" matches "run")
- **Unicode Support**: Full Unicode text handling with diacritics removal
- **Query Syntax**: phrases (`"neural network"`), boolean (`AND`, `NOT`), prefix (`optim*`)

### Table: `embeddings`

Vector embeddings for each chunk.

```sql
CREATE TABLE embeddings (
    chunk_id INTEGER PRIMARY KEY,
    vector BLOB NOT NULL,             -- Binary float32 array
    FOREIGN KEY (chunk_id) REFERENCES chunks(id)
);
```

**Vector Format:**

- Type: Little-endian float32 array
- Dimensions: As specified in `metadata.embedding_dim`
- Size: `embedding_dim * 4` bytes per vector

```python
# Reading
vector = np.frombuffer(blob, dtype=np.float32)

# Writing
blob = embedding.astype(np.float32).tobytes()
```

### Table: `previews`

Rendered page images. **Always populated for PDF documents** (schema ≥ 5).

```sql
CREATE TABLE previews (
    pdf_page INTEGER PRIMARY KEY,     -- PDF page number (1-indexed)
    thumbnail BLOB NOT NULL,          -- JPEG image bytes
    width INTEGER NOT NULL,           -- Image width in pixels
    height INTEGER NOT NULL           -- Image height in pixels
);
```

**Preview Parameters:**

- Resolution: 200 DPI (sufficient for on-screen display)
- Format: JPEG, quality 85
- Purpose: Display pages without requiring the original PDF

For PDF documents with schema_version ≥ 5, every page has a corresponding preview. This ensures the SPDF is fully self-contained for viewing.

---

## Schema Additions (v1.1) — Model Checkpoint

Schema version 2 adds optional model checkpoint support for reproducible embeddings.

### Table: `model_checkpoint` (Optional)

```sql
CREATE TABLE model_checkpoint (
    id INTEGER PRIMARY KEY DEFAULT 1,
    model_name TEXT NOT NULL,
    model_version TEXT NOT NULL,
    model_hash TEXT NOT NULL,               -- "sha256:..."
    source_url TEXT,
    license TEXT,
    quantization TEXT,                      -- "Q2_K", "Q4_K_M", etc.
    format TEXT NOT NULL,                   -- "gguf", "onnx"
    storage_mode TEXT NOT NULL,             -- "embedded" | "external" | "api"
    checkpoint_blob BLOB,                   -- Model bytes (if embedded)
    checkpoint_size INTEGER,
    external_path TEXT,                     -- Path (if external)
    embedding_dim INTEGER NOT NULL,
    max_tokens INTEGER,
    prefix_query TEXT,
    prefix_document TEXT,
    normalize_embeddings INTEGER DEFAULT 1,
    CHECK (storage_mode IN ('embedded', 'external', 'api'))
);
```

| Storage Mode | Description |
|--------------|-------------|
| `embedded` | Model bytes in `checkpoint_blob` |
| `external` | Model in `~/.spdf/models/` by hash |
| `api` | No local model, API-dependent |

---

## Schema Additions (v2.0) — Multimodal Support

Schema version 3 adds support for video, audio, and images.

### Table: `media_blob`

Stores the original source file.

```sql
CREATE TABLE media_blob (
    id INTEGER PRIMARY KEY DEFAULT 1,
    data BLOB NOT NULL,
    mime_type TEXT NOT NULL,                -- "application/pdf", "video/mp4", etc.
    original_filename TEXT NOT NULL,
    original_size INTEGER NOT NULL,
    sha256_hash TEXT NOT NULL,
    created_at TEXT
);
```

### Table: `video_segments` / `audio_segments`

Transcription segments with timestamps.

```sql
CREATE TABLE video_segments (
    id INTEGER PRIMARY KEY,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    text TEXT NOT NULL,
    speaker_id INTEGER,                     -- Reference to speakers table
    confidence REAL NOT NULL,
    language TEXT DEFAULT 'en',
    FOREIGN KEY (speaker_id) REFERENCES speakers(id)
);

-- audio_segments has identical schema
```

These tables store the **raw transcription output** with basic speaker assignment from ASR. Each segment contains the spoken text and its time range.

### Table: `speakers`

Identified speakers.

```sql
CREATE TABLE speakers (
    id INTEGER PRIMARY KEY,
    name TEXT,                              -- Display name (can be updated)
    voice_embedding BLOB,                   -- Voice print for identification
    total_duration_ms INTEGER DEFAULT 0,
    embedding_stable BLOB,                  -- v3.0: Stable embedding for re-ID
    confidence REAL DEFAULT 1.0             -- v3.0: ID confidence
);
```

### Table: `video_frames`

Extracted keyframes from video.

```sql
CREATE TABLE video_frames (
    id INTEGER PRIMARY KEY,
    timestamp_ms INTEGER NOT NULL,
    frame_type TEXT NOT NULL,               -- "keyframe", "scene_change", etc.
    thumbnail BLOB NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    embedding BLOB
);
```

### Table: `images`

Extracted images from PDF pages with contextual embeddings.

```sql
CREATE TABLE images (
    id INTEGER PRIMARY KEY,
    pdf_page INTEGER NOT NULL,
    book_page INTEGER NOT NULL,           -- For citation: "Figure on p. 47"
    image_index INTEGER NOT NULL DEFAULT 0,
    full_image BLOB NOT NULL,
    thumbnail BLOB NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    -- Raw image embedding (image only)
    embedding BLOB,
    -- Contextual embedding (image + surrounding text + page info)
    context_embedding BLOB,
    -- Text context used for contextual embedding
    context_text TEXT,
    -- Text extracted from the image itself (OCR)
    ocr_text TEXT,
    -- Caption or description
    caption TEXT
);

CREATE INDEX idx_images_page ON images(pdf_page);
CREATE INDEX idx_images_book_page ON images(book_page);
```

**Embedding Strategy:**

Images should be embedded **with their document context** using Qwen3-VL's multimodal input:

| Column | Content | Use Case |
|--------|---------|----------|
| `embedding` | Raw image only | Visual similarity search |
| `context_embedding` | Image + surrounding text + page | Semantic document search |

The `context_embedding` is generated by passing Qwen3-VL:
1. The image
2. Surrounding text (caption, nearby paragraphs)
3. Page context: "Figure on page {book_page} of {title}"

This enables queries like "diagram showing neural network architecture" to find the right figure even if the image alone wouldn't match.

**Cross-Modal Links:**

Use `cross_modal_links` to explicitly connect images to text chunks:

```sql
-- Image illustrates a specific text chunk
INSERT INTO cross_modal_links (source_type, source_id, target_type, target_id, link_type)
VALUES ('image', 42, 'chunk', 156, 'illustrates');
```

### v2.0 Metadata Keys

| Key | Type | Description |
|-----|------|-------------|
| `media_type` | string | "pdf", "image", "video", "audio" |
| `has_media_blob` | bool | Original file stored |
| `duration_seconds` | float | Duration (audio/video) |
| `frame_rate` | float | FPS (video) |
| `resolution` | string | "WIDTHxHEIGHT" |

---

## Schema Additions (v2.1) — Dual Video Embeddings

Schema version 4 adds dual video embedding support.

### Table: `video_embeddings`

```sql
CREATE TABLE video_embeddings (
    id INTEGER PRIMARY KEY,
    vector BLOB NOT NULL,
    embedding_type TEXT NOT NULL,           -- "composite_segment" or "direct_video"
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    keyframe_ids TEXT,                      -- JSON array (composite only)
    chunk_id INTEGER,
    video_clip_hash TEXT,                   -- SHA256 (direct only)
    created_at TEXT,
    CHECK (embedding_type IN ('composite_segment', 'direct_video')),
    FOREIGN KEY (chunk_id) REFERENCES chunks(id)
);
```

| Type | Duration | Description |
|------|----------|-------------|
| `composite_segment` | 30s | 5 keyframes + transcription text |
| `direct_video` | 15s | Native video clip embedding, 50% overlap |

---

## Schema Additions (v3.0) — Semantic Structure

Schema version 6 adds semantic chunking, document structure detection, contextual embeddings, and cross-modal linking.

### Design Philosophy

v3.0 extends the data model to store richer structural and contextual information. It does **not** prescribe how applications should query this data — search strategies, ranking algorithms, and model choices remain implementation decisions. See `PROCESSING_GUIDE.md` for recommended practices.

**All v3.0 tables are optional.** A valid schema-6 file may contain none, some, or all of these tables. Readers should check for table existence before querying.

### Table: `sections`

Detected document structure (chapters, headings, etc.).

```sql
CREATE TABLE sections (
    id INTEGER PRIMARY KEY,
    parent_id INTEGER,                      -- For nested sections (NULL = root)
    section_type TEXT NOT NULL,             -- See section types below
    title TEXT,
    start_page INTEGER NOT NULL,
    end_page INTEGER NOT NULL,
    start_chunk_id INTEGER,
    end_chunk_id INTEGER,
    depth INTEGER NOT NULL DEFAULT 0,       -- Nesting depth (0 = root)
    start_ms INTEGER,                       -- For media
    end_ms INTEGER,                         -- For media
    -- Optional section-level embedding (avoids separate table)
    embedding BLOB,                         -- Section content embedding
    summary_text TEXT,                      -- Optional section summary
    FOREIGN KEY (parent_id) REFERENCES sections(id)
);

CREATE INDEX idx_sections_page ON sections(start_page, end_page);
```

**Section Types:**

| Type | Description |
|------|-------------|
| `chapter` | Book chapter |
| `heading` | Section heading |
| `subheading` | Subsection |
| `abstract` | Abstract/summary |
| `introduction` | Introduction |
| `conclusion` | Conclusion |
| `bibliography` | References |
| `appendix` | Appendix |

### Table: `chunk_contexts`

Contextual information for each chunk.

```sql
CREATE TABLE chunk_contexts (
    chunk_id INTEGER PRIMARY KEY,
    context_before TEXT,                    -- ~500 chars preceding
    context_after TEXT,                     -- ~500 chars following
    context_embedding BLOB,                 -- Embedding of chunk + context
    section_id INTEGER,                     -- Section containing this chunk
    FOREIGN KEY (chunk_id) REFERENCES chunks(id),
    FOREIGN KEY (section_id) REFERENCES sections(id)
);
```

**Usage:**

- `context_before`/`context_after`: Surrounding text for display
- `context_embedding`: Embedding of chunk with its context window (improves retrieval)
- `section_id`: Links chunk to its containing section

### Table: `cross_modal_links`

Explicit relationships between content types.

```sql
CREATE TABLE cross_modal_links (
    id INTEGER PRIMARY KEY,
    source_type TEXT NOT NULL,              -- "chunk", "image", "video_frame", "scene"
    source_id INTEGER NOT NULL,
    target_type TEXT NOT NULL,
    target_id INTEGER NOT NULL,
    link_type TEXT NOT NULL,                -- See link types below
    confidence REAL NOT NULL DEFAULT 1.0,
    created_at TEXT
);

CREATE INDEX idx_cross_modal_source ON cross_modal_links(source_type, source_id);
CREATE INDEX idx_cross_modal_target ON cross_modal_links(target_type, target_id);
```

**Link Types:**

| Type | Description |
|------|-------------|
| `illustrates` | Image/frame illustrates text |
| `transcribes` | Text transcribes audio/video |
| `references` | Text references image/figure |
| `caption` | Text is caption for image |

### Table: `scenes` (Video)

Detected scene boundaries in video.

```sql
CREATE TABLE scenes (
    id INTEGER PRIMARY KEY,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    scene_type TEXT,                        -- "static", "motion", "transition", etc.
    visual_hash TEXT,                       -- Perceptual hash
    motion_score REAL,                      -- Motion intensity (0.0-1.0)
    description TEXT,
    keyframe_id INTEGER,
    embedding BLOB,                         -- Scene-level embedding (keyframes + transcription)
    FOREIGN KEY (keyframe_id) REFERENCES video_frames(id)
);

CREATE INDEX idx_scenes_time ON scenes(start_ms, end_ms);
```

**Scene Types:**

| Type | Description |
|------|-------------|
| `static` | Minimal motion (slides, documents) |
| `motion` | Active movement |
| `transition` | Scene change/fade |
| `slide` | Presentation slide |

**Scene Embedding:**

The optional `embedding` column stores a combined representation of the scene:
- Visual content from keyframes
- Associated transcription text (if any)

This enables "find similar scenes" queries across videos.

### Table: `audio_scenes`

Detected audio events (speech, music, silence, etc.).

```sql
CREATE TABLE audio_scenes (
    id INTEGER PRIMARY KEY,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    scene_type TEXT NOT NULL,               -- See types below
    confidence REAL DEFAULT 1.0,            -- Detection confidence (0.0-1.0)
    description TEXT
);

CREATE INDEX idx_audio_scenes_time ON audio_scenes(start_ms, end_ms);
CREATE INDEX idx_audio_scenes_type ON audio_scenes(scene_type);
```

**Audio Scene Types:**

| Type | Description |
|------|-------------|
| `speech` | Human speech |
| `music` | Music playing |
| `silence` | No audio activity |
| `ambient` | Background noise/atmosphere |
| `applause` | Audience applause |
| `laughter` | Audience laughter |

**Relationship to `audio_segments`:**

`audio_segments` stores transcription text. `audio_scenes` classifies what *type* of audio is present, including non-speech events. They can overlap in time but serve different purposes:

- `audio_segments`: "What was said" (text)
- `audio_scenes`: "What kind of sound" (classification)

### Table: `speaker_turns`

Granular speaker turn boundaries for diarization.

```sql
CREATE TABLE speaker_turns (
    id INTEGER PRIMARY KEY,
    speaker_id INTEGER,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    overlap_speaker_id INTEGER,             -- If overlapping speech
    confidence REAL DEFAULT 1.0,
    FOREIGN KEY (speaker_id) REFERENCES speakers(id)
);
```

**Relationship to `video_segments`/`audio_segments`:**

The segment tables (`video_segments`, `audio_segments`) store **transcription text with timestamps** and basic speaker assignment from ASR. They answer "what was said when."

The `speaker_turns` table stores **refined speaker boundaries** from dedicated diarization. It answers "who spoke when" with higher precision, including overlapping speech detection. Speaker turns cross-reference segments but may have finer time resolution.

Applications should:
1. Use segments for displaying transcription text
2. Use speaker_turns (when present) for speaker attribution and timeline visualization
3. Join on time ranges to combine text with refined speaker info

### v3.0 Metadata Keys

| Key | Type | Description |
|-----|------|-------------|
| `contextual_chunks` | bool | `chunk_contexts` table populated |
| `context_window_size` | int | Context window in chars (default 500) |
| `section_count` | int | Number of detected sections |
| `scene_count` | int | Number of video scenes |
| `audio_scene_count` | int | Number of audio scenes |
| `speaker_count` | int | Number of speakers |
| `semantic_chunking` | bool | Semantic chunking was used |
| `semantic_threshold` | float | Boundary threshold (default 0.7) |
| `min_chunk_size` | int | Min chunk size (default 200) |
| `max_chunk_size` | int | Max chunk size (default 1000) |

### Semantic Chunking

v3.0 introduces **semantic chunking** as an alternative to fixed-size chunking. Instead of splitting at fixed character intervals, semantic chunking detects topic boundaries using sentence embedding similarity.

The `chunks` table schema is unchanged. Metadata flags indicate whether semantic chunking was used and its parameters. This keeps the format compatible while allowing improved chunk quality.

### Storage Overhead

| Feature | Approximate Impact |
|---------|-------------------|
| `sections` | +1-2% |
| `chunk_contexts` | +30-40% |
| `cross_modal_links` | +1-2% |
| `scenes` (video) | +5-10% |
| `audio_scenes` | +1-3% |
| `speaker_turns` | +1-2% |

---

## Validation Rules

A valid SPDF file MUST:

1. **Be gzip-compressed** — Decompresses to valid SQLite database
2. **Have required tables** — metadata, pages, chunks, embeddings (previews recommended but not required for non-PDF media)
3. **Have all required metadata keys** — As listed in v1.0 section
4. **Have valid schema_version** — Integer 1-6
5. **Have consistent counts** — `total_pages` = COUNT(pages), `total_chunks` = COUNT(chunks)
6. **Have matching embeddings** — One embedding per chunk
7. **Have valid embedding dimensions** — Each vector = `embedding_dim * 4` bytes
8. **Have valid foreign keys** — All references must be valid
9. **Have valid confidence values** — 0.0 ≤ confidence ≤ 1.0
10. **Have valid hash format** — Hashes start with "sha256:"

### Additional Validation (schema ≥ 5)

11. **PDF previews complete** — For `media_type="pdf"`, every page has a preview

### Additional Validation (schema ≥ 6)

v3.0 tables are optional. If present:

12. **Valid section hierarchy** — All `parent_id` references valid or NULL
13. **Valid section ranges** — `start_page ≤ end_page`

---

## Compression

- **Algorithm:** Gzip
- **Level:** 6 (default)
- **Typical ratio:** 60-80% reduction

## Size Estimates

| Content | Approximate Size |
|---------|-----------------|
| 15-page article (with previews) | ~2-5 MB |
| 30-page chapter (with previews) | ~5-10 MB |
| 200-page book (with previews) | ~30-60 MB |
| 1-hour video (with media) | ~500 MB - 2 GB |

Primary factors: preview image quality, media blob inclusion, embedding dimensions.

---

## Reading SPDF Files

### Algorithm

1. Open file with gzip decompression
2. Write decompressed bytes to temporary SQLite file
3. Connect to SQLite database
4. Read `schema_version` from metadata
5. Load tables appropriate to schema version
6. Clean up temporary file

### Minimal Python Reader

```python
import gzip
import sqlite3
import tempfile
import numpy as np
from pathlib import Path

def read_spdf(path):
    """Read an SPDF file and return its contents."""
    with gzip.open(path, 'rb') as f:
        db_bytes = f.read()

    with tempfile.NamedTemporaryFile(suffix='.db', delete=False) as tmp:
        tmp.write(db_bytes)
        tmp_path = tmp.name

    try:
        conn = sqlite3.connect(tmp_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        # Read metadata
        cursor.execute("SELECT key, value FROM metadata")
        metadata = {row['key']: row['value'] for row in cursor}

        schema_version = int(metadata.get('schema_version', '1'))

        # Read core tables
        cursor.execute("SELECT * FROM pages ORDER BY id")
        pages = [dict(row) for row in cursor]

        cursor.execute("SELECT * FROM chunks ORDER BY id")
        chunks = [dict(row) for row in cursor]

        cursor.execute("SELECT chunk_id, vector FROM embeddings ORDER BY chunk_id")
        embeddings = [np.frombuffer(row['vector'], dtype=np.float32) for row in cursor]

        cursor.execute("SELECT * FROM previews ORDER BY pdf_page")
        previews = [dict(row) for row in cursor]

        result = {
            'metadata': metadata,
            'pages': pages,
            'chunks': chunks,
            'embeddings': embeddings,
            'previews': previews,
        }

        # Load v3.0 tables if present
        if schema_version >= 6:
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='sections'")
            if cursor.fetchone():
                cursor.execute("SELECT * FROM sections ORDER BY id")
                result['sections'] = [dict(row) for row in cursor]

        conn.close()
        return result
    finally:
        Path(tmp_path).unlink(missing_ok=True)
```

---

## Security Considerations

1. **Hash Verification** — Verify `source_pdf_hash` when original is available
2. **Untrusted Files** — Validate schema before processing
3. **Size Limits** — Limit decompressed size to prevent zip bombs
4. **SQL Injection** — Use parameterized queries

---

## Reference Implementation

See `spdf/reference/` for minimal reader/writer implementations.

See `PROCESSING_GUIDE.md` for recommended search strategies, model choices, and processing pipelines.

---

## Changelog

### v3.0 / Schema 6 (2026-02-04)

**Semantic Chunking & Contextual Retrieval**

- Semantic chunking with boundary detection (metadata flags)
- Contextual embeddings with surrounding context (`chunk_contexts`)
- Document structure detection (`sections` with inline embedding)
- Cross-modal linking (`cross_modal_links`)
- Video scene detection with embeddings (`scenes`)
- Audio scene classification (`audio_scenes`)
- Refined speaker turns (`speaker_turns`)
- FTS5 update trigger for chunk modifications
- All v3.0 tables optional

### v2.2 / Schema 5 (2026-02-04)

- PDF page renders always included in `previews`

### v2.1 / Schema 4 (2026-02-04)

- Dual video embeddings (composite + direct)
- `video_embeddings` table

### v2.0 / Schema 3 (2026-02-04)

- Multimodal support (video, audio, images)
- `media_blob`, `video_segments`, `audio_segments`, `speakers`, `video_frames`, `images`
- New embedding model: Qwen3-VL-Embedding-2B (2048 dims)

### v1.1 / Schema 2 (2026-01-01)

- Model checkpoint support for reproducibility
- `model_checkpoint` table

### v1.0 / Schema 1 (2026-01-01)

- Initial release
- `metadata`, `pages`, `chunks`, `chunks_fts`, `embeddings`, `previews`
