"""Base provider interfaces."""
from abc import ABC, abstractmethod
from typing import List, Optional, Dict, Any
from ..core.models import Paper


class BaseProvider(ABC):
    """Base class for all providers."""

    def __init__(self, config: Optional[Any] = None):
        """Initialize provider with optional configuration.

        Args:
            config: Configuration object
        """
        self.config = config


class SearchResult:
    """Represents a single search result.

    Attributes:
        title: Paper title
        authors: List of authors
        year: Publication year
        url: URL to paper
        pdf_url: Direct PDF download URL
        abstract: Paper abstract
        venue: Publication venue
        doi: DOI if available
    """

    def __init__(
        self,
        title: str,
        authors: List[str],
        year: int,
        url: Optional[str] = None,
        pdf_url: Optional[str] = None,
        abstract: Optional[str] = None,
        venue: Optional[str] = None,
        doi: Optional[str] = None,
    ):
        self.title = title
        self.authors = authors
        self.year = year
        self.url = url
        self.pdf_url = pdf_url
        self.abstract = abstract
        self.venue = venue
        self.doi = doi

    def to_paper(self, paper_id: Optional[str] = None) -> Paper:
        """Convert search result to Paper model.

        Args:
            paper_id: Optional paper ID, will be generated if not provided

        Returns:
            Paper instance
        """
        if paper_id is None:
            # Generate ID from title
            paper_id = self.title.lower().replace(" ", "_")[:50]

        return Paper(
            id=paper_id,
            title=self.title,
            authors=self.authors,
            year=self.year,
            url=self.url,
            pdf_url=self.pdf_url,
            abstract=self.abstract,
            venue=self.venue,
            doi=self.doi,
        )
