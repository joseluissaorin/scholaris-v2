---
name: scholaris
description: AI-powered academic citation system. Use when working with academic papers, PDFs, bibliography management, generating in-text citations, processing research documents, or when the user mentions citations, bibliography, academic writing, SPDF files, or reference management. Automatically inserts verified page-number citations into documents.
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash(python:*, python3:*, pip:*, curl:*, scholaris:*)
  - Grep
  - Glob
  - WebSearch
  - WebFetch
---

# Scholaris - AI-Powered Academic Citation System

Scholaris automatically inserts in-text citations with verified page numbers into academic documents. It uses Vision OCR, semantic RAG, and temporal logic to ensure accurate, grounded citations.

## CLI Commands (Recommended)

The fastest way to use scholaris is via CLI:

```bash
# Auto-cite a document using pre-processed SPDF bibliography
scholaris cite paper.md ./spdf -o paper_cited.md

# Process a PDF to SPDF format (with auto-metadata extraction)
scholaris process paper.pdf --auto-metadata
scholaris process paper.pdf --key smith2024 --authors "John Smith" --year 2024 --title "Paper Title"

# Extract metadata from all PDFs in a directory (hybrid AI approach)
scholaris extract ./pdfs -o bibliography.xlsx
scholaris extract ./pdfs -o refs.bib --format bibtex

# Export SPDF bibliography to various formats
scholaris export ./spdf bibliography.xlsx
scholaris export ./spdf refs.bib --format bibtex
scholaris export ./spdf refs.csv --format csv
scholaris export ./spdf refs.json --format json

# Show info about SPDF collection
scholaris info ./spdf

# Install Claude Code skills globally
scholaris install-skills --global
```

## Key Pattern: CitationIndex with Pre-Processed SPDF Files

**This is the simplest and most efficient approach** for citing documents when you already have SPDF files:

```python
from scholaris.auto_cite.citation_index import CitationIndex
from scholaris.auto_cite.models import CitationStyle

# Load all SPDF files from a directory (KEY FIX: use add_directory())
index = CitationIndex(gemini_api_key=GEMINI_API_KEY)
count = index.add_directory("./spdf")
print(f"Loaded {count} sources ({index.total_chunks} chunks)")

# Read and cite document
document_text = Path("paper.md").read_text()
result = index.cite_document(
    document_text=document_text,
    style=CitationStyle.APA7,
    min_confidence=0.5,
    include_bibliography=True,
)

# Save
Path("paper_cited.md").write_text(result.modified_document)
print(f"Inserted {result.metadata['total_citations']} citations")
```

**Why this works:**
- `CitationIndex.add_directory()` loads pre-computed embeddings from SPDF files
- No re-processing or re-embedding needed
- Vector search happens in-memory using numpy
- No external database (ChromaDB) required

## Quick Start

### 1. Setup Environment

```python
import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

from scholaris.auto_cite import CitationIndex, CitationStyle
from scholaris.auto_cite.processed_pdf import ProcessedPDF
```

### 2. Process a PDF to SPDF Format

```python
processed = ProcessedPDF.from_pdf(
    pdf_path="paper.pdf",
    citation_key="smith2024",
    authors=["John Smith", "Jane Doe"],
    year=2024,
    title="Understanding Neural Networks",
    gemini_api_key=GEMINI_API_KEY,
    include_previews=False,
)
processed.save("paper.spdf")
```

### 3. Cite a Document (Two Approaches)

#### Approach A: Pre-processed SPDF files (Recommended)

```python
# Load bibliography from folder of .spdf files
index = CitationIndex(gemini_api_key=GEMINI_API_KEY)
index.add_directory("./spdf")

# Generate citations
result = index.cite_document(
    document_text=Path("paper.md").read_text(),
    style=CitationStyle.APA7,
    min_confidence=0.5,
    include_bibliography=True,
)

Path("paper_cited.md").write_text(result.modified_document)
```

#### Approach B: Auto-process PDFs on the fly

```python
# Load and auto-process any unprocessed PDFs
index = CitationIndex.from_bibliography(
    folder="./bibliography/",
    gemini_api_key=GEMINI_API_KEY,
    auto_process=True,
    save_processed=True,
)

result = index.cite_document(
    document_text="Your academic paper text...",
    style=CitationStyle.APA7,
)
```

## Core Concepts

### SPDF Format (Shareable Processed PDF)
- **Process once, use forever** - No re-processing needed
- Contains: OCR text, embeddings, page metadata, language detection
- Extensions: `.spdf`, `.scholaris`, `.scpdf`
- Size: ~1.5 MB per 15-page article

### Citation Types
| Type | Description |
|------|-------------|
| `DIRECT_SUPPORT` | Source directly makes this claim |
| `FRAMEWORK_APPLICATION` | Applying older theory to new domain |
| `BACKGROUND_CONTEXT` | General domain knowledge |
| `TEMPORAL_IMPOSSIBLE` | Source predates the concept |

### Citation Styles
- `CitationStyle.APA7` - APA 7th Edition
- `CitationStyle.CHICAGO17` - Chicago 17th Edition

## Common Tasks

### Batch Process PDFs

```python
pdf_metadata = {
    "paper1.pdf": {"citation_key": "smith2024", "authors": ["Smith"], "year": 2024, "title": "Title 1"},
    "paper2.pdf": {"citation_key": "jones2023", "authors": ["Jones"], "year": 2023, "title": "Title 2"},
}

for pdf_file, meta in pdf_metadata.items():
    processed = ProcessedPDF.from_pdf(
        pdf_path=pdf_file,
        gemini_api_key=GEMINI_API_KEY,
        **meta
    )
    processed.save(f"./spdf/{meta['citation_key']}.spdf")
```

### Search for Papers

```python
from scholaris import Scholaris

scholar = Scholaris(gemini_api_key=GEMINI_API_KEY)
papers = scholar.search_papers(
    topic="machine learning transformers",
    max_papers=10,
    min_year=2020,
)
```

### Generate BibTeX

```python
bibtex_entries = scholar.generate_bibtex(
    pdf_paths=["paper1.pdf", "paper2.pdf"],
    method="auto",
)
scholar.export_bibtex(bibtex_entries, "references.bib")
```

## CLI Reference

```bash
# Cite a document
scholaris cite <document> <spdf_dir> [options]
  -o, --output        Output file path
  --style            Citation style: apa, chicago (default: apa)
  --confidence       Min confidence threshold (default: 0.5)
  --max-citations    Max citations per claim (default: 2)
  --no-bibliography  Don't append bibliography
  -v, --verbose      Verbose output

# Process PDF to SPDF
scholaris process <pdf> [options]
  -o, --output       Output SPDF file path
  --output-dir       Output directory
  --key             Citation key
  --authors         Authors (comma-separated)
  --year            Publication year
  --title           Document title
  --no-previews     Skip page preview images
  --auto-metadata   Auto-extract metadata using hybrid AI approach

# Extract metadata from PDFs (hybrid approach: Gemini Vision + pdf2bib)
scholaris extract <pdf_dir> [options]
  -o, --output       Output file path
  --format          Output format: xlsx, csv, bibtex, json (default: xlsx)
  --delay           API rate limit delay in seconds (default: 1.0)
  -v, --verbose      Verbose output

# Export SPDF bibliography
scholaris export <spdf_dir> <output> [options]
  --format          Output format: xlsx, csv, bibtex, json (auto-detected)

# Show SPDF collection info
scholaris info <spdf_dir>

# Install Claude Code skills
scholaris install-skills [--global]
```

## Hybrid Metadata Extraction

Scholaris uses a hybrid approach to extract accurate bibliographic metadata:

1. **pdf2bib** - Looks up DOI/ISBN from PDF metadata (highest confidence when found)
2. **Gemini Vision** - OCR of title pages for visual extraction (great for scanned/academic PDFs)
3. **PDF internal metadata** - Reads embedded PDF metadata (often incomplete)
4. **Filename parsing** - Extracts hints from common filename patterns (fallback)

Results are intelligently merged with higher confidence sources taking precedence.

```python
from scholaris.auto_cite.metadata_extractor import (
    HybridMetadataExtractor,
    BibliographyExporter,
    batch_extract_metadata,
)

# Single PDF extraction
extractor = HybridMetadataExtractor(gemini_api_key=API_KEY)
metadata = extractor.extract("paper.pdf")
print(f"Title: {metadata.title}")
print(f"Authors: {', '.join(metadata.authors)}")
print(f"Year: {metadata.year}")
print(f"Confidence: {metadata.confidence:.2f}")

# Batch extraction with export
results = batch_extract_metadata(
    pdf_paths=["paper1.pdf", "paper2.pdf", "paper3.pdf"],
    gemini_api_key=API_KEY,
    rate_limit_delay=1.0,
)

# Export to various formats
BibliographyExporter.to_xlsx(results, "bibliography.xlsx")
BibliographyExporter.to_bibtex(results, "references.bib")
BibliographyExporter.to_csv(results, "bibliography.csv")
BibliographyExporter.to_json(results, "bibliography.json")
```

## Workflow Patterns

For detailed workflows, see [WORKFLOWS.md](WORKFLOWS.md).

For complete API reference, see [REFERENCE.md](REFERENCE.md).

## Requirements

- Python 3.9+
- Gemini API Key (set as `GEMINI_API_KEY` environment variable)
- Dependencies: `pip install scholaris` or from git

## File Locations

| Purpose | Typical Location |
|---------|------------------|
| Source PDFs | `./pdfs/` or `./bibliography/` |
| Processed SPDFs | `./spdf/` or same as PDFs |
| Output documents | Same directory as input |
| Environment file | `.env` in project root |

## Error Handling

```python
try:
    result = index.cite_document(document_text, style=CitationStyle.APA7)
except Exception as e:
    print(f"Citation failed: {e}")
    # Fallback: return original document
```

## Tips

1. **Use CLI for quick tasks** - `scholaris cite` is faster than writing scripts
2. **Pre-process SPDF files** - Process once, reuse forever
3. **Use add_directory()** - The key pattern for loading pre-processed SPDFs
4. **Set appropriate confidence** - 0.5 is a good default, lower for more citations
5. **Check temporal logic** - Scholaris detects anachronistic citations automatically
6. **Review framework rewrites** - When citing old theories for new concepts
