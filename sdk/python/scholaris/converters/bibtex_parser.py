"""BibTeX parsing utilities extracted from article_generator.py."""
import logging
import bibtexparser
from bibtexparser.bparser import BibTexParser
from bibtexparser.customization import convert_to_unicode
from typing import List, Dict, Any, Optional

from ..exceptions import BibTeXError

logger = logging.getLogger(__name__)


def parse_bibtex(content: str) -> List[Dict[str, Any]]:
    """Parse BibTeX content using bibtexparser library.

    Args:
        content: BibTeX content as string

    Returns:
        List of parsed BibTeX entry dictionaries

    Raises:
        BibTeXError: If parsing fails
    """
    try:
        # Configure the parser
        parser = BibTexParser(common_strings=True)  # Use common_strings for standard abbreviations
        parser.customization = convert_to_unicode  # Handle potential encoding issues
        parser.ignore_comments = True
        parser.homogenize_fields = True  # Make field keys lowercase

        bib_database = bibtexparser.loads(content, parser=parser)

        if not bib_database.entries:
            logger.warning("bibtexparser parsed the string but found no valid entries.")
            return []

        logger.info(f"Successfully parsed {len(bib_database.entries)} BibTeX entries")
        return bib_database.entries

    except Exception as e:
        logger.error(f"BibTeX parsing failed: {e}\nContent snippet: {content[:200]}...")
        raise BibTeXError(f"Failed to parse BibTeX content: {e}")


def parse_bibtex_file(file_path: str) -> List[Dict[str, Any]]:
    """Parse a BibTeX file.

    Args:
        file_path: Path to .bib file

    Returns:
        List of parsed BibTeX entries

    Raises:
        BibTeXError: If file reading or parsing fails
    """
    try:
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
        return parse_bibtex(content)
    except FileNotFoundError:
        raise BibTeXError(f"BibTeX file not found: {file_path}")
    except Exception as e:
        raise BibTeXError(f"Failed to read BibTeX file {file_path}: {e}")


def format_bibtex_metadata(bib_entries: List[Dict[str, Any]]) -> str:
    """Format parsed BibTeX entries into readable string for LLM prompts.

    Args:
        bib_entries: List of parsed BibTeX entry dictionaries

    Returns:
        Formatted string with BibTeX metadata
    """
    if not bib_entries:
        return "No BibTeX metadata found or parsed."

    formatted = "Found BibTeX Metadata for References:\n---\n"

    # Sort entries alphabetically by author last name
    def get_sort_key(entry):
        author = entry.get('author', '').strip()
        if author:
            # Get the first author's last name
            first_author = author.split(' and ')[0]
            parts = first_author.split(',')
            if len(parts) > 1:
                return parts[0].strip().lower()  # Last name first
            else:
                parts = first_author.split()
                if parts:
                    return parts[-1].lower()  # Last name last
        return ""  # Default sort key if no author

    sorted_entries = sorted(bib_entries, key=get_sort_key)

    for i, entry in enumerate(sorted_entries, 1):
        formatted += f"Reference {i}:\n"
        formatted += f"  Title: {entry.get('title', 'N/A')}\n"
        formatted += f"  Authors: {entry.get('author', 'N/A')}\n"
        formatted += f"  Year: {entry.get('year', 'N/A')}\n"

        # Include journal/booktitle if available
        if 'journal' in entry:
            formatted += f"  Journal: {entry.get('journal')}\n"
        if 'booktitle' in entry:
            formatted += f"  Book Title: {entry.get('booktitle')}\n"

        # Include abstract if present
        abstract = entry.get('abstract', '')
        if abstract:
            formatted += f"  Abstract: {abstract[:300]}...\n"
        formatted += "---\n"

    return formatted.strip()


def entries_to_bibtex_string(entries: List[Dict[str, Any]]) -> str:
    """Convert list of BibTeX entry dictionaries to BibTeX string format.

    Args:
        entries: List of BibTeX entry dictionaries

    Returns:
        BibTeX formatted string
    """
    output_lines = []

    for entry in entries:
        entry_type = entry.get('ENTRYTYPE', 'article')
        entry_id = entry.get('ID', 'unknown')

        lines = [f"@{entry_type}{{{entry_id},"]

        for key, value in entry.items():
            if key not in ['ENTRYTYPE', 'ID']:
                # Clean up the value
                value_str = str(value).strip()
                lines.append(f"  {key} = {{{value_str}}},")

        lines.append("}\n")
        output_lines.extend(lines)

    return "\n".join(output_lines)


def save_bibtex(entries: List[Dict[str, Any]], output_path: str) -> None:
    """Save BibTeX entries to a .bib file.

    Args:
        entries: List of BibTeX entry dictionaries
        output_path: Path to save .bib file

    Raises:
        BibTeXError: If saving fails
    """
    try:
        bibtex_string = entries_to_bibtex_string(entries)
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(bibtex_string)
        logger.info(f"Saved {len(entries)} BibTeX entries to {output_path}")
    except Exception as e:
        raise BibTeXError(f"Failed to save BibTeX file {output_path}: {e}")
