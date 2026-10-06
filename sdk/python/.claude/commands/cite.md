---
description: Cite an academic document using scholaris bibliography. Generates in-text citations with verified page numbers.
allowed-tools: Read, Write, Edit, Bash(python:*, python3:*), Glob, Grep
argument-hint: [input_file] [bibliography_dir]
---

# Cite Academic Document with Scholaris

You are helping the user cite an academic document using the scholaris citation system.

## Arguments
- `$1`: Input document file (markdown, docx, or txt)
- `$2`: Bibliography directory containing PDFs or SPDF files

## Context
- Current directory: !`pwd`
- Available files: !`ls -la 2>/dev/null | head -20`

## Your Task

1. **Identify the input file and bibliography directory** from the arguments or current context
2. **Check for existing SPDF files** in the bibliography directory
3. **Process any unprocessed PDFs** to SPDF format with appropriate metadata
4. **Generate citations** using CitationIndex and cite_document()
5. **Save the output** as `{input_name}_cited.{extension}` and optionally as markdown

## Code Template

```python
import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

from scholaris.auto_cite import CitationIndex, CitationStyle

# Load bibliography
index = CitationIndex.from_bibliography(
    folder="$2" or "./spdf",
    gemini_api_key=GEMINI_API_KEY,
    auto_process=True,
    save_processed=True,
)

# Read document
with open("$1", "r") as f:
    doc_text = f.read()

# Generate citations
result = index.cite_document(
    document_text=doc_text,
    style=CitationStyle.APA7,
    batch_size=3,
    min_confidence=0.6,
    include_bibliography=True,
)

# Save
output_path = Path("$1").stem + "_cited.md"
with open(output_path, "w") as f:
    f.write(result.modified_document)

print(f"Citations: {result.metadata['total_citations']}")
print(f"Output: {output_path}")
```

## Output
- Report the number of citations generated
- List the sources used
- Confirm the output file location
