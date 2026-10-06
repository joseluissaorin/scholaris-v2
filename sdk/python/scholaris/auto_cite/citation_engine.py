"""Citation engine powered by Gemini.

This module implements citation matching with three modes:
1. Full document mode: Send entire document at once
2. Paragraph-by-paragraph mode: Process each paragraph for thorough coverage
3. Grounded RAG mode: Use verified page numbers from retrieval (NEW)

MODIFIED: Grounded RAG for accurate page citations.
"""

import logging
import json
import re
from enum import Enum
from typing import List, Dict, Any, Tuple, Optional, Union, TYPE_CHECKING
import google.generativeai as genai

from .models import PageAwarePDF, Citation, CitationStyle, RetrievedChunk

if TYPE_CHECKING:
    from .page_aware_rag import PageAwareRAG
    from .citation_export import CitationExporter

logger = logging.getLogger(__name__)


class GeminiCitationEngine:
    """Citation engine using Gemini with aggressive citation matching.

    Supports two processing modes:
    - Full document: Faster, sends entire document at once
    - Paragraph-by-paragraph: More thorough, processes each paragraph
    """

    def __init__(
        self,
        api_key: str,
        model: str = "gemini-3-flash-preview",
        max_context_tokens: int = 900000,
        aggressive_mode: bool = True,
        paragraph_mode: bool = True,  # NEW: Process paragraph by paragraph
    ):
        """Initialize Gemini citation engine.

        Args:
            api_key: Google Gemini API key
            model: Gemini model to use
            max_context_tokens: Maximum tokens to use
            aggressive_mode: If True, find more citations (default: True)
            paragraph_mode: If True, process paragraph by paragraph (default: True)
        """
        self.api_key = api_key
        self.model = model
        self.max_context_tokens = max_context_tokens
        self.aggressive_mode = aggressive_mode
        self.paragraph_mode = paragraph_mode

        genai.configure(api_key=api_key)
        self.client = genai.GenerativeModel(model)

        logger.info(
            f"Gemini citation engine initialized: model={model}, "
            f"aggressive={aggressive_mode}, paragraph_mode={paragraph_mode}"
        )

    def _format_authors_apa7(self, authors_str: str) -> str:
        """Format author names for APA7 in-text citations.

        APA7 rules for parenthetical citations:
        - Use surnames only
        - Use "&" between authors (not "and")
        - For 3+ authors, use "et al." after first author

        Handles special cases:
        - "Teun A. van Dijk" → "van Dijk" (keep particle)
        - "Robert-Alain de Beaugrande" → "de Beaugrande" (keep particle)

        Args:
            authors_str: Comma-separated full names (e.g., "M.A.K. Halliday, Ruqaiya Hasan")

        Returns:
            Formatted surnames for citation (e.g., "Halliday & Hasan")
        """
        if not authors_str:
            return "Unknown"

        # Split by comma
        authors = [a.strip() for a in authors_str.split(",")]

        # Particles that should stay with the surname (lowercase)
        particles = {"van", "von", "de", "del", "della", "di", "da", "le", "la", "el", "den", "ter"}

        surnames = []
        for author in authors:
            parts = author.split()
            if not parts:
                continue

            # Find surname with particles
            # Strategy: work backwards from end, collecting surname + any particles before it
            surname_parts = []

            # Last word is always the main surname
            surname_parts.append(parts[-1])

            # Check preceding words for particles
            for i in range(len(parts) - 2, -1, -1):
                word = parts[i]
                if word.lower() in particles:
                    # Keep particle lowercase as per APA
                    surname_parts.insert(0, word.lower())
                else:
                    # Stop when we hit a non-particle (given name, initial, etc.)
                    break

            if surname_parts:
                surnames.append(" ".join(surname_parts))

        if not surnames:
            return "Unknown"

        # Format according to number of authors
        if len(surnames) == 1:
            return surnames[0]
        elif len(surnames) == 2:
            return f"{surnames[0]} & {surnames[1]}"
        else:
            # 3+ authors: first author et al.
            return f"{surnames[0]} et al."

    def _disambiguate_authors(self, citations: List["GroundedCitation"], style: CitationStyle) -> List["GroundedCitation"]:
        """Add author initials when multiple authors share the same surname.

        APA7 requires disambiguation when different first-authors share surnames:
        - Clark (2019) and Clark (2022) by different authors become:
        - K. Clark et al. (2019) and J. H. Clark et al. (2022)

        Args:
            citations: List of GroundedCitation objects
            style: Citation style

        Returns:
            Updated citations with disambiguated author names
        """
        from collections import defaultdict

        # Build mapping: surname -> list of (citation_key, year, full_authors)
        surname_to_sources = defaultdict(list)

        for c in citations:
            if not c.authors:
                continue

            # Get first author surname
            first_author = c.authors.split(",")[0].strip()
            parts = first_author.split()
            if not parts:
                continue

            # Extract surname (last word + any particles)
            particles = {"van", "von", "de", "del", "della", "di", "da", "le", "la", "el", "den", "ter"}
            surname_parts = [parts[-1]]
            for i in range(len(parts) - 2, -1, -1):
                if parts[i].lower() in particles:
                    surname_parts.insert(0, parts[i].lower())
                else:
                    break
            surname = " ".join(surname_parts)

            # Track this source under the surname
            source_key = (c.citation_key, c.year)
            if source_key not in [s[0] for s in surname_to_sources[surname]]:
                surname_to_sources[surname].append((source_key, first_author, c.authors))

        # Find surnames that need disambiguation (multiple different first-authors)
        needs_disambiguation = {}
        for surname, sources in surname_to_sources.items():
            # Check if multiple DIFFERENT first authors
            unique_first_authors = set(s[1] for s in sources)
            if len(unique_first_authors) > 1:
                # Build disambiguation map: citation_key -> initial to use
                for source_key, first_author, full_authors in sources:
                    parts = first_author.split()
                    if len(parts) >= 2:
                        # Get initial(s) from given name(s)
                        initials = []
                        for i in range(len(parts) - 1):
                            word = parts[i]
                            if word.lower() not in particles:
                                if "." in word:
                                    initials.append(word)  # Already an initial like "K."
                                else:
                                    initials.append(word[0] + ".")
                        initial_str = " ".join(initials) if initials else parts[0][0] + "."
                        needs_disambiguation[source_key] = (initial_str, surname)

        # Update citation strings for sources that need disambiguation
        if needs_disambiguation:
            logger.info(f"Disambiguating {len(needs_disambiguation)} author references")

            for c in citations:
                source_key = (c.citation_key, c.year)
                if source_key in needs_disambiguation:
                    initial_str, surname = needs_disambiguation[source_key]

                    # Parse current citation string and rebuild with initials
                    # Format: (Author, Year, p. X) or (Author et al., Year, p. X)
                    old_author = self._format_authors_apa7(c.authors) if c.authors else "Unknown"

                    # Check if et al.
                    if " et al." in old_author:
                        new_author = f"{initial_str} {surname} et al."
                    elif " & " in old_author:
                        # Two authors - only disambiguate first
                        parts = old_author.split(" & ")
                        new_author = f"{initial_str} {parts[0]} & {parts[1]}"
                    else:
                        new_author = f"{initial_str} {surname}"

                    # Rebuild citation string
                    if style == CitationStyle.APA7:
                        if c.page_end and c.page_end != c.page_number:
                            c.citation_string = f"({new_author}, {c.year}, pp. {c.page_number}-{c.page_end})"
                        else:
                            c.citation_string = f"({new_author}, {c.year}, p. {c.page_number})"
                    # Chicago handled separately if needed

        return citations

    def _get_expanded_chunk_context(
        self,
        chunk: RetrievedChunk,
        rag: "PageAwareRAG",
        chars_before: int = 400,
        chars_after: int = 400,
    ) -> str:
        """Get expanded context for a chunk by including neighboring text.

        Args:
            chunk: The main chunk
            rag: RAG instance to query for neighbors
            chars_before: Characters to include before the chunk
            chars_after: Characters to include after the chunk

        Returns:
            Expanded text with context markers
        """
        main_text = chunk.text if chunk.text else ""

        # Safety: return early if main text is empty or very short
        if len(main_text) < 10:
            return main_text

        # Try to get neighboring chunks from the same source and nearby pages
        try:
            # Check if RAG has the method we need
            if not hasattr(rag, 'get_chunks_by_source_and_page'):
                # Fallback: just return main text
                if len(main_text) > 1200:
                    return main_text[:1200] + "..."
                return main_text

            # Get chunks from same page or adjacent pages
            neighbors = rag.get_chunks_by_source_and_page(
                citation_key=chunk.citation_key,
                book_page=chunk.book_page,
                include_adjacent=True,
            )

            # Filter out any neighbors with empty text
            neighbors = [n for n in neighbors if n and getattr(n, 'text', None)]

            if neighbors and len(neighbors) > 1:
                # Sort by (page, chunk_index) for proper ordering
                sorted_neighbors = sorted(
                    neighbors,
                    key=lambda x: (
                        getattr(x, 'book_page', 0) or 0,
                        getattr(x, 'chunk_index', 0) or 0
                    )
                )

                # Find current chunk position by comparing text prefix
                # Use min() to avoid index errors on short texts
                main_prefix = main_text[:min(100, len(main_text))]
                current_idx = -1

                for i, n in enumerate(sorted_neighbors):
                    neighbor_text = getattr(n, 'text', '') or ''
                    if len(neighbor_text) >= len(main_prefix):
                        neighbor_prefix = neighbor_text[:len(main_prefix)]
                        if neighbor_prefix == main_prefix:
                            current_idx = i
                            break

                if current_idx >= 0 and current_idx < len(sorted_neighbors):
                    # Build context
                    context_parts = []

                    # Previous chunk
                    if current_idx > 0:
                        prev_chunk = sorted_neighbors[current_idx - 1]
                        prev_text = getattr(prev_chunk, 'text', '') or ''
                        if prev_text and len(prev_text) > 0:
                            context_parts.append(
                                f"[...preceding context...]\n{prev_text[-chars_before:]}"
                            )

                    # Main chunk (full text)
                    context_parts.append(f"\n[MAIN EVIDENCE]\n{main_text}")

                    # Next chunk
                    if current_idx < len(sorted_neighbors) - 1:
                        next_chunk = sorted_neighbors[current_idx + 1]
                        next_text = getattr(next_chunk, 'text', '') or ''
                        if next_text and len(next_text) > 0:
                            context_parts.append(
                                f"\n[...following context...]\n{next_text[:chars_after]}"
                            )

                    if context_parts:
                        return "\n".join(context_parts)

        except (IndexError, AttributeError, TypeError) as e:
            logger.debug(f"Could not get expanded context (specific): {e}")
        except Exception as e:
            logger.debug(f"Could not get expanded context: {e}")

        # Fallback: just return main text with reasonable length
        if len(main_text) > 1200:
            return main_text[:1200] + "..."
        return main_text

    def analyze_and_cite(
        self,
        document_text: str,
        bibliography: List[PageAwarePDF],
        style: CitationStyle,
        max_citations_per_claim: int = 3,
    ) -> List[Citation]:
        """Analyze document and generate citations.

        Uses paragraph-by-paragraph mode if enabled for thorough coverage.
        """
        logger.info(
            f"Analyzing document ({len(document_text)} chars) "
            f"against {len(bibliography)} sources"
        )

        if self.paragraph_mode and self.aggressive_mode:
            return self._analyze_by_paragraphs(
                document_text=document_text,
                bibliography=bibliography,
                style=style,
                max_citations_per_claim=max_citations_per_claim,
            )
        else:
            return self._analyze_full_document(
                document_text=document_text,
                bibliography=bibliography,
                style=style,
                max_citations_per_claim=max_citations_per_claim,
            )

    def _analyze_by_paragraphs(
        self,
        document_text: str,
        bibliography: List[PageAwarePDF],
        style: CitationStyle,
        max_citations_per_claim: int,
        batch_size: int = 4,
    ) -> List[Citation]:
        """Process document in paragraph batches for thorough citation coverage."""

        # Split into paragraphs (by double newline or markdown headers)
        paragraphs = self._split_into_paragraphs(document_text)
        # Filter out short paragraphs
        paragraphs = [p for p in paragraphs if len(p.strip()) >= 50]
        logger.info(f"Split document into {len(paragraphs)} paragraphs (batch size: {batch_size})")

        # Build bibliography context once (reused for all batches)
        bibliography_context = self._build_compact_bibliography_context(bibliography)

        all_citations = []
        seen_claims = set()  # Avoid duplicate citations

        # Process in batches of batch_size paragraphs
        total_batches = (len(paragraphs) + batch_size - 1) // batch_size
        for batch_idx in range(total_batches):
            start_idx = batch_idx * batch_size
            end_idx = min(start_idx + batch_size, len(paragraphs))
            batch_paragraphs = paragraphs[start_idx:end_idx]

            logger.info(f"Processing batch {batch_idx+1}/{total_batches} (paragraphs {start_idx+1}-{end_idx})...")

            try:
                # Combine paragraphs with markers
                combined_text = "\n\n".join([
                    f"[PARAGRAPH {start_idx + i + 1}]\n{p}"
                    for i, p in enumerate(batch_paragraphs)
                ])

                prompt = self._build_paragraph_prompt(
                    paragraph=combined_text,
                    paragraph_number=batch_idx + 1,
                    total_paragraphs=total_batches,
                    bibliography_context=bibliography_context,
                    bibliography=bibliography,
                    style=style,
                )

                response = self.client.generate_content(prompt)

                citations = self._parse_citations_from_response(
                    response=response,
                    bibliography=bibliography,
                    style=style,
                )

                # Deduplicate
                for citation in citations:
                    claim_key = citation.claim_text[:100]
                    if claim_key not in seen_claims:
                        seen_claims.add(claim_key)
                        all_citations.append(citation)

            except Exception as e:
                logger.warning(f"Failed to process batch {batch_idx+1}: {e}")
                continue

        logger.info(f"✓ Generated {len(all_citations)} citations from {len(paragraphs)} paragraphs")
        return all_citations

    def _split_into_paragraphs(self, document_text: str) -> List[str]:
        """Split document into processable paragraphs."""
        # Split by double newlines or markdown section breaks
        raw_paragraphs = re.split(r'\n\s*\n|\n-{3,}\n|\n#{1,6}\s+', document_text)

        # Merge very short paragraphs with next one
        paragraphs = []
        buffer = ""

        for p in raw_paragraphs:
            p = p.strip()
            if not p:
                continue

            buffer += "\n\n" + p if buffer else p

            # If buffer is substantial enough, add it
            if len(buffer) > 200:
                paragraphs.append(buffer)
                buffer = ""

        if buffer:
            paragraphs.append(buffer)

        return paragraphs

    def _build_paragraph_prompt(
        self,
        paragraph: str,
        paragraph_number: int,
        total_paragraphs: int,
        bibliography_context: str,
        bibliography: List[PageAwarePDF],
        style: CitationStyle,
    ) -> str:
        """Build prompt for a single paragraph."""

        # Citation key mapping
        key_author_map = []
        for pdf in bibliography:
            author_name = pdf.reference.authors[0].split()[-1] if pdf.reference.authors else "Unknown"
            key_author_map.append(f"- {pdf.citation_key}: {author_name} ({pdf.reference.year})")

        key_mapping_str = "\n".join(key_author_map)

        prompt = f"""You are an expert academic citation assistant. Analyze this paragraph and identify ALL claims that need citations.

AVAILABLE SOURCES:
{key_mapping_str}

CITATION FORMAT (APA 7th):
- (Author, Year, p. PageNumber)
- 2 authors: (Smith & Jones, 2023, p. 42)
- 3+ authors: (Smith et al., 2023, p. 42)

=== PARAGRAPH TO ANALYZE ({paragraph_number}/{total_paragraphs}) ===

{paragraph}

=== BIBLIOGRAPHY EXCERPTS ===

{bibliography_context}

=== INSTRUCTIONS ===

Find EVERY citation opportunity in this paragraph:
1. Author mentions (Halliday, Beaugrande, Van Dijk, Langacker, etc.)
2. Theoretical concepts (cohesion, coherence, construal, textuality, etc.)
3. Specific claims about linguistics or NLP
4. References to specific theories (RST, Centering, BPE, etc.)

For EACH opportunity, provide:
- claim_text: The EXACT text from the paragraph (copy precisely)
- citation_key: Which source to cite
- pdf_page_number: Page number in the PDF (use 1 if unsure)
- confidence: 0.5-1.0

OUTPUT (JSON only, no explanation):
```json
{{
  "citations": [
    {{
      "claim_text": "exact text needing citation",
      "citation_key": "halliday1976",
      "pdf_page_number": 1,
      "evidence_text": "brief evidence from source",
      "confidence": 0.8,
      "reason": "why this needs citation"
    }}
  ]
}}
```

If this paragraph has no citable claims, return: {{"citations": []}}
"""
        return prompt

    def _build_compact_bibliography_context(
        self,
        bibliography: List[PageAwarePDF],
    ) -> str:
        """Build compact bibliography for paragraph mode (all pages, full text)."""
        context_parts = []

        for pdf in bibliography:
            authors_str = ", ".join(pdf.reference.authors[:2]) if pdf.reference.authors else "Unknown"

            header = f"""
=== {pdf.citation_key} ===
{authors_str} ({pdf.reference.year}). {pdf.reference.title}

Full content:
"""
            context_parts.append(header)

            # NO PAGE LIMIT - include ALL pages with FULL text
            for page in pdf.pages:
                context_parts.append(f"[p.{page.pdf_page_number}] {page.text_content}\n")

        return "".join(context_parts)

    def _analyze_full_document(
        self,
        document_text: str,
        bibliography: List[PageAwarePDF],
        style: CitationStyle,
        max_citations_per_claim: int,
    ) -> List[Citation]:
        """Original full document analysis."""
        if self.aggressive_mode:
            prompt = self._build_aggressive_prompt(
                document_text=document_text,
                bibliography=bibliography,
                style=style,
                max_citations_per_claim=max_citations_per_claim,
            )
        else:
            prompt = self._build_conservative_prompt(
                document_text=document_text,
                bibliography=bibliography,
                style=style,
                max_citations_per_claim=max_citations_per_claim,
            )

        response = self.client.generate_content(prompt)

        citations = self._parse_citations_from_response(
            response=response,
            bibliography=bibliography,
            style=style,
        )

        logger.info(f"✓ Generated {len(citations)} citations")
        return citations

    def _build_aggressive_prompt(
        self,
        document_text: str,
        bibliography: List[PageAwarePDF],
        style: CitationStyle,
        max_citations_per_claim: int,
    ) -> str:
        """Build aggressive prompt for thorough citation matching."""
        author_list = []
        for pdf in bibliography:
            for author in pdf.reference.authors:
                parts = author.replace(",", "").split()
                if parts:
                    last_name = parts[-1] if len(parts) == 1 else parts[0]
                    author_list.append(last_name)

        authors_str = ", ".join(set(author_list))

        key_author_map = []
        for pdf in bibliography:
            author_name = pdf.reference.authors[0].split()[-1] if pdf.reference.authors else "Unknown"
            key_author_map.append(f"- {pdf.citation_key}: {author_name} ({pdf.reference.year})")

        key_mapping_str = "\n".join(key_author_map)

        if style == CitationStyle.APA7:
            style_guide = """
APA 7th Edition:
- Format: (Author, Year, p. PageNumber)
- 2 authors: (Smith & Jones, 2023, p. 42)
- 3+ authors: (Smith et al., 2023, p. 42)
"""
        else:
            style_guide = """
Chicago 17th Edition (Notes & Bibliography):
- Format: Superscript footnote number
- Footnote: Author, "Title," Source (Year): Page.
"""

        bibliography_context = self._build_rich_bibliography_context(bibliography)

        spanish_indicators = ["el", "la", "los", "las", "de", "que", "en", "es", "un", "una"]
        doc_lower = document_text.lower()[:1000]
        is_spanish = sum(1 for w in spanish_indicators if f" {w} " in doc_lower) > 3

        language_instruction = """
IDIOMA: El documento está en ESPAÑOL. Busca menciones de autores y conceptos en español.
""" if is_spanish else ""

        prompt = f"""You are an expert academic citation assistant. Your task is to analyze an academic document and insert bibliographic citations EXHAUSTIVELY.

AUTHORS AVAILABLE IN BIBLIOGRAPHY:
{authors_str}

CITATION KEY MAPPING:
{key_mapping_str}

{style_guide}
{language_instruction}

=== CRITICAL INSTRUCTIONS ===

1. AGGRESSIVELY SEARCH for citation opportunities:
   - Every author mention (Halliday, Beaugrande, Langacker, Van Dijk, etc.)
   - Every theoretical concept attributable to a source
   - Every paraphrase of ideas from sources
   - Every empirical or theoretical claim needing support

2. BE GENEROUS WITH CITATIONS:
   - More citations are better than fewer
   - A dense theoretical paragraph may need 3-5 citations
   - Author mentions should ALWAYS have citations

---
DOCUMENT TO ANALYZE:
---

{document_text}

---
FULL BIBLIOGRAPHY:
---

{bibliography_context}

---
OUTPUT (JSON):
```json
{{
  "citations": [
    {{
      "claim_text": "exact text from document",
      "citation_key": "halliday1976",
      "pdf_page_number": 15,
      "evidence_text": "quote from source",
      "confidence": 0.85,
      "reason": "why"
    }}
  ]
}}
```

Generate AT LEAST 20-40 citations for a long academic document.
"""

        return prompt

    def _build_conservative_prompt(
        self,
        document_text: str,
        bibliography: List[PageAwarePDF],
        style: CitationStyle,
        max_citations_per_claim: int,
    ) -> str:
        """Build conservative prompt (original behavior)."""
        if style == CitationStyle.APA7:
            style_guide = """
APA 7th Edition Requirements:
- Format: (Author, Year, p. PageNumber)
- Direct quotes: MUST include page number
- Paraphrases: Page number recommended for specific claims
"""
        else:
            style_guide = """
Chicago 17th Edition (Notes & Bibliography) Requirements:
- Format: Superscript footnote number in text
- Footnote: Author, "Title," Source Volume, no. Issue (Year): Page.
"""

        bibliography_context = self._build_bibliography_context(bibliography)

        prompt = f"""You are an expert academic citation assistant. Analyze the document and suggest accurate in-text citations.

{style_guide}

---
USER DOCUMENT:
---

{document_text}

---
BIBLIOGRAPHY:
---

{bibliography_context}

---
OUTPUT FORMAT (JSON):
```json
{{
  "citations": [
    {{
      "claim_text": "Exact text from document",
      "citation_key": "author2023key",
      "pdf_page_number": 15,
      "evidence_text": "Quote from source",
      "confidence": 0.95,
      "reason": "Why this source supports this claim"
    }}
  ]
}}
```

Be conservative - only suggest citations you're confident about.
"""

        return prompt

    def _build_rich_bibliography_context(
        self,
        bibliography: List[PageAwarePDF],
    ) -> str:
        """Build rich bibliography context - NO LIMITS, full PDF text."""
        context_parts = []

        for i, pdf in enumerate(bibliography, 1):
            authors_str = ", ".join(pdf.reference.authors[:3]) if pdf.reference.authors else "Unknown"
            if len(pdf.reference.authors) > 3:
                authors_str += " et al."

            header = f"""
================================================================================
SOURCE {i}: {pdf.citation_key}
================================================================================
Authors: {authors_str}
Title: {pdf.reference.title}
Year: {pdf.reference.year}
Journal/Publisher: {pdf.reference.source}

FULL CONTENT ({len(pdf.pages)} pages):
"""
            context_parts.append(header)

            # NO LIMITS - include ALL pages with FULL text
            for page in pdf.pages:
                page_header = f"\n--- PDF Page {page.pdf_page_number} ---\n"
                context_parts.append(page_header)
                context_parts.append(page.text_content)

        return "".join(context_parts)

    def _build_bibliography_context(
        self,
        bibliography: List[PageAwarePDF],
    ) -> str:
        """Build bibliography context - NO LIMITS, full PDF text."""
        context_parts = []

        for i, pdf in enumerate(bibliography, 1):
            authors_str = ", ".join(pdf.reference.authors[:3]) if pdf.reference.authors else "Unknown"

            header = f"""
========================================
SOURCE {i}: {pdf.citation_key}
========================================
Authors: {authors_str}
Title: {pdf.reference.title}
Year: {pdf.reference.year}
Total pages: {len(pdf.pages)}
"""
            context_parts.append(header)

            # NO LIMITS - include ALL pages with FULL text
            for page in pdf.pages:
                page_header = f"\n--- Page {page.pdf_page_number} ---\n"
                context_parts.append(page_header)
                context_parts.append(page.text_content)

        return "".join(context_parts)

    def _parse_citations_from_response(
        self,
        response: Any,
        bibliography: List[PageAwarePDF],
        style: CitationStyle,
    ) -> List[Citation]:
        """Parse Gemini response into Citation objects."""
        citations = []

        try:
            response_text = response.text

            # Find JSON block
            if "```json" in response_text:
                json_start = response_text.index("```json") + 7
                json_end = response_text.index("```", json_start)
                json_text = response_text[json_start:json_end].strip()
            elif "{" in response_text and "}" in response_text:
                json_start = response_text.index("{")
                json_end = response_text.rindex("}") + 1
                json_text = response_text[json_start:json_end]
            else:
                logger.warning("No JSON found in Gemini response")
                return []

            data = json.loads(json_text)

            pdf_map = {pdf.citation_key: pdf for pdf in bibliography}

            for cite_data in data.get("citations", []):
                citation_key = cite_data.get("citation_key")
                source_pdf = pdf_map.get(citation_key)

                # Fuzzy matching
                if not source_pdf and citation_key:
                    for key, pdf in pdf_map.items():
                        if (citation_key.lower() in key.lower() or
                            key.lower() in citation_key.lower()):
                            source_pdf = pdf
                            break

                if not source_pdf:
                    logger.warning(f"Citation key not found: {citation_key}")
                    continue

                citation = Citation(
                    source_pdf=source_pdf,
                    page_number=cite_data.get("pdf_page_number", 1),
                    claim_text=cite_data.get("claim_text", ""),
                    evidence_text=cite_data.get("evidence_text", ""),
                    confidence=cite_data.get("confidence", 0.7),
                )

                if style == CitationStyle.APA7:
                    citation.citation_string = citation.format_apa7()
                else:
                    citation.citation_string = citation.format_chicago17()

                citations.append(citation)

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse JSON: {e}")
        except Exception as e:
            logger.error(f"Error parsing citations: {e}")

        return citations

    # ==================== GROUNDED RAG MODE ====================

    def analyze_with_grounded_rag(
        self,
        document_text: str,
        rag: "PageAwareRAG",
        style: CitationStyle,
        max_citations_per_claim: int = 3,
        batch_size: int = 4,
        exporter: Optional["CitationExporter"] = None,
        parallel_batches: int = 10,
    ) -> List["GroundedCitation"]:
        """Analyze document using grounded RAG for verified page numbers.

        This is the preferred mode for accurate citations:
        - Page numbers come from retrieval metadata, not guessing
        - Gemini can only cite pages that exist in retrieved chunks
        - Every citation is grounded in verified evidence
        - Processes paragraphs in parallel batches for speed

        Args:
            document_text: Document to analyze
            rag: PageAwareRAG instance with indexed bibliography
            style: Citation style (APA7 or Chicago17)
            max_citations_per_claim: Maximum citations per claim
            batch_size: Number of paragraphs to process per batch
            exporter: Optional CitationExporter for CSV/JSON export
            parallel_batches: Number of batches to process in parallel (default: 10)

        Returns:
            List of GroundedCitation objects with verified page numbers
        """
        from concurrent.futures import ThreadPoolExecutor, as_completed

        logger.info(f"Starting grounded RAG citation analysis ({len(document_text)} chars)")

        # Split into paragraphs and filter short ones
        paragraphs = self._split_into_paragraphs(document_text)
        paragraphs = [p for p in paragraphs if len(p.strip()) >= 50]
        logger.info(f"Split document into {len(paragraphs)} paragraphs (batch size: {batch_size}, parallel: {parallel_batches})")

        # Register paragraphs with exporter if provided
        if exporter:
            for i, para in enumerate(paragraphs):
                exporter.add_sentence(i, para)

        # Build all batch info upfront
        total_batches = (len(paragraphs) + batch_size - 1) // batch_size
        batch_infos = []
        for batch_idx in range(total_batches):
            start_idx = batch_idx * batch_size
            end_idx = min(start_idx + batch_size, len(paragraphs))
            batch_paragraphs = paragraphs[start_idx:end_idx]
            batch_infos.append({
                "batch_idx": batch_idx,
                "start_idx": start_idx,
                "end_idx": end_idx,
                "paragraphs": batch_paragraphs,
            })

        logger.info(f"Processing {total_batches} batches in parallel (max {parallel_batches} concurrent)...")

        # Process batches in parallel
        all_results = {}  # batch_idx -> (citations, chunks)

        def process_batch(batch_info):
            """Process a single batch - called in parallel."""
            batch_idx = batch_info["batch_idx"]
            start_idx = batch_info["start_idx"]
            batch_paragraphs = batch_info["paragraphs"]

            combined_text = "\n\n".join([
                f"[PARAGRAPH {start_idx + i + 1}]\n{p}"
                for i, p in enumerate(batch_paragraphs)
            ])

            try:
                citations, chunks = self._cite_paragraph_with_rag(
                    paragraph=combined_text,
                    paragraph_number=batch_idx + 1,
                    total_paragraphs=total_batches,
                    rag=rag,
                    style=style,
                    return_chunks=True,
                    full_document=document_text,
                    already_cited=[],  # Can't track incrementally in parallel
                )
                return batch_idx, citations, chunks, None
            except Exception as e:
                import traceback
                tb = traceback.format_exc()
                logger.warning(f"Failed to process batch {batch_idx+1}: {e}\n{tb}")
                return batch_idx, [], [], str(e)

        with ThreadPoolExecutor(max_workers=parallel_batches) as executor:
            futures = {executor.submit(process_batch, info): info for info in batch_infos}

            completed = 0
            for future in as_completed(futures):
                completed += 1
                batch_idx, citations, chunks, error = future.result()
                if error:
                    logger.warning(f"Batch {batch_idx+1} failed: {error}")
                else:
                    all_results[batch_idx] = (citations, chunks)
                    logger.info(f"Completed batch {batch_idx+1}/{total_batches} ({completed}/{total_batches} done, {len(citations)} citations)")

        # Collect results in order and deduplicate
        all_citations = []
        seen_claims = set()

        for batch_idx in sorted(all_results.keys()):
            citations, retrieved_chunks = all_results[batch_idx]
            batch_info = batch_infos[batch_idx]
            start_idx = batch_info["start_idx"]
            batch_paragraphs = batch_info["paragraphs"]

            # Add to exporter if provided
            if exporter and retrieved_chunks:
                for i, para in enumerate(batch_paragraphs):
                    para_idx = start_idx + i
                    exporter.add_retrieved_chunks(para_idx, retrieved_chunks, max_chunks=5)

            # Deduplicate and track source paragraph
            for citation in citations:
                claim_key = citation.claim_text[:100]
                if claim_key not in seen_claims:
                    seen_claims.add(claim_key)

                    # Find which paragraph this citation belongs to
                    if exporter:
                        best_para_idx = start_idx
                        best_overlap = 0
                        for i, para in enumerate(batch_paragraphs):
                            if citation.claim_text and citation.claim_text in para:
                                best_para_idx = start_idx + i
                                break
                            overlap = len(set(citation.claim_text.lower().split()) &
                                        set(para.lower().split()))
                            if overlap > best_overlap:
                                best_overlap = overlap
                                best_para_idx = start_idx + i

                        citation.source_paragraph_id = best_para_idx
                        exporter.add_citation(best_para_idx, citation)

                    all_citations.append(citation)

        logger.info(f"✓ Generated {len(all_citations)} grounded citations from {len(paragraphs)} paragraphs ({total_batches} batches parallel)")

        # Disambiguate authors with same surnames (e.g., K. Clark vs J.H. Clark)
        all_citations = self._disambiguate_authors(all_citations, style)

        return all_citations

    def _cite_paragraph_with_rag(
        self,
        paragraph: str,
        paragraph_number: int,
        total_paragraphs: int,
        rag: "PageAwareRAG",
        style: CitationStyle,
        return_chunks: bool = False,
        full_document: Optional[str] = None,
        already_cited: Optional[List[Dict[str, Any]]] = None,
    ) -> Union[List["GroundedCitation"], Tuple[List["GroundedCitation"], List[RetrievedChunk]]]:
        """Generate citations for a paragraph using RAG retrieval.

        Page numbers come from retrieval metadata, NOT from Gemini guessing.

        Args:
            paragraph: Paragraph text to analyze
            paragraph_number: Current paragraph number
            total_paragraphs: Total paragraph count
            rag: PageAwareRAG instance
            style: Citation style
            return_chunks: If True, also return retrieved chunks
            full_document: The complete document text for context
            already_cited: List of already-cited sources from previous batches

        Returns:
            If return_chunks=False: List of GroundedCitation
            If return_chunks=True: Tuple of (citations, retrieved_chunks)
        """
        # Step 1: Retrieve relevant chunks from RAG
        chunks = rag.query_for_paragraph(paragraph, n_results=30)

        if not chunks:
            return ([], []) if return_chunks else []

        # Step 2: Format evidence with VERIFIED page numbers AND expanded context
        evidence_lines = []
        for c in chunks:
            try:
                # Get neighboring chunks for better context
                context_text = self._get_expanded_chunk_context(c, rag)
            except Exception as e:
                # Fallback to chunk text if expansion fails
                logger.debug(f"Expanded context failed for {c.citation_key}: {e}")
                context_text = c.text if c.text else ""
                if len(context_text) > 1200:
                    context_text = context_text[:1200] + "..."

            evidence_lines.append(
                f"[{c.citation_key} ({c.year}), p.{c.book_page}] (similarity: {c.similarity:.2f})\n{context_text}"
            )

        evidence_str = "\n\n---\n\n".join(evidence_lines)

        # Step 3: Build prompt with full context
        prompt = self._build_grounded_rag_prompt(
            paragraph=paragraph,
            paragraph_number=paragraph_number,
            total_paragraphs=total_paragraphs,
            evidence_str=evidence_str,
            chunks=chunks,
            full_document=full_document,
            already_cited=already_cited or [],
        )

        # Step 4: Call Gemini
        response = self.client.generate_content(prompt)

        # Step 5: Parse and validate citations
        citations = self._parse_grounded_citations(response, chunks, style)

        if return_chunks:
            return citations, chunks
        return citations

    def _build_grounded_rag_prompt(
        self,
        paragraph: str,
        paragraph_number: int,
        total_paragraphs: int,
        evidence_str: str,
        chunks: List[RetrievedChunk],
        full_document: Optional[str] = None,
        already_cited: Optional[List[Dict[str, Any]]] = None,
    ) -> str:
        """Build prompt for grounded RAG citation matching with claim classification.

        Args:
            paragraph: Current batch of paragraphs to analyze
            paragraph_number: Current batch number
            total_paragraphs: Total batch count
            evidence_str: Formatted evidence from RAG
            chunks: Retrieved chunks
            full_document: Complete document text for context
            already_cited: Sources already cited in previous batches
        """
        # Build list of valid citation targets with YEARS prominently displayed
        valid_targets = []
        pages_by_source = {}  # citation_key -> sorted list of pages
        source_years = {}  # citation_key -> year
        seen = set()

        for c in chunks:
            key = f"{c.citation_key}_p{c.book_page}"
            if key not in seen:
                seen.add(key)
                year = c.year if c.year else "unknown"
                valid_targets.append(f"- {c.citation_key} (YEAR: {year}), p.{c.book_page}")
                # Track pages per source for range detection
                if c.citation_key not in pages_by_source:
                    pages_by_source[c.citation_key] = []
                    source_years[c.citation_key] = year
                pages_by_source[c.citation_key].append(c.book_page)

        # Sort pages for each source
        for key in pages_by_source:
            pages_by_source[key] = sorted(set(pages_by_source[key]))

        valid_targets_str = "\n".join(valid_targets[:50])

        # Build page range info for sources with consecutive pages
        range_info = []
        for citation_key, pages in pages_by_source.items():
            year = source_years.get(citation_key, "?")
            if len(pages) > 1:
                range_info.append(f"  {citation_key} ({year}): pages {pages}")
        range_info_str = "\n".join(range_info) if range_info else "  (no multi-page sources detected)"

        # Build full document summary (truncated for context)
        doc_summary = ""
        if full_document:
            # Show first 2000 chars and last 1000 chars for document overview
            if len(full_document) > 4000:
                doc_summary = f"{full_document[:2000]}\n\n[...middle sections omitted...]\n\n{full_document[-1000:]}"
            else:
                doc_summary = full_document

        # Build already-cited sources summary
        cited_summary = ""
        if already_cited:
            # Group by source
            from collections import defaultdict
            by_source = defaultdict(list)
            for cite in already_cited:
                by_source[cite["source"]].append(cite)

            cited_lines = []
            for source, cites in by_source.items():
                pages = sorted(set(c["page"] for c in cites))
                year = cites[0].get("year", "?")
                cited_lines.append(f"  - {source} ({year}): cited {len(cites)} times, pages {pages}")
            cited_summary = "\n".join(cited_lines)

        # Detect document language for quotation mark style
        doc_sample = (full_document[:2000] if full_document else paragraph).lower()
        spanish_indicators = ["el", "la", "los", "las", "de", "que", "en", "es", "un", "una", "del", "por", "con", "para"]
        french_indicators = ["le", "la", "les", "de", "des", "du", "que", "est", "dans", "pour", "avec", "sur"]
        spanish_count = sum(1 for w in spanish_indicators if f" {w} " in doc_sample)
        french_count = sum(1 for w in french_indicators if f" {w} " in doc_sample)

        if spanish_count > french_count and spanish_count > 5:
            detected_language = "spanish"
            quote_instruction = """
=== QUOTATION MARKS (SPANISH DOCUMENT) ===

This document is in SPANISH. Use Spanish/guillemet quotation marks:
- Opening quote: « (no space after)
- Closing quote: » (no space before)
- Example: «texto citado»
- NEVER use English quotes ("") in the rewritten text
"""
        elif french_count > spanish_count and french_count > 5:
            detected_language = "french"
            quote_instruction = """
=== QUOTATION MARKS (FRENCH DOCUMENT) ===

This document is in FRENCH. Use French quotation marks WITH SPACES:
- Opening quote: « (WITH space after)
- Closing quote: » (WITH space before)
- Example: « texte cité »
- NEVER use English quotes ("") in the rewritten text
"""
        else:
            detected_language = "english"
            quote_instruction = """
=== QUOTATION MARKS (ENGLISH DOCUMENT) ===

This document is in ENGLISH. Use standard English quotation marks:
- Opening quote: "
- Closing quote: "
- Example: "cited text"
"""

        # Determine source languages from chunks
        source_languages = set()
        for c in chunks:
            # Check for language indicators in chunk text
            chunk_lower = c.text.lower()[:200] if c.text else ""
            if any(w in chunk_lower for w in ["the ", " is ", " are ", " of ", " and ", " that "]):
                source_languages.add("en")
            if any(w in chunk_lower for w in [" el ", " la ", " los ", " de ", " que ", " es "]):
                source_languages.add("es")
            if any(w in chunk_lower for w in [" le ", " la ", " les ", " du ", " des ", " est "]):
                source_languages.add("fr")
            if any(w in chunk_lower for w in [" der ", " die ", " das ", " und ", " ist "]):
                source_languages.add("de")

        # Build cross-lingual instruction if needed
        cross_lingual_instruction = ""
        doc_lang_code = {"spanish": "es", "french": "fr", "english": "en"}.get(detected_language, "en")
        other_languages = source_languages - {doc_lang_code}

        if other_languages:
            lang_names = {"en": "English", "es": "Spanish", "fr": "French", "de": "German"}
            other_lang_names = ", ".join(lang_names.get(l, l) for l in other_languages)
            cross_lingual_instruction = f"""
=== CROSS-LINGUAL CITATION MATCHING ===

IMPORTANT: This document is in {detected_language.upper()}, but many sources are in {other_lang_names}.

You MUST match claims SEMANTICALLY across languages:
- Spanish "coherencia textual" = English "textual coherence"
- Spanish "cohesión léxica" = English "lexical cohesion"
- Spanish "tokenización" = English "tokenization"
- Spanish "modelo de lenguaje" = English "language model"
- Spanish "espacio latente" = English "latent space"
- Spanish "aparato perceptivo" = English "perceptual apparatus"
- Spanish "gramática cognitiva" = English "cognitive grammar"
- Spanish "macroestructuras" = English "macrostructures"

When a Spanish claim discusses concepts from an English source, CITE THE ENGLISH SOURCE.
The evidence text will be in English, but it supports the Spanish claim semantically.

Example:
- Spanish claim: "La cohesión léxica conecta elementos textuales"
- English evidence: "Lexical cohesion creates connections between textual elements"
- These are THE SAME CLAIM - cite the English source!
"""

        prompt = f"""You are an expert academic citation assistant with deep knowledge of citation logic and academic integrity. Your task is to identify claims, CLASSIFY the citation relationship, and potentially REWRITE sentences for proper attribution.
{quote_instruction}
{cross_lingual_instruction}

=== FULL DOCUMENT CONTEXT ===

The document you are citing discusses the following topics (showing beginning and end):

{doc_summary if doc_summary else "(Full document not provided)"}

=== ALREADY CITED IN THIS DOCUMENT ===

The following sources have already been cited in previous sections of this document:

{cited_summary if cited_summary else "(No sources cited yet - this is the first batch)"}

IMPORTANT: Avoid over-citing the same source. If a source has been heavily cited already, only cite it again for NEW claims not covered by previous citations.

=== CURRENT SECTION TO ANALYZE ({paragraph_number}/{total_paragraphs}) ===

{paragraph}

=== RETRIEVED EVIDENCE (with source YEAR, verified page numbers, and expanded context) ===

{evidence_str}

=== VALID SOURCES (note the PUBLICATION YEAR of each source) ===

{valid_targets_str}

=== AVAILABLE PAGE RANGES ===

{range_info_str}

=== CRITICAL: TEMPORAL IMPOSSIBILITY DETECTION ===

A source CANNOT directly support claims about concepts that didn't exist when it was written:

EXAMPLES OF TEMPORAL IMPOSSIBILITY:
- A 1981 source (de Beaugrande) CANNOT directly discuss "tokenization in neural language models"
- A 1987 source (Langacker) CANNOT directly support claims about "Transformers" or "attention mechanisms"
- A 1980 source (van Dijk) CANNOT discuss "embedding spaces" or "BPE algorithms"

MODERN NLP CONCEPTS (require sources from 2013+):
- Transformers, attention mechanisms (2017+)
- Tokenization algorithms: BPE, WordPiece, SentencePiece (2016+)
- Neural language models, embeddings (2013+)
- BERT, GPT, LLMs (2018+)

IF a claim about modern NLP cites an older linguistics source, this is FRAMEWORK APPLICATION, not direct support.

=== CITATION TYPE CLASSIFICATION (MANDATORY) ===

For EACH potential citation, classify the relationship:

1. "direct_support" - The source DIRECTLY makes or supports this exact claim
   - Source year is appropriate for the topic
   - Evidence text contains the same argument
   - Example: "Cohesion creates textual unity" → Halliday (1976) directly discusses this

2. "framework_application" - You're APPLYING the source's concept to a NEW domain
   - Source year predates the technology/concept being discussed
   - The connection is the AUTHOR'S novel synthesis
   - Example: "Tokenization operates as a perceptual apparatus" → de Beaugrande (1981) didn't discuss tokenization, but his framework is being applied
   - REQUIRES: suggested_rewrite field with properly attributed text

3. "background_context" - Foundational knowledge that frames the argument
   - General theoretical background
   - Example: "Text linguistics studies coherence" → basic background claim

4. "novel_contribution" - The author's own idea or synthesis
   - NO CITATION NEEDED - this is the author's contribution
   - Example: Original metaphors, novel arguments

5. "temporal_impossible" - Citation is logically impossible
   - A pre-2010 source cited for claims about neural NLP
   - MUST be converted to framework_application with rewrite

=== FRAMEWORK APPLICATION REWRITES ===

When citation_type is "framework_application", you MUST provide a suggested_rewrite that:
1. Clearly attributes the framework to the original source
2. Marks the novel application as the author's proposal
3. Replaces the ENTIRE sentence or clause that will be substituted

CRITICAL FOR REWRITES: The claim_text for framework applications should be the COMPLETE SENTENCE
(from start to just before the period) that will be replaced. The suggested_rewrite will
SUBSTITUTE the entire claim_text, so both must match in scope.

EXAMPLES:

Original sentence: "La tokenización opera como el aparato perceptivo del modelo."

WRONG claim_text (too short):
  claim_text: "el aparato perceptivo del modelo"  ← Only part of sentence!
  Result: "La tokenización opera como [rewrite]." ← Broken!

CORRECT claim_text (full sentence):
  claim_text: "La tokenización opera como el aparato perceptivo del modelo"  ← Full sentence
  suggested_rewrite: "Aplicando el marco procesual de de Beaugrande y Dressler (1981), proponemos que la tokenización funciona como el aparato perceptivo del modelo"
  Result: "[rewrite]." ← Clean replacement!

EXAMPLE REWRITES:

Original: "Proponemos que la tokenización impone un construal específico."
claim_text: "Proponemos que la tokenización impone un construal específico"
suggested_rewrite: "Langacker (1987) introdujo el concepto de construal. Aplicando este marco, proponemos que la tokenización impone un construal específico"

=== CLAIM_TEXT EXTRACTION RULES ===

The "claim_text" field must contain the EXACT substring from the document.

RULE 1: Copy text CHARACTER-FOR-CHARACTER
  - Same capitalization, accents, punctuation
  - If no exact match, citation will fail

RULE 2: STOP BEFORE sentence-ending punctuation (. ! ? :)

RULE 3: For DIRECT_SUPPORT: meaningful phrase or clause
        For FRAMEWORK_APPLICATION: ENTIRE sentence to be replaced

=== OUTPUT FORMAT (valid JSON only) ===

{{
  "citations": [
    {{
      "claim_text": "exact substring from document",
      "citation_key": "halliday1976",
      "book_page": 322,
      "book_page_end": null,
      "evidence_match": "brief quote from evidence",
      "confidence": 0.92,
      "citation_type": "direct_support",
      "suggested_rewrite": null
    }},
    {{
      "claim_text": "la tokenización opera como el aparato perceptivo del modelo",
      "citation_key": "beaugrande1981",
      "book_page": 93,
      "book_page_end": null,
      "evidence_match": "The procedural processing model...",
      "confidence": 0.85,
      "citation_type": "framework_application",
      "suggested_rewrite": "Aplicando el marco procesual de de Beaugrande y Dressler (1981), proponemos que la tokenización funciona como el aparato perceptivo del modelo"
    }}
  ],
  "novel_contributions": [
    "Brief description of claims that are the author's own ideas (no citation needed)"
  ],
  "warnings": [
    "Any temporal impossibilities or concerns detected"
  ]
}}

If no claims need citations: {{"citations": [], "novel_contributions": [], "warnings": []}}

=== CRITICAL REMINDERS ===

1. NEVER cite a pre-2013 source as direct support for neural NLP claims
2. Framework applications REQUIRE suggested_rewrite
3. Novel contributions should NOT be cited - they are the author's ideas
4. When in doubt, classify as framework_application with proper rewrite
"""
        return prompt

    def _parse_grounded_citations(
        self,
        response: Any,
        chunks: List[RetrievedChunk],
        style: CitationStyle,
    ) -> List["GroundedCitation"]:
        """Parse grounded citations and validate page numbers.

        Supports page ranges (e.g., pp. 3-11) when Gemini provides book_page_end.
        """
        citations = []

        try:
            response_text = response.text

            # Find JSON block
            if "```json" in response_text:
                json_start = response_text.index("```json") + 7
                json_end = response_text.index("```", json_start)
                json_text = response_text[json_start:json_end].strip()
            elif "{" in response_text and "}" in response_text:
                json_start = response_text.index("{")
                json_end = response_text.rindex("}") + 1
                json_text = response_text[json_start:json_end]
            else:
                logger.warning("No JSON found in grounded RAG response")
                return []

            data = json.loads(json_text)

            # Build lookup for validation: (citation_key, page) -> chunk
            valid_pages = {}
            for chunk in chunks:
                key = (chunk.citation_key, chunk.book_page)
                if key not in valid_pages:
                    valid_pages[key] = chunk

            for cite_data in data.get("citations", []):
                citation_key = cite_data.get("citation_key")
                book_page = cite_data.get("book_page", 1)
                book_page_end = cite_data.get("book_page_end")  # NEW: page range end

                # Validate start page exists in retrieval
                lookup_key = (citation_key, book_page)
                if lookup_key not in valid_pages:
                    # Try fuzzy match
                    matched = False
                    for (ck, pg), chunk in valid_pages.items():
                        if citation_key and citation_key.lower() in ck.lower():
                            lookup_key = (ck, pg)
                            matched = True
                            break
                    if not matched:
                        logger.warning(f"Skipping unverified: {citation_key} p.{book_page}")
                        continue

                chunk = valid_pages[lookup_key]

                # Validate page range if specified
                page_end = None
                pdf_page_end = None
                if book_page_end is not None and book_page_end != book_page:
                    # Validate end page exists
                    end_key = (citation_key, book_page_end)
                    if end_key in valid_pages:
                        end_chunk = valid_pages[end_key]
                        page_end = book_page_end
                        pdf_page_end = end_chunk.pdf_page
                        logger.info(f"Page range validated: {citation_key} pp. {book_page}-{book_page_end}")
                    else:
                        # Try to find closest valid end page
                        valid_source_pages = sorted([
                            pg for (ck, pg) in valid_pages.keys()
                            if ck == citation_key and pg > book_page
                        ])
                        if valid_source_pages:
                            # Use highest available page up to requested end
                            for pg in reversed(valid_source_pages):
                                if pg <= book_page_end:
                                    end_chunk = valid_pages[(citation_key, pg)]
                                    page_end = pg
                                    pdf_page_end = end_chunk.pdf_page
                                    logger.info(f"Page range adjusted: {citation_key} pp. {book_page}-{pg} (requested {book_page_end})")
                                    break

                # Format citation string with page range support
                author_str = self._format_authors_apa7(chunk.authors) if chunk.authors else "Unknown"
                year = chunk.year if chunk.year else 0

                if page_end is not None and page_end != book_page:
                    # Page range: pp. X-Y
                    if style == CitationStyle.APA7:
                        citation_string = f"({author_str}, {year}, pp. {book_page}-{page_end})"
                    else:
                        title = chunk.title if chunk.title else "Unknown"
                        citation_string = f'{author_str}, "{title}" ({year}): {book_page}-{page_end}.'
                else:
                    # Single page: p. X
                    if style == CitationStyle.APA7:
                        citation_string = f"({author_str}, {year}, p. {book_page})"
                    else:
                        title = chunk.title if chunk.title else "Unknown"
                        citation_string = f'{author_str}, "{title}" ({year}): {book_page}.'

                # Parse citation type (new field)
                raw_type = cite_data.get("citation_type", "direct_support")
                try:
                    citation_type = CitationType(raw_type)
                except ValueError:
                    citation_type = CitationType.DIRECT_SUPPORT

                # Get suggested rewrite for framework applications
                suggested_rewrite = cite_data.get("suggested_rewrite")

                # Detect temporal impossibility
                temporal_warning = None
                if year and year < 2010:
                    claim_text_lower = cite_data.get("claim_text", "").lower()
                    modern_terms = ["tokeniz", "transformer", "attention", "embedding",
                                    "bert", "gpt", "neural", "bpe", "wordpiece", "llm",
                                    "modelo de lenguaje", "red neuronal", "espacio latente"]
                    if any(term in claim_text_lower for term in modern_terms):
                        if citation_type == CitationType.DIRECT_SUPPORT:
                            # Upgrade to framework application
                            citation_type = CitationType.FRAMEWORK_APPLICATION
                            temporal_warning = (
                                f"Source year {year} predates modern NLP concepts. "
                                f"Treated as framework application."
                            )
                            logger.warning(temporal_warning)

                citations.append(GroundedCitation(
                    citation_key=chunk.citation_key,
                    page_number=chunk.book_page,
                    pdf_page_number=chunk.pdf_page,
                    claim_text=cite_data.get("claim_text", ""),
                    evidence_text=cite_data.get("evidence_match", ""),
                    confidence=cite_data.get("confidence", 0.7),
                    citation_string=citation_string,
                    authors=chunk.authors,
                    year=year,
                    title=chunk.title,
                    page_end=page_end,
                    pdf_page_end=pdf_page_end,
                    citation_type=citation_type,
                    suggested_rewrite=suggested_rewrite,
                    temporal_warning=temporal_warning,
                ))

            # Log warnings from response
            for warning in data.get("warnings", []):
                logger.warning(f"Citation warning: {warning}")

            # Log novel contributions (no citations needed)
            for novel in data.get("novel_contributions", []):
                logger.info(f"Novel contribution (no citation): {novel}")

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse grounded JSON: {e}")
        except Exception as e:
            logger.error(f"Error parsing grounded citations: {e}")

        return citations


class CitationType(Enum):
    """Classification of citation relationship."""
    DIRECT_SUPPORT = "direct_support"  # Source directly makes/supports the claim
    FRAMEWORK_APPLICATION = "framework_application"  # Using source's framework for new domain
    BACKGROUND_CONTEXT = "background_context"  # Foundational knowledge
    NOVEL_CONTRIBUTION = "novel_contribution"  # Author's own idea - no citation needed
    TEMPORAL_IMPOSSIBLE = "temporal_impossible"  # Source predates the concept


class GroundedCitation:
    """Citation with verified page from RAG retrieval.

    Supports page ranges for concepts spanning multiple pages (e.g., pp. 123-126).
    Now includes citation type classification and text modification suggestions.
    """

    def __init__(
        self,
        citation_key: str,
        page_number: int,
        pdf_page_number: int,
        claim_text: str,
        evidence_text: str,
        confidence: float,
        citation_string: str,
        authors: str = "",
        year: int = 0,
        title: str = "",
        source_paragraph_id: int = -1,
        page_end: Optional[int] = None,
        pdf_page_end: Optional[int] = None,
        citation_type: CitationType = CitationType.DIRECT_SUPPORT,
        suggested_rewrite: Optional[str] = None,
        temporal_warning: Optional[str] = None,
    ):
        self.citation_key = citation_key
        self.page_number = page_number  # Start page (or single page)
        self.page_end = page_end  # End page for ranges (None if single page)
        self.pdf_page_number = pdf_page_number
        self.pdf_page_end = pdf_page_end  # End PDF page for ranges
        self.claim_text = claim_text
        self.evidence_text = evidence_text
        self.confidence = confidence
        self.citation_string = citation_string
        self.authors = authors
        self.year = year
        self.title = title
        self.source_pdf = None
        self.source_paragraph_id = source_paragraph_id  # Which paragraph this citation is for
        # New fields for citation logic
        self.citation_type = citation_type
        self.suggested_rewrite = suggested_rewrite  # Rewritten text for framework applications
        self.temporal_warning = temporal_warning  # Warning about temporal impossibility

    @property
    def is_page_range(self) -> bool:
        """Return True if this citation spans multiple pages."""
        return self.page_end is not None and self.page_end != self.page_number

    @property
    def needs_rewrite(self) -> bool:
        """Return True if text should be rewritten (framework application)."""
        return self.citation_type == CitationType.FRAMEWORK_APPLICATION and self.suggested_rewrite

    @property
    def is_impossible(self) -> bool:
        """Return True if citation is temporally impossible."""
        return self.citation_type == CitationType.TEMPORAL_IMPOSSIBLE

    @property
    def page_string(self) -> str:
        """Format page(s) as 'p. X' or 'pp. X-Y'."""
        if self.is_page_range:
            return f"pp. {self.page_number}-{self.page_end}"
        return f"p. {self.page_number}"

    @property
    def journal_page(self) -> int:
        return self.page_number

    def format_apa7(self) -> str:
        return f"({self.authors}, {self.year}, p. {self.page_number})"

    def format_chicago17(self) -> str:
        return f'{self.authors}, "{self.title}" ({self.year}): {self.page_number}.'
