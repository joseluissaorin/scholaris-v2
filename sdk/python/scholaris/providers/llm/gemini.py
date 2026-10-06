"""Google Gemini LLM provider implementation."""
import os
import time
import logging
import re
from typing import List, Optional

try:
    import google.generativeai as genai
    from google.generativeai import types
    GEMINI_AVAILABLE = True
except ImportError:
    GEMINI_AVAILABLE = False

from .base import BaseLLMProvider
from ...exceptions import LLMError
from ...utils.rate_limiter import rate_limit_api

logger = logging.getLogger(__name__)


class GeminiProvider(BaseLLMProvider):
    """Google Gemini LLM provider.

    Supports text generation with optional file uploads (PDFs, images, etc.).
    Uses the google-generativeai library for API access.
    """

    def __init__(self, config):
        """Initialize Gemini provider.

        Args:
            config: Configuration object with gemini_api_key

        Raises:
            LLMError: If Gemini library not installed or API key missing
        """
        super().__init__(config)

        if not GEMINI_AVAILABLE:
            raise LLMError(
                "google-generativeai library not installed. "
                "Install it with: pip install google-generativeai"
            )

        if not self.config.gemini_api_key:
            raise LLMError("GEMINI_API_KEY not configured")

        # Configure Gemini client
        try:
            genai.configure(api_key=self.config.gemini_api_key)
            self.client = genai
            logger.info("Google Generative AI client configured successfully")
        except Exception as e:
            raise LLMError(f"Failed to configure Gemini client: {e}")

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
            model: Optional specific model (defaults to config.gemini_model_default)
            temperature: Generation temperature (0.0-2.0)
            max_tokens: Maximum tokens to generate

        Returns:
            Generated text

        Raises:
            LLMError: If generation fails
        """
        if not model:
            model = self.config.gemini_model_default

        logger.info(f"Generating with Gemini model: {model}")

        # Apply rate limiting
        rate_limit_api("gemini", 15, 60)

        # Configure generation
        generation_config = types.GenerationConfig(
            temperature=temperature,
        )
        if max_tokens:
            generation_config.max_output_tokens = max_tokens

        try:
            gen_model = self.client.GenerativeModel(model)
            response = gen_model.generate_content(
                contents=[prompt],
                generation_config=generation_config
            )

            text = response.text

            # Post-process: trim pre-title content
            text = self._post_process_text(text)

            return text

        except Exception as e:
            logger.error(f"Gemini generation error: {e}")
            raise LLMError(f"Gemini generation failed: {e}")

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
            file_paths: List of file paths to upload
            model: Optional specific model
            temperature: Generation temperature

        Returns:
            Generated text

        Raises:
            LLMError: If generation fails
            FileNotFoundError: If files don't exist
        """
        if not model:
            model = self.config.gemini_model_default

        logger.info(f"Generating with Gemini model: {model} with {len(file_paths)} files")

        # Apply rate limiting
        rate_limit_api("gemini", 15, 60)

        uploaded_files = []

        try:
            # Upload files
            logger.info(f"Uploading {len(file_paths)} files to Gemini...")
            for file_path in file_paths:
                if not os.path.exists(file_path):
                    raise FileNotFoundError(f"File not found: {file_path}")

                try:
                    uploaded_file = self.client.upload_file(path=file_path)
                    time.sleep(2)  # Wait for processing

                    # Verify file state
                    file_info = self.client.get_file(name=uploaded_file.name)
                    if file_info.state.name != "ACTIVE":
                        logger.warning(
                            f"File {uploaded_file.name} not active after upload "
                            f"(state: {file_info.state.name}). Waiting..."
                        )
                        time.sleep(10)
                        file_info = self.client.get_file(name=uploaded_file.name)
                        if file_info.state.name != "ACTIVE":
                            raise LLMError(
                                f"File {uploaded_file.name} failed to become active. "
                                f"Final state: {file_info.state.name}"
                            )

                    uploaded_files.append(uploaded_file)
                    logger.info(
                        f"Uploaded file: {file_path} as {uploaded_file.name}, "
                        f"URI: {uploaded_file.uri}"
                    )

                except FileNotFoundError:
                    raise
                except Exception as e:
                    logger.error(f"Failed to upload file {file_path}: {e}")
                    raise LLMError(f"File upload failed for {file_path}: {e}")

            # Construct contents: uploaded files + text prompt
            contents_for_api = uploaded_files + [prompt]
            logger.info(
                f"Constructed contents: {len(uploaded_files)} file(s) and 1 text prompt"
            )

            # Configure generation
            generation_config = types.GenerationConfig(
                temperature=temperature,
            )

            # Generate content
            logger.info(f"Sending request to Gemini API model '{model}'...")
            gen_model = self.client.GenerativeModel(model)
            response = gen_model.generate_content(
                contents=contents_for_api,
                generation_config=generation_config
            )

            text = response.text

            # Post-process
            text = self._post_process_text(text)

            return text

        except (FileNotFoundError, LLMError):
            raise
        except Exception as e:
            logger.error(f"Gemini generation with files error: {e}")
            raise LLMError(f"Gemini generation with files failed: {e}")

        finally:
            # Clean up uploaded files
            if uploaded_files:
                logger.info("Cleaning up uploaded Gemini files...")
                for f in uploaded_files:
                    try:
                        # Check if file still exists
                        try:
                            self.client.get_file(name=f.name)
                        except Exception:
                            logger.info(f"File {f.name} already deleted or inaccessible")
                            continue

                        self.client.delete_file(name=f.name)
                        logger.info(f"Deleted uploaded file: {f.name}")
                    except Exception as del_e:
                        logger.warning(f"Failed to delete uploaded file {f.name}: {del_e}")

    def supports_file_upload(self) -> bool:
        """Gemini supports file uploads.

        Returns:
            True
        """
        return True

    def get_default_model(self) -> str:
        """Get the default Gemini model.

        Returns:
            Default model name from config
        """
        return self.config.gemini_model_default

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
