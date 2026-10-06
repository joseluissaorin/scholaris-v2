# Quick Start Guide

Get started with Scholaris in 5 minutes. This guide walks you through a complete workflow from paper search to literature review generation.

## Prerequisites

- Scholaris installed ([Installation Guide](Installation))
- Google Gemini API key ([Get one here](https://makersuite.google.com/app/apikey))

## Your First Workflow

### 1. Initialize Scholaris

```python
from scholaris import Scholaris

# Initialize with your API key
scholar = Scholaris(gemini_api_key="your-api-key-here")
```

### 2. Search for Papers

```python
# Search Google Scholar for papers
papers = scholar.search_papers(
    topic="transformer neural networks",
    max_papers=5,
    min_year=2020
)

print(f"Found {len(papers)} papers")
for paper in papers:
    print(f"- {paper.title}")
```

**Expected output:**
```
Found 5 papers
- Attention Is All You Need
- BERT: Pre-training of Deep Bidirectional Transformers
- GPT-3: Language Models are Few-Shot Learners
...
```

### 3. Download PDFs

```python
# Download papers to local directory
pdf_paths = scholar.download_papers(
    papers=papers,
    output_dir="./my_papers"
)

print(f"Downloaded {len(pdf_paths)} PDFs")
```

### 4. Generate BibTeX

```python
# Extract citations from PDFs
bibtex_entries = scholar.generate_bibtex(
    pdf_paths=pdf_paths,
    method="auto"  # Uses pdf2bib, falls back to AI
)

# Export to .bib file
scholar.export_bibtex(bibtex_entries, "references.bib")

# Format as APA 7th edition
formatted = scholar.format_references(bibtex_entries, style="APA7")
print(formatted)
```

### 5. Generate Literature Review

```python
# Create AI-powered literature review
review = scholar.generate_review(
    topic="Transformer Neural Networks in NLP",
    papers=papers,
    bibtex_entries=bibtex_entries,
    sections=[
        "Introduction",
        "Key Innovations",
        "Applications",
        "Conclusion"
    ],
    min_words_per_section=300,
    language="English"
)

print(f"Generated {review.word_count} words")
```

### 6. Export to Word

```python
# Export to Microsoft Word format
scholar.export_docx(review, "literature_review.docx")
print("Review saved to literature_review.docx")
```

## Complete Example

Here's the entire workflow in one script:

```python
from scholaris import Scholaris

# Initialize
scholar = Scholaris(gemini_api_key="your-api-key-here")

# Search
papers = scholar.search_papers(
    topic="transformer neural networks",
    max_papers=5,
    min_year=2020
)

# Download
pdf_paths = scholar.download_papers(papers, output_dir="./papers")

# Generate citations
bibtex = scholar.generate_bibtex(pdf_paths, method="auto")
scholar.export_bibtex(bibtex, "references.bib")

# Create review
review = scholar.generate_review(
    topic="Transformer Neural Networks",
    papers=papers,
    bibtex_entries=bibtex,
    sections=["Introduction", "Methods", "Discussion", "Conclusion"],
    min_words_per_section=300
)

# Export
scholar.export_docx(review, "review.docx")
print(f"✓ Complete! Generated {review.word_count}-word review")
```

## Using the Complete Workflow

For even simpler usage, use the `complete_workflow()` method:

```python
from scholaris import Scholaris

scholar = Scholaris(gemini_api_key="your-api-key-here")

# One method does everything
review = scholar.complete_workflow(
    topic="Transformer Neural Networks",
    auto_search=True,
    max_papers=10,
    min_year=2020,
    sections=["Introduction", "Background", "Discussion"],
    output_format="docx",
    output_path="./complete_review.docx"
)

print(f"Done! Review saved with {review.word_count} words")
```

## Environment Variables (Recommended)

Instead of hardcoding your API key, use environment variables:

**Create `.env` file:**
```bash
GEMINI_API_KEY=your-api-key-here
SCHOLARIS_MAX_PAPERS_PER_KEYWORD=10
SCHOLARIS_MIN_PUBLICATION_YEAR=2020
```

**Use in code:**
```python
from scholaris import Scholaris, Config

# Loads from .env automatically
config = Config.from_env()
scholar = Scholaris(config=config)
```

## Common Patterns

### Search Only

```python
papers = scholar.search_papers(topic="quantum computing", max_papers=20)
for paper in papers:
    print(f"{paper.title} ({paper.year})")
```

### BibTeX Only

```python
# From existing PDFs
bibtex = scholar.generate_bibtex(
    pdf_paths=["paper1.pdf", "paper2.pdf"],
    method="auto"
)
scholar.export_bibtex(bibtex, "my_refs.bib")
```

### Review Without Search

```python
# Use your own papers
review = scholar.complete_workflow(
    topic="Your Topic",
    auto_search=False,
    user_pdfs=["my_paper1.pdf", "my_paper2.pdf"],
    output_format="markdown"
)
```

## Next Steps

- [Configuration](Configuration) - Customize Scholaris settings
- [API Reference](API-Reference) - Explore all methods and options
- [Examples](Examples) - See more real-world use cases
- [Troubleshooting](Troubleshooting) - Solve common issues

## Getting Help

- **Questions?** Check the [FAQ](FAQ)
- **Problems?** See [Troubleshooting](Troubleshooting)
- **Bugs?** Open an [issue](https://github.com/joseluissaorin/scholaris/issues)

---

**Congratulations!** You've completed your first Scholaris workflow. Explore the [Examples](Examples) for more advanced usage.
