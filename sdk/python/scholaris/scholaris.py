"""Main Scholaris class - entry point for the library."""
import os
import logging
from typing import List, Optional, Dict, Any

from .config import Config
from .core.models import Paper, Reference, Review
from .exceptions import ConfigurationError, SearchError, BibTeXError
from .providers.search.pypaperbot import PyPaperBotProvider
from .providers.bibtex.pdf2bib import Pdf2BibExtractor
from .providers.bibtex.llm_fallback import LLMBibtexExtractor
from .converters.bibtex_parser import (
    parse_bibtex,
    parse_bibtex_file,
    save_bibtex,
    format_bibtex_metadata,
)
from .core.citation import CitationFormatter
from .core.review import ReviewGenerator
from .converters.docx_converter import DocxConverter
from .converters.html_converter import HtmlConverter
from .utils.logging import setup_logging

try:
    from .providers.llm.gemini import GeminiProvider
    GEMINI_AVAILABLE = True
except ImportError:
    GEMINI_AVAILABLE = False

logger = logging.getLogger(__name__)


class Scholaris:
    """Main entry point for Scholaris academic library.

    Example:
        >>> from scholaris import Scholaris
        >>> scholar = Scholaris(gemini_api_key="your-key")
        >>> papers = scholar.search_papers("Machine Learning", max_papers=10)
        >>> review = scholar.generate_review("AI Ethics", papers=papers)
    """

    def __init__(
        self,
        gemini_api_key: Optional[str] = None,
        perplexity_api_key: Optional[str] = None,
        deepseek_api_key: Optional[str] = None,
        search_provider: str = "pypaperbot",
        llm_provider: str = "gemini",
        config: Optional[Config] = None,
        log_level: int = logging.INFO,
    ):
        """Initialize Scholaris.

        Args:
            gemini_api_key: API key for Google Gemini
            perplexity_api_key: API key for Perplexity
            deepseek_api_key: API key for DeepSeek
            search_provider: Search backend to use ('pypaperbot')
            llm_provider: LLM provider to use ('gemini', 'perplexity', 'deepseek')
            config: Optional Config object (overrides other parameters)
            log_level: Logging level (default: INFO)
        """
        # Setup logging
        setup_logging(level=log_level)

        # Initialize configuration
        if config is None:
            config = Config.from_env()

        # Override with provided API keys
        if gemini_api_key:
            config.gemini_api_key = gemini_api_key
        if perplexity_api_key:
            config.perplexity_api_key = perplexity_api_key
        if deepseek_api_key:
            config.deepseek_api_key = deepseek_api_key

        config.search_provider = search_provider
        config.llm_provider = llm_provider

        self.config = config

        # Initialize providers
        self._init_providers()

        logger.info(f"Scholaris initialized with {search_provider} search and {llm_provider} LLM")

    def _init_providers(self):
        """Initialize search and LLM providers."""
        # Initialize search provider
        if self.config.search_provider == "pypaperbot":
            self.search_provider = PyPaperBotProvider(self.config)
        else:
            raise ConfigurationError(
                f"Unsupported search provider: {self.config.search_provider}"
            )

        # Initialize BibTeX extractors
        try:
            self.pdf2bib_extractor = Pdf2BibExtractor(self.config)
        except BibTeXError as e:
            logger.warning(f"pdf2bib not available: {e}")
            self.pdf2bib_extractor = None

        # LLM BibTeX extractor will be initialized when needed (requires Gemini provider)
        self.llm_bibtex_extractor = None

        # Initialize LLM provider if configured
        self.llm_provider = None
        if self.config.llm_provider == "gemini" and GEMINI_AVAILABLE:
            if self.config.gemini_api_key:
                try:
                    self.llm_provider = GeminiProvider(self.config)
                    logger.info("Gemini LLM provider initialized successfully")
                except Exception as e:
                    logger.warning(f"Failed to initialize Gemini provider: {e}")
                    self.llm_provider = None
            else:
                logger.warning("Gemini API key not configured. LLM features will be limited.")
        elif self.config.llm_provider != "gemini":
            logger.warning(f"LLM provider '{self.config.llm_provider}' not yet implemented")


    # ==================== Phase 1: Search & Download ====================

    def search_papers(
        self,
        topic: str,
        max_papers: int = 20,
        min_year: Optional[int] = None,
        keywords: Optional[List[str]] = None,
        gemini_model: Optional[str] = None,
    ) -> List[Paper]:
        """Search for academic papers on a topic.

        Args:
            topic: Research topic to search for
            max_papers: Maximum number of papers to find
            min_year: Minimum publication year
            keywords: Optional list of specific keywords to search
            gemini_model: Optional Gemini model for keyword extraction

        Returns:
            List of Paper objects

        Raises:
            SearchError: If search fails
        """
        logger.info(f"Searching for papers on topic: '{topic}'")

        # If no keywords provided, search directly with topic
        if keywords is None:
            # Future: use LLM to extract keywords from topic
            # For now, just use the topic directly
            keywords = [topic]

        all_papers = []
        for keyword in keywords:
            try:
                results = self.search_provider.search(
                    query=keyword,
                    max_results=max_papers // len(keywords),
                    min_year=min_year or self.config.min_publication_year,
                )

                # Convert SearchResults to Papers
                for i, result in enumerate(results):
                    paper = result.to_paper(paper_id=f"{keyword}_{i}")
                    # Add local PDF path if available
                    if hasattr(result, '_local_pdf_path'):
                        paper.pdf_path = result._local_pdf_path
                    all_papers.append(paper)

            except Exception as e:
                logger.error(f"Search failed for keyword '{keyword}': {e}")
                # Continue with other keywords

        logger.info(f"Found {len(all_papers)} papers total")
        return all_papers[:max_papers]

    def search_from_bibliography(
        self,
        bibliography_list: List[str],
        gemini_model: Optional[str] = None,
    ) -> List[Paper]:
        """Parse bibliography list and search for specific papers.

        This method uses Gemini to extract paper titles from bibliography
        entries, then searches for each specific paper.

        Args:
            bibliography_list: List of bibliography entries/references
            gemini_model: Optional Gemini model for parsing

        Returns:
            List of Paper objects found

        Raises:
            SearchError: If search fails
            LLMError: If bibliography parsing fails
        """
        logger.info(f"Parsing {len(bibliography_list)} bibliography entries")

        # TODO: Implement LLM-based title extraction
        # For now, use bibliography entries directly as search queries
        all_papers = []

        for bib_entry in bibliography_list:
            try:
                # Search for this specific entry
                results = self.search_provider.search(
                    query=bib_entry,
                    max_results=1,  # Only get first match
                )

                if results:
                    paper = results[0].to_paper()
                    if hasattr(results[0], '_local_pdf_path'):
                        paper.pdf_path = results[0]._local_pdf_path
                    all_papers.append(paper)
                    logger.info(f"Found paper: {paper.title}")
                else:
                    logger.warning(f"No results for bibliography entry: {bib_entry[:50]}...")

            except Exception as e:
                logger.error(f"Failed to search for entry: {e}")
                continue

        logger.info(f"Found {len(all_papers)} papers from bibliography list")
        return all_papers

    def download_papers(
        self,
        papers: List[Paper],
        output_dir: str = "./papers",
    ) -> List[str]:
        """Download PDFs for papers.

        Args:
            papers: List of Paper objects to download
            output_dir: Directory to save PDFs

        Returns:
            List of paths to downloaded PDFs

        Raises:
            DownloadError: If downloads fail
        """
        logger.info(f"Downloading {len(papers)} papers to {output_dir}")
        os.makedirs(output_dir, exist_ok=True)

        downloaded_paths = []

        for paper in papers:
            # Skip if already have local PDF
            if paper.pdf_path and os.path.exists(paper.pdf_path):
                downloaded_paths.append(paper.pdf_path)
                continue

            # Generate output filename
            safe_title = "".join(c for c in paper.title if c.isalnum() or c in (' ', '-', '_'))[:50]
            output_path = os.path.join(output_dir, f"{safe_title}.pdf")

            try:
                # Note: For PyPaperBot, papers are downloaded during search
                # This method is mainly for other providers or manual downloads
                if paper.pdf_path and os.path.exists(paper.pdf_path):
                    import shutil
                    shutil.copy2(paper.pdf_path, output_path)
                    downloaded_paths.append(output_path)
                    paper.pdf_path = output_path
                    logger.info(f"Downloaded: {paper.title}")
                else:
                    logger.warning(f"No PDF available for: {paper.title}")

            except Exception as e:
                logger.error(f"Failed to download {paper.title}: {e}")
                continue

        logger.info(f"Downloaded {len(downloaded_paths)} PDFs")
        return downloaded_paths

    # ==================== Phase 2: BibTeX Generation ====================

    def generate_bibtex(
        self,
        pdf_paths: List[str],
        method: str = "auto",
        gemini_model: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Generate BibTeX entries from PDFs.

        Args:
            pdf_paths: List of paths to PDF files
            method: Extraction method - "auto" (try pdf2bib first, then LLM),
                   "pdf2bib" (only pdf2bib), or "llm" (only LLM)
            gemini_model: Optional Gemini model for LLM fallback

        Returns:
            List of BibTeX entry dictionaries

        Raises:
            BibTeXError: If extraction fails
        """
        logger.info(f"Generating BibTeX for {len(pdf_paths)} PDFs using method '{method}'")

        all_entries = []

        for pdf_path in pdf_paths:
            if not os.path.exists(pdf_path):
                logger.error(f"PDF not found: {pdf_path}")
                continue

            entry = None

            # Try pdf2bib if available and method allows
            if method in ["auto", "pdf2bib"] and self.pdf2bib_extractor:
                try:
                    logger.info(f"Trying pdf2bib for {os.path.basename(pdf_path)}")
                    entry = self.pdf2bib_extractor.extract(pdf_path)
                    if entry:
                        logger.info(f"✓ pdf2bib succeeded for {os.path.basename(pdf_path)}")
                except Exception as e:
                    logger.warning(f"pdf2bib failed for {os.path.basename(pdf_path)}: {e}")
                    entry = None

            # Try LLM fallback if needed and method allows
            if not entry and method in ["auto", "llm"]:
                # Initialize LLM BibTeX extractor if not already done
                if not self.llm_bibtex_extractor:
                    self._init_llm_bibtex_extractor()

                if self.llm_bibtex_extractor:
                    try:
                        logger.info(f"Trying LLM fallback for {os.path.basename(pdf_path)}")
                        entry = self.llm_bibtex_extractor.extract(pdf_path)
                        if entry:
                            logger.info(f"✓ LLM extraction succeeded for {os.path.basename(pdf_path)}")
                    except Exception as e:
                        logger.error(f"LLM extraction failed for {os.path.basename(pdf_path)}: {e}")
                        entry = None

            # Add entries if found
            if entry:
                all_entries.extend(entry)  # extract() returns a list
            else:
                logger.warning(f"Failed to extract BibTeX from {os.path.basename(pdf_path)}")

        logger.info(f"Generated {len(all_entries)} BibTeX entries from {len(pdf_paths)} PDFs")
        return all_entries

    def _init_llm_bibtex_extractor(self):
        """Initialize LLM BibTeX extractor (requires Gemini provider)."""
        if self.llm_bibtex_extractor:
            return  # Already initialized

        if not self.llm_provider:
            logger.warning(
                "LLM BibTeX extraction requires an LLM provider. "
                "Initialize Scholaris with gemini_api_key to enable this feature."
            )
            self.llm_bibtex_extractor = None
            return

        try:
            self.llm_bibtex_extractor = LLMBibtexExtractor(
                config=self.config,
                gemini_provider=self.llm_provider
            )
            logger.info("LLM BibTeX extractor initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize LLM BibTeX extractor: {e}")
            self.llm_bibtex_extractor = None

    def parse_bibtex_file(self, bib_file_path: str) -> List[Dict[str, Any]]:
        """Parse existing .bib file.

        Args:
            bib_file_path: Path to .bib file

        Returns:
            List of parsed BibTeX entry dictionaries

        Raises:
            BibTeXError: If file reading or parsing fails
        """
        logger.info(f"Parsing BibTeX file: {bib_file_path}")
        entries = parse_bibtex_file(bib_file_path)
        logger.info(f"Parsed {len(entries)} entries from {bib_file_path}")
        return entries

    def export_bibtex(
        self,
        bibtex_entries: List[Dict[str, Any]],
        output_path: str,
    ) -> None:
        """Export BibTeX entries to .bib file.

        Args:
            bibtex_entries: List of BibTeX entry dictionaries
            output_path: Path to save .bib file

        Raises:
            BibTeXError: If export fails
        """
        logger.info(f"Exporting {len(bibtex_entries)} BibTeX entries to {output_path}")
        save_bibtex(bibtex_entries, output_path)
        logger.info(f"✓ Exported BibTeX to {output_path}")

    def format_references(
        self,
        bibtex_entries: List[Dict[str, Any]],
        style: str = "APA7",
    ) -> str:
        """Format references in specified citation style.

        Args:
            bibtex_entries: List of BibTeX entry dictionaries
            style: Citation style (currently only "APA7" supported)

        Returns:
            Formatted reference list as string
        """
        logger.info(f"Formatting {len(bibtex_entries)} references in {style} style")
        formatted = CitationFormatter.format_reference_list(bibtex_entries, style=style)
        return formatted

    # ==================== Phase 3: Review Generation ====================

    def generate_review(
        self,
        topic: str,
        papers: Optional[List[Paper]] = None,
        bibtex_entries: Optional[List[Dict[str, Any]]] = None,
        sections: Optional[List[str]] = None,
        min_words_per_section: int = 2250,
        language: str = "English",
        gemini_model: Optional[str] = None,
        use_thinking_model: bool = True,
    ) -> Review:
        """Generate literature review from papers and topic.

        Args:
            topic: Research topic for the review
            papers: Optional list of Paper objects (PDFs will be used for context)
            bibtex_entries: Optional list of BibTeX entry dictionaries
            sections: Optional list of specific sections to include
            min_words_per_section: Minimum words per section (default: 2250)
            language: Output language (default: "English")
            gemini_model: Optional Gemini model override
            use_thinking_model: Use thinking model for generation (default: True)

        Returns:
            Review object with generated content

        Raises:
            LLMError: If review generation fails
            ConfigurationError: If LLM provider not configured
        """
        logger.info(f"Generating literature review for topic: '{topic}'")

        # Check if LLM provider is available
        if not self.llm_provider:
            raise ConfigurationError(
                "LLM provider not configured. Initialize Scholaris with gemini_api_key "
                "to enable review generation."
            )

        # Collect PDF paths from papers
        pdf_paths = []
        if papers:
            for paper in papers:
                if paper.pdf_path and os.path.exists(paper.pdf_path):
                    pdf_paths.append(paper.pdf_path)
            logger.info(f"Found {len(pdf_paths)} PDF files from {len(papers)} papers")

        # If no BibTeX entries provided, try to generate from PDFs
        if not bibtex_entries and pdf_paths:
            logger.info("No BibTeX entries provided. Generating from PDFs...")
            bibtex_entries = self.generate_bibtex(
                pdf_paths=pdf_paths,
                method="auto",
                gemini_model=gemini_model
            )

        if not bibtex_entries:
            logger.warning("No BibTeX entries available for review generation")
            bibtex_entries = []

        # Format references
        formatted_references = self.format_references(
            bibtex_entries,
            style="APA7"
        )

        # Initialize review generator
        review_generator = ReviewGenerator(
            llm_provider=self.llm_provider,
            config=self.config
        )

        # Generate review
        review = review_generator.generate_review(
            topic=topic,
            bibtex_entries=bibtex_entries,
            formatted_references=formatted_references,
            pdf_paths=pdf_paths,
            sections=sections,
            language=language,
            min_words_per_section=min_words_per_section,
            use_thinking_model=use_thinking_model
        )

        logger.info(
            f"✓ Review generated: {review.word_count} words, "
            f"{len(review.sections)} sections, {len(review.references)} references"
        )

        return review

    # ==================== Phase 4: Export & Complete Workflow ====================

    def export_markdown(self, review: Review, output_path: str) -> str:
        """Export review as Markdown file.

        Args:
            review: Review object to export
            output_path: Path to save Markdown file

        Returns:
            Path to saved file
        """
        logger.info(f"Exporting review to Markdown: {output_path}")

        try:
            with open(output_path, 'w', encoding='utf-8') as f:
                f.write(review.markdown)

            logger.info(f"✓ Markdown exported: {output_path}")
            return output_path

        except Exception as e:
            logger.error(f"Markdown export failed: {e}")
            raise

    def export_docx(self, review: Review, output_path: str) -> str:
        """Export review as DOCX file.

        Args:
            review: Review object to export
            output_path: Path to save DOCX file

        Returns:
            Path to saved file

        Raises:
            ConversionError: If export fails
        """
        logger.info(f"Exporting review to DOCX: {output_path}")

        converter = DocxConverter(output_folder=os.path.dirname(output_path) or ".")
        result = converter.convert(review.markdown, output_path)

        logger.info(f"✓ DOCX exported: {result}")
        return result

    def export_html(self, review: Review, output_path: str, include_css: bool = True) -> str:
        """Export review as HTML file.

        Args:
            review: Review object to export
            output_path: Path to save HTML file
            include_css: Include academic CSS styling (default: True)

        Returns:
            Path to saved file

        Raises:
            ConversionError: If export fails
        """
        logger.info(f"Exporting review to HTML: {output_path}")

        converter = HtmlConverter()
        result = converter.convert(review.markdown, output_path, include_css=include_css)

        logger.info(f"✓ HTML exported: {result}")
        return result

    def complete_workflow(
        self,
        topic: str,
        auto_search: bool = True,
        user_pdfs: Optional[List[str]] = None,
        user_bibtex: Optional[str] = None,
        max_papers: int = 20,
        min_year: Optional[int] = None,
        sections: Optional[List[str]] = None,
        min_words_per_section: int = 2250,
        language: str = "English",
        output_format: str = "markdown",
        output_path: Optional[str] = None,
    ) -> Review:
        """Complete academic workflow from start to finish.

        This method orchestrates all phases:
        1. Search for papers (if auto_search=True)
        2. Download PDFs
        3. Generate BibTeX entries
        4. Generate literature review
        5. Export to specified format

        Args:
            topic: Research topic
            auto_search: Automatically search for papers (default: True)
            user_pdfs: Optional list of user-provided PDF paths
            user_bibtex: Optional path to user-provided .bib file
            max_papers: Maximum papers to search (default: 20)
            min_year: Minimum publication year filter
            sections: Optional specific sections to generate
            min_words_per_section: Minimum words per section (default: 2250)
            language: Output language (default: "English")
            output_format: Export format - "markdown", "docx", "html" (default: "markdown")
            output_path: Optional custom output path

        Returns:
            Generated Review object

        Raises:
            ConfigurationError: If LLM provider not configured
            LLMError: If review generation fails
        """
        logger.info(f"Starting complete workflow for topic: '{topic}'")

        papers = []
        pdf_paths = []
        bibtex_entries = []

        # Phase 1: Search and Download
        if auto_search:
            logger.info("Phase 1: Searching for papers...")
            papers = self.search_papers(
                topic=topic,
                max_papers=max_papers,
                min_year=min_year
            )
            logger.info(f"Found {len(papers)} papers")

            logger.info("Downloading PDFs...")
            downloaded_paths = self.download_papers(
                papers,
                output_dir=self.config.papers_dir
            )
            pdf_paths.extend(downloaded_paths)
            logger.info(f"Downloaded {len(downloaded_paths)} PDFs")

        # Add user-provided PDFs
        if user_pdfs:
            for pdf_path in user_pdfs:
                if os.path.exists(pdf_path):
                    pdf_paths.append(pdf_path)
                else:
                    logger.warning(f"User PDF not found: {pdf_path}")
            logger.info(f"Added {len(user_pdfs)} user-provided PDFs")

        # Phase 2: BibTeX Generation
        logger.info("Phase 2: Generating BibTeX entries...")

        # Load user-provided BibTeX if available
        if user_bibtex and os.path.exists(user_bibtex):
            user_entries = self.parse_bibtex_file(user_bibtex)
            bibtex_entries.extend(user_entries)
            logger.info(f"Loaded {len(user_entries)} entries from user .bib file")

        # Generate BibTeX from PDFs
        if pdf_paths:
            generated_entries = self.generate_bibtex(
                pdf_paths=pdf_paths,
                method="auto"
            )
            bibtex_entries.extend(generated_entries)
            logger.info(f"Generated {len(generated_entries)} BibTeX entries from PDFs")

        if not bibtex_entries:
            logger.warning("No BibTeX entries available for review")

        # Phase 3: Review Generation
        logger.info("Phase 3: Generating literature review...")
        review = self.generate_review(
            topic=topic,
            papers=papers,
            bibtex_entries=bibtex_entries,
            sections=sections,
            min_words_per_section=min_words_per_section,
            language=language,
            use_thinking_model=True
        )

        logger.info(
            f"Review generated: {review.word_count} words, "
            f"{len(review.sections)} sections"
        )

        # Phase 4: Export
        if output_path:
            logger.info(f"Phase 4: Exporting to {output_format}...")

            if output_format.lower() == "docx":
                self.export_docx(review, output_path)
            elif output_format.lower() == "html":
                self.export_html(review, output_path)
            else:  # markdown
                self.export_markdown(review, output_path)

            logger.info(f"✓ Exported to: {output_path}")

        logger.info("✓ Complete workflow finished successfully")
        return review
