"""Basic usage example for Scholaris."""
from scholaris import Scholaris

def main():
    # Initialize Scholaris
    print("Initializing Scholaris...")
    scholar = Scholaris()

    # Example 1: Search for papers on a topic
    print("\n=== Example 1: Topic Search ===")
    topic = "Machine Learning in Healthcare"
    print(f"Searching for papers on: {topic}")

    papers = scholar.search_papers(
        topic=topic,
        max_papers=5,
        min_year=2020
    )

    print(f"\nFound {len(papers)} papers:")
    for i, paper in enumerate(papers, 1):
        print(f"{i}. {paper.title}")
        print(f"   Authors: {', '.join(paper.authors) if paper.authors else 'N/A'}")
        print(f"   Year: {paper.year or 'N/A'}")
        print()

    # Example 2: Download PDFs
    if papers:
        print("\n=== Example 2: Download PDFs ===")
        print("Downloading PDFs...")

        pdf_paths = scholar.download_papers(
            papers=papers,
            output_dir="./example_papers"
        )

        print(f"Downloaded {len(pdf_paths)} PDFs:")
        for path in pdf_paths:
            print(f"  - {path}")

    # Example 3: Search from bibliography list
    print("\n=== Example 3: Bibliography List Search ===")
    bibliography_list = [
        "Deep Learning for Medical Image Analysis",
        "Neural Networks in Healthcare Diagnostics",
    ]

    print("Searching for papers from bibliography list...")
    bib_papers = scholar.search_from_bibliography(bibliography_list)

    print(f"Found {len(bib_papers)} papers:")
    for paper in bib_papers:
        print(f"  - {paper.title}")

if __name__ == "__main__":
    main()
