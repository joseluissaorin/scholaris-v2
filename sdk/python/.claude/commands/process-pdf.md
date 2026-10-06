---
description: Process a PDF to SPDF format for scholaris citation matching. Extracts text via Vision OCR and generates embeddings.
allowed-tools: Read, Write, Bash(python:*, python3:*, file:*), Glob
argument-hint: [pdf_file] [citation_key] [authors] [year] [title]
---

# Process PDF to SPDF Format

Convert a PDF to scholaris SPDF format for citation matching.

## Arguments
- `$1`: PDF file path
- `$2`: Citation key (e.g., "smith2024")
- `$3`: Authors (semicolon-separated, e.g., "John Smith; Jane Doe")
- `$4`: Publication year
- `$5`: Document title

## Context
- Current directory: !`pwd`
- PDF files available: !`ls *.pdf 2>/dev/null || echo "No PDFs in current directory"`

## Your Task

1. **Verify the PDF exists** and is a valid PDF file
2. **Extract or request metadata** if not provided:
   - citation_key: derived from filename or first author + year
   - authors: list of author names
   - year: publication year
   - title: document title
3. **Process the PDF** using ProcessedPDF.from_pdf()
4. **Save as SPDF** in the same directory or ./spdf/

## Code Template

```python
import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

from scholaris.auto_cite import ProcessedPDF

pdf_path = "$1"
citation_key = "$2" or Path(pdf_path).stem[:20]
authors = "$3".split("; ") if "$3" else ["Unknown Author"]
year = int("$4") if "$4" else 2020
title = "$5" or Path(pdf_path).stem.replace("_", " ")

print(f"Processing: {pdf_path}")
print(f"  Key: {citation_key}")
print(f"  Authors: {authors}")
print(f"  Year: {year}")
print(f"  Title: {title}")

processed = ProcessedPDF.from_pdf(
    pdf_path=pdf_path,
    citation_key=citation_key,
    authors=authors,
    year=year,
    title=title,
    gemini_api_key=GEMINI_API_KEY,
)

output_path = Path(pdf_path).with_suffix(".spdf")
processed.save(str(output_path))
print(f"\nSaved: {output_path}")
print(f"  Pages: {len(processed.pages)}")
print(f"  Chunks: {len(processed.chunks)}")
```

## Notes
- SPDF files are reusable - process once, cite many times
- Include previews only if recovery is needed (increases file size)
- Language is auto-detected from text content
