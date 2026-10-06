"""Citation formatters for APA 7th and Chicago 17th edition styles.

This module handles the formatting of in-text citations and footnotes
according to academic citation standards.
"""

import logging
from typing import List, Optional
from .models import Citation, PageAwarePDF, CitationStyle

logger = logging.getLogger(__name__)


class CitationFormatter:
    """Formats citations in various academic styles."""

    @staticmethod
    def format_apa7(
        citation: Citation,
        is_direct_quote: bool = True,
    ) -> str:
        """Format citation in APA 7th edition style.

        APA 7th edition in-text citation format:
        - Direct quote: (Author, Year, p. PageNumber)
        - Paraphrase: (Author, Year)  [page optional but recommended]
        - Multiple authors: (Smith & Jones, Year, p. X) for 2 authors
        - 3+ authors: (Smith et al., Year, p. X)

        Args:
            citation: Citation object to format
            is_direct_quote: Whether this is a direct quote (requires page number)

        Returns:
            Formatted APA citation string
        """
        source_pdf = citation.source_pdf
        reference = source_pdf.reference

        # Extract author information
        authors = reference.authors
        if not authors:
            author_str = "Unknown"
        elif len(authors) == 1:
            # Single author: last name only
            author_str = authors[0].split()[-1]
        elif len(authors) == 2:
            # Two authors: both last names with &
            author1 = authors[0].split()[-1]
            author2 = authors[1].split()[-1]
            author_str = f"{author1} & {author2}"
        else:
            # 3+ authors: first author et al.
            author_str = f"{authors[0].split()[-1]} et al."

        year = reference.year

        # Get journal page number
        journal_page = source_pdf.get_journal_page(citation.page_number)

        # Check if using PDF pagination (should warn)
        if source_pdf.page_offset_result.uses_pdf_pagination:
            if is_direct_quote or citation.page_number > 0:
                return f"({author_str}, {year}, PDF p. {citation.page_number})"
            return f"({author_str}, {year})"

        # Standard journal pagination
        if is_direct_quote or citation.page_number > 0:
            return f"({author_str}, {year}, p. {journal_page})"

        # Paraphrase without specific page
        return f"({author_str}, {year})"

    @staticmethod
    def format_chicago17_footnote(
        citation: Citation,
        footnote_number: int,
        is_first_citation: bool = True,
    ) -> str:
        """Format citation in Chicago 17th edition (Notes & Bibliography) style.

        Chicago 17th edition footnote formats:
        - First citation: Full format with all details
        - Subsequent: Shortened format (Author, "Title," Page)

        Args:
            citation: Citation object to format
            footnote_number: Footnote number for this citation
            is_first_citation: Whether this is the first citation of this source

        Returns:
            Formatted Chicago footnote content (without superscript number)
        """
        source_pdf = citation.source_pdf
        reference = source_pdf.reference

        # Extract author information
        authors = reference.authors
        if not authors:
            author_str = "Unknown"
        else:
            # First author: First Last
            first_author_parts = authors[0].split()
            if len(first_author_parts) >= 2:
                author_str = f"{first_author_parts[0]} {first_author_parts[-1]}"
            else:
                author_str = authors[0]

            if len(authors) > 1:
                author_str += " et al."

        title = reference.title
        source = reference.source
        year = reference.year

        # Get journal page number
        journal_page = source_pdf.get_journal_page(citation.page_number)

        # Check if using PDF pagination
        if source_pdf.page_offset_result.uses_pdf_pagination:
            page_str = f"PDF p. {citation.page_number}"
        else:
            page_str = str(journal_page)

        if is_first_citation:
            # Full citation format
            # Format: Author, "Title," Source Volume, no. Issue (Year): Page.
            volume_info = ""
            if reference.volume:
                volume_info = f" {reference.volume}"
                if reference.issue:
                    volume_info += f", no. {reference.issue}"

            return f'{author_str}, "{title}," {source}{volume_info} ({year}): {page_str}.'
        else:
            # Shortened citation format
            # Format: Author, "Title," Page.
            return f'{author_str}, "{title}," {page_str}.'

    @staticmethod
    def format_chicago17_inline(
        citation: Citation,
        footnote_number: int,
    ) -> str:
        """Format inline superscript marker for Chicago footnote.

        Args:
            citation: Citation object
            footnote_number: Footnote number to display

        Returns:
            Superscript footnote marker (e.g., "^42")
        """
        return f"^{footnote_number}"


class ReferenceListFormatter:
    """Formats complete reference lists (bibliographies)."""

    @staticmethod
    def format_apa7_reference_list(
        page_aware_pdfs: List[PageAwarePDF],
    ) -> str:
        """Format complete reference list in APA 7th edition style.

        APA reference list format (hanging indent):
        Author, A. A., & Author, B. B. (Year). Title of article. Journal Name,
            Volume(Issue), pages. https://doi.org/...

        Args:
            page_aware_pdfs: List of PageAwarePDF objects

        Returns:
            Formatted reference list as string
        """
        references = []

        for pdf in sorted(page_aware_pdfs, key=lambda p: p.reference.authors[0] if p.reference.authors else ""):
            ref = pdf.reference

            # Format authors
            if not ref.authors:
                author_str = "Unknown."
            elif len(ref.authors) == 1:
                parts = ref.authors[0].split()
                if len(parts) >= 2:
                    # Last, F. I.
                    author_str = f"{parts[-1]}, {parts[0][0]}."
                else:
                    author_str = ref.authors[0] + "."
            else:
                # Multiple authors
                formatted_authors = []
                for i, author in enumerate(ref.authors[:7]):  # APA limits to 7 authors
                    parts = author.split()
                    if len(parts) >= 2:
                        if i == len(ref.authors) - 1:
                            # Last author with &
                            formatted_authors.append(f"& {parts[-1]}, {parts[0][0]}.")
                        else:
                            formatted_authors.append(f"{parts[-1]}, {parts[0][0]}.")
                    else:
                        formatted_authors.append(author + ".")

                if len(ref.authors) > 7:
                    formatted_authors.append("...")
                author_str = ", ".join(formatted_authors)

            # Format title
            title = ref.title

            # Format source (journal/conference)
            source = ref.source

            # Format volume/issue/pages
            volume_info = ""
            if ref.volume:
                volume_info = f"{ref.volume}"
                if ref.issue:
                    volume_info += f"({ref.issue})"
                if ref.pages:
                    volume_info += f", {ref.pages}"

            # Format DOI/URL
            doi_url = ""
            if ref.doi:
                doi_url = f"https://doi.org/{ref.doi}"
            elif ref.url:
                doi_url = ref.url

            # Assemble reference
            reference_parts = [
                author_str,
                f"({ref.year}).",
                f"{title}.",
                f"{source},",
            ]

            if volume_info:
                reference_parts.append(volume_info + ".")
            if doi_url:
                reference_parts.append(doi_url)

            references.append(" ".join(reference_parts))

        return "\n\n".join(references)

    @staticmethod
    def format_chicago17_bibliography(
        page_aware_pdfs: List[PageAwarePDF],
    ) -> str:
        """Format complete bibliography in Chicago 17th edition style.

        Chicago bibliography format (hanging indent):
        Author, First Last. "Title of Article." Journal Name Volume, no. Issue
            (Year): Pages. https://doi.org/...

        Args:
            page_aware_pdfs: List of PageAwarePDF objects

        Returns:
            Formatted bibliography as string
        """
        references = []

        for pdf in sorted(page_aware_pdfs, key=lambda p: p.reference.authors[0] if p.reference.authors else ""):
            ref = pdf.reference

            # Format authors
            if not ref.authors:
                author_str = "Unknown"
            elif len(ref.authors) == 1:
                author_str = ref.authors[0]
            else:
                # First author Last, First, and Second First Last
                parts = ref.authors[0].split()
                if len(parts) >= 2:
                    first_author = f"{parts[-1]}, {parts[0]}"
                else:
                    first_author = ref.authors[0]

                if len(ref.authors) == 2:
                    author_str = f"{first_author}, and {ref.authors[1]}"
                else:
                    author_str = f"{first_author} et al."

            # Format title (in quotes for articles)
            title = f'"{ref.title}"'

            # Format source
            source = ref.source

            # Format volume/issue
            volume_info = ""
            if ref.volume:
                volume_info = f" {ref.volume}"
                if ref.issue:
                    volume_info += f", no. {ref.issue}"

            # Format pages
            pages_info = ""
            if ref.pages:
                pages_info = f": {ref.pages}"

            # Format DOI/URL
            doi_url = ""
            if ref.doi:
                doi_url = f" https://doi.org/{ref.doi}."
            elif ref.url:
                doi_url = f" {ref.url}."

            # Assemble reference
            reference = f"{author_str}. {title}. {source}{volume_info} ({ref.year}){pages_info}.{doi_url}"
            references.append(reference)

        return "\n\n".join(references)


def format_citation(
    citation: Citation,
    style: CitationStyle,
    footnote_number: Optional[int] = None,
    is_first_citation: bool = True,
) -> str:
    """Format a citation in the specified style.

    Args:
        citation: Citation object to format
        style: Citation style (APA7 or Chicago17)
        footnote_number: Footnote number (for Chicago style)
        is_first_citation: Whether this is first citation (for Chicago)

    Returns:
        Formatted citation string
    """
    if style == CitationStyle.APA7:
        return CitationFormatter.format_apa7(citation)
    elif style == CitationStyle.CHICAGO17:
        if footnote_number is None:
            footnote_number = 1  # Default
        return CitationFormatter.format_chicago17_footnote(
            citation,
            footnote_number,
            is_first_citation
        )
    else:
        raise ValueError(f"Unsupported citation style: {style}")
