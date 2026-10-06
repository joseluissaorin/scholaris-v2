"""Local Embedder - Generate embeddings using local GGUF models.

This module provides local embedding generation using llama-cpp-python,
which runs GGUF models without requiring external APIs.

Example:
    from spdf.models import LocalEmbedder, ModelStore

    store = ModelStore()
    model_path = store.get_model("nomic-embed-text-v2-moe-Q2_K")

    embedder = LocalEmbedder(model_path)
    embeddings = embedder.embed(["Hello world", "Another text"])
"""

import logging
from pathlib import Path
from typing import List, Optional, Union

import numpy as np

logger = logging.getLogger(__name__)


class LocalEmbedder:
    """Generate embeddings using a local GGUF model.

    Uses llama-cpp-python for inference. Install with:
        pip install llama-cpp-python

    For GPU acceleration (optional):
        CMAKE_ARGS="-DLLAMA_CUBLAS=on" pip install llama-cpp-python

    Example:
        embedder = LocalEmbedder("model.gguf")
        vectors = embedder.embed(["text 1", "text 2"])
        # vectors: List[np.ndarray], each of shape (768,)
    """

    def __init__(
        self,
        model_path: Union[str, Path],
        embedding_dim: int = 768,
        max_tokens: int = 8192,
        prefix_query: str = "search_query: ",
        prefix_document: str = "search_document: ",
        normalize: bool = True,
        n_ctx: int = 8192,
        n_batch: int = 512,
        n_threads: Optional[int] = None,
        verbose: bool = False,
    ):
        """Initialize embedder with a GGUF model.

        Args:
            model_path: Path to GGUF model file
            embedding_dim: Expected embedding dimensions
            max_tokens: Maximum tokens per text
            prefix_query: Prefix for query texts (asymmetric models)
            prefix_document: Prefix for document texts
            normalize: L2 normalize output vectors
            n_ctx: Context size for model
            n_batch: Batch size for processing
            n_threads: Number of CPU threads (None = auto)
            verbose: Enable llama.cpp logging
        """
        self.model_path = Path(model_path)
        self.embedding_dim = embedding_dim
        self.max_tokens = max_tokens
        self.prefix_query = prefix_query
        self.prefix_document = prefix_document
        self.normalize = normalize
        self.n_ctx = n_ctx
        self.n_batch = n_batch
        self.n_threads = n_threads
        self.verbose = verbose

        self._model = None
        self._loaded = False

    def _ensure_loaded(self) -> None:
        """Lazy load the model on first use."""
        if self._loaded:
            return

        try:
            from llama_cpp import Llama
        except ImportError:
            raise ImportError(
                "llama-cpp-python is required for local embeddings.\n"
                "Install with: pip install llama-cpp-python\n"
                "For GPU: CMAKE_ARGS=\"-DLLAMA_CUBLAS=on\" pip install llama-cpp-python"
            )

        if not self.model_path.exists():
            raise FileNotFoundError(f"Model not found: {self.model_path}")

        logger.info(f"Loading model: {self.model_path.name}")

        self._model = Llama(
            model_path=str(self.model_path),
            embedding=True,
            n_ctx=self.n_ctx,
            n_batch=self.n_batch,
            n_threads=self.n_threads,
            verbose=self.verbose,
        )
        self._loaded = True
        logger.info("Model loaded successfully")

    def embed(
        self,
        texts: List[str],
        is_query: bool = False,
        show_progress: bool = False,
    ) -> List[np.ndarray]:
        """Generate embeddings for texts.

        Args:
            texts: List of texts to embed
            is_query: If True, use query prefix (for asymmetric models)
            show_progress: Show progress bar (requires tqdm)

        Returns:
            List of numpy arrays, each of shape (embedding_dim,)
        """
        self._ensure_loaded()

        prefix = self.prefix_query if is_query else self.prefix_document
        embeddings = []

        iterator = texts
        if show_progress:
            try:
                from tqdm import tqdm
                iterator = tqdm(texts, desc="Embedding")
            except ImportError:
                pass

        for text in iterator:
            # Add prefix for asymmetric models like nomic
            prefixed_text = f"{prefix}{text}"

            # Truncate if too long (simple char-based truncation)
            # In production, should use proper tokenization
            if len(prefixed_text) > self.max_tokens * 4:  # ~4 chars per token
                prefixed_text = prefixed_text[:self.max_tokens * 4]

            # Generate embedding
            try:
                emb = self._model.embed(prefixed_text)
                emb = np.array(emb, dtype=np.float32)

                # Normalize if requested
                if self.normalize:
                    norm = np.linalg.norm(emb)
                    if norm > 0:
                        emb = emb / norm

                embeddings.append(emb)

            except Exception as e:
                logger.warning(f"Failed to embed text: {e}")
                # Return zero vector on failure
                embeddings.append(np.zeros(self.embedding_dim, dtype=np.float32))

        return embeddings

    def embed_single(self, text: str, is_query: bool = False) -> np.ndarray:
        """Generate embedding for a single text.

        Args:
            text: Text to embed
            is_query: If True, use query prefix

        Returns:
            Numpy array of shape (embedding_dim,)
        """
        return self.embed([text], is_query=is_query)[0]

    def embed_batch(
        self,
        texts: List[str],
        batch_size: int = 32,
        is_query: bool = False,
        show_progress: bool = True,
    ) -> List[np.ndarray]:
        """Generate embeddings for texts in batches.

        Args:
            texts: List of texts to embed
            batch_size: Number of texts per batch
            is_query: If True, use query prefix
            show_progress: Show progress bar

        Returns:
            List of numpy arrays
        """
        all_embeddings = []

        for i in range(0, len(texts), batch_size):
            batch = texts[i:i + batch_size]
            batch_embeddings = self.embed(batch, is_query=is_query, show_progress=False)
            all_embeddings.extend(batch_embeddings)

            if show_progress:
                logger.info(f"Embedded {min(i + batch_size, len(texts))}/{len(texts)}")

        return all_embeddings

    def unload(self) -> None:
        """Unload the model to free memory."""
        if self._model is not None:
            del self._model
            self._model = None
            self._loaded = False
            logger.info("Model unloaded")

    @property
    def is_loaded(self) -> bool:
        """Check if model is loaded."""
        return self._loaded

    def __enter__(self) -> "LocalEmbedder":
        """Context manager entry."""
        self._ensure_loaded()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        """Context manager exit - unload model."""
        self.unload()

    def __repr__(self) -> str:
        status = "loaded" if self._loaded else "not loaded"
        return f"LocalEmbedder({self.model_path.name}, {status})"


def check_llama_cpp_available() -> bool:
    """Check if llama-cpp-python is installed."""
    try:
        import llama_cpp
        return True
    except ImportError:
        return False


def get_recommended_model_config() -> dict:
    """Get recommended model configuration for nomic-embed-text-v2-moe."""
    return {
        "name": "nomic-embed-text-v2-moe",
        "quantization": "Q2_K",
        "embedding_dim": 768,
        "max_tokens": 8192,
        "prefix_query": "search_query: ",
        "prefix_document": "search_document: ",
        "normalize": True,
    }
