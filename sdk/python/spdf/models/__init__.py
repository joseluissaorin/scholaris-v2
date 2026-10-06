"""SPDF Model Store - Download, cache, and manage embedding models.

This module provides functionality for:
- Downloading GGUF models from HuggingFace
- Caching models in ~/.spdf/models/
- Verifying model hashes
- Loading models for inference
"""

from .store import ModelStore, ModelInfo, KNOWN_MODELS
from .embedder import LocalEmbedder

__all__ = ["ModelStore", "ModelInfo", "LocalEmbedder", "KNOWN_MODELS"]
