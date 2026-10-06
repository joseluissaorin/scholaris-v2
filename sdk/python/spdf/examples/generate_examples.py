#!/usr/bin/env python3
"""Generate example SPDF files for testing and reference.

This script creates:
- minimal.spdf: Smallest valid SPDF file (1 page, no previews)
- full.spdf: Complete example with all features

Run from the spdf directory:
    python examples/generate_examples.py
"""

import sys
from datetime import datetime
from pathlib import Path

import numpy as np

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from reference.writer import SPDFWriter


def create_minimal_example(output_path: Path) -> None:
    """Create minimal.spdf - smallest valid SPDF file."""
    writer = SPDFWriter()

    # Set minimal metadata
    writer._metadata = {
        'citation_key': 'minimal2026',
        'authors': '["Test Author"]',
        'year': '2026',
        'title': 'Minimal SPDF Example',
        'source_pdf_hash': 'sha256:' + '0' * 64,
        'source_pdf_filename': 'minimal.pdf',
        'processed_at': datetime.now().isoformat(),
        'ocr_model': 'test',
        'embedding_model': 'test',
        'embedding_dim': '768',
        'schema_version': '1',
        'total_pages': '1',
        'total_chunks': '1',
    }

    # Add single page
    writer.add_page(
        pdf_page=1,
        book_page=1,
        text="This is a minimal SPDF example with a single page.",
        confidence=0.95,
        is_landscape_half=False,
    )

    # Add single chunk
    writer.add_chunk(
        page_id=0,
        chunk_index=0,
        text="This is a minimal SPDF example with a single page.",
        book_page=1,
        pdf_page=1,
    )

    # Add embedding (random 768-dim vector)
    np.random.seed(42)  # Reproducible
    writer.add_embedding(np.random.randn(768).astype(np.float32))

    # No previews for minimal example

    writer.save(output_path)
    print(f"Created: {output_path}")


def create_full_example(output_path: Path) -> None:
    """Create full.spdf - complete example with all features."""
    writer = SPDFWriter()

    # Set complete metadata
    writer._metadata = {
        'citation_key': 'beaugrande1981',
        'authors': '["Robert-Alain de Beaugrande", "Wolfgang U. Dressler"]',
        'year': '1981',
        'title': 'Introduction to Text Linguistics',
        'source_pdf_hash': 'sha256:' + 'a' * 64,
        'source_pdf_filename': 'beaugrande1981.pdf',
        'processed_at': datetime.now().isoformat(),
        'ocr_model': 'gemini-2.0-flash-lite',
        'embedding_model': 'gemini-embedding-exp-03-07',
        'embedding_dim': '768',
        'schema_version': '1',
        'total_pages': '3',
        'total_chunks': '6',
    }

    # Add pages with different scenarios
    pages = [
        {
            'pdf_page': 1,
            'book_page': -1,  # Roman numeral (i)
            'text': 'INTRODUCTION TO TEXT LINGUISTICS\n\nPreface\n\nThis book presents a comprehensive introduction to the study of texts and discourse.',
            'confidence': 0.92,
            'is_landscape_half': False,
        },
        {
            'pdf_page': 2,
            'book_page': 1,
            'text': 'Chapter 1: Basic Notions\n\nA TEXT will be defined as a COMMUNICATIVE OCCURRENCE which meets seven standards of TEXTUALITY.',
            'confidence': 0.95,
            'is_landscape_half': False,
        },
        {
            'pdf_page': 3,
            'book_page': 2,
            'text': 'The seven standards are: cohesion, coherence, intentionality, acceptability, informativity, situationality, and intertextuality.',
            'confidence': 0.93,
            'is_landscape_half': False,
        },
    ]

    for page in pages:
        writer.add_page(
            pdf_page=page['pdf_page'],
            book_page=page['book_page'],
            text=page['text'],
            confidence=page['confidence'],
            is_landscape_half=page['is_landscape_half'],
        )

    # Add chunks (2 per page)
    chunks = [
        # Page 0 (preface)
        {'page_id': 0, 'chunk_index': 0, 'text': 'INTRODUCTION TO TEXT LINGUISTICS', 'book_page': -1, 'pdf_page': 1},
        {'page_id': 0, 'chunk_index': 1, 'text': 'Preface\n\nThis book presents a comprehensive introduction to the study of texts and discourse.', 'book_page': -1, 'pdf_page': 1},
        # Page 1 (chapter 1)
        {'page_id': 1, 'chunk_index': 0, 'text': 'Chapter 1: Basic Notions', 'book_page': 1, 'pdf_page': 2},
        {'page_id': 1, 'chunk_index': 1, 'text': 'A TEXT will be defined as a COMMUNICATIVE OCCURRENCE which meets seven standards of TEXTUALITY.', 'book_page': 1, 'pdf_page': 2},
        # Page 2 (seven standards)
        {'page_id': 2, 'chunk_index': 0, 'text': 'The seven standards are: cohesion, coherence, intentionality, acceptability,', 'book_page': 2, 'pdf_page': 3},
        {'page_id': 2, 'chunk_index': 1, 'text': 'informativity, situationality, and intertextuality.', 'book_page': 2, 'pdf_page': 3},
    ]

    for chunk in chunks:
        writer.add_chunk(**chunk)

    # Add embeddings (random 768-dim vectors)
    np.random.seed(123)  # Reproducible
    for _ in range(6):
        writer.add_embedding(np.random.randn(768).astype(np.float32))

    # Add fake previews (small placeholder JPEG)
    # This is a minimal valid 1x1 JPEG
    minimal_jpeg = bytes([
        0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
        0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43,
        0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
        0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12,
        0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20,
        0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29,
        0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39, 0x3D, 0x38, 0x32,
        0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01,
        0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xFF, 0xC4, 0x00, 0x1F, 0x00, 0x00,
        0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
        0x09, 0x0A, 0x0B, 0xFF, 0xC4, 0x00, 0xB5, 0x10, 0x00, 0x02, 0x01, 0x03,
        0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7D,
        0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06,
        0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xA1, 0x08,
        0x23, 0x42, 0xB1, 0xC1, 0x15, 0x52, 0xD1, 0xF0, 0x24, 0x33, 0x62, 0x72,
        0x82, 0x09, 0x0A, 0x16, 0x17, 0x18, 0x19, 0x1A, 0x25, 0x26, 0x27, 0x28,
        0x29, 0x2A, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3A, 0x43, 0x44, 0x45,
        0x46, 0x47, 0x48, 0x49, 0x4A, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
        0x5A, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6A, 0x73, 0x74, 0x75,
        0x76, 0x77, 0x78, 0x79, 0x7A, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
        0x8A, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9A, 0xA2, 0xA3,
        0xA4, 0xA5, 0xA6, 0xA7, 0xA8, 0xA9, 0xAA, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6,
        0xB7, 0xB8, 0xB9, 0xBA, 0xC2, 0xC3, 0xC4, 0xC5, 0xC6, 0xC7, 0xC8, 0xC9,
        0xCA, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xD9, 0xDA, 0xE1, 0xE2,
        0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8, 0xE9, 0xEA, 0xF1, 0xF2, 0xF3, 0xF4,
        0xF5, 0xF6, 0xF7, 0xF8, 0xF9, 0xFA, 0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01,
        0x00, 0x00, 0x3F, 0x00, 0xFB, 0xD5, 0xDB, 0x20, 0xA8, 0xF1, 0x64, 0x79,
        0xB7, 0xE1, 0x43, 0x21, 0xFF, 0xD9
    ])

    for pdf_page in [1, 2, 3]:
        writer.add_preview(
            pdf_page=pdf_page,
            thumbnail=minimal_jpeg,
            width=1,
            height=1,
        )

    writer.save(output_path)
    print(f"Created: {output_path}")


def main():
    """Generate all example files."""
    examples_dir = Path(__file__).parent

    create_minimal_example(examples_dir / "minimal.spdf")
    create_full_example(examples_dir / "full.spdf")

    print("\nExample files created successfully!")
    print("You can validate them with:")
    print("  python -m spdf.validator spdf/examples/*.spdf")


if __name__ == "__main__":
    main()
