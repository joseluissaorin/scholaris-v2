#!/usr/bin/env python3
"""
Scholaris: Process a PDF to SPDF format.

Usage:
    python process_pdf.py <pdf_file> [--key KEY] [--authors AUTHORS] [--year YEAR] [--title TITLE]

Examples:
    python process_pdf.py paper.pdf --key smith2024 --authors "John Smith" --year 2024 --title "Paper Title"
    python process_pdf.py paper.pdf  # Uses auto-extracted metadata
"""

import argparse
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

if not GEMINI_API_KEY:
    print("Error: GEMINI_API_KEY not set in environment")
    sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Process PDF to SPDF format")
    parser.add_argument("pdf_file", help="Path to PDF file")
    parser.add_argument("--key", "-k", help="Citation key (default: filename)")
    parser.add_argument("--authors", "-a", help="Authors (semicolon-separated)")
    parser.add_argument("--year", "-y", type=int, help="Publication year")
    parser.add_argument("--title", "-t", help="Document title")
    parser.add_argument("--output", "-o", help="Output SPDF path")
    parser.add_argument("--previews", action="store_true", help="Include page previews")

    args = parser.parse_args()

    pdf_path = Path(args.pdf_file)
    if not pdf_path.exists():
        print(f"Error: File not found: {pdf_path}")
        sys.exit(1)

    # Default values
    citation_key = args.key or pdf_path.stem[:30].replace(" ", "_")
    authors = args.authors.split("; ") if args.authors else ["Unknown Author"]
    year = args.year or 2020
    title = args.title or pdf_path.stem.replace("_", " ")
    output_path = args.output or str(pdf_path.with_suffix(".spdf"))

    print(f"Processing: {pdf_path.name}")
    print(f"  Citation key: {citation_key}")
    print(f"  Authors: {', '.join(authors)}")
    print(f"  Year: {year}")
    print(f"  Title: {title}")

    from scholaris.auto_cite import ProcessedPDF

    try:
        processed = ProcessedPDF.from_pdf(
            pdf_path=str(pdf_path),
            citation_key=citation_key,
            authors=authors,
            year=year,
            title=title,
            gemini_api_key=GEMINI_API_KEY,
            include_previews=args.previews,
        )
        processed.save(output_path)
        print(f"\nSaved: {output_path}")
        print(f"  Pages: {len(processed.pages)}")
        print(f"  Chunks: {len(processed.chunks)}")
    except Exception as e:
        print(f"\nError: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
