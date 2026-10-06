# Scholaris Workflows

Common workflow patterns for academic citation tasks.

---

## Table of Contents

1. [Complete Citation Workflow](#complete-citation-workflow)
2. [Bibliography Building](#bibliography-building)
3. [Batch PDF Processing](#batch-pdf-processing)
4. [Web Search and Download](#web-search-and-download)
5. [Document Conversion](#document-conversion)
6. [Citation Analysis](#citation-analysis)
7. [Multi-Language Support](#multi-language-support)

---

## Complete Citation Workflow

End-to-end workflow for citing an academic document.

```python
#!/usr/bin/env python3
"""Complete citation workflow for academic papers."""

import os
from pathlib import Path
from dotenv import load_dotenv
from docx import Document

# Load environment
load_dotenv()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

from scholaris.auto_cite import CitationIndex, CitationStyle, ProcessedPDF
from scholaris.converters.docx_converter import DocxConverter


def read_docx(path: str) -> str:
    """Read text from a Word document."""
    doc = Document(path)
    return "\n\n".join([p.text for p in doc.paragraphs if p.text.strip()])


def process_bibliography(pdf_dir: str, spdf_dir: str, metadata: dict) -> list:
    """Process PDFs to SPDF format with metadata."""
    os.makedirs(spdf_dir, exist_ok=True)
    processed = []

    for pdf_file in Path(pdf_dir).glob("*.pdf"):
        spdf_path = Path(spdf_dir) / f"{pdf_file.stem}.spdf"

        if spdf_path.exists():
            print(f"  Already processed: {pdf_file.name}")
            processed.append(str(spdf_path))
            continue

        meta = metadata.get(pdf_file.name, {
            "citation_key": pdf_file.stem[:20],
            "authors": ["Unknown"],
            "year": 2020,
            "title": pdf_file.stem,
        })

        try:
            proc = ProcessedPDF.from_pdf(
                pdf_path=str(pdf_file),
                gemini_api_key=GEMINI_API_KEY,
                **meta
            )
            proc.save(str(spdf_path))
            processed.append(str(spdf_path))
            print(f"  Processed: {pdf_file.name}")
        except Exception as e:
            print(f"  Failed: {pdf_file.name} - {e}")

    return processed


def cite_document(doc_text: str, spdf_dir: str) -> tuple:
    """Generate citations for document."""
    index = CitationIndex.from_bibliography(
        folder=spdf_dir,
        gemini_api_key=GEMINI_API_KEY,
        auto_process=False,
    )

    print(f"Loaded {len(index)} sources, {index.total_chunks} chunks")

    result = index.cite_document(
        document_text=doc_text,
        style=CitationStyle.APA7,
        batch_size=3,
        min_confidence=0.6,
        include_bibliography=True,
    )

    return result.modified_document, result


def main():
    # Configuration
    input_file = "paper.docx"
    pdf_dir = "./pdfs"
    spdf_dir = "./spdf"
    output_md = "paper_cited.md"
    output_docx = "paper_cited.docx"

    # PDF metadata (customize per project)
    pdf_metadata = {
        "source1.pdf": {
            "citation_key": "smith2024",
            "authors": ["John Smith"],
            "year": 2024,
            "title": "Title of Source 1",
        },
        # Add more...
    }

    # Step 1: Read document
    print("Reading document...")
    doc_text = read_docx(input_file)

    # Step 2: Process PDFs
    print("Processing PDFs...")
    process_bibliography(pdf_dir, spdf_dir, pdf_metadata)

    # Step 3: Generate citations
    print("Generating citations...")
    cited_text, result = cite_document(doc_text, spdf_dir)

    # Step 4: Save outputs
    print("Saving outputs...")
    with open(output_md, "w") as f:
        f.write(cited_text)

    converter = DocxConverter(output_folder=".")
    converter.convert(cited_text, output_docx)

    # Report
    print(f"\nResults:")
    print(f"  Citations: {result.metadata.get('total_citations', 0)}")
    print(f"  Sources: {', '.join(result.metadata.get('sources_used', []))}")
    print(f"  Output: {output_md}, {output_docx}")


if __name__ == "__main__":
    main()
```

---

## Bibliography Building

Build a bibliography from scratch by searching and downloading papers.

```python
#!/usr/bin/env python3
"""Build bibliography from topic search."""

import os
from dotenv import load_dotenv

load_dotenv()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

from scholaris import Scholaris
from scholaris.auto_cite import ProcessedPDF


def build_bibliography(topic: str, output_dir: str = "./bibliography"):
    """Search, download, and process papers on a topic."""

    scholar = Scholaris(gemini_api_key=GEMINI_API_KEY)
    os.makedirs(output_dir, exist_ok=True)
    os.makedirs(f"{output_dir}/spdf", exist_ok=True)

    # Search for papers
    print(f"Searching for: {topic}")
    papers = scholar.search_papers(
        topic=topic,
        max_papers=10,
        min_year=2018,
    )
    print(f"Found {len(papers)} papers")

    # Download PDFs
    print("Downloading PDFs...")
    downloaded = scholar.download_papers(papers, output_dir=output_dir)
    print(f"Downloaded {len(downloaded)} PDFs")

    # Generate BibTeX
    print("Generating BibTeX...")
    bibtex = scholar.generate_bibtex(downloaded, method="auto")
    scholar.export_bibtex(bibtex, f"{output_dir}/references.bib")
    print(f"Saved {len(bibtex)} BibTeX entries")

    # Process to SPDF
    print("Processing to SPDF format...")
    for i, (pdf_path, entry) in enumerate(zip(downloaded, bibtex)):
        try:
            # Extract metadata from BibTeX
            authors = entry.get("author", "Unknown").split(" and ")
            year = int(entry.get("year", 2020))
            title = entry.get("title", f"Paper {i}")
            key = entry.get("ID", f"paper{i}")

            proc = ProcessedPDF.from_pdf(
                pdf_path=pdf_path,
                citation_key=key,
                authors=authors,
                year=year,
                title=title,
                gemini_api_key=GEMINI_API_KEY,
            )
            spdf_path = f"{output_dir}/spdf/{key}.spdf"
            proc.save(spdf_path)
            print(f"  Processed: {key}")
        except Exception as e:
            print(f"  Failed: {pdf_path} - {e}")

    print(f"\nBibliography ready in {output_dir}/")


if __name__ == "__main__":
    build_bibliography("transformer attention mechanisms NLP")
```

---

## Batch PDF Processing

Process multiple PDFs with metadata from a CSV file.

```python
#!/usr/bin/env python3
"""Batch process PDFs from CSV metadata."""

import csv
import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

from scholaris.auto_cite import ProcessedPDF


def load_metadata_csv(csv_path: str) -> dict:
    """Load PDF metadata from CSV file.

    CSV format:
    filename,citation_key,authors,year,title
    paper1.pdf,smith2024,"John Smith; Jane Doe",2024,Paper Title
    """
    metadata = {}
    with open(csv_path, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            metadata[row['filename']] = {
                'citation_key': row['citation_key'],
                'authors': row['authors'].split('; '),
                'year': int(row['year']),
                'title': row['title'],
            }
    return metadata


def batch_process(pdf_dir: str, csv_path: str, output_dir: str):
    """Process all PDFs using metadata from CSV."""

    metadata = load_metadata_csv(csv_path)
    os.makedirs(output_dir, exist_ok=True)

    success = 0
    failed = 0

    for pdf_file in Path(pdf_dir).glob("*.pdf"):
        if pdf_file.name not in metadata:
            print(f"No metadata for: {pdf_file.name}")
            continue

        meta = metadata[pdf_file.name]
        spdf_path = Path(output_dir) / f"{meta['citation_key']}.spdf"

        if spdf_path.exists():
            print(f"Already exists: {spdf_path.name}")
            success += 1
            continue

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


if __name__ == "__main__":
    batch_process(
        pdf_dir="./pdfs",
        csv_path="./metadata.csv",
        output_dir="./spdf"
    )
```

**Example metadata.csv:**
```csv
filename,citation_key,authors,year,title
paper1.pdf,smith2024,John Smith; Jane Doe,2024,Understanding Neural Networks
paper2.pdf,jones2023,Alice Jones,2023,Deep Learning Fundamentals
paper3.pdf,brown2022,Bob Brown; Carol White,2022,Transformer Architectures
```

---

## Web Search and Download

Download papers from web search results.

```python
#!/usr/bin/env python3
"""Download PDFs from web search results."""

import os
import subprocess
from pathlib import Path

def download_from_urls(urls: list, output_dir: str) -> list:
    """Download PDFs from a list of URLs."""
    os.makedirs(output_dir, exist_ok=True)
    downloaded = []

    for i, url in enumerate(urls):
        filename = f"paper_{i+1}.pdf"
        output_path = Path(output_dir) / filename

        try:
            subprocess.run([
                "curl", "-L", "-o", str(output_path), url
            ], check=True, capture_output=True)

            # Verify it's a PDF
            result = subprocess.run(
                ["file", str(output_path)],
                capture_output=True, text=True
            )
            if "PDF" in result.stdout:
                downloaded.append(str(output_path))
                print(f"Downloaded: {filename}")
            else:
                os.remove(output_path)
                print(f"Not a PDF: {url}")
        except Exception as e:
            print(f"Failed: {url} - {e}")

    return downloaded


# Example usage with search results
urls = [
    "https://example.com/paper1.pdf",
    "https://example.com/paper2.pdf",
]

downloaded = download_from_urls(urls, "./pdfs")
print(f"Downloaded {len(downloaded)} PDFs")
```

---

## Document Conversion

Convert between different document formats.

```python
#!/usr/bin/env python3
"""Convert documents between formats."""

import os
from scholaris.converters.docx_converter import DocxConverter
from scholaris.converters.html_converter import HtmlConverter


def markdown_to_docx(md_path: str, docx_path: str):
    """Convert Markdown to Word document."""
    with open(md_path, 'r', encoding='utf-8') as f:
        content = f.read()

    output_dir = os.path.dirname(docx_path) or "."
    converter = DocxConverter(output_folder=output_dir)
    converter.convert(content, docx_path)
    print(f"Created: {docx_path}")


def markdown_to_html(md_path: str, html_path: str, include_css: bool = True):
    """Convert Markdown to HTML with optional styling."""
    with open(md_path, 'r', encoding='utf-8') as f:
        content = f.read()

    converter = HtmlConverter()
    converter.convert(content, html_path, include_css=include_css)
    print(f"Created: {html_path}")


def docx_to_markdown(docx_path: str) -> str:
    """Extract text from Word document as Markdown."""
    from docx import Document

    doc = Document(docx_path)
    paragraphs = []

    for para in doc.paragraphs:
        if para.text.strip():
            # Check for headings
            if para.style.name.startswith('Heading'):
                level = int(para.style.name[-1]) if para.style.name[-1].isdigit() else 1
                paragraphs.append(f"{'#' * level} {para.text}")
            else:
                paragraphs.append(para.text)

    return "\n\n".join(paragraphs)


# Example usage
if __name__ == "__main__":
    # Convert cited markdown to both formats
    markdown_to_docx("paper_cited.md", "paper_cited.docx")
    markdown_to_html("paper_cited.md", "paper_cited.html")
```

---

## Citation Analysis

Analyze citation results and generate reports.

```python
#!/usr/bin/env python3
"""Analyze citation results."""

from collections import Counter
from scholaris.auto_cite import CitationIndex, CitationStyle, export_citations_to_csv
import os
from dotenv import load_dotenv

load_dotenv()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")


def analyze_citations(result):
    """Generate citation analysis report."""

    citations = result.citations
    metadata = result.metadata

    # Count by type
    type_counts = Counter(str(c.citation_type) for c in citations)

    # Count by source
    source_counts = Counter(c.citation_key for c in citations)

    # Confidence distribution
    confidences = [c.confidence for c in citations]
    avg_confidence = sum(confidences) / len(confidences) if confidences else 0

    # Framework rewrites
    rewrites = [c for c in citations if c.suggested_rewrite]

    report = f"""
# Citation Analysis Report

## Summary
- Total citations: {metadata.get('total_citations', 0)}
- Successful insertions: {metadata.get('successful_insertions', 0)}
- Framework rewrites: {len(rewrites)}
- Average confidence: {avg_confidence:.2%}

## Citation Types
"""
    for ctype, count in type_counts.most_common():
        report += f"- {ctype}: {count}\n"

    report += "\n## Sources Used\n"
    for source, count in source_counts.most_common():
        report += f"- {source}: {count} citations\n"

    if rewrites:
        report += "\n## Framework Rewrites\n"
        for r in rewrites[:5]:
            report += f"\n### {r.citation_key}\n"
            report += f"- Original: {r.claim_text[:100]}...\n"
            report += f"- Rewrite: {r.suggested_rewrite[:100]}...\n"

    return report


def main():
    # Load and cite document
    with open("paper.md", "r") as f:
        doc_text = f.read()

    index = CitationIndex.from_bibliography(
        folder="./spdf",
        gemini_api_key=GEMINI_API_KEY,
    )

    result = index.cite_document(
        document_text=doc_text,
        style=CitationStyle.APA7,
    )

    # Generate report
    report = analyze_citations(result)
    print(report)

    with open("citation_report.md", "w") as f:
        f.write(report)

    # Export to CSV
    export_citations_to_csv(result.citations, "citations.csv")
    print("Exported citations to citations.csv")


if __name__ == "__main__":
    main()
```

---

## Multi-Language Support

Work with documents and sources in different languages.

```python
#!/usr/bin/env python3
"""Cross-lingual citation matching."""

import os
from dotenv import load_dotenv

load_dotenv()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

from scholaris.auto_cite import CitationIndex, CitationStyle, ProcessedPDF


def process_multilingual_bibliography():
    """Process sources in multiple languages."""

    # Spanish source
    es_proc = ProcessedPDF.from_pdf(
        pdf_path="fuente_espanol.pdf",
        citation_key="garcia2023",
        authors=["María García"],
        year=2023,
        title="Análisis de Discurso",
        gemini_api_key=GEMINI_API_KEY,
    )
    es_proc.save("spdf/garcia2023.spdf")

    # English source
    en_proc = ProcessedPDF.from_pdf(
        pdf_path="english_source.pdf",
        citation_key="smith2024",
        authors=["John Smith"],
        year=2024,
        title="Discourse Analysis",
        gemini_api_key=GEMINI_API_KEY,
    )
    en_proc.save("spdf/smith2024.spdf")

    # French source
    fr_proc = ProcessedPDF.from_pdf(
        pdf_path="source_francais.pdf",
        citation_key="dupont2022",
        authors=["Jean Dupont"],
        year=2022,
        title="Analyse du Discours",
        gemini_api_key=GEMINI_API_KEY,
    )
    fr_proc.save("spdf/dupont2022.spdf")


def cite_spanish_document():
    """Cite a Spanish document with English/French sources."""

    with open("documento_espanol.md", "r", encoding="utf-8") as f:
        spanish_doc = f.read()

    index = CitationIndex.from_bibliography(
        folder="./spdf",
        gemini_api_key=GEMINI_API_KEY,
    )

    # Scholaris handles cross-lingual matching automatically
    result = index.cite_document(
        document_text=spanish_doc,
        style=CitationStyle.APA7,
    )

    with open("documento_citado.md", "w", encoding="utf-8") as f:
        f.write(result.modified_document)

    print(f"Cross-lingual citations: {result.metadata['total_citations']}")


if __name__ == "__main__":
    process_multilingual_bibliography()
    cite_spanish_document()
```

---

## Tips for Each Workflow

### Complete Citation Workflow
- Always provide metadata for better matching
- Use SPDF caching to avoid reprocessing
- Review framework rewrites for accuracy

### Bibliography Building
- Start with specific search terms
- Verify downloaded PDFs are valid
- Generate BibTeX before processing

### Batch Processing
- Use CSV for managing large bibliographies
- Process in parallel if needed
- Keep backups of SPDF files

### Web Search and Download
- Verify files are actually PDFs
- Respect copyright and access rights
- Use Sci-Hub responsibly (legal status varies)

### Document Conversion
- Preserve formatting during conversion
- Test output in target application
- Keep original files as backup

### Citation Analysis
- Review low-confidence citations
- Check temporal logic warnings
- Export to CSV for detailed analysis

### Multi-Language Support
- Language is auto-detected from text
- Cross-lingual matching works automatically
- Use appropriate quotation marks per language
