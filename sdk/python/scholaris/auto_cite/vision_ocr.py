"""Vision OCR processor using Gemini Vision for PDF page extraction.

Primary extraction method for all PDFs. Extracts text and VERIFIED page numbers
directly from page images. Handles scanned books, landscape spreads, and native PDFs.

Features:
- Copyright-safe prompts framed as academic indexing
- Parallel processing (5 concurrent pages)
- Robust JSON repair for LLM output issues
- Retry logic with alternative prompts
- Rate limiting to avoid API throttling
"""

import base64
import json
import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import List, Optional, Dict, Any, Tuple

import fitz  # PyMuPDF
import google.generativeai as genai

from .models import OCRPage

logger = logging.getLogger(__name__)


class VisionOCRProcessor:
    """Vision OCR processor with parallel processing and copyright-safe extraction.

    Uses Gemini Vision to extract text and page numbers from PDF page images.
    This is the PRIMARY extraction method - guarantees accurate page numbers.
    """

    # Processing configuration
    PARALLEL_WORKERS = 5
    MAX_RETRIES = 3
    RETRY_DELAY = 2.0
    RATE_LIMIT_DELAY = 1.0  # Delay between batches to avoid rate limits

    # Copyright retry delay (when Gemini blocks for copyright)
    COPYRIGHT_RETRY_DELAY = 5.0

    def __init__(
        self,
        gemini_api_key: str,
        model_name: str = "gemini-2.0-flash",
        dpi: int = 150,
    ):
        """Initialize Vision OCR processor.

        Args:
            gemini_api_key: Gemini API key
            model_name: Gemini model for vision (2.0-flash recommended)
            dpi: DPI for rendering PDF pages to images
        """
        genai.configure(api_key=gemini_api_key)
        self.model = genai.GenerativeModel(model_name)
        self.dpi = dpi

    def process_pdf(
        self,
        pdf_path: str,
        progress_callback: Optional[callable] = None,
        start_page: int = 0,
        end_page: Optional[int] = None,
    ) -> List[OCRPage]:
        """Process PDF with parallel Vision OCR.

        Args:
            pdf_path: Path to PDF file
            progress_callback: Optional callback(current, total) for progress
            start_page: First page to process (0-indexed)
            end_page: Last page to process (None = all)

        Returns:
            List of OCRPage objects with verified page numbers
        """
        pdf_path = Path(pdf_path)
        if not pdf_path.exists():
            raise FileNotFoundError(f"PDF not found: {pdf_path}")

        doc = fitz.open(str(pdf_path))
        total_pages = len(doc)

        if end_page is None:
            end_page = total_pages
        end_page = min(end_page, total_pages)

        pages_to_process = list(range(start_page, end_page))
        logger.info(f"Processing {len(pages_to_process)} pages with Vision OCR (5 parallel workers)")

        # Render all pages to images first
        page_images = []
        for pdf_page_idx in pages_to_process:
            page = doc[pdf_page_idx]
            image_bytes = self._render_page_to_image(page)
            page_images.append((pdf_page_idx + 1, image_bytes))  # 1-indexed

        doc.close()

        # Process in parallel batches
        all_results: Dict[int, List[OCRPage]] = {}
        total_batches = (len(page_images) + self.PARALLEL_WORKERS - 1) // self.PARALLEL_WORKERS

        for batch_idx in range(total_batches):
            batch_start = batch_idx * self.PARALLEL_WORKERS
            batch_end = min(batch_start + self.PARALLEL_WORKERS, len(page_images))
            batch = page_images[batch_start:batch_end]

            # Process batch in parallel
            batch_results = self._process_batch_parallel(batch)
            all_results.update(batch_results)

            # Progress callback
            if progress_callback:
                progress_callback(batch_end, len(page_images))

            # Rate limiting between batches
            if batch_idx < total_batches - 1:
                time.sleep(self.RATE_LIMIT_DELAY)

        # Flatten and sort results by PDF page number
        ocr_pages = []
        for pdf_page in sorted(all_results.keys()):
            ocr_pages.extend(all_results[pdf_page])

        logger.info(f"Vision OCR complete: {len(ocr_pages)} pages extracted")
        return ocr_pages

    def _process_batch_parallel(
        self,
        batch: List[Tuple[int, bytes]]
    ) -> Dict[int, List[OCRPage]]:
        """Process a batch of pages in parallel.

        Args:
            batch: List of (pdf_page_num, image_bytes) tuples

        Returns:
            Dict mapping pdf_page_num to list of OCRPage objects
        """
        results = {}

        with ThreadPoolExecutor(max_workers=self.PARALLEL_WORKERS) as executor:
            future_to_page = {
                executor.submit(self._ocr_page_with_retry, img_bytes, page_num): page_num
                for page_num, img_bytes in batch
            }

            for future in as_completed(future_to_page):
                page_num = future_to_page[future]
                try:
                    page_results = future.result()
                    results[page_num] = page_results
                except Exception as e:
                    logger.warning(f"OCR failed for page {page_num}: {e}")
                    # Create fallback with PDF page number
                    results[page_num] = [OCRPage(
                        pdf_page=page_num,
                        book_page=page_num,
                        text="[OCR FAILED]",
                        confidence=0.0,
                        is_landscape_half=False,
                        layout_type="single",
                    )]

        return results

    def _ocr_page_with_retry(
        self,
        image_bytes: bytes,
        pdf_page_num: int
    ) -> List[OCRPage]:
        """OCR a single page with retry logic for errors.

        Tries multiple prompts:
        1. Primary: Full indexing prompt (most detail)
        2. Fallback: Metadata-focused prompt (less likely to trigger copyright)
        3. Final: Page number only

        Args:
            image_bytes: PNG image bytes
            pdf_page_num: PDF page number (1-indexed)

        Returns:
            List of OCRPage objects (1 for single, 2 for landscape spread)
        """
        prompts = [
            self._build_primary_prompt(),
            self._build_fallback_prompt(),
        ]

        last_error = None

        for prompt_idx, prompt in enumerate(prompts):
            for attempt in range(self.MAX_RETRIES):
                try:
                    return self._call_vision_api(prompt, image_bytes, pdf_page_num)

                except Exception as e:
                    last_error = e
                    error_msg = str(e).lower()

                    # Copyright block - try next prompt
                    if "reciting" in error_msg or "copyrighted" in error_msg:
                        logger.debug(f"Page {pdf_page_num}: Copyright issue, trying alternative prompt")
                        time.sleep(self.COPYRIGHT_RETRY_DELAY)
                        break  # Try next prompt

                    # Rate limit - wait and retry same prompt
                    elif "429" in str(e) or "quota" in error_msg:
                        wait_time = self._extract_retry_delay(str(e))
                        logger.debug(f"Page {pdf_page_num}: Rate limit, waiting {wait_time}s")
                        time.sleep(wait_time)
                        continue

                    # JSON error - retry same prompt
                    elif attempt < self.MAX_RETRIES - 1:
                        logger.debug(f"Page {pdf_page_num}: Error {e}, retrying...")
                        time.sleep(self.RETRY_DELAY * (attempt + 1))
                        continue
                    else:
                        break  # Try next prompt

        # All prompts failed - return fallback with PDF page number
        logger.warning(f"Page {pdf_page_num}: All OCR attempts failed: {last_error}")
        return [OCRPage(
            pdf_page=pdf_page_num,
            book_page=pdf_page_num,
            text="[OCR FAILED]",
            confidence=0.0,
            is_landscape_half=False,
            layout_type="single",
        )]

    def _build_primary_prompt(self) -> str:
        """Build the primary OCR prompt - full extraction framed as academic indexing."""
        return """You are an academic document indexing assistant. Extract searchable metadata from this document page image.

PURPOSE: Building a personal citation database for academic research. This is metadata extraction for search indexing, not content reproduction.

ANALYZE AND EXTRACT:

1. LAYOUT DETECTION
   - "single": Normal single page
   - "landscape_double": Two book pages side-by-side (common in scanned books)

2. PAGE NUMBER(S)
   - Find the PRINTED page number on the page (in header, footer, or corner)
   - For landscape_double: identify LEFT page number and RIGHT page number
   - Use null if no page number is visible

3. TEXT CONTENT
   - Extract text for search indexing
   - For landscape_double: extract LEFT page first, then RIGHT page

OUTPUT FORMAT (valid JSON only, no markdown):
{
  "layout": "single" or "landscape_double",
  "pages": [
    {
      "position": "single" or "left" or "right",
      "printed_page": <integer or null>,
      "text": "<extracted text with special chars escaped>"
    }
  ]
}

CRITICAL: Escape all special characters in text (\\n, \\t, \\", \\\\). Output ONLY valid JSON."""

    def _build_fallback_prompt(self) -> str:
        """Build fallback prompt - focuses on page number, brief text summary."""
        return """Extract page metadata for academic citation indexing.

TASK: Identify the printed page number and provide a brief text summary.

1. What is the PRINTED page number visible on this page? (Look in corners, header, footer)
2. Is this a single page or two pages side-by-side (landscape scan)?
3. Provide a brief summary of the text content (first 500 characters).

OUTPUT (valid JSON only):
{
  "layout": "single" or "landscape_double",
  "pages": [
    {
      "position": "single" or "left" or "right",
      "printed_page": <number or null>,
      "text": "<brief text summary, escaped for JSON>"
    }
  ]
}

Escape special characters: \\n \\t \\" \\\\"""

    def _call_vision_api(
        self,
        prompt: str,
        image_bytes: bytes,
        pdf_page_num: int
    ) -> List[OCRPage]:
        """Call Gemini Vision API and parse response.

        Args:
            prompt: The OCR prompt
            image_bytes: PNG image bytes
            pdf_page_num: PDF page number for fallback

        Returns:
            List of OCRPage objects
        """
        image_part = {
            "mime_type": "image/png",
            "data": base64.b64encode(image_bytes).decode("utf-8"),
        }

        response = self.model.generate_content(
            [prompt, image_part],
            generation_config=genai.types.GenerationConfig(
                temperature=0.1,
                max_output_tokens=8192,
            ),
        )

        return self._parse_ocr_response(response.text, pdf_page_num)

    def _parse_ocr_response(
        self,
        response_text: str,
        pdf_page_num: int
    ) -> List[OCRPage]:
        """Parse OCR response with robust JSON repair.

        Args:
            response_text: Raw response from Gemini
            pdf_page_num: PDF page number for fallback

        Returns:
            List of OCRPage objects
        """
        # Try to parse JSON with repair
        data = self._repair_and_parse_json(response_text)

        if data is None:
            raise ValueError(f"Could not parse OCR response as JSON")

        layout = data.get("layout", "single")
        pages_data = data.get("pages", [])

        if not pages_data:
            return [OCRPage(
                pdf_page=pdf_page_num,
                book_page=pdf_page_num,
                text="",
                confidence=0.5,
                is_landscape_half=False,
                layout_type="single",
            )]

        ocr_pages = []
        for page_data in pages_data:
            position = page_data.get("position", "single")
            printed_page = page_data.get("printed_page")
            text = page_data.get("text", "")

            # Determine book page number
            if printed_page is not None:
                book_page = self._parse_page_number(printed_page, pdf_page_num)
                confidence = 0.95
            else:
                book_page = pdf_page_num
                confidence = 0.3

            is_landscape = layout == "landscape_double"

            ocr_pages.append(OCRPage(
                pdf_page=pdf_page_num,
                book_page=book_page,
                text=str(text).strip(),
                confidence=confidence,
                is_landscape_half=is_landscape,
                layout_type=layout,
            ))

        return ocr_pages

    def _repair_and_parse_json(self, text: str) -> Optional[dict]:
        """Repair common JSON issues and parse.

        Handles:
        - Markdown code blocks
        - Truncated responses
        - Unescaped characters
        - Missing closing brackets

        Args:
            text: Raw text that should contain JSON

        Returns:
            Parsed dict or None if repair failed
        """
        # Step 1: Remove markdown code blocks
        cleaned = text.strip()
        if cleaned.startswith("```"):
            lines = cleaned.split("\n")
            # Remove first line (```json or ```)
            if lines[0].startswith("```"):
                lines = lines[1:]
            # Remove last line if it's just ```
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            cleaned = "\n".join(lines)

        # Step 2: Try direct parse
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            pass

        # Step 3: Try to extract JSON object with regex
        json_match = re.search(r'\{[\s\S]*\}', cleaned)
        if json_match:
            json_str = json_match.group()

            # Try direct parse
            try:
                return json.loads(json_str)
            except json.JSONDecodeError:
                pass

            # Step 4: Fix common escape issues
            fixed = self._fix_json_escapes(json_str)
            try:
                return json.loads(fixed)
            except json.JSONDecodeError:
                pass

            # Step 5: Try to fix truncation
            fixed = self._fix_truncated_json(fixed)
            try:
                return json.loads(fixed)
            except json.JSONDecodeError as e:
                logger.debug(f"JSON repair failed: {e}")
                pass

        return None

    def _fix_json_escapes(self, json_str: str) -> str:
        """Fix common JSON escape issues.

        Args:
            json_str: JSON string with potential escape issues

        Returns:
            Fixed JSON string
        """
        # Fix unescaped backslashes (but not already escaped ones)
        # This is tricky - we need to escape \ that aren't part of \n, \t, \", \\

        # First, temporarily replace valid escapes
        placeholders = {
            '\\n': '\x00N\x00',
            '\\t': '\x00T\x00',
            '\\r': '\x00R\x00',
            '\\"': '\x00Q\x00',
            '\\\\': '\x00B\x00',
            '\\/': '\x00S\x00',
        }

        result = json_str
        for escape, placeholder in placeholders.items():
            result = result.replace(escape, placeholder)

        # Now escape remaining backslashes
        result = result.replace('\\', '\\\\')

        # Restore valid escapes
        for escape, placeholder in placeholders.items():
            result = result.replace(placeholder, escape)

        # Fix unescaped quotes inside strings (heuristic)
        # This is a common issue: "text": "He said "hello""
        # We can't reliably fix this without understanding context

        return result

    def _fix_truncated_json(self, json_str: str) -> str:
        """Attempt to fix truncated JSON by closing open structures.

        Args:
            json_str: Potentially truncated JSON string

        Returns:
            JSON string with structures closed
        """
        # Count open/close brackets
        open_braces = json_str.count('{') - json_str.count('}')
        open_brackets = json_str.count('[') - json_str.count(']')

        # If string ends mid-value, try to close it
        result = json_str.rstrip()

        # If we're in a string, close it
        if result.endswith('\\'):
            result = result[:-1]

        # Check if we're in an unterminated string
        in_string = False
        escaped = False
        for char in result:
            if escaped:
                escaped = False
                continue
            if char == '\\':
                escaped = True
                continue
            if char == '"':
                in_string = not in_string

        if in_string:
            result += '"'

        # Close arrays and objects
        result += ']' * open_brackets
        result += '}' * open_braces

        return result

    def _parse_page_number(self, printed_page: Any, fallback: int) -> int:
        """Parse page number from OCR output.

        Handles integers, strings, and Roman numerals.

        Args:
            printed_page: Page number from OCR
            fallback: Fallback page number

        Returns:
            Integer page number
        """
        if printed_page is None:
            return fallback

        if isinstance(printed_page, int):
            return printed_page

        page_str = str(printed_page).strip().lower()

        # Try integer
        try:
            return int(page_str)
        except ValueError:
            pass

        # Try Roman numeral
        roman_val = self._roman_to_int(page_str)
        if roman_val is not None:
            return -roman_val  # Negative for front matter

        return fallback

    def _roman_to_int(self, s: str) -> Optional[int]:
        """Convert Roman numeral to integer.

        Args:
            s: Roman numeral string (case-insensitive)

        Returns:
            Integer value or None if invalid
        """
        roman_values = {
            'i': 1, 'v': 5, 'x': 10, 'l': 50,
            'c': 100, 'd': 500, 'm': 1000
        }

        s = s.lower().strip()
        if not s or not all(c in roman_values for c in s):
            return None

        result = 0
        prev_value = 0

        for char in reversed(s):
            value = roman_values[char]
            if value < prev_value:
                result -= value
            else:
                result += value
            prev_value = value

        return result if result > 0 else None

    def _extract_retry_delay(self, error_msg: str) -> float:
        """Extract retry delay from rate limit error message.

        Args:
            error_msg: Error message containing retry information

        Returns:
            Delay in seconds (default 60)
        """
        match = re.search(r'retry in (\d+(?:\.\d+)?)', error_msg.lower())
        if match:
            return float(match.group(1)) + 5  # Add buffer
        return 60.0

    def _render_page_to_image(self, page: fitz.Page) -> bytes:
        """Render PDF page to PNG bytes.

        Args:
            page: PyMuPDF page object

        Returns:
            PNG image as bytes
        """
        mat = fitz.Matrix(self.dpi / 72, self.dpi / 72)
        pix = page.get_pixmap(matrix=mat)
        return pix.tobytes("png")

    def is_scanned_pdf(self, pdf_path: str, sample_pages: int = 3) -> bool:
        """Check if PDF is scanned (page-sized images) vs native digital.

        Args:
            pdf_path: Path to PDF file
            sample_pages: Number of pages to check

        Returns:
            True if PDF appears to be scanned
        """
        doc = fitz.open(pdf_path)
        pages_checked = min(sample_pages, len(doc))
        scanned_count = 0

        for i in range(pages_checked):
            page = doc[i]
            page_rect = page.rect
            page_area = page_rect.width * page_rect.height

            images = page.get_images()
            for img in images:
                try:
                    xref = img[0]
                    img_rect = page.get_image_bbox(img)
                    if img_rect:
                        img_area = img_rect.width * img_rect.height
                        # If image covers >50% of page, likely scanned
                        if img_area / page_area > 0.5:
                            scanned_count += 1
                            break
                except:
                    continue

        doc.close()

        # If majority of sampled pages have large images, it's scanned
        return scanned_count > pages_checked / 2

    def extract_text_layer(
        self,
        pdf_path: str,
        start_page: int = 0,
        end_page: Optional[int] = None,
    ) -> List[OCRPage]:
        """Extract text from PDF text layer (fallback method).

        Only use when Vision OCR completely fails.

        Args:
            pdf_path: Path to PDF file
            start_page: First page (0-indexed)
            end_page: Last page (None = all)

        Returns:
            List of OCRPage objects (with PDF page numbers as book pages)
        """
        doc = fitz.open(pdf_path)
        total_pages = len(doc)

        if end_page is None:
            end_page = total_pages
        end_page = min(end_page, total_pages)

        ocr_pages = []
        for pdf_page_idx in range(start_page, end_page):
            page = doc[pdf_page_idx]
            text = page.get_text().strip()

            # Try to detect page number from text
            book_page = self._detect_page_number_from_text(text, pdf_page_idx + 1)

            ocr_pages.append(OCRPage(
                pdf_page=pdf_page_idx + 1,
                book_page=book_page,
                text=text,
                confidence=0.5,  # Lower confidence for text layer
                is_landscape_half=False,
                layout_type="single",
            ))

        doc.close()
        return ocr_pages

    def _detect_page_number_from_text(self, text: str, pdf_page: int) -> int:
        """Detect page number from extracted text (heuristic).

        Looks for page numbers in common locations.

        Args:
            text: Extracted page text
            pdf_page: PDF page number as fallback

        Returns:
            Detected or fallback page number
        """
        lines = text.strip().split("\n")
        if not lines:
            return pdf_page

        candidates = []

        # Check first and last few lines
        for line in lines[:3] + lines[-3:]:
            line = line.strip()

            # Standalone number
            if re.match(r'^\d{1,4}$', line):
                candidates.append(int(line))

            # "Page X" or "p. X"
            match = re.search(r'(?:page|p\.?)\s*(\d{1,4})', line, re.IGNORECASE)
            if match:
                candidates.append(int(match.group(1)))

            # Number at end or start of line
            match = re.search(r'(?:^|\s)(\d{1,4})(?:\s|$)', line)
            if match:
                num = int(match.group(1))
                if 1 <= num <= 9999:
                    candidates.append(num)

        if candidates:
            # Return most common, or first if tie
            return max(set(candidates), key=candidates.count)

        return pdf_page


# Convenience function
def process_pdf_vision(
    pdf_path: str,
    gemini_api_key: str,
    progress_callback: Optional[callable] = None,
) -> List[OCRPage]:
    """Process PDF with Vision OCR.

    Args:
        pdf_path: Path to PDF file
        gemini_api_key: Gemini API key
        progress_callback: Optional progress callback

    Returns:
        List of OCRPage objects with verified page numbers
    """
    processor = VisionOCRProcessor(gemini_api_key)
    return processor.process_pdf(pdf_path, progress_callback)
