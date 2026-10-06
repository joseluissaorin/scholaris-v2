---
description: Search for academic papers on a topic and download PDFs using scholaris.
allowed-tools: Read, Write, Bash(python:*, python3:*, curl:*), WebSearch, WebFetch, Glob
argument-hint: [topic] [max_papers]
---

# Search and Download Academic Papers

Search for papers on a topic using scholaris and download PDFs.

## Arguments
- `$1`: Research topic or search query
- `$2`: Maximum number of papers (default: 10)

## Context
- Current directory: !`pwd`
- Existing PDFs: !`ls *.pdf 2>/dev/null | wc -l`

## Your Task

1. **Initialize Scholaris** with Gemini API key
2. **Search for papers** on the given topic
3. **Download PDFs** to ./papers/ directory
4. **Generate BibTeX** entries
5. **Report results** with paper titles and paths

## Code Template

```python
import os
from dotenv import load_dotenv

load_dotenv()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

from scholaris import Scholaris

scholar = Scholaris(gemini_api_key=GEMINI_API_KEY)

# Search
topic = "$1" or "machine learning"
max_papers = int("$2") if "$2" else 10

print(f"Searching for: {topic}")
papers = scholar.search_papers(
    topic=topic,
    max_papers=max_papers,
    min_year=2018,
)
print(f"Found {len(papers)} papers")

# Download
downloaded = scholar.download_papers(papers, output_dir="./papers")
print(f"Downloaded {len(downloaded)} PDFs")

# Generate BibTeX
if downloaded:
    bibtex = scholar.generate_bibtex(downloaded, method="auto")
    scholar.export_bibtex(bibtex, "./papers/references.bib")
    print(f"Saved {len(bibtex)} BibTeX entries")

# List results
for paper in papers:
    print(f"  - {paper.title} ({paper.year})")
```

## Alternative: Web Search

If PyPaperBot fails, use web search to find PDFs:

1. Search for academic papers on the topic
2. Look for direct PDF links from:
   - Google Scholar
   - ResearchGate
   - Academia.edu
   - University repositories
   - arXiv.org
3. Download PDFs using curl

## Notes
- Sci-Hub can be used but legal status varies by jurisdiction
- Always respect copyright and access rights
- Some papers may require institutional access
