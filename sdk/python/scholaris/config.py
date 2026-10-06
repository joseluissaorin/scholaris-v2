"""Configuration management for Scholaris."""
import os
from dataclasses import dataclass, field
from typing import Optional
from dotenv import load_dotenv


@dataclass
class Config:
    """Scholaris configuration.

    Attributes:
        llm_provider: Default LLM provider ('gemini', 'perplexity', 'deepseek')
        gemini_api_key: API key for Google Gemini
        perplexity_api_key: API key for Perplexity
        deepseek_api_key: API key for DeepSeek
        gemini_model_default: Default Gemini model
        gemini_model_thinking: Gemini thinking model for review generation
        gemini_model_parsing: Gemini model for bibliography parsing
        gemini_model_bibtex: Gemini model for BibTeX extraction
        search_provider: Search backend ('pypaperbot')
        max_papers_per_keyword: Maximum papers to download per keyword
        min_publication_year: Minimum publication year filter
        scihub_mirror: Sci-Hub mirror URL for PDF downloads
        citation_style: Citation style for references ('APA7')
        default_language: Default language for generated content
        min_words_per_section: Minimum words per section in generated reviews
        output_dir: Directory for output files
        papers_dir: Directory for downloaded papers
        temp_dir: Directory for temporary files
        enable_rate_limiting: Enable API rate limiting
    """

    # LLM Settings
    llm_provider: str = "gemini"
    gemini_api_key: Optional[str] = None
    perplexity_api_key: Optional[str] = None
    deepseek_api_key: Optional[str] = None

    # Gemini Model Configuration
    gemini_model_default: str = "gemini-2.0-flash-exp"
    gemini_model_thinking: str = "gemini-2.0-flash-exp"  # Use same as default (thinking model not available)
    gemini_model_parsing: str = "gemini-2.0-flash-exp"
    gemini_model_bibtex: str = "gemini-2.0-flash-exp"

    # Search Settings
    search_provider: str = "pypaperbot"
    max_papers_per_keyword: int = 10
    min_publication_year: Optional[int] = None
    scihub_mirror: str = "https://www.sci-hub.ru"

    # Generation Settings
    citation_style: str = "APA7"
    default_language: str = "English"
    min_words_per_section: int = 2250

    # Storage
    output_dir: str = "./output"
    papers_dir: str = "./papers"
    temp_dir: str = "./temp"

    # Rate Limiting
    enable_rate_limiting: bool = True

    @classmethod
    def from_env(cls, env_file: Optional[str] = None) -> "Config":
        """Load configuration from environment variables.

        Args:
            env_file: Path to .env file (optional)

        Returns:
            Config instance with values from environment
        """
        if env_file:
            load_dotenv(env_file)
        else:
            load_dotenv()

        return cls(
            llm_provider=os.getenv("SCHOLARIS_LLM_PROVIDER", "gemini"),
            gemini_api_key=os.getenv("GEMINI_API_KEY"),
            perplexity_api_key=os.getenv("PERPLEXITY_API_KEY"),
            deepseek_api_key=os.getenv("DEEPSEEK_API_KEY"),
            gemini_model_default=os.getenv("GEMINI_MODEL_DEFAULT", "gemini-2.0-flash"),
            gemini_model_thinking=os.getenv(
                "GEMINI_MODEL_THINKING", "gemini-2.0-flash-thinking-exp-01-21"
            ),
            gemini_model_parsing=os.getenv("GEMINI_MODEL_PARSING", "gemini-2.0-flash"),
            gemini_model_bibtex=os.getenv("GEMINI_MODEL_BIBTEX", "gemini-2.0-flash"),
            search_provider=os.getenv("SCHOLARIS_SEARCH_PROVIDER", "pypaperbot"),
            max_papers_per_keyword=int(os.getenv("SCHOLARIS_MAX_PAPERS_PER_KEYWORD", "10")),
            min_publication_year=int(year)
            if (year := os.getenv("SCHOLARIS_MIN_PUBLICATION_YEAR"))
            else None,
            scihub_mirror=os.getenv("SCHOLARIS_SCIHUB_MIRROR", "https://www.sci-hub.ru"),
            citation_style=os.getenv("SCHOLARIS_CITATION_STYLE", "APA7"),
            default_language=os.getenv("SCHOLARIS_DEFAULT_LANGUAGE", "English"),
            min_words_per_section=int(os.getenv("SCHOLARIS_MIN_WORDS_PER_SECTION", "2250")),
            output_dir=os.getenv("SCHOLARIS_OUTPUT_DIR", "./output"),
            papers_dir=os.getenv("SCHOLARIS_PAPERS_DIR", "./papers"),
            temp_dir=os.getenv("SCHOLARIS_TEMP_DIR", "./temp"),
            enable_rate_limiting=os.getenv("SCHOLARIS_ENABLE_RATE_LIMITING", "true").lower()
            == "true",
        )

    @classmethod
    def from_dict(cls, config_dict: dict) -> "Config":
        """Load configuration from dictionary.

        Args:
            config_dict: Dictionary with configuration values

        Returns:
            Config instance
        """
        return cls(**{k: v for k, v in config_dict.items() if k in cls.__annotations__})
