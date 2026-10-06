"""PyPaperBot search provider implementation."""
import os
import re
import subprocess
import logging
import datetime
from typing import List, Optional
from .base import BaseSearchProvider, SearchResult
from ...exceptions import SearchError, DownloadError

logger = logging.getLogger(__name__)


class PyPaperBotProvider(BaseSearchProvider):
    """Search provider using PyPaperBot (Google Scholar + Sci-Hub).

    PyPaperBot is invoked as a subprocess and results are parsed
    from the output directory structure.
    """

    def __init__(self, config: Optional[any] = None):
        """Initialize PyPaperBot provider.

        Args:
            config: Configuration object with scihub_mirror setting
        """
        super().__init__(config)
        self.scihub_mirror = (
            config.scihub_mirror if config and hasattr(config, 'scihub_mirror')
            else "https://www.sci-hub.ru"
        )

    def search(
        self,
        query: str,
        max_results: int = 10,
        min_year: Optional[int] = None,
        output_dir: Optional[str] = None,
        scholar_pages: int = 1,
        **kwargs
    ) -> List[SearchResult]:
        """Search for papers using PyPaperBot.

        Args:
            query: Search query (can be a topic or specific paper title)
            max_results: Maximum papers to download (not strictly enforced by PyPaperBot)
            min_year: Minimum publication year
            output_dir: Directory to download papers to
            scholar_pages: Number of Google Scholar pages to search
            **kwargs: Additional arguments

        Returns:
            List of SearchResult objects

        Raises:
            SearchError: If search fails
        """
        # Determine min_year if not provided
        if min_year is None:
            current_year = datetime.datetime.now().year
            min_year = current_year - 5  # Default: last 5 years

        # Create output directory
        if output_dir is None:
            sanitized_query = re.sub(r'[^a-zA-Z0-9_\-]', '_', query)[:50]
            output_dir = f"./papers/{sanitized_query}"

        os.makedirs(output_dir, exist_ok=True)

        # Try python3 first, fallback to python for universal compatibility
        python_commands = ["python3", "python"]
        last_error = None

        for python_cmd in python_commands:
            cmd = [
                python_cmd, "-m", "PyPaperBot",
                "--query", query,
                "--dwn-dir", output_dir,
                "--scholar-pages", str(scholar_pages),
                "--min-year", str(min_year),
                "--scihub-mirror", self.scihub_mirror
            ]

            logger.info(f"Running PyPaperBot: {' '.join(cmd)}")

            try:
                # Run PyPaperBot
                process = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=7200,  # 2-hour timeout
                    check=True
                )

                logger.info(f"PyPaperBot completed for query '{query}' using {python_cmd}")
                if process.stderr:
                    logger.debug(f"PyPaperBot stderr: {process.stderr[-300:]}")

                # Success - break out of loop
                break

            except subprocess.CalledProcessError as e:
                logger.error(f"PyPaperBot failed for '{query}' with {python_cmd}: {e.stderr}")
                raise SearchError(f"PyPaperBot search failed: {e.stderr[:200]}")
            except subprocess.TimeoutExpired:
                logger.error(f"PyPaperBot timed out for '{query}' with {python_cmd}")
                raise SearchError(f"PyPaperBot search timed out for query: {query}")
            except FileNotFoundError as e:
                # Try next python command
                last_error = e
                logger.debug(f"{python_cmd} not found, trying next option...")
                continue
        else:
            # All python commands failed
            logger.error("PyPaperBot not found with any Python command")
            raise SearchError(
                "PyPaperBot command not found. Install it with: pip install PyPaperBot\n"
                f"Tried: {', '.join(python_commands)}"
            )

        # Parse results from output directory
        results = self._parse_results(output_dir)
        logger.info(f"Found {len(results)} papers for query '{query}'")

        return results[:max_results] if max_results else results

    def _parse_results(self, output_dir: str) -> List[SearchResult]:
        """Parse PyPaperBot results from output directory.

        Args:
            output_dir: Directory containing downloaded papers

        Returns:
            List of SearchResult objects
        """
        results = []

        if not os.path.exists(output_dir):
            return results

        # Look for bibtex.bib file
        bibtex_path = os.path.join(output_dir, "bibtex.bib")
        if os.path.exists(bibtex_path):
            # Parse bibtex file (simplified - will use proper parser later)
            try:
                with open(bibtex_path, 'r', encoding='utf-8', errors='ignore') as f:
                    bibtex_content = f.read()
                    # Basic parsing - extract titles and create results
                    # This is simplified; actual implementation should use bibtexparser
                    logger.debug(f"Found bibtex.bib with {len(bibtex_content)} characters")
            except Exception as e:
                logger.warning(f"Failed to read bibtex file: {e}")

        # List PDFs in directory
        for filename in os.listdir(output_dir):
            if filename.lower().endswith('.pdf'):
                pdf_path = os.path.join(output_dir, filename)

                # Try to get file size to verify it's not empty
                try:
                    file_size = os.path.getsize(pdf_path)
                    if file_size < 1024:  # Skip very small files
                        logger.warning(f"Skipping small PDF: {filename} ({file_size} bytes)")
                        continue
                except OSError:
                    continue

                # Create a basic SearchResult from filename
                # Title is extracted from filename (cleaned up)
                title = os.path.splitext(filename)[0].replace('_', ' ')

                result = SearchResult(
                    title=title,
                    authors=[],  # Will be populated from bibtex if available
                    year=0,  # Will be populated from bibtex if available
                    pdf_url=None,
                    url=None,
                    abstract=None,
                )

                # Store the local PDF path in a custom attribute
                # (SearchResult doesn't have pdf_path, but we can add it to the Paper later)
                result._local_pdf_path = pdf_path

                results.append(result)

        return results

    def download_pdf(
        self,
        result: SearchResult,
        output_path: str
    ) -> Optional[str]:
        """Download PDF for a search result.

        Note: PyPaperBot handles downloading during search,
        so this method mainly copies/moves existing PDFs.

        Args:
            result: SearchResult with PDF information
            output_path: Path to save PDF

        Returns:
            Path to downloaded PDF

        Raises:
            DownloadError: If download fails
        """
        # If result already has a local PDF path, copy it
        if hasattr(result, '_local_pdf_path'):
            import shutil
            try:
                os.makedirs(os.path.dirname(output_path), exist_ok=True)
                shutil.copy2(result._local_pdf_path, output_path)
                logger.info(f"Copied PDF to {output_path}")
                return output_path
            except Exception as e:
                raise DownloadError(f"Failed to copy PDF: {e}")

        # If we have a pdf_url, try to download it
        if result.pdf_url:
            import requests
            try:
                response = requests.get(result.pdf_url, timeout=60)
                response.raise_for_status()

                os.makedirs(os.path.dirname(output_path), exist_ok=True)
                with open(output_path, 'wb') as f:
                    f.write(response.content)

                logger.info(f"Downloaded PDF to {output_path}")
                return output_path
            except Exception as e:
                raise DownloadError(f"Failed to download PDF from {result.pdf_url}: {e}")

        logger.warning(f"No PDF available for result: {result.title}")
        return None
