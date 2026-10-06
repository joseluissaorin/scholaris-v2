"""pdf2bib BibTeX extractor implementation."""
import os
import logging
from typing import List, Dict, Any, Optional

try:
    import pdf2bib
    PDF2BIB_AVAILABLE = True
except ImportError:
    PDF2BIB_AVAILABLE = False

from .base import BaseBibtexExtractor
from ...exceptions import BibTeXError
from ...converters.bibtex_parser import parse_bibtex

logger = logging.getLogger(__name__)


class Pdf2BibExtractor(BaseBibtexExtractor):
    """BibTeX extractor using pdf2bib library."""

    def __init__(self, config: Optional[Any] = None):
        """Initialize pdf2bib extractor.

        Args:
            config: Configuration object

        Raises:
            BibTeXError: If pdf2bib is not installed
        """
        super().__init__(config)

        if not PDF2BIB_AVAILABLE:
            raise BibTeXError(
                "pdf2bib library not installed. Install it with: pip install pdf2bib"
            )

        # Suppress pdf2bib verbose output
        pdf2bib.config.set('verbose', False)

    def extract(self, pdf_path: str) -> Optional[List[Dict[str, Any]]]:
        """Extract BibTeX from PDF using pdf2bib.

        Args:
            pdf_path: Path to PDF file

        Returns:
            List of parsed BibTeX entries, or None if extraction fails
        """
        if not os.path.exists(pdf_path):
            raise BibTeXError(f"PDF file not found: {pdf_path}")

        logger.info(f"Attempting BibTeX extraction with pdf2bib: {os.path.basename(pdf_path)}")

        try:
            result = pdf2bib.pdf2bib(pdf_path)

            # Handle different result types (list or dict)
            entry_dict = None
            if isinstance(result, list) and result and isinstance(result[0], dict):
                entry_dict = result[0]
            elif isinstance(result, dict):
                entry_dict = result
            else:
                logger.warning(
                    f"pdf2bib returned unexpected type for {os.path.basename(pdf_path)}: {type(result)}"
                )
                return None

            # Check if we have valid BibTeX
            if entry_dict and entry_dict.get('bibtex') and isinstance(entry_dict['bibtex'], str):
                bibtex_string = entry_dict['bibtex'].strip()
                if bibtex_string:
                    # Parse the BibTeX string
                    parsed_entries = parse_bibtex(bibtex_string)
                    if parsed_entries:
                        logger.info(
                            f"Successfully extracted BibTeX using pdf2bib: {os.path.basename(pdf_path)}"
                        )
                        return parsed_entries
                    else:
                        logger.warning(
                            f"pdf2bib returned BibTeX but parsing failed: {os.path.basename(pdf_path)}"
                        )
                        return None
            else:
                logger.warning(
                    f"pdf2bib returned dict but no valid BibTeX: {os.path.basename(pdf_path)}"
                )
                return None

        except FileNotFoundError:
            raise BibTeXError(f"PDF file not found during extraction: {pdf_path}")
        except Exception as e:
            logger.error(f"pdf2bib extraction failed for {pdf_path}: {e}")
            return None

    def supports_batch(self) -> bool:
        """pdf2bib doesn't support batch processing."""
        return False
