"""Custom exceptions for Scholaris."""


class ScholarisError(Exception):
    """Base exception for all Scholaris errors."""

    pass


class ConfigurationError(ScholarisError):
    """Raised when configuration is invalid or missing."""

    pass


class SearchError(ScholarisError):
    """Raised when paper search fails."""

    pass


class DownloadError(ScholarisError):
    """Raised when PDF download fails."""

    pass


class BibTeXError(ScholarisError):
    """Raised when BibTeX parsing or generation fails."""

    pass


class LLMError(ScholarisError):
    """Raised when LLM API call fails."""

    pass


class RateLimitError(LLMError):
    """Raised when API rate limit is hit."""

    def __init__(self, message: str, retry_after: float = 0):
        super().__init__(message)
        self.retry_after = retry_after


class ConversionError(ScholarisError):
    """Raised when format conversion fails."""

    pass


class ValidationError(ScholarisError):
    """Raised when input validation fails."""

    pass


# Aliases for backward compatibility
ConfigError = ConfigurationError
