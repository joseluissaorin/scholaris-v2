"""Base LLM provider interface."""
from abc import ABC, abstractmethod
from typing import List, Optional, Dict, Any
from ..base import BaseProvider


class BaseLLMProvider(BaseProvider):
    """Abstract base class for LLM providers."""

    @abstractmethod
    def generate(
        self,
        prompt: str,
        model: Optional[str] = None,
        temperature: float = 1.0,
        max_tokens: Optional[int] = None,
    ) -> str:
        """Generate text from a prompt.

        Args:
            prompt: Text prompt for generation
            model: Optional specific model name
            temperature: Generation temperature (0.0-2.0)
            max_tokens: Maximum tokens to generate

        Returns:
            Generated text

        Raises:
            LLMError: If generation fails
        """
        pass

    @abstractmethod
    def generate_with_files(
        self,
        prompt: str,
        file_paths: List[str],
        model: Optional[str] = None,
        temperature: float = 1.0,
    ) -> str:
        """Generate text from a prompt with file context.

        Args:
            prompt: Text prompt for generation
            file_paths: List of file paths to upload for context
            model: Optional specific model name
            temperature: Generation temperature

        Returns:
            Generated text

        Raises:
            LLMError: If generation fails
            FileNotFoundError: If files don't exist
        """
        pass

    @abstractmethod
    def supports_file_upload(self) -> bool:
        """Whether this provider supports file uploads.

        Returns:
            True if file uploads are supported
        """
        pass

    def get_default_model(self) -> str:
        """Get the default model for this provider.

        Returns:
            Default model name
        """
        return self.config.gemini_model_default if hasattr(self.config, 'gemini_model_default') else None
