"""Data models for Scholaris."""
from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional, Dict, Any


@dataclass
class Paper:
    """Represents an academic paper.

    Attributes:
        id: Unique identifier for the paper
        title: Paper title
        authors: List of author names
        year: Publication year
        abstract: Paper abstract (optional)
        doi: Digital Object Identifier (optional)
        url: URL to paper page (optional)
        pdf_url: Direct URL to PDF (optional)
        pdf_path: Local path to downloaded PDF (optional)
        citation_count: Number of citations (optional)
        venue: Publication venue (journal/conference)
        keywords: List of keywords (optional)
        bibtex_entry: BibTeX entry as string (optional)
    """

    id: str
    title: str
    authors: List[str]
    year: int
    abstract: Optional[str] = None
    doi: Optional[str] = None
    url: Optional[str] = None
    pdf_url: Optional[str] = None
    pdf_path: Optional[str] = None
    citation_count: int = 0
    venue: Optional[str] = None
    keywords: List[str] = field(default_factory=list)
    bibtex_entry: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert paper to dictionary."""
        return {
            "id": self.id,
            "title": self.title,
            "authors": self.authors,
            "year": self.year,
            "abstract": self.abstract,
            "doi": self.doi,
            "url": self.url,
            "pdf_url": self.pdf_url,
            "pdf_path": self.pdf_path,
            "citation_count": self.citation_count,
            "venue": self.venue,
            "keywords": self.keywords,
            "bibtex_entry": self.bibtex_entry,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Paper":
        """Create paper from dictionary."""
        return cls(**{k: v for k, v in data.items() if k in cls.__annotations__})


@dataclass
class Reference:
    """Represents a bibliographic reference.

    Attributes:
        title: Reference title
        authors: List of author names
        year: Publication year
        source: Journal, conference, or book title
        volume: Volume number (optional)
        issue: Issue number (optional)
        pages: Page range (optional)
        doi: Digital Object Identifier (optional)
        url: URL (optional)
        bibtex_entry: Raw BibTeX entry
        entry_type: BibTeX entry type (article, inproceedings, etc.)
    """

    title: str
    authors: List[str]
    year: int
    source: str
    bibtex_entry: Dict[str, Any]
    entry_type: str = "article"
    volume: Optional[str] = None
    issue: Optional[str] = None
    pages: Optional[str] = None
    doi: Optional[str] = None
    url: Optional[str] = None
    abstract: Optional[str] = None

    def to_bibtex_string(self) -> str:
        """Convert reference to BibTeX string format."""
        # This will be implemented using the bibtex converters
        # For now, return raw entry if available
        if isinstance(self.bibtex_entry, dict):
            entry_type = self.bibtex_entry.get("ENTRYTYPE", self.entry_type)
            entry_id = self.bibtex_entry.get("ID", "unknown")

            lines = [f"@{entry_type}{{{entry_id},"]
            for key, value in self.bibtex_entry.items():
                if key not in ["ENTRYTYPE", "ID"]:
                    lines.append(f"  {key} = {{{value}}},")
            lines.append("}")

            return "\n".join(lines)
        return str(self.bibtex_entry)

    def to_dict(self) -> Dict[str, Any]:
        """Convert reference to dictionary."""
        return {
            "title": self.title,
            "authors": self.authors,
            "year": self.year,
            "source": self.source,
            "entry_type": self.entry_type,
            "volume": self.volume,
            "issue": self.issue,
            "pages": self.pages,
            "doi": self.doi,
            "url": self.url,
            "abstract": self.abstract,
            "bibtex_entry": self.bibtex_entry,
        }


@dataclass
class Section:
    """Represents a section of an academic article.

    Attributes:
        title: Section title
        content: Section content in Markdown
        order: Order in the document
        word_count: Approximate word count
    """

    title: str
    content: str
    order: int = 0
    word_count: int = 0

    def __post_init__(self):
        """Calculate word count if not provided."""
        if self.word_count == 0:
            self.word_count = len(self.content.split())


@dataclass
class Review:
    """Represents a generated literature review.

    Attributes:
        topic: Review topic
        markdown: Full review content in Markdown
        sections: List of sections
        references: List of references
        metadata: Additional metadata
        generated_at: Timestamp of generation
    """

    topic: str
    markdown: str
    references: List[Reference]
    sections: Dict[str, Section] = field(default_factory=dict)
    metadata: Dict[str, Any] = field(default_factory=dict)
    generated_at: datetime = field(default_factory=datetime.now)

    @property
    def word_count(self) -> int:
        """Total word count of the review."""
        return len(self.markdown.split())

    @property
    def reference_count(self) -> int:
        """Number of references."""
        return len(self.references)

    def to_dict(self) -> Dict[str, Any]:
        """Convert review to dictionary."""
        return {
            "topic": self.topic,
            "markdown": self.markdown,
            "sections": {k: {"title": v.title, "content": v.content, "order": v.order}
                        for k, v in self.sections.items()},
            "references": [r.to_dict() for r in self.references],
            "metadata": self.metadata,
            "generated_at": self.generated_at.isoformat(),
            "word_count": self.word_count,
            "reference_count": self.reference_count,
        }
