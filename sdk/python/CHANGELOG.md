# Changelog

All notable changes to Scholaris will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-01-01

### Added
- Initial release of Scholaris
- Paper search functionality via Google Scholar
- Automatic PDF download from Sci-Hub
- BibTeX extraction from PDFs (pdf2bib + AI fallback)
- APA 7th edition citation formatting
- AI-powered literature review generation using Gemini
- Multi-format export (Markdown, DOCX, HTML)
- Complete workflow automation
- Cross-platform support (Linux, macOS, Windows)
- Comprehensive documentation and wiki
- Examples for Flask, FastAPI, and CLI integration

### Features
- **Search**: Google Scholar integration via PyPaperBot
- **Download**: Sci-Hub PDF acquisition
- **Citations**: Dual BibTeX extraction (pdf2bib + LLM)
- **AI Writing**: Gemini-powered literature reviews
- **Export**: Markdown, Word (DOCX), HTML formats
- **Workflow**: End-to-end automation in single call

### Dependencies
- Python >= 3.9
- PyPaperBot, selenium, undetected-chromedriver
- google-generativeai, bibtexparser
- python-docx, markdown, beautifulsoup4

### Testing
- 75% unit test coverage
- Integration tests with real services
- Cross-platform compatibility verified

### Documentation
- Complete README with examples
- Comprehensive wiki (9 pages)
- API reference documentation
- Troubleshooting guide
- FAQ with 30+ questions

---

**Full Changelog**: https://github.com/joseluissaorin/scholaris/commits/main
