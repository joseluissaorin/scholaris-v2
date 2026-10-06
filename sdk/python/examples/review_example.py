"""Example demonstrating literature review generation (Phase 3).

This example shows how to:
1. Search for papers on a topic
2. Download PDFs
3. Generate BibTeX from PDFs
4. Generate a complete literature review with AI
5. Export the review

Requirements:
    - Set GEMINI_API_KEY environment variable
    - Install: pip install PyPaperBot pdf2bib bibtexparser google-generativeai
"""
import os
from scholaris import Scholaris

def main():
    # Initialize Scholaris with Gemini API key
    gemini_key = os.getenv("GEMINI_API_KEY")
    if not gemini_key:
        print("ERROR: GEMINI_API_KEY environment variable not set!")
        print("Set it with: export GEMINI_API_KEY='your-api-key'")
        return

    print("Initializing Scholaris with Gemini provider...")
    scholar = Scholaris(gemini_api_key=gemini_key)

    # Example 1: Complete workflow from search to review
    print("\n" + "="*60)
    print("Example 1: Complete Literature Review Workflow")
    print("="*60)

    topic = "Machine Learning in Healthcare Diagnosis"

    # Step 1: Search for papers
    print(f"\n1. Searching for papers on: '{topic}'...")
    papers = scholar.search_papers(
        topic=topic,
        max_papers=5,  # Limit for demo
        min_year=2020
    )
    print(f"   Found {len(papers)} papers")

    # Step 2: Download PDFs
    print("\n2. Downloading PDFs...")
    pdf_paths = scholar.download_papers(papers, output_dir="./papers")
    print(f"   Downloaded {len(pdf_paths)} PDFs")

    # Step 3: Generate BibTeX
    print("\n3. Generating BibTeX entries...")
    bibtex_entries = scholar.generate_bibtex(
        pdf_paths=pdf_paths,
        method="auto"  # pdf2bib + Gemini fallback
    )
    print(f"   Generated {len(bibtex_entries)} BibTeX entries")

    # Step 4: Generate Literature Review
    print("\n4. Generating literature review...")
    print("   This may take several minutes depending on section count...")

    review = scholar.generate_review(
        topic=topic,
        papers=papers,
        bibtex_entries=bibtex_entries,
        sections=["Introduction", "Literature Review", "Discussion"],
        min_words_per_section=500,  # Reduced for demo (default: 2250)
        language="English",
        use_thinking_model=True  # Use Gemini thinking model
    )

    print(f"\n✓ Review generated!")
    print(f"   Title: {review.title}")
    print(f"   Total words: {review.word_count}")
    print(f"   Sections: {len(review.sections)}")
    print(f"   References: {len(review.references)}")

    # Display section breakdown
    print("\n   Section breakdown:")
    for section_title, section in review.sections.items():
        print(f"     - {section_title}: {section.word_count} words")

    # Step 5: Save the review
    print("\n5. Saving review...")

    # Save as Markdown
    with open("./review.md", "w") as f:
        f.write(review.markdown)
    print("   ✓ Saved to ./review.md")

    # Display first 500 characters
    print("\n   Preview:")
    print("   " + "-"*56)
    preview = review.markdown[:500].replace("\n", "\n   ")
    print(f"   {preview}...")
    print("   " + "-"*56)

    # Example 2: Generate review from existing BibTeX
    print("\n" + "="*60)
    print("Example 2: Generate Review from Existing BibTeX")
    print("="*60)

    # Parse an existing .bib file (if you have one)
    if os.path.exists("./references.bib"):
        print("\n1. Parsing existing BibTeX file...")
        entries = scholar.parse_bibtex_file("./references.bib")

        print("\n2. Generating review from BibTeX entries...")
        review2 = scholar.generate_review(
            topic="AI Ethics and Governance",
            bibtex_entries=entries,
            sections=["Introduction", "Ethical Frameworks"],
            min_words_per_section=300,  # Short for demo
            use_thinking_model=False  # Use faster model
        )

        print(f"\n✓ Review generated: {review2.word_count} words")

        with open("./review2.md", "w") as f:
            f.write(review2.markdown)
        print("   ✓ Saved to ./review2.md")
    else:
        print("\nSkipping (no references.bib file found)")

    # Example 3: Customize review generation
    print("\n" + "="*60)
    print("Example 3: Customized Review Generation")
    print("="*60)

    print("\n1. Generating custom review with specific sections...")

    custom_review = scholar.generate_review(
        topic="Deep Learning for Medical Image Analysis",
        papers=papers[:3],  # Use subset of papers
        sections=[
            "Background",
            "Recent Advances",
            "Challenges and Limitations",
            "Future Directions"
        ],
        min_words_per_section=400,
        language="English",
        use_thinking_model=True
    )

    print(f"\n✓ Custom review generated!")
    print(f"   Sections: {list(custom_review.sections.keys())}")
    print(f"   Total words: {custom_review.word_count}")

    with open("./custom_review.md", "w") as f:
        f.write(custom_review.markdown)
    print("   ✓ Saved to ./custom_review.md")

    print("\n" + "="*60)
    print("Examples completed successfully!")
    print("="*60)
    print("\nGenerated files:")
    print("  - ./review.md (main review)")
    print("  - ./review2.md (from BibTeX - if available)")
    print("  - ./custom_review.md (customized sections)")
    print("\nNote: Review generation uses AI and may take several minutes.")
    print("      Adjust min_words_per_section for production use (default: 2250)")

if __name__ == "__main__":
    main()
