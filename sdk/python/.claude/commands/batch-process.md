---
description: Batch process multiple PDFs to SPDF format with metadata from a CSV file or directory scan.
allowed-tools: Read, Write, Bash(python:*, python3:*), Glob, Grep
argument-hint: [pdf_directory] [output_directory]
---

# Batch Process PDFs to SPDF

Process multiple PDFs to SPDF format for citation matching.

## Arguments
- `$1`: Directory containing PDF files
- `$2`: Output directory for SPDF files (default: ./spdf)

## Context
- Current directory: !`pwd`
- PDF directory contents: !`ls "$1"/*.pdf 2>/dev/null | head -10 || ls *.pdf 2>/dev/null | head -10`

## Your Task

1. **Scan the PDF directory** for all PDF files
2. **For each PDF**, either:
   - Use existing metadata from metadata.csv if available
   - Extract metadata using pdf2bib or LLM
   - Request metadata from user if critical
3. **Process each PDF** to SPDF format
4. **Save to output directory**
5. **Report results** with success/failure counts

## Metadata CSV Format

If `metadata.csv` exists in the PDF directory, use it:

```csv
filename,citation_key,authors,year,title
paper1.pdf,smith2024,"John Smith; Jane Doe",2024,Paper Title
paper2.pdf,jones2023,Alice Jones,2023,Another Paper
```

## Code Template

```python
import os
import csv
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

from scholaris.auto_cite import ProcessedPDF

pdf_dir = Path("$1" or ".")
output_dir = Path("$2" or "./spdf")
output_dir.mkdir(exist_ok=True)

# Load metadata if available
metadata = {}
csv_path = pdf_dir / "metadata.csv"
if csv_path.exists():
    with open(csv_path, newline='', encoding='utf-8') as f:
        for row in csv.DictReader(f):
            metadata[row['filename']] = {
                'citation_key': row['citation_key'],
                'authors': row['authors'].split('; '),
                'year': int(row['year']),
                'title': row['title'],
            }

# Process PDFs
success, failed = 0, 0
for pdf_file in pdf_dir.glob("*.pdf"):
    spdf_path = output_dir / f"{pdf_file.stem}.spdf"

    if spdf_path.exists():
        print(f"Skip (exists): {pdf_file.name}")
        success += 1
        continue

    meta = metadata.get(pdf_file.name, {
        'citation_key': pdf_file.stem[:20],
        'authors': ['Unknown'],
        'year': 2020,
        'title': pdf_file.stem,
    })

    try:
        proc = ProcessedPDF.from_pdf(
            pdf_path=str(pdf_file),
            gemini_api_key=GEMINI_API_KEY,
            **meta
        )
        proc.save(str(spdf_path))
        print(f"Processed: {meta['citation_key']}")
        success += 1
    except Exception as e:
        print(f"Failed: {pdf_file.name} - {e}")
        failed += 1

print(f"\nResults: {success} processed, {failed} failed")
```

## Notes
- SPDF files already in output directory are skipped
- Without metadata.csv, basic metadata is extracted from filename
- For best results, provide accurate metadata
