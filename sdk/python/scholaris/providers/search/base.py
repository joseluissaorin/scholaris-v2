"""Base search provider interface."""
from abc import ABC, abstractmethod
from typing import List, Optional
from ..base import BaseProvider, SearchResult


class BaseSearchProvider(BaseProvider):
    """Abstract base class for paper search providers."""

    @abstractmethod
    def search(
        self,
        query: str,
        max_results: int = 10,
        min_year: Optional[int] = None,
        **kwargs
    ) -> List[SearchResult]:
        """Search for academic papers.

        Args:
            query: Search query string
            max_results: Maximum number of results to return
            min_year: Minimum publication year filter
            **kwargs: Additional provider-specific parameters

        Returns:
            List of SearchResult objects

        Raises:
            SearchError: If search fails
        """
        pass

    @abstractmethod
    def download_pdf(
        self,
        result: SearchResult,
        output_path: str
    ) -> Optional[str]:
        """Download PDF for a search result.

        Args:
            result: SearchResult to download
            output_path: Path to save the PDF

        Returns:
            Path to downloaded PDF, or None if download failed

        Raises:
            DownloadError: If download fails
        """
        pass
