# API Reference

Complete API documentation for Scholaris.

## Core Classes

### Scholaris

Main interface for all Scholaris operations.

#### Constructor

```python
Scholaris(
    gemini_api_key: Optional[str] = None,
    perplexity_api_key: Optional[str] = None,
    deepseek_api_key: Optional[str] = None,
    search_provider: str = "pypaperbot",
    llm_provider: str = "gemini",
    config: Optional[Config] = None
)
```

**Parameters:**
- `gemini_api_key` - Google Gemini API key
- `perplexity_api_key` - Perplexity API key (optional)
- `deepseek_api_key` - DeepSeek API key (optional)
- `search_provider` - Search backend ("pypaperbot")
- `llm_provider` - LLM backend ("gemini", "perplexity", "deepseek")
- `config` - Configuration object

#### search_papers()

Search for academic papers.

```python
search_papers(
    topic: str,
    max_papers: int = 10,
    min_year: Optional[int] = None,
    keywords: Optional[List[str]] = None
) -> List[Paper]
```

**Parameters:**
- `topic` - Research topic or query
- `max_papers` - Maximum number of papers to return
- `min_year` - Filter papers from this year onwards
- `keywords` - Additional search keywords

**Returns:** List of `Paper` objects

**Example:**
```python
papers = scholar.search_papers(
    topic="machine learning",
    max_papers=20,
    min_year=2020
)
```

#### download_papers()

Download PDFs for papers.

```python
download_papers(
    papers: List[Paper],
    output_dir: str = "./papers"
) -> List[str]
```

**Parameters:**
- `papers` - List of Paper objects to download
- `output_dir` - Directory to save PDFs

**Returns:** List of paths to downloaded PDFs

**Example:**
```python
pdf_paths = scholar.download_papers(
    papers=papers,
    output_dir="./my_papers"
)
```

#### generate_bibtex()

Extract BibTeX from PDFs.

```python
generate_bibtex(
    pdf_paths: List[str],
    method: str = "auto"
) -> List[dict]
```

**Parameters:**
- `pdf_paths` - List of PDF file paths
- `method` - Extraction method:
  - `"auto"` - Try pdf2bib, fallback to LLM
  - `"pdf2bib"` - Use pdf2bib only
  - `"llm"` - Use LLM only

**Returns:** List of BibTeX entry dictionaries

**Example:**
```python
bibtex = scholar.generate_bibtex(
    pdf_paths=["paper1.pdf", "paper2.pdf"],
    method="auto"
)
```

#### format_references()

Format BibTeX entries as citations.

```python
format_references(
    bibtex_entries: List[dict],
    style: str = "APA7"
) -> str
```

**Parameters:**
- `bibtex_entries` - List of BibTeX dictionaries
- `style` - Citation style ("APA7")

**Returns:** Formatted reference string

**Example:**
```python
formatted = scholar.format_references(bibtex, style="APA7")
print(formatted)
```

#### export_bibtex()

Export BibTeX to .bib file.

```python
export_bibtex(
    bibtex_entries: List[dict],
    output_path: str
) -> None
```

**Parameters:**
- `bibtex_entries` - List of BibTeX dictionaries
- `output_path` - Path to .bib file

**Example:**
```python
scholar.export_bibtex(bibtex, "references.bib")
```

#### generate_review()

Generate literature review using AI.

```python
generate_review(
    topic: str,
    papers: Optional[List[Paper]] = None,
    bibtex_entries: Optional[List[dict]] = None,
    sections: Optional[List[str]] = None,
    min_words_per_section: int = 500,
    language: str = "English",
    use_thinking_model: bool = False
) -> Review
```

**Parameters:**
- `topic` - Review topic
- `papers` - Papers to include (optional)
- `bibtex_entries` - Citations to use (optional)
- `sections` - Section names (default: ["Introduction", "Literature Review", "Conclusion"])
- `min_words_per_section` - Minimum words per section
- `language` - Output language
- `use_thinking_model` - Use advanced thinking model

**Returns:** `Review` object

**Example:**
```python
review = scholar.generate_review(
    topic="Neural Networks",
    papers=papers,
    bibtex_entries=bibtex,
    sections=["Introduction", "Methods", "Discussion"],
    min_words_per_section=300
)
```

#### export_markdown()

Export review to Markdown.

```python
export_markdown(
    review: Review,
    output_path: str
) -> None
```

#### export_docx()

Export review to Word format.

```python
export_docx(
    review: Review,
    output_path: str
) -> None
```

#### export_html()

Export review to HTML.

```python
export_html(
    review: Review,
    output_path: str,
    include_css: bool = True
) -> None
```

#### complete_workflow()

Execute complete research workflow.

```python
complete_workflow(
    topic: str,
    auto_search: bool = True,
    user_pdfs: Optional[List[str]] = None,
    user_bibtex: Optional[str] = None,
    max_papers: int = 20,
    min_year: Optional[int] = None,
    sections: Optional[List[str]] = None,
    output_format: str = "docx",
    output_path: Optional[str] = None
) -> Review
```

**Parameters:**
- `topic` - Research topic
- `auto_search` - Automatically search for papers
- `user_pdfs` - User-provided PDF paths
- `user_bibtex` - Path to existing .bib file
- `max_papers` - Maximum papers to search
- `min_year` - Filter by year
- `sections` - Review sections
- `output_format` - Export format ("markdown", "docx", "html")
- `output_path` - Output file path

**Returns:** `Review` object

### Config

Configuration management.

#### Constructor

```python
Config(
    llm_provider: str = "gemini",
    search_provider: str = "pypaperbot",
    max_papers_per_keyword: int = 10,
    min_publication_year: Optional[int] = None,
    scihub_mirror: str = "https://www.sci-hub.ru",
    citation_style: str = "APA7",
    default_language: str = "English",
    min_words_per_section: int = 500,
    output_dir: str = "./output",
    papers_dir: str = "./papers"
)
```

#### from_env()

Load configuration from environment variables.

```python
@classmethod
from_env(cls, env_file: Optional[str] = None) -> Config
```

**Example:**
```python
config = Config.from_env()
scholar = Scholaris(config=config)
```

### Data Models

#### Paper

Represents an academic paper.

**Attributes:**
- `title: str` - Paper title
- `authors: List[str]` - List of authors
- `year: int` - Publication year
- `abstract: Optional[str]` - Paper abstract
- `url: Optional[str]` - Paper URL
- `pdf_url: Optional[str]` - Direct PDF URL
- `venue: Optional[str]` - Publication venue

#### Review

Represents a generated literature review.

**Attributes:**
- `topic: str` - Review topic
- `markdown: str` - Full review in Markdown
- `sections: Dict[str, Section]` - Review sections
- `references: List[dict]` - BibTeX references
- `word_count: int` - Total word count
- `generated_at: datetime` - Generation timestamp
- `metadata: dict` - Additional metadata

## Error Handling

All methods may raise these exceptions:

- `SearchError` - Paper search failed
- `DownloadError` - PDF download failed
- `BibtexError` - BibTeX extraction failed
- `ReviewError` - Review generation failed
- `ConfigurationError` - Invalid configuration

**Example:**
```python
from scholaris.exceptions import SearchError

try:
    papers = scholar.search_papers(topic="invalid topic")
except SearchError as e:
    print(f"Search failed: {e}")
```

## Environment Variables

See [Configuration](Configuration) for full list of environment variables.

---

**See Also:**
- [Quick Start](Quick-Start) - Get started quickly
- [Examples](Examples) - Real-world usage examples
- [Configuration](Configuration) - Configuration options
