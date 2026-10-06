"""LLM-based BibTeX extractor fallback (extracted from llm.py)."""
import os
import time
import logging
from typing import List, Dict, Any, Optional

from .base import BaseBibtexExtractor
from ...exceptions import BibTeXError, LLMError
from ...converters.bibtex_parser import parse_bibtex

logger = logging.getLogger(__name__)


class LLMBibtexExtractor(BaseBibtexExtractor):
    """BibTeX extractor using LLM as fallback when pdf2bib fails.

    This extractor uses Google Gemini to analyze PDF files and extract
    bibliographic information, then formats it as BibTeX.
    """

    def __init__(self, config: Optional[Any] = None, gemini_provider=None):
        """Initialize LLM BibTeX extractor.

        Args:
            config: Configuration object
            gemini_provider: Gemini LLM provider instance

        Raises:
            BibTeXError: If Gemini provider is not available
        """
        super().__init__(config)
        self.gemini_provider = gemini_provider

        if not gemini_provider:
            raise BibTeXError("Gemini provider required for LLM BibTeX extraction")

    def extract(self, pdf_path: str) -> Optional[List[Dict[str, Any]]]:
        """Extract BibTeX from PDF using LLM.

        Args:
            pdf_path: Path to PDF file

        Returns:
            List of parsed BibTeX entries, or None if extraction fails
        """
        if not os.path.exists(pdf_path):
            raise BibTeXError(f"PDF file not found: {pdf_path}")

        logger.info(f"Attempting BibTeX extraction with LLM: {os.path.basename(pdf_path)}")

        # Construct prompt for BibTeX extraction
        bibtex_prompt = f"""Analyze the beginning of the attached PDF file ({os.path.basename(pdf_path)}).
Extract the core bibliographic information (title, authors, year, publication source like journal name or conference proceedings, volume, issue, pages if available).
Format this information STRICTLY as a single BibTeX entry (e.g., @article{{...}}, @inproceedings{{...}}, etc.).
Use a descriptive BibTeX key (e.g., AuthorLastNameYearTitleKeyword).
Output ONLY the BibTeX entry itself, starting with `@`. Do not include any introductory text, explanation, or ```bibtex markers. If you cannot reliably extract the information, return an empty string.
"""

        try:
            # Use Gemini provider to generate BibTeX
            bibtex_string = self.gemini_provider.generate_with_files(
                prompt=bibtex_prompt,
                file_paths=[pdf_path],
                model=self.config.gemini_model_bibtex if self.config else None
            )

            if not bibtex_string or not bibtex_string.strip().startswith("@"):
                logger.warning(
                    f"LLM did not return valid BibTeX for {os.path.basename(pdf_path)}"
                )
                return None

            # Parse the generated BibTeX
            parsed_entries = parse_bibtex(bibtex_string)
            if parsed_entries:
                logger.info(
                    f"Successfully extracted BibTeX using LLM: {os.path.basename(pdf_path)}"
                )
                return parsed_entries
            else:
                logger.warning(
                    f"LLM generated BibTeX-like string but parsing failed: {os.path.basename(pdf_path)}"
                )
                return None

        except Exception as e:
            logger.error(f"LLM BibTeX extraction failed for {pdf_path}: {e}")
            return None

    def supports_batch(self) -> bool:
        """LLM extractor doesn't support batch processing."""
        return False
