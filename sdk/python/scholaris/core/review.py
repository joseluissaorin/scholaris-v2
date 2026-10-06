"""Literature review generation logic."""
import logging
import re
from typing import List, Optional, Dict, Any

from ..exceptions import LLMError
from .models import Review, Section, Reference

logger = logging.getLogger(__name__)


class ReviewGenerator:
    """Generates academic literature reviews using LLM providers."""

    def __init__(self, llm_provider, config):
        """Initialize review generator.

        Args:
            llm_provider: LLM provider instance (e.g., GeminiProvider)
            config: Configuration object
        """
        self.llm_provider = llm_provider
        self.config = config

    def generate_outline(
        self,
        topic: str,
        bibtex_metadata: str,
        language: str = "English",
        sections: Optional[List[str]] = None,
    ) -> str:
        """Generate article outline from topic and references.

        Args:
            topic: Research topic
            bibtex_metadata: Formatted BibTeX metadata string
            language: Output language
            sections: Optional specific sections to include

        Returns:
            Markdown outline string

        Raises:
            LLMError: If outline generation fails
        """
        logger.info(f"Generating outline for topic: '{topic}'")

        if sections:
            sections_text = ", ".join(sections)
            sections_instruction = f"Create an outline focusing specifically on these sections: {sections_text}."
        else:
            sections_instruction = (
                "Generate a full academic article outline with standard sections "
                "(Abstract, Introduction, Literature Review, Method, Results, Discussion, Conclusion, References)."
            )

        outline_prompt = f"""Based on the user's topic and the provided BibTeX reference metadata, generate a focused outline for an academic article. The outline should follow APA 7th edition formatting and style guidelines.

Topic: {topic}
Language: {language}

Reference Metadata Summary:
---
{bibtex_metadata}
---

Instructions:
- {sections_instruction}
- Always include a References section at the end.
- Briefly describe the content/purpose of each section in the outline.
- Ensure the outline incorporates insights suggested by the reference metadata.
- The output should be ONLY the markdown formatted outline (using ## for section headers).
- DO NOT include introductory text before the outline.
- DO NOT include the References section in the outline (it will be added separately).
"""

        try:
            outline = self.llm_provider.generate(
                prompt=outline_prompt,
                model=self.config.gemini_model_default,
                temperature=1.0
            )
            logger.info("Outline generated successfully")
            return outline
        except Exception as e:
            logger.error(f"Outline generation failed: {e}")
            raise LLMError(f"Failed to generate outline: {e}")

    def parse_sections(self, outline: str) -> List[str]:
        """Parse section titles from outline.

        Args:
            outline: Markdown outline string

        Returns:
            List of section titles
        """
        sections = re.findall(r'^##\s+(.+)$', outline, re.MULTILINE)

        if not sections:
            logger.warning("Could not parse sections from outline")
            sections = ["Article Body"]

        logger.info(f"Parsed {len(sections)} sections from outline")
        return sections

    def generate_section(
        self,
        section_title: str,
        topic: str,
        outline: str,
        bibtex_metadata: str,
        formatted_references: str,
        pdf_paths: List[str],
        previous_content: str = "",
        language: str = "English",
        min_words: int = 2250,
        use_thinking_model: bool = True,
    ) -> str:
        """Generate content for a single section.

        Args:
            section_title: Title of the section to generate
            topic: Research topic
            outline: Full article outline
            bibtex_metadata: Formatted BibTeX metadata
            formatted_references: APA 7th formatted references
            pdf_paths: List of PDF file paths for context
            previous_content: Previously generated sections
            language: Output language
            min_words: Minimum word count for section
            use_thinking_model: Use thinking model for deeper reasoning

        Returns:
            Generated section content

        Raises:
            LLMError: If generation fails
        """
        logger.info(f"Generating section: '{section_title}' with {len(pdf_paths)} PDFs")

        # Limit PDFs to avoid API limits
        MAX_PDFS = 50
        limited_pdfs = pdf_paths[:MAX_PDFS]
        if len(pdf_paths) > MAX_PDFS:
            logger.warning(
                f"Limiting PDFs to {MAX_PDFS} (out of {len(pdf_paths)} total)"
            )

        section_prompt = f"""You are writing an academic article. You have been provided with {len(limited_pdfs)} PDF document(s) as primary source material, along with BibTeX metadata for context. Your current task is to write ONLY the content for the section titled: "{section_title}".

Topic: {topic}
Language: {language}

Reference Metadata Summary:
---
{bibtex_metadata}
---

Formatted References (Use for citations):
---
{formatted_references}
---

Full Article Outline:
---
{outline}
---

{f'''Previously Written Sections:
---
{previous_content}
---''' if previous_content else ''}

Instructions for writing section "{section_title}":
- Write ONLY the content for this specific section. DO NOT repeat the section title in your output.
- Base your writing primarily on the content of the provided PDF documents.
- Adhere strictly to APA 7th edition style, formatting, and tone. Use formal language.
- Use proper APA 7th edition in-text citations (e.g., "Smith et al., 2020" or "Smith & Jones, 2021").
- IMPORTANT: Only cite references that appear in the Formatted References section above.
- Ensure the content logically follows previous sections and sets up subsequent sections.
- Maintain consistency in {language}.
- The section should be at least {min_words} words.
"""

        try:
            # Choose model based on thinking preference
            if use_thinking_model and hasattr(self.config, 'gemini_model_thinking'):
                model = self.config.gemini_model_thinking
                logger.info(f"Using thinking model: {model}")
            else:
                model = self.config.gemini_model_default

            # Generate with file context if PDFs available
            if limited_pdfs and self.llm_provider.supports_file_upload():
                content = self.llm_provider.generate_with_files(
                    prompt=section_prompt,
                    file_paths=limited_pdfs,
                    model=model,
                    temperature=1.2
                )
            else:
                content = self.llm_provider.generate(
                    prompt=section_prompt,
                    model=model,
                    temperature=1.2
                )

            logger.info(f"Section '{section_title}' generated successfully")
            return content.strip()

        except Exception as e:
            logger.error(f"Section generation failed for '{section_title}': {e}")
            raise LLMError(f"Failed to generate section '{section_title}': {e}")

    def generate_review(
        self,
        topic: str,
        bibtex_entries: List[Dict[str, Any]],
        formatted_references: str,
        pdf_paths: Optional[List[str]] = None,
        sections: Optional[List[str]] = None,
        language: str = "English",
        min_words_per_section: int = 2250,
        use_thinking_model: bool = True,
    ) -> Review:
        """Generate complete literature review.

        Args:
            topic: Research topic
            bibtex_entries: List of BibTeX entry dictionaries
            formatted_references: APA 7th formatted references string
            pdf_paths: Optional list of PDF paths for context
            sections: Optional specific sections to include
            language: Output language
            min_words_per_section: Minimum words per section
            use_thinking_model: Use thinking model for generation

        Returns:
            Review object with generated content

        Raises:
            LLMError: If review generation fails
        """
        logger.info(f"Generating literature review for topic: '{topic}'")

        if pdf_paths is None:
            pdf_paths = []

        # Format BibTeX metadata
        from ..converters.bibtex_parser import format_bibtex_metadata
        bibtex_metadata = format_bibtex_metadata(bibtex_entries)

        # 1. Generate outline
        outline = self.generate_outline(
            topic=topic,
            bibtex_metadata=bibtex_metadata,
            language=language,
            sections=sections
        )

        # 2. Parse sections
        section_titles = self.parse_sections(outline)

        # 3. Generate each section
        section_objects = {}
        article_parts = []
        previous_content = ""

        for section_title in section_titles:
            try:
                content = self.generate_section(
                    section_title=section_title,
                    topic=topic,
                    outline=outline,
                    bibtex_metadata=bibtex_metadata,
                    formatted_references=formatted_references,
                    pdf_paths=pdf_paths,
                    previous_content=previous_content,
                    language=language,
                    min_words=min_words_per_section,
                    use_thinking_model=use_thinking_model
                )

                # Store section
                section_objects[section_title] = Section(
                    title=section_title,
                    content=content,
                    word_count=len(content.split())
                )

                # Update previous content
                if previous_content:
                    previous_content += f"\n\n## {section_title}\n\n{content}"
                else:
                    previous_content = f"## {section_title}\n\n{content}"

                article_parts.append(f"## {section_title}\n\n{content}")

            except Exception as e:
                logger.error(f"Failed to generate section '{section_title}': {e}")
                # Add placeholder but continue
                placeholder = f"[Content generation failed for this section: {str(e)[:100]}]"
                section_objects[section_title] = Section(
                    title=section_title,
                    content=placeholder,
                    word_count=0
                )
                article_parts.append(f"## {section_title}\n\n{placeholder}")

        # 4. Combine sections and add references
        markdown = "\n\n".join(article_parts)
        markdown += f"\n\n{formatted_references}"

        # 5. Extract title
        title = topic  # Default
        title_match = re.search(r'^\s*#+\s+(.+)$', markdown, re.MULTILINE)
        if title_match:
            title = title_match.group(1).strip()

        # 6. Create Reference objects
        references = []
        for entry in bibtex_entries:
            references.append(Reference(
                title=entry.get('title', 'Untitled'),
                authors=[a.strip() for a in entry.get('author', 'Unknown').split(' and ')],
                year=int(entry.get('year', 0)) if entry.get('year', '').isdigit() else 0,
                source=entry.get('journal', entry.get('booktitle', 'Unknown source')),
                bibtex_entry=entry
            ))

        # 7. Create Review object
        from datetime import datetime
        review = Review(
            topic=topic,
            markdown=markdown,
            references=references,
            sections=section_objects,
            metadata={
                "language": language,
                "title": title
            },
            generated_at=datetime.now()
        )

        logger.info(f"Review generated: {review.word_count} words, {len(section_objects)} sections")
        return review
