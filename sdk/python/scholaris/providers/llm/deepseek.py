"""DeepSeek LLM provider implementation."""
import logging
import re
from typing import List, Optional

import requests

from .base import BaseLLMProvider
from ...exceptions import LLMError
from ...utils.rate_limiter import rate_limit_api

logger = logging.getLogger(__name__)


class DeepSeekProvider(BaseLLMProvider):
    """DeepSeek LLM provider.

    Uses the DeepSeek API for text generation. Does not support file uploads.
    """

    def __init__(self, config):
        """Initialize DeepSeek provider.

        Args:
            config: Configuration object with deepseek_api_key

        Raises:
            LLMError: If API key is missing
        """
        super().__init__(config)

        if not self.config.deepseek_api_key:
            raise LLMError("DEEPSEEK_API_KEY not configured")

        self.api_url = "https://api.deepseek.com/chat/completions"
        logger.info("DeepSeek provider initialized successfully")

    def generate(
        self,
        prompt: str,
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
    ) -> str:
        """Generate text from a prompt.

        Args:
            prompt: Text prompt for generation
            model: Optional specific model (defaults to "deepseek-chat")
            temperature: Generation temperature (0.0-2.0)
            max_tokens: Maximum tokens to generate

        Returns:
            Generated text

        Raises:
            LLMError: If generation fails
        """
        if not model:
            model = "deepseek-chat"

        logger.info(f"Generating with DeepSeek model: {model}")

        # Apply rate limiting (30 calls per minute)
        rate_limit_api("deepseek", 30, 60)

        headers = {
            "Authorization": f"Bearer {self.config.deepseek_api_key}",
            "Content-Type": "application/json"
        }

        data = {
            "model": model,
            "messages": [
                {"role": "system", "content": "You are an AI writing assistant."},
                {"role": "user", "content": prompt}
            ],
            "temperature": temperature,
        }

        if max_tokens:
            data["max_tokens"] = max_tokens

        try:
            logger.info("Sending request to DeepSeek API...")
            response = requests.post(self.api_url, headers=headers, json=data)
            response.raise_for_status()

            result = response.json()

            if not result.get("choices"):
                logger.error(f"DeepSeek API returned no choices. Response: {result}")
                raise LLMError("DeepSeek API returned no choices")

            text = result["choices"][0]["message"]["content"].strip()

            # Post-process
            text = self._post_process_text(text)

            return text

        except requests.exceptions.RequestException as e:
            logger.error(f"DeepSeek API request failed: {e}")
            raise LLMError(f"DeepSeek API request failed: {e}")
        except Exception as e:
            logger.error(f"DeepSeek generation error: {e}")
            raise LLMError(f"DeepSeek generation failed: {e}")

    def generate_with_files(
        self,
        prompt: str,
        file_paths: List[str],
        model: Optional[str] = None,
        temperature: float = 0.7,
    ) -> str:
        """DeepSeek does not support file uploads.

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
            "DeepSeek does not support file uploads. Files will be ignored."
        )
        return self.generate(prompt, model=model, temperature=temperature)

    def supports_file_upload(self) -> bool:
        """DeepSeek does not support file uploads.

        Returns:
            False
        """
        return False

    def get_default_model(self) -> str:
        """Get the default DeepSeek model.

        Returns:
            "deepseek-chat"
        """
        return "deepseek-chat"

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
