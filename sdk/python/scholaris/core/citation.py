"""Citation formatting utilities (APA 7th edition)."""
import logging
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)


class CitationFormatter:
    """Format citations and references according to APA 7th edition."""

    @staticmethod
    def format_reference_list(
        bib_entries: List[Dict[str, Any]],
        style: str = "APA7"
    ) -> str:
        """Format a list of BibTeX entries as APA 7th references.

        Args:
            bib_entries: List of BibTeX entry dictionaries
            style: Citation style (currently only APA7 supported)

        Returns:
            Formatted reference list as string
        """
        if style != "APA7":
            logger.warning(f"Style '{style}' not supported, using APA7")

        if not bib_entries:
            return "## References\n\nNo references found."

        # Sort alphabetically by author last name
        def get_sort_key(entry):
            author = entry.get('author', '').strip()
            if author:
                first_author = author.split(' and ')[0]
                parts = first_author.split(',')
                if len(parts) > 1:
                    return parts[0].strip().lower()
                else:
                    parts = first_author.split()
                    if parts:
                        return parts[-1].lower()
            return entry.get('title', '').lower()

        sorted_entries = sorted(bib_entries, key=get_sort_key)

        # Format each entry
        references = ["## References\n"]

        for entry in sorted_entries:
            ref = CitationFormatter._format_apa7_entry(entry)
            if ref:
                references.append(ref)
                references.append("")  # Blank line between entries

        return "\n".join(references)

    @staticmethod
    def _format_apa7_entry(entry: Dict[str, Any]) -> str:
        """Format a single BibTeX entry as APA 7th reference.

        Args:
            entry: BibTeX entry dictionary

        Returns:
            Formatted reference string
        """
        # Extract fields
        authors = entry.get('author', 'Unknown Author')
        year = entry.get('year', 'n.d.')
        title = entry.get('title', 'Untitled')
        entry_type = entry.get('ENTRYTYPE', 'article').lower()

        # Format authors (simplified - just use as-is for now)
        # In production, should parse and format author names properly
        author_str = authors.replace(' and ', ', & ')

        # Format based on entry type
        if entry_type == 'article':
            journal = entry.get('journal', '')
            volume = entry.get('volume', '')
            pages = entry.get('pages', '')
            doi = entry.get('doi', '')

            ref = f"{author_str} ({year}). {title}. "
            if journal:
                ref += f"*{journal}*"
            if volume:
                ref += f", *{volume}*"
            if pages:
                ref += f", {pages}"
            if doi:
                ref += f". https://doi.org/{doi}"
            ref += "."

        elif entry_type in ['inproceedings', 'conference']:
            booktitle = entry.get('booktitle', '')
            pages = entry.get('pages', '')

            ref = f"{author_str} ({year}). {title}. "
            if booktitle:
                ref += f"In *{booktitle}*"
            if pages:
                ref += f" (pp. {pages})"
            ref += "."

        elif entry_type == 'book':
            publisher = entry.get('publisher', '')

            ref = f"{author_str} ({year}). *{title}*. "
            if publisher:
                ref += f"{publisher}."
            else:
                ref += "."

        else:
            # Generic format for unknown types
            ref = f"{author_str} ({year}). {title}."

        return ref

    @staticmethod
    def generate_in_text_citation(entry: Dict[str, Any]) -> str:
        """Generate in-text citation (Author, Year) format.

        Args:
            entry: BibTeX entry dictionary

        Returns:
            In-text citation string
        """
        authors = entry.get('author', 'Unknown')
        year = entry.get('year', 'n.d.')

        # Get first author's last name
        first_author = authors.split(' and ')[0]
        parts = first_author.split(',')
        if len(parts) > 1:
            last_name = parts[0].strip()
        else:
            parts = first_author.split()
            last_name = parts[-1] if parts else 'Unknown'

        # Check if multiple authors
        if ' and ' in authors:
            return f"({last_name} et al., {year})"
        else:
            return f"({last_name}, {year})"


# Convenience functions for direct import
def format_apa7_reference(entry: Dict[str, Any]) -> str:
    """Format a single BibTeX entry as APA 7th reference.

    Convenience wrapper around CitationFormatter._format_apa7_entry.

    Args:
        entry: BibTeX entry dictionary

    Returns:
        Formatted reference string
    """
    return CitationFormatter._format_apa7_entry(entry)


def generate_in_text_citation(entry: Dict[str, Any]) -> str:
    """Generate in-text citation (Author, Year) format.

    Convenience wrapper around CitationFormatter.generate_in_text_citation.

    Args:
        entry: BibTeX entry dictionary

    Returns:
        In-text citation string
    """
    return CitationFormatter.generate_in_text_citation(entry)
