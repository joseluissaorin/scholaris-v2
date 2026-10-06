"""Example demonstrating export formats and complete workflow (Phase 4).

This example shows how to:
1. Use the complete_workflow() method for end-to-end processing
2. Export reviews to multiple formats (Markdown, DOCX, HTML)
3. Integrate user-provided PDFs and BibTeX files
4. Customize output and formatting

Requirements:
    - Set GEMINI_API_KEY environment variable
    - Install: pip install PyPaperBot pdf2bib bibtexparser google-generativeai python-docx
"""
import os
from scholaris import Scholaris

def main():
    # Initialize Scholaris
    gemini_key = os.getenv("GEMINI_API_KEY")
    if not gemini_key:
        print("ERROR: GEMINI_API_KEY environment variable not set!")
        print("Set it with: export GEMINI_API_KEY='your-api-key'")
        return

    print("Initializing Scholaris...")
    scholar = Scholaris(gemini_api_key=gemini_key)

    # Example 1: Complete workflow with automatic search
    print("\n" + "="*60)
    print("Example 1: Complete Workflow (Auto Search + Export)")
    print("="*60)

    print("\n1. Running complete workflow...")
    print("   This will: search papers → download PDFs → generate BibTeX → generate review")

    review = scholar.complete_workflow(
        topic="Artificial Intelligence in Education",
        auto_search=True,
        max_papers=5,  # Limit for demo
        min_year=2021,
        sections=["Introduction", "Current Applications", "Challenges"],
        min_words_per_section=400,  # Reduced for demo
        language="English",
        output_format="markdown",  # Will save automatically
        output_path="./complete_review.md"
    )

    print(f"\n✓ Complete workflow finished!")
    print(f"   Title: {review.title}")
    print(f"   Total words: {review.word_count}")
    print(f"   Sections: {len(review.sections)}")
    print(f"   Saved to: ./complete_review.md")

    # Example 2: Export to multiple formats
    print("\n" + "="*60)
    print("Example 2: Export to Multiple Formats")
    print("="*60)

    print("\n1. Exporting to Markdown...")
    md_path = scholar.export_markdown(review, "./export_demo.md")
    print(f"   ✓ Saved to {md_path}")

    print("\n2. Exporting to DOCX (Microsoft Word)...")
    docx_path = scholar.export_docx(review, "./export_demo.docx")
    print(f"   ✓ Saved to {docx_path}")
    print("   Features: A4 layout, Times New Roman 12pt, APA formatting")

    print("\n3. Exporting to HTML (web format)...")
    html_path = scholar.export_html(review, "./export_demo.html", include_css=True)
    print(f"   ✓ Saved to {html_path}")
    print("   Features: Academic CSS, responsive design, print-friendly")

    print("\n4. Exporting to HTML (without CSS, for embedding)...")
    html_bare = scholar.export_html(review, "./export_demo_bare.html", include_css=False)
    print(f"   ✓ Saved to {html_bare}")
    print("   Use this for embedding in your own website/app")

    # Example 3: Workflow with user-provided PDFs
    print("\n" + "="*60)
    print("Example 3: Workflow with User-Provided PDFs")
    print("="*60)

    # Check if user has PDFs
    if os.path.exists("./my_papers"):
        print("\n1. Using PDFs from ./my_papers directory...")

        user_pdfs = [
            os.path.join("./my_papers", f)
            for f in os.listdir("./my_papers")
            if f.endswith(".pdf")
        ]

        if user_pdfs:
            review2 = scholar.complete_workflow(
                topic="Climate Change Mitigation Strategies",
                auto_search=False,  # Don't search, use only user PDFs
                user_pdfs=user_pdfs,
                sections=["Overview", "Key Findings"],
                min_words_per_section=300,
                output_format="docx",
                output_path="./user_pdfs_review.docx"
            )

            print(f"\n✓ Generated review from {len(user_pdfs)} user PDFs")
            print(f"   Saved to: ./user_pdfs_review.docx")
        else:
            print("   No PDFs found in ./my_papers")
    else:
        print("\nSkipping (create ./my_papers directory with PDFs to test)")

    # Example 4: Workflow with existing BibTeX file
    print("\n" + "="*60)
    print("Example 4: Workflow with Existing BibTeX File")
    print("="*60)

    if os.path.exists("./my_references.bib"):
        print("\n1. Using existing BibTeX file: ./my_references.bib")

        review3 = scholar.complete_workflow(
            topic="Quantum Computing Applications",
            auto_search=False,  # Don't search
            user_bibtex="./my_references.bib",
            sections=["Introduction", "Applications", "Future Directions"],
            min_words_per_section=500,
            output_format="html",
            output_path="./bibtex_review.html"
        )

        print(f"\n✓ Generated review from existing BibTeX")
        print(f"   References: {len(review3.references)}")
        print(f"   Saved to: ./bibtex_review.html")
    else:
        print("\nSkipping (create ./my_references.bib to test)")

    # Example 5: Hybrid workflow (search + user content)
    print("\n" + "="*60)
    print("Example 5: Hybrid Workflow (Auto Search + User PDFs)")
    print("="*60)

    print("\n1. Combining automatic search with user-provided PDFs...")

    # Create dummy user PDFs path for demo (only if exists)
    hybrid_pdfs = []
    if os.path.exists("./additional_papers"):
        hybrid_pdfs = [
            os.path.join("./additional_papers", f)
            for f in os.listdir("./additional_papers")
            if f.endswith(".pdf")
        ]

    review4 = scholar.complete_workflow(
        topic="Blockchain in Supply Chain Management",
        auto_search=True,  # Search for papers
        max_papers=3,  # Get some papers automatically
        user_pdfs=hybrid_pdfs if hybrid_pdfs else None,  # Add user PDFs if available
        min_year=2020,
        sections=["Background", "Use Cases", "Challenges"],
        min_words_per_section=400,
        output_format="markdown",
        output_path="./hybrid_review.md"
    )

    print(f"\n✓ Hybrid review generated!")
    print(f"   Total references: {len(review4.references)}")
    print(f"   Saved to: ./hybrid_review.md")

    # Example 6: Manual export after generation
    print("\n" + "="*60)
    print("Example 6: Manual Export After Generation")
    print("="*60)

    print("\n1. Generate review without auto-export...")

    review5 = scholar.generate_review(
        topic="Machine Learning Interpretability",
        papers=None,  # Will need to search separately
        sections=["Introduction", "Methods", "Discussion"],
        min_words_per_section=300,
        language="English",
        use_thinking_model=True
    )

    print(f"\n2. Manually exporting to different formats...")

    # Export to all formats with custom names
    scholar.export_markdown(review5, "./ml_interpretability.md")
    print("   ✓ Exported to ./ml_interpretability.md")

    scholar.export_docx(review5, "./ml_interpretability.docx")
    print("   ✓ Exported to ./ml_interpretability.docx")

    scholar.export_html(review5, "./ml_interpretability.html")
    print("   ✓ Exported to ./ml_interpretability.html")

    # Summary
    print("\n" + "="*60)
    print("Examples completed successfully!")
    print("="*60)
    print("\nGenerated files:")
    print("  Example 1:")
    print("    - ./complete_review.md (complete workflow)")
    print("  Example 2:")
    print("    - ./export_demo.md (markdown)")
    print("    - ./export_demo.docx (Word document)")
    print("    - ./export_demo.html (full HTML with CSS)")
    print("    - ./export_demo_bare.html (HTML without CSS)")
    print("  Example 3:")
    print("    - ./user_pdfs_review.docx (from user PDFs)")
    print("  Example 4:")
    print("    - ./bibtex_review.html (from existing BibTeX)")
    print("  Example 5:")
    print("    - ./hybrid_review.md (search + user content)")
    print("  Example 6:")
    print("    - ./ml_interpretability.md (manual export)")
    print("    - ./ml_interpretability.docx")
    print("    - ./ml_interpretability.html")

    print("\nFormat Comparison:")
    print("  - Markdown (.md): Best for version control, GitHub, simple editing")
    print("  - DOCX (.docx): Best for Microsoft Word, academic submissions")
    print("  - HTML (.html): Best for websites, online viewing, responsive display")

    print("\nWorkflow Options:")
    print("  - auto_search=True: Automatically search and download papers")
    print("  - auto_search=False + user_pdfs: Use only your own PDFs")
    print("  - auto_search=False + user_bibtex: Use existing BibTeX file")
    print("  - Hybrid: Combine auto search with user content")

if __name__ == "__main__":
    main()
