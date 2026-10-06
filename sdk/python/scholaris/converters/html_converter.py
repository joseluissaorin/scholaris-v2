"""Markdown to HTML converter for literature reviews."""
import logging
from typing import Optional

import markdown

from ..exceptions import ConversionError

logger = logging.getLogger(__name__)


class HtmlConverter:
    """Convert markdown to HTML format with academic styling."""

    def __init__(self):
        """Initialize HTML converter."""
        pass

    def convert(self, markdown_text: str, output_path: str, include_css: bool = True) -> str:
        """Convert markdown text to HTML file.

        Args:
            markdown_text: Markdown content
            output_path: Path to save HTML file
            include_css: Include default academic CSS styling

        Returns:
            Path to created HTML file

        Raises:
            ConversionError: If conversion fails
        """
        logger.info(f"Converting markdown to HTML: {output_path}")

        try:
            # Convert markdown to HTML
            html_content = markdown.markdown(markdown_text, extensions=[
                'extra',
                'tables',
                'sane_lists',
                'footnotes',
                'smarty',
                'codehilite',
                'toc',  # Table of contents
                'meta'  # Metadata
            ])

            # Wrap in full HTML document
            if include_css:
                html_doc = self._create_html_document(html_content)
            else:
                html_doc = html_content

            # Write to file
            with open(output_path, 'w', encoding='utf-8') as f:
                f.write(html_doc)

            logger.info(f"✓ HTML saved: {output_path}")
            return output_path

        except Exception as e:
            logger.error(f"HTML conversion failed: {e}")
            raise ConversionError(f"Failed to convert to HTML: {e}")

    def _create_html_document(self, content: str) -> str:
        """Wrap content in full HTML document with CSS."""
        return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Academic Literature Review</title>
    <style>
        {self._get_academic_css()}
    </style>
</head>
<body>
    <div class="container">
        {content}
    </div>
</body>
</html>"""

    def _get_academic_css(self) -> str:
        """Get CSS styling for academic documents."""
        return """
        body {
            font-family: 'Times New Roman', Times, serif;
            font-size: 12pt;
            line-height: 1.6;
            color: #333;
            background-color: #fff;
            margin: 0;
            padding: 0;
        }

        .container {
            max-width: 800px;
            margin: 0 auto;
            padding: 2.5cm;
            background-color: #fff;
        }

        h1, h2, h3, h4, h5, h6 {
            font-family: 'Times New Roman', Times, serif;
            font-weight: bold;
            margin-top: 1.5em;
            margin-bottom: 0.5em;
            color: #000;
        }

        h1 {
            font-size: 24pt;
            text-align: center;
            border-bottom: 2px solid #000;
            padding-bottom: 0.3em;
        }

        h2 {
            font-size: 18pt;
            border-bottom: 1px solid #666;
            padding-bottom: 0.2em;
        }

        h3 {
            font-size: 14pt;
        }

        p {
            text-align: justify;
            text-indent: 1.27cm;
            margin-bottom: 1em;
        }

        a {
            color: #0066cc;
            text-decoration: none;
        }

        a:hover {
            text-decoration: underline;
        }

        blockquote {
            margin: 1em 2em;
            padding: 0.5em 1em;
            border-left: 3px solid #ccc;
            background-color: #f9f9f9;
            font-style: italic;
        }

        code {
            font-family: 'Courier New', Courier, monospace;
            font-size: 10pt;
            background-color: #f4f4f4;
            padding: 2px 4px;
            border-radius: 3px;
        }

        pre {
            font-family: 'Courier New', Courier, monospace;
            font-size: 10pt;
            background-color: #f4f4f4;
            padding: 1em;
            border-radius: 5px;
            overflow-x: auto;
            margin: 1em 0;
        }

        pre code {
            background-color: transparent;
            padding: 0;
        }

        table {
            border-collapse: collapse;
            width: 100%;
            margin: 1em 0;
        }

        table, th, td {
            border: 1px solid #666;
        }

        th, td {
            padding: 0.5em;
            text-align: left;
        }

        th {
            background-color: #f0f0f0;
            font-weight: bold;
        }

        ul, ol {
            margin: 0.5em 0;
            padding-left: 2em;
        }

        li {
            margin-bottom: 0.3em;
        }

        img {
            max-width: 100%;
            height: auto;
            display: block;
            margin: 1em auto;
        }

        .footnote {
            font-size: 10pt;
            margin-top: 2em;
            border-top: 1px solid #ccc;
            padding-top: 1em;
        }

        @media print {
            .container {
                max-width: none;
                margin: 0;
            }

            a {
                color: #000;
            }

            h1, h2 {
                page-break-after: avoid;
            }

            pre, blockquote {
                page-break-inside: avoid;
            }
        }
        """
