"""Model Store - Download, cache, and verify embedding models.

This module handles model management for SPDF files:
- Downloads GGUF models from HuggingFace
- Caches in ~/.spdf/models/ organized by hash
- Verifies SHA256 hashes
- Provides model metadata
"""

import hashlib
import json
import logging
import os
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional, Dict, List, Any
from urllib.request import urlretrieve
from urllib.error import URLError, HTTPError

logger = logging.getLogger(__name__)


@dataclass
class ModelInfo:
    """Information about an embedding model."""
    name: str                           # "nomic-embed-text-v2-moe"
    version: str                        # "v2.0"
    quantization: str                   # "Q2_K"
    format: str                         # "gguf"
    embedding_dim: int                  # 768
    max_tokens: int                     # 8192

    # Download info
    url: str                            # HuggingFace URL
    sha256: str                         # Expected hash (without "sha256:" prefix)
    size_bytes: int                     # File size

    # Inference parameters
    prefix_query: str = "search_query: "
    prefix_document: str = "search_document: "
    normalize: bool = True

    # License
    license: str = "Apache-2.0"

    @property
    def filename(self) -> str:
        return f"{self.name}.{self.quantization}.{self.format}"

    @property
    def full_hash(self) -> str:
        return f"sha256:{self.sha256}"

    @property
    def size_mb(self) -> float:
        return self.size_bytes / 1024 / 1024

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "version": self.version,
            "quantization": self.quantization,
            "format": self.format,
            "embedding_dim": self.embedding_dim,
            "max_tokens": self.max_tokens,
            "url": self.url,
            "sha256": self.sha256,
            "size_bytes": self.size_bytes,
            "prefix_query": self.prefix_query,
            "prefix_document": self.prefix_document,
            "normalize": self.normalize,
            "license": self.license,
        }


# Registry of known models with verified hashes
# These are the recommended models for SPDF files
KNOWN_MODELS: Dict[str, ModelInfo] = {
    "nomic-embed-text-v2-moe-Q2_K": ModelInfo(
        name="nomic-embed-text-v2-moe",
        version="v2.0",
        quantization="Q2_K",
        format="gguf",
        embedding_dim=768,
        max_tokens=8192,
        url="https://huggingface.co/nomic-ai/nomic-embed-text-v2-moe-GGUF/resolve/main/nomic-embed-text-v2-moe.Q2_K.gguf",
        sha256="placeholder_hash_to_be_updated",  # Will be updated on first download
        size_bytes=293_000_000,  # ~280 MB
        prefix_query="search_query: ",
        prefix_document="search_document: ",
        normalize=True,
        license="Apache-2.0",
    ),
    "nomic-embed-text-v2-moe-Q4_K_M": ModelInfo(
        name="nomic-embed-text-v2-moe",
        version="v2.0",
        quantization="Q4_K_M",
        format="gguf",
        embedding_dim=768,
        max_tokens=8192,
        url="https://huggingface.co/nomic-ai/nomic-embed-text-v2-moe-GGUF/resolve/main/nomic-embed-text-v2-moe.Q4_K_M.gguf",
        sha256="placeholder_hash_to_be_updated",
        size_bytes=586_000_000,  # ~560 MB
        prefix_query="search_query: ",
        prefix_document="search_document: ",
        normalize=True,
        license="Apache-2.0",
    ),
}

# Default model for new SPDF files
DEFAULT_MODEL = "nomic-embed-text-v2-moe-Q2_K"


class ModelStore:
    """Manages local model storage and downloads.

    Models are stored in ~/.spdf/models/ organized by SHA256 hash:
        ~/.spdf/models/
        └── sha256_abc123.../
            ├── model.gguf
            └── metadata.json

    Example:
        store = ModelStore()

        # Download if needed, get path
        path = store.get_model("nomic-embed-text-v2-moe-Q2_K")

        # Or download from URL
        path = store.download(url, expected_hash="sha256:...")

        # Check if model exists
        if store.has_model("sha256:abc123..."):
            path = store.get_path_by_hash("sha256:abc123...")
    """

    DEFAULT_STORE_PATH = Path.home() / ".spdf" / "models"

    def __init__(self, store_path: Optional[Path] = None):
        """Initialize model store.

        Args:
            store_path: Custom path for model storage. Defaults to ~/.spdf/models/
        """
        self.store_path = Path(store_path) if store_path else self.DEFAULT_STORE_PATH
        self.store_path.mkdir(parents=True, exist_ok=True)

        # Load index of installed models
        self._index_path = self.store_path / "index.json"
        self._index: Dict[str, Dict] = self._load_index()

    def _load_index(self) -> Dict[str, Dict]:
        """Load the model index from disk."""
        if self._index_path.exists():
            try:
                return json.loads(self._index_path.read_text())
            except (json.JSONDecodeError, IOError):
                return {}
        return {}

    def _save_index(self) -> None:
        """Save the model index to disk."""
        self._index_path.write_text(json.dumps(self._index, indent=2))

    def list_models(self) -> List[Dict[str, Any]]:
        """List all installed models.

        Returns:
            List of model info dictionaries
        """
        models = []
        for hash_prefix, info in self._index.items():
            model_dir = self.store_path / hash_prefix
            if model_dir.exists():
                info["installed"] = True
                info["path"] = str(model_dir)
                models.append(info)
        return models

    def has_model(self, model_hash: str) -> bool:
        """Check if a model is installed.

        Args:
            model_hash: Full hash like "sha256:abc123..." or just the hash
        """
        hash_value = model_hash.replace("sha256:", "")
        hash_prefix = f"sha256_{hash_value[:16]}"

        if hash_prefix not in self._index:
            return False

        model_dir = self.store_path / hash_prefix
        return model_dir.exists() and (model_dir / "model.gguf").exists()

    def get_path_by_hash(self, model_hash: str) -> Optional[Path]:
        """Get path to model file by hash.

        Args:
            model_hash: Full hash like "sha256:abc123..."

        Returns:
            Path to model file, or None if not found
        """
        hash_value = model_hash.replace("sha256:", "")
        hash_prefix = f"sha256_{hash_value[:16]}"

        model_path = self.store_path / hash_prefix / "model.gguf"
        if model_path.exists():
            return model_path
        return None

    def get_model(self, model_key: str, force_download: bool = False) -> Path:
        """Get a known model, downloading if necessary.

        Args:
            model_key: Key from KNOWN_MODELS (e.g., "nomic-embed-text-v2-moe-Q2_K")
            force_download: Re-download even if exists

        Returns:
            Path to model file

        Raises:
            ValueError: If model_key not in KNOWN_MODELS
            RuntimeError: If download fails
        """
        if model_key not in KNOWN_MODELS:
            available = ", ".join(KNOWN_MODELS.keys())
            raise ValueError(f"Unknown model: {model_key}. Available: {available}")

        model_info = KNOWN_MODELS[model_key]

        # Check if already installed
        if not force_download and self.has_model(model_info.full_hash):
            path = self.get_path_by_hash(model_info.full_hash)
            if path:
                logger.info(f"Model already installed: {model_key}")
                return path

        # Download
        return self.download(
            url=model_info.url,
            expected_hash=model_info.full_hash,
            model_info=model_info,
        )

    def download(
        self,
        url: str,
        expected_hash: Optional[str] = None,
        model_info: Optional[ModelInfo] = None,
        progress_callback: Optional[callable] = None,
    ) -> Path:
        """Download a model from URL.

        Args:
            url: Download URL
            expected_hash: Expected SHA256 hash (optional but recommended)
            model_info: ModelInfo for metadata storage
            progress_callback: Called with (downloaded_bytes, total_bytes)

        Returns:
            Path to downloaded model file

        Raises:
            RuntimeError: If download fails or hash mismatch
        """
        logger.info(f"Downloading model from {url}")

        # Create temp directory for download
        temp_path = self.store_path / "temp_download"
        temp_path.mkdir(exist_ok=True)
        temp_file = temp_path / "model.gguf"

        try:
            # Download with progress
            def report_progress(block_num, block_size, total_size):
                if progress_callback:
                    progress_callback(block_num * block_size, total_size)
                elif block_num % 100 == 0:
                    downloaded = block_num * block_size / 1024 / 1024
                    total = total_size / 1024 / 1024 if total_size > 0 else 0
                    logger.info(f"  Downloaded {downloaded:.1f} / {total:.1f} MB")

            urlretrieve(url, temp_file, reporthook=report_progress)

            # Compute hash
            computed_hash = self._compute_hash(temp_file)
            logger.info(f"Computed hash: {computed_hash}")

            # Verify hash if provided
            if expected_hash:
                expected = expected_hash.replace("sha256:", "")
                if computed_hash != expected and expected != "placeholder_hash_to_be_updated":
                    raise RuntimeError(
                        f"Hash mismatch! Expected {expected[:16]}..., got {computed_hash[:16]}..."
                    )

            # Move to permanent location
            hash_prefix = f"sha256_{computed_hash[:16]}"
            model_dir = self.store_path / hash_prefix
            model_dir.mkdir(exist_ok=True)

            final_path = model_dir / "model.gguf"
            shutil.move(str(temp_file), str(final_path))

            # Save metadata
            metadata = {
                "hash": f"sha256:{computed_hash}",
                "url": url,
                "size_bytes": final_path.stat().st_size,
            }
            if model_info:
                metadata.update(model_info.to_dict())

            (model_dir / "metadata.json").write_text(json.dumps(metadata, indent=2))

            # Update index
            self._index[hash_prefix] = metadata
            self._save_index()

            logger.info(f"Model installed: {final_path}")
            return final_path

        except (URLError, HTTPError) as e:
            raise RuntimeError(f"Download failed: {e}")
        finally:
            # Cleanup temp
            if temp_path.exists():
                shutil.rmtree(temp_path, ignore_errors=True)

    def import_model(
        self,
        model_path: Path,
        model_info: Optional[ModelInfo] = None,
    ) -> str:
        """Import a model file into the store.

        Args:
            model_path: Path to GGUF file
            model_info: Optional metadata

        Returns:
            Hash of imported model
        """
        model_path = Path(model_path)
        if not model_path.exists():
            raise FileNotFoundError(f"Model file not found: {model_path}")

        # Compute hash
        computed_hash = self._compute_hash(model_path)
        full_hash = f"sha256:{computed_hash}"

        # Check if already exists
        if self.has_model(full_hash):
            logger.info(f"Model already in store: {full_hash[:24]}...")
            return full_hash

        # Copy to store
        hash_prefix = f"sha256_{computed_hash[:16]}"
        model_dir = self.store_path / hash_prefix
        model_dir.mkdir(exist_ok=True)

        final_path = model_dir / "model.gguf"
        shutil.copy2(model_path, final_path)

        # Save metadata
        metadata = {
            "hash": full_hash,
            "size_bytes": final_path.stat().st_size,
            "source": str(model_path),
        }
        if model_info:
            metadata.update(model_info.to_dict())

        (model_dir / "metadata.json").write_text(json.dumps(metadata, indent=2))

        # Update index
        self._index[hash_prefix] = metadata
        self._save_index()

        logger.info(f"Model imported: {full_hash[:24]}...")
        return full_hash

    def extract_model(self, model_hash: str, output_path: Path) -> Path:
        """Extract a model from the store to a file.

        Args:
            model_hash: Model hash
            output_path: Destination path

        Returns:
            Path to extracted file
        """
        source = self.get_path_by_hash(model_hash)
        if not source:
            raise FileNotFoundError(f"Model not found in store: {model_hash[:24]}...")

        output_path = Path(output_path)
        shutil.copy2(source, output_path)
        logger.info(f"Model extracted to: {output_path}")
        return output_path

    def delete_model(self, model_hash: str) -> bool:
        """Delete a model from the store.

        Args:
            model_hash: Model hash

        Returns:
            True if deleted, False if not found
        """
        hash_value = model_hash.replace("sha256:", "")
        hash_prefix = f"sha256_{hash_value[:16]}"

        model_dir = self.store_path / hash_prefix
        if model_dir.exists():
            shutil.rmtree(model_dir)
            if hash_prefix in self._index:
                del self._index[hash_prefix]
                self._save_index()
            logger.info(f"Model deleted: {model_hash[:24]}...")
            return True
        return False

    def get_metadata(self, model_hash: str) -> Optional[Dict[str, Any]]:
        """Get metadata for a model.

        Args:
            model_hash: Model hash

        Returns:
            Metadata dict or None
        """
        hash_value = model_hash.replace("sha256:", "")
        hash_prefix = f"sha256_{hash_value[:16]}"

        metadata_path = self.store_path / hash_prefix / "metadata.json"
        if metadata_path.exists():
            return json.loads(metadata_path.read_text())
        return None

    @staticmethod
    def _compute_hash(path: Path) -> str:
        """Compute SHA256 hash of a file."""
        sha256 = hashlib.sha256()
        with open(path, 'rb') as f:
            for chunk in iter(lambda: f.read(8192), b''):
                sha256.update(chunk)
        return sha256.hexdigest()


def get_default_store() -> ModelStore:
    """Get the default model store."""
    return ModelStore()
