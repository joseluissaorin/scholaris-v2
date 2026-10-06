"""Example demonstrating BibTeX generation and formatting (Phase 2).

This example shows how to:
1. Generate BibTeX from PDFs using pdf2bib (with LLM fallback)
2. Parse existing .bib files
3. Export BibTeX to .bib files
4. Format references in APA 7th edition

Requirements:
    - Set GEMINI_API_KEY environment variable (for LLM fallback)
    - Install pdf2bib: pip install pdf2bib
"""
import os
from pathlib import Path
from scholaris import Scholaris

def main():
    # Initialize Scholaris
    print("Initializing Scholaris...")
    scholar = Scholaris(
        gemini_api_key=os.getenv("GEMINI_API_KEY")
    )

    # Example 1: Generate BibTeX from PDFs
    print("\n" + "="*60)
    print("Example 1: Generate BibTeX from PDFs")
    print("="*60)

    # Assuming you have some PDFs (from Phase 1 search/download)
    pdf_dir = Path("./papers")

    if pdf_dir.exists():
        pdf_paths = list(pdf_dir.glob("*.pdf"))[:3]  # Take first 3 PDFs

        if pdf_paths:
            print(f"\nGenerating BibTeX for {len(pdf_paths)} PDFs...")

            # Try automatic method (pdf2bib first, then LLM fallback)
            bibtex_entries = scholar.generate_bibtex(
                pdf_paths=[str(p) for p in pdf_paths],
                method="auto"
            )

            print(f"\n✓ Generated {len(bibtex_entries)} BibTeX entries")

            # Display first entry
            if bibtex_entries:
                print("\nFirst BibTeX entry:")
                print(f"  ID: {bibtex_entries[0].get('ID', 'N/A')}")
                print(f"  Type: {bibtex_entries[0].get('ENTRYTYPE', 'N/A')}")
                print(f"  Title: {bibtex_entries[0].get('title', 'N/A')}")
                print(f"  Authors: {bibtex_entries[0].get('author', 'N/A')}")
                print(f"  Year: {bibtex_entries[0].get('year', 'N/A')}")

            # Example 2: Export BibTeX to .bib file
            print("\n" + "="*60)
            print("Example 2: Export BibTeX to .bib file")
            print("="*60)

            output_bib = "./references.bib"
            scholar.export_bibtex(bibtex_entries, output_bib)
            print(f"\n✓ Exported to {output_bib}")

            # Example 3: Parse the exported .bib file
            print("\n" + "="*60)
            print("Example 3: Parse existing .bib file")
            print("="*60)

            parsed_entries = scholar.parse_bibtex_file(output_bib)
            print(f"\n✓ Parsed {len(parsed_entries)} entries from {output_bib}")

            # Example 4: Format references in APA 7th edition
            print("\n" + "="*60)
            print("Example 4: Format references (APA 7th edition)")
            print("="*60)

            formatted_refs = scholar.format_references(
                bibtex_entries,
                style="APA7"
            )

            print("\nFormatted references:")
            print(formatted_refs)

            # Save formatted references to file
            with open("./formatted_references.md", "w") as f:
                f.write(formatted_refs)
            print("\n✓ Saved formatted references to ./formatted_references.md")

        else:
            print("\nNo PDFs found in ./papers directory")
            print("Run basic_usage.py first to download some papers")
    else:
        print("\n./papers directory not found")
        print("Run basic_usage.py first to download some papers")

    # Example 5: Direct BibTeX string parsing
    print("\n" + "="*60)
    print("Example 5: Parse BibTeX string directly")
    print("="*60)

    sample_bibtex = """
    @article{Smith2020,
        author = {Smith, John and Doe, Jane},
        title = {Deep Learning for Medical Diagnosis},
        journal = {Journal of Artificial Intelligence},
        year = {2020},
        volume = {15},
        pages = {123-145},
        doi = {10.1234/jai.2020.001}
    }

    @inproceedings{Jones2021,
        author = {Jones, Alice and Brown, Bob},
        title = {Neural Networks in Healthcare},
        booktitle = {Proceedings of the International Conference on AI},
        year = {2021},
        pages = {45-60}
    }
    """

    # Parse the BibTeX string
    from scholaris.converters.bibtex_parser import parse_bibtex

    parsed = parse_bibtex(sample_bibtex)
    print(f"\n✓ Parsed {len(parsed)} entries from BibTeX string")

    # Format them
    formatted = scholar.format_references(parsed, style="APA7")
    print("\nFormatted sample references:")
    print(formatted)

if __name__ == "__main__":
    main()
