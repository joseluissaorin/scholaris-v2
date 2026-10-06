#!/usr/bin/env python3
"""
Scholaris: Cite a document using a bibliography folder.

Usage:
    python cite_document.py <input_file> <bibliography_dir> [output_file]

Examples:
    python cite_document.py paper.md ./spdf paper_cited.md
    python cite_document.py thesis.docx ./bibliography thesis_cited.docx
"""

import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Load environment
load_dotenv()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

if not GEMINI_API_KEY:
    print("Error: GEMINI_API_KEY not set in environment")
    sys.exit(1)


def read_document(path: str) -> str:
    """Read document content based on file type."""
    path = Path(path)

    if path.suffix == ".docx":
        from docx import Document
        doc = Document(str(path))
        return "\n\n".join([p.text for p in doc.paragraphs if p.text.strip()])
    elif path.suffix in [".md", ".txt"]:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    else:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()


def save_document(content: str, path: str):
    """Save document based on file type."""
    path = Path(path)

    if path.suffix == ".docx":
        from scholaris.converters.docx_converter import DocxConverter
        converter = DocxConverter(output_folder=str(path.parent) or ".")
        converter.convert(content, str(path))
    else:
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    input_file = sys.argv[1]
    bibliography_dir = sys.argv[2]
    output_file = sys.argv[3] if len(sys.argv) > 3 else None

    if not output_file:
        input_path = Path(input_file)
        output_file = str(input_path.parent / f"{input_path.stem}_cited{input_path.suffix}")

    print(f"Input: {input_file}")
    print(f"Bibliography: {bibliography_dir}")
    print(f"Output: {output_file}")

    # Import scholaris
    from scholaris.auto_cite import CitationIndex, CitationStyle

    # Read document
    print("\nReading document...")
    doc_text = read_document(input_file)
    print(f"  {len(doc_text)} characters")

    # Load bibliography
    print("\nLoading bibliography...")
    index = CitationIndex.from_bibliography(
        folder=bibliography_dir,
        gemini_api_key=GEMINI_API_KEY,
        auto_process=True,
        save_processed=True,
    )
    print(f"  {len(index)} sources, {index.total_chunks} chunks")

    # Generate citations
    print("\nGenerating citations...")
    result = index.cite_document(
        document_text=doc_text,
        style=CitationStyle.APA7,
        batch_size=3,
        min_confidence=0.6,
        include_bibliography=True,
    )

    # Save output
    print("\nSaving output...")
    save_document(result.modified_document, output_file)

    # Report
    print(f"\n{'='*50}")
    print("Results:")
    print(f"  Total citations: {result.metadata.get('total_citations', 0)}")
    print(f"  Framework rewrites: {result.metadata.get('framework_rewrites', 0)}")
    sources = result.metadata.get('sources_used', [])
    if sources:
        print(f"  Sources used: {', '.join(sources[:5])}")
    print(f"\nOutput saved to: {output_file}")


if __name__ == "__main__":
    main()
