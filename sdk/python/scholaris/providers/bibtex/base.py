"""Base BibTeX extractor interface."""
from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional
from ..base import BaseProvider


class BaseBibtexExtractor(BaseProvider):
    """Abstract base class for BibTeX extraction from PDFs."""

    @abstractmethod
    def extract(self, pdf_path: str) -> Optional[List[Dict[str, Any]]]:
        """Extract BibTeX from a PDF file.

        Args:
            pdf_path: Path to PDF file

        Returns:
            List of BibTeX entry dictionaries, or None if extraction fails

        Raises:
            BibTeXError: If extraction fails critically
        """
        pass

    @abstractmethod
    def supports_batch(self) -> bool:
        """Whether this extractor supports batch processing.

        Returns:
            True if batch processing is supported
        """
        pass
