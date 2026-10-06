# Scholaris API Reference

Complete API documentation for the Scholaris academic citation system.

---

## Table of Contents

1. [Core Classes](#core-classes)
2. [ProcessedPDF](#processedpdf)
3. [CitationIndex](#citationindex)
4. [CitationResult](#citationresult)
5. [Scholaris Main Class](#scholaris-main-class)
6. [Models and Enums](#models-and-enums)
7. [Utility Functions](#utility-functions)
8. [Configuration](#configuration)

---

## Core Classes

### Import Statements

```python
# Main imports
from scholaris import Scholaris
from scholaris.auto_cite import (
    # Core classes
    CitationIndex,
    CitationStyle,
    ProcessedPDF,
    CitationOrchestrator,

    # Models
    SPDFMetadata,
    SPDFPage,
    SPDFChunk,
    CitationRequest,
    CitationResult,
    GroundedCitation,

    # Export
    CitationExporter,
    export_citations_to_csv,

    # Vision OCR (optional)
    VisionOCRProcessor,
    PageAwareRAG,
    MetadataExtractor,
)
```

---

## ProcessedPDF

Shareable processed PDF format (.spdf) for citation matching.

### Constructor

```python
ProcessedPDF.from_pdf(
    pdf_path: str,
    citation_key: str,
    authors: List[str],
    year: int,
    title: str,
    gemini_api_key: str,
    include_previews: bool = False,
    chunk_size: int = 500,
    chunk_overlap: int = 100,
) -> ProcessedPDF
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pdf_path` | str | Yes | Path to the PDF file |
| `citation_key` | str | Yes | Unique identifier (e.g., "smith2024") |
| `authors` | List[str] | Yes | List of author names |
| `year` | int | Yes | Publication year |
| `title` | str | Yes | Document title |
| `gemini_api_key` | str | Yes | Google Gemini API key |
| `include_previews` | bool | No | Store low-res page images for recovery |
| `chunk_size` | int | No | Text chunk size in characters (default: 500) |
| `chunk_overlap` | int | No | Overlap between chunks (default: 100) |

### Methods

```python
# Save to file
processed.save(path: str) -> None

# Load from file
processed = ProcessedPDF.load(path: str) -> ProcessedPDF

# Get metadata
metadata: SPDFMetadata = processed.metadata

# Get all chunks
chunks: List[SPDFChunk] = processed.chunks

# Get total pages
num_pages: int = len(processed.pages)
```

### SPDFMetadata

```python
@dataclass
class SPDFMetadata:
    citation_key: str
    authors: List[str]
    year: int
    title: str
    language: str  # ISO 639-1 code (en, es, fr, de)
    source_hash: str  # SHA256 of original PDF
    created_at: str  # ISO timestamp
    scholaris_version: str
```

### SPDFChunk

```python
@dataclass
class SPDFChunk:
    text: str
    page_number: int  # Verified page number from OCR
    pdf_page_index: int  # 0-indexed PDF page
    embedding: List[float]  # 768-dim vector
    confidence: float  # OCR confidence score
```

---

## CitationIndex

Multi-source citation index for semantic matching and citation generation.

### Constructor

```python
CitationIndex.from_bibliography(
    folder: str,
    gemini_api_key: str,
    auto_process: bool = True,
    save_processed: bool = True,
    file_extensions: List[str] = [".spdf", ".pdf"],
) -> CitationIndex
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `folder` | str | Yes | Path to bibliography folder |
| `gemini_api_key` | str | Yes | Google Gemini API key |
| `auto_process` | bool | No | Process new PDFs automatically |
| `save_processed` | bool | No | Save processed PDFs as .spdf |
| `file_extensions` | List[str] | No | File types to load |

### Properties

```python
# Number of sources loaded
len(index) -> int

# Total text chunks across all sources
index.total_chunks -> int

# List of citation keys
index.sources -> List[str]
```

### Methods

#### cite_document

```python
result = index.cite_document(
    document_text: str,
    style: CitationStyle = CitationStyle.APA7,
    batch_size: int = 3,
    min_confidence: float = 0.6,
    include_bibliography: bool = True,
    max_citations_per_paragraph: int = 5,
) -> CitationResult
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `document_text` | str | - | The document to cite |
| `style` | CitationStyle | APA7 | Citation format |
| `batch_size` | int | 3 | Paragraphs per processing batch |
| `min_confidence` | float | 0.6 | Minimum confidence threshold (0.0-1.0) |
| `include_bibliography` | bool | True | Append reference list |
| `max_citations_per_paragraph` | int | 5 | Limit citations per paragraph |

#### query

```python
# Query the index for relevant chunks
chunks = index.query(
    query_text: str,
    top_k: int = 10,
    min_score: float = 0.5,
) -> List[RetrievedChunk]
```

#### add_source

```python
# Add a ProcessedPDF to the index
index.add_source(processed: ProcessedPDF) -> None
```

---

## CitationResult

Result object returned by `cite_document()`.

### Properties

```python
@dataclass
class CitationResult:
    modified_document: str  # Document with citations inserted
    citations: List[GroundedCitation]  # All citations generated
    metadata: Dict[str, Any]  # Statistics and info
```

### Metadata Fields

```python
result.metadata = {
    "total_citations": int,
    "successful_insertions": int,
    "framework_rewrites": int,
    "sources_used": List[str],
    "processing_time_seconds": float,
    "style": str,
}
```

### GroundedCitation

```python
@dataclass
class GroundedCitation:
    claim_text: str  # Original text being cited
    citation_key: str  # e.g., "smith2024"
    page_number: int  # Verified page number
    confidence: float  # Match confidence (0.0-1.0)
    citation_type: CitationType  # DIRECT_SUPPORT, FRAMEWORK_APPLICATION, etc.
    citation_string: str  # Formatted citation e.g., "(Smith, 2024, p. 42)"
    evidence_text: str  # Supporting text from source
    suggested_rewrite: Optional[str]  # For framework applications
```

---

## Scholaris Main Class

Main entry point for search, download, and BibTeX generation.

### Constructor

```python
scholar = Scholaris(
    gemini_api_key: Optional[str] = None,
    search_provider: str = "pypaperbot",
    llm_provider: str = "gemini",
    log_level: int = logging.INFO,
)
```

### Methods

#### search_papers

```python
papers = scholar.search_papers(
    topic: str,
    max_papers: int = 20,
    min_year: Optional[int] = None,
    keywords: Optional[List[str]] = None,
) -> List[Paper]
```

#### download_papers

```python
downloaded_paths = scholar.download_papers(
    papers: List[Paper],
    output_dir: str = "./papers",
) -> List[str]
```

#### generate_bibtex

```python
bibtex_entries = scholar.generate_bibtex(
    pdf_paths: List[str],
    method: str = "auto",  # "auto", "pdf2bib", "llm"
) -> List[Dict[str, Any]]
```

#### export_bibtex

```python
scholar.export_bibtex(
    bibtex_entries: List[Dict[str, Any]],
    output_path: str,
) -> None
```

#### format_references

```python
formatted = scholar.format_references(
    bibtex_entries: List[Dict[str, Any]],
    style: str = "APA7",
) -> str
```

#### complete_workflow

```python
review = scholar.complete_workflow(
    topic: str,
    auto_search: bool = True,
    user_pdfs: Optional[List[str]] = None,
    user_bibtex: Optional[str] = None,
    max_papers: int = 20,
    sections: Optional[List[str]] = None,
    language: str = "English",
    output_format: str = "markdown",  # "markdown", "docx", "html"
    output_path: Optional[str] = None,
) -> Review
```

---

## Models and Enums

### CitationStyle

```python
class CitationStyle(Enum):
    APA7 = "apa7"
    CHICAGO17 = "chicago17"
```

### CitationType

```python
class CitationType(Enum):
    DIRECT_SUPPORT = "direct_support"
    FRAMEWORK_APPLICATION = "framework_application"
    BACKGROUND_CONTEXT = "background_context"
    TEMPORAL_IMPOSSIBLE = "temporal_impossible"
```

### Paper

```python
@dataclass
class Paper:
    paper_id: str
    title: str
    authors: List[str]
    year: Optional[int]
    abstract: Optional[str]
    doi: Optional[str]
    url: Optional[str]
    pdf_path: Optional[str]
```

---

## Utility Functions

### export_citations_to_csv

```python
from scholaris.auto_cite import export_citations_to_csv

export_citations_to_csv(
    citations: List[GroundedCitation],
    output_path: str,
) -> None
```

### Document Converters

```python
from scholaris.converters.docx_converter import DocxConverter

converter = DocxConverter(output_folder="./output")
converter.convert(markdown_text, "output.docx")
```

```python
from scholaris.converters.html_converter import HtmlConverter

converter = HtmlConverter()
converter.convert(markdown_text, "output.html", include_css=True)
```

---

## Configuration

### Environment Variables

```bash
# Required
GEMINI_API_KEY=your_gemini_api_key

# Optional
CROSSREF_EMAIL=your@email.com  # Better page detection
```

### Config Object

```python
from scholaris.config import Config

config = Config.from_env()
config.gemini_api_key = "your-key"
config.min_publication_year = 2000
config.papers_dir = "./papers"
```

---

## Temporal Logic

Scholaris automatically detects when sources cannot support claims about concepts that didn't exist:

| Modern Concept | Minimum Year | Examples |
|----------------|--------------|----------|
| Transformers | 2017+ | Attention mechanisms, self-attention |
| Tokenization (BPE, WordPiece) | 2016+ | Subword segmentation |
| Neural LMs | 2013+ | Word embeddings, neural networks |
| BERT, GPT, LLMs | 2018+ | Pre-trained language models |

When temporal impossibilities are detected, Scholaris rewrites citations as framework applications:

**Before (problematic):**
> Tokenization affects coherence (Beaugrande, 1981, p. 84)

**After (properly attributed):**
> Applying the textuality framework of Beaugrande and Dressler (1981), we can analyze how tokenization affects coherence (Beaugrande, 1981, p. 84)

---

## Performance Metrics

| Component | Metric |
|-----------|--------|
| Vision OCR accuracy | 95%+ |
| Page detection | 97.4% |
| Temporal detection | 98%+ |
| Processing speed | ~2 min for 38 sources, 17k chunks |
| Grounded citations | 0% page-1 fallback |

---

## Error Handling

```python
from scholaris.exceptions import (
    ScholarisError,      # Base exception
    ConfigurationError,  # Missing API keys, invalid config
    SearchError,         # Paper search failures
    DownloadError,       # PDF download failures
    BibTeXError,         # BibTeX extraction failures
    LLMError,            # Gemini API errors
    RateLimitError,      # API rate limiting
    ConversionError,     # Document conversion failures
    ValidationError,     # Input validation errors
)
```

---

## Supported File Formats

### Input

| Format | Extension | Support |
|--------|-----------|---------|
| PDF | .pdf | Full (Vision OCR) |
| SPDF | .spdf, .scholaris, .scpdf | Full (pre-processed) |
| Markdown | .md | Full |
| Word | .docx | Full |
| Plain Text | .txt | Full |
| LaTeX | .tex | Full |
| HTML | .html | Full |

### Output

| Format | Method |
|--------|--------|
| Markdown | Direct text output |
| Word | `DocxConverter` |
| HTML | `HtmlConverter` |
| CSV | `export_citations_to_csv()` |
| JSON | `result.metadata` serialization |
