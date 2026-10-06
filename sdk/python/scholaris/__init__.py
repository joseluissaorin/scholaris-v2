"""Scholaris - Academic Research Automation Library.

A Python library for academic research automation including:
- Bibliography search and download
- BibTeX generation
- Literature review generation
- Academic writing assistance
"""

import importlib
from typing import Any

# La v1 (procesado local con PyMuPDF y Gemini) se carga solo si se usa: así
# `scholaris.v2` (lector de SPDF 4.0 y cliente de la API) no necesita sus dependencias.
_PEREZOSOS = {
    "Config": ".config",
    "ScholarisError": ".exceptions", "ConfigurationError": ".exceptions", "SearchError": ".exceptions",
    "DownloadError": ".exceptions", "BibTeXError": ".exceptions", "LLMError": ".exceptions",
    "RateLimitError": ".exceptions", "ConversionError": ".exceptions", "ValidationError": ".exceptions",
    "Paper": ".core.models", "Reference": ".core.models", "Section": ".core.models", "Review": ".core.models",
    "Scholaris": ".scholaris",
}


def __getattr__(nombre: str) -> Any:
    if nombre in _PEREZOSOS:
        return getattr(importlib.import_module(_PEREZOSOS[nombre], __name__), nombre)
    raise AttributeError(nombre)


__version__ = "2.0.0"
__all__ = [
    "Scholaris",
    "Config",
    "Paper",
    "Reference",
    "Section",
    "Review",
    "ScholarisError",
    "ConfigurationError",
    "SearchError",
    "DownloadError",
    "BibTeXError",
    "LLMError",
    "RateLimitError",
    "ConversionError",
    "ValidationError",
]
