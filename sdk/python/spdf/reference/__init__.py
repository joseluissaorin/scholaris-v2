"""SPDF Reference Implementation - Minimal reader/writer for the .spdf format.

This module provides a minimal, dependency-light implementation of the SPDF
format that can be used as a reference for porting to other languages.

The only dependencies are:
- Python 3.9+ standard library (gzip, sqlite3, json, tempfile)
- numpy (for embedding vectors only)

v1.1 adds support for:
- Embedded model checkpoints for reproducible embeddings
- Multi-model embedding storage (embeddings_v2 table)
"""

from .reader import SPDFReader, SPDFData, ModelCheckpoint, EmbeddingV2, SearchResult, read_spdf
from .writer import SPDFWriter, write_spdf

__all__ = [
    # Core classes
    "SPDFReader",
    "SPDFWriter",
    # Data classes
    "SPDFData",
    "ModelCheckpoint",
    "EmbeddingV2",
    "SearchResult",
    # Convenience functions
    "read_spdf",
    "write_spdf",
]
