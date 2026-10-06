"""SPDF - Scholaris Processed Document Format

A portable, self-contained file format for storing processed PDF documents
ready for citation matching.

Modules:
- validator: Validate .spdf files against the specification
- reference: Minimal reader/writer implementation

Usage:
    from spdf.validator import SPDFValidator
    from spdf.reference import read_spdf, write_spdf

See SPEC.md for the format specification.
"""

__version__ = "1.0.0"
