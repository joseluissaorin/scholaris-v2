"""Perplexity LLM provider implementation."""
import logging
import re
from typing import List, Optional

import requests

from .base import BaseLLMProvider
from ...exceptions import LLMError
from ...utils.rate_limiter import rate_limit_api

logger = logging.getLogger(__name__)


class PerplexityProvider(BaseLLMProvider):
    """Perplexity LLM provider.

    Uses the Perplexity API for text generation. Does not support file uploads.
    Supports models like "sonar-deep-research" and "sonar-reasoning".
    """

    def __init__(self, config):
        """Initialize Perplexity provider.

        Args:
            config: Configuration object with perplexity_api_key

        Raises:
            LLMError: If API key is missing
        """
        super().__init__(config)

        if not self.config.perplexity_api_key:
            raise LLMError("PERPLEXITY_API_KEY not configured")

        self.api_url = "https://api.perplexity.ai/chat/completions"
        logger.info("Perplexity provider initialized successfully")

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
            model: Optional specific model (defaults to "sonar-deep-research")
            temperature: Generation temperature (0.0-2.0)
            max_tokens: Maximum tokens to generate

        Returns:
            Generated text

        Raises:
            LLMError: If generation fails
        """
        if not model:
            model = "sonar-deep-research"

        logger.info(f"Generating with Perplexity model: {model}")

        # Apply rate limiting (5 calls per minute)
        rate_limit_api("perplexity", 5, 60)

        headers = {
            "Authorization": f"Bearer {self.config.perplexity_api_key}",
            "Content-Type": "application/json"
        }

        data = {
            "model": model,
            "messages": [
                {"role": "user", "content": prompt}
            ],
        }

        if temperature is not None:
            data["temperature"] = temperature

        if max_tokens:
            data["max_tokens"] = max_tokens

        try:
            logger.info("Sending request to Perplexity API...")
            response = requests.post(self.api_url, headers=headers, json=data)

            if response.status_code != 200:
                logger.error(
                    f"Perplexity API error: {response.status_code}, {response.text}"
                )
                raise LLMError(
                    f"Perplexity API error: {response.status_code}, {response.text}"
                )

            result = response.json()
            text = result.get("choices", [{}])[0].get("message", {}).get("content", "")

            if not text:
                logger.error(f"Perplexity API returned empty content. Response: {result}")
                raise LLMError("Perplexity API returned empty content")

            # Post-process
            text = self._post_process_text(text)

            return text

        except requests.exceptions.RequestException as e:
            logger.error(f"Perplexity API request failed: {e}")
            raise LLMError(f"Perplexity API request failed: {e}")
        except Exception as e:
            logger.error(f"Perplexity generation error: {e}")
            raise LLMError(f"Perplexity generation failed: {e}")

    def generate_with_files(
        self,
        prompt: str,
        file_paths: List[str],
        model: Optional[str] = None,
        temperature: float = 1.0,
    ) -> str:
        """Perplexity does not support file uploads.

        Args:
            prompt: Text prompt for generation
            file_paths: List of file paths (ignored)
            model: Optional specific model
            temperature: Generation temperature

        Returns:
            Generated text (files are ignored)

        Raises:
            LLMError: If generation fails
        """
        logger.warning(
            "Perplexity does not support file uploads. Files will be ignored."
        )
        return self.generate(prompt, model=model, temperature=temperature)

    def supports_file_upload(self) -> bool:
        """Perplexity does not support file uploads.

        Returns:
            False
        """
        return False

    def get_default_model(self) -> str:
        """Get the default Perplexity model.

        Returns:
            "sonar-deep-research"
        """
        return "sonar-deep-research"

    def _post_process_text(self, text: str) -> str:
        """Post-process generated text.

        Trims content before the first markdown header.

        Args:
            text: Raw generated text

        Returns:
            Post-processed text
        """
        if not text:
            return text

        # Find first markdown header
        header_match = re.search(r'^\s*#\s+.+$', text, re.MULTILINE)
        if header_match:
            start_index = header_match.start()
            text = text[start_index:]

        return text
