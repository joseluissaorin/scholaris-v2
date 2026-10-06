# Scholaris Wiki

Welcome to the Scholaris documentation. This wiki provides comprehensive guides for using Scholaris to automate your academic research workflow.

## What is Scholaris?

Scholaris is a Python library that automates academic research tasks:
- **Search** for papers on Google Scholar
- **Download** PDFs from open-access sources
- **Extract** citations and generate BibTeX
- **Generate** literature reviews using AI
- **Export** to multiple formats (Markdown, Word, HTML)

## Getting Started

**New to Scholaris?** Start here:
1. [Installation](Installation) - Set up Scholaris on your system
2. [Quick Start](Quick-Start) - Your first workflow in 5 minutes
3. [Configuration](Configuration) - Configure API keys and settings

## Documentation

### Core Guides
- [Installation](Installation) - Installation methods and requirements
- [Quick Start](Quick-Start) - Basic usage tutorial
- [Configuration](Configuration) - Environment and programmatic configuration
- [API Reference](API-Reference) - Complete API documentation

### Advanced Topics
- [Examples](Examples) - Real-world use cases
- [Architecture](Architecture) - System design and extensibility
- [Troubleshooting](Troubleshooting) - Common issues and solutions
- [FAQ](FAQ) - Frequently asked questions

### Development
- [Contributing](Contributing) - How to contribute to Scholaris
- [Testing](Testing) - Running and writing tests
- [Release Notes](Release-Notes) - Version history and changes

## Quick Links

- **GitHub Repository**: https://github.com/joseluissaorin/scholaris
- **Issue Tracker**: https://github.com/joseluissaorin/scholaris/issues
- **License**: MIT License

## Getting Help

- Check the [FAQ](FAQ) for common questions
- Review [Troubleshooting](Troubleshooting) for known issues
- Search existing [GitHub Issues](https://github.com/joseluissaorin/scholaris/issues)
- Open a new issue if you can't find a solution

## Key Features

### Paper Search
Search Google Scholar by topic, author, or specific papers:
```python
papers = scholar.search_papers(topic="neural networks", max_papers=10)
```

### PDF Download
Automatically download papers from open-access sources:
```python
paths = scholar.download_papers(papers, output_dir="./papers")
```

### BibTeX Management
Extract citations from PDFs and format bibliographies:
```python
bibtex = scholar.generate_bibtex(pdf_paths, method="auto")
formatted = scholar.format_references(bibtex, style="APA7")
```

### Literature Review Generation
Create AI-powered literature reviews:
```python
review = scholar.generate_review(
    topic="Machine Learning",
    papers=papers,
    sections=["Introduction", "Methods", "Discussion"]
)
```

### Multi-Format Export
Export to Markdown, Word, or HTML:
```python
scholar.export_docx(review, "review.docx")
```

## System Requirements

- **Python**: 3.9 or higher
- **Operating Systems**: Linux, macOS, Windows
- **API Keys**: Google Gemini API key (for AI features)
- **Dependencies**: Automatically installed via pip

## Next Steps

1. **Install Scholaris**: Follow the [Installation](Installation) guide
2. **Get an API key**: Sign up for [Google Gemini API](https://makersuite.google.com/app/apikey)
3. **Try the Quick Start**: Complete the [Quick Start](Quick-Start) tutorial
4. **Explore Examples**: Browse [Examples](Examples) for your use case

---

**Last Updated**: 2026-01-01  
**Version**: 1.0.0  
**License**: MIT
