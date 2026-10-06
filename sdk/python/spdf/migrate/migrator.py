"""SPDF Migrator - Re-embed documents with different embedding models.

This module provides functionality to migrate SPDF files from one embedding
model to another, preserving all other content.

Key use cases:
1. Migration from deprecated API models to local models
2. Adding embedded model checkpoints for reproducibility
3. Updating embeddings with newer/better models
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Dict, Any, Union

import numpy as np

from ..reference.reader import SPDFReader, SPDFData
from ..reference.writer import SPDFWriter

logger = logging.getLogger(__name__)


@dataclass
class MigrationResult:
    """Result of a migration operation."""
    success: bool
    input_path: Path
    output_path: Optional[Path]
    chunks_migrated: int = 0
    old_model: str = ""
    new_model: str = ""
    embed_model: bool = False
    storage_mode: str = ""
    error: Optional[str] = None
    duration_seconds: float = 0.0


class SPDFMigrator:
    """Migrate SPDF files to use different embedding models.

    Example:
        from spdf.migrate import SPDFMigrator
        from spdf.models import LocalEmbedder, ModelStore

        store = ModelStore()
        model_path = store.get_model("nomic-embed-text-v2-moe-Q2_K")
        embedder = LocalEmbedder(model_path)

        migrator = SPDFMigrator(embedder)
        result = migrator.migrate(
            input_path="old.spdf",
            output_path="new.spdf",
            embed_model=True,
        )

        if result.success:
            print(f"Migrated {result.chunks_migrated} chunks")
    """

    def __init__(self, embedder=None):
        """Initialize migrator.

        Args:
            embedder: Embedder instance (LocalEmbedder or compatible).
                     Must have an `embed(texts, is_query=False)` method.
        """
        self.embedder = embedder
        self._reader = SPDFReader()

    def migrate(
        self,
        input_path: Union[str, Path],
        output_path: Union[str, Path],
        model_path: Optional[Union[str, Path]] = None,
        model_name: str = "nomic-embed-text-v2-moe",
        model_version: str = "v2.0",
        embed_model: bool = False,
        storage_mode: str = "external",
        source_url: Optional[str] = None,
        show_progress: bool = True,
        batch_size: int = 32,
    ) -> MigrationResult:
        """Migrate an SPDF file to use a different embedding model.

        Args:
            input_path: Path to input SPDF file
            output_path: Path to output SPDF file
            model_path: Path to model file (for embedded/external mode)
            model_name: Name of the embedding model
            model_version: Version of the embedding model
            embed_model: If True, embed the model in the output file
            storage_mode: "embedded", "external", or "api"
            source_url: URL for model download
            show_progress: Show progress during embedding
            batch_size: Number of chunks to embed at once

        Returns:
            MigrationResult with details about the operation
        """
        import time
        start_time = time.time()

        input_path = Path(input_path)
        output_path = Path(output_path)

        if self.embedder is None:
            return MigrationResult(
                success=False,
                input_path=input_path,
                output_path=None,
                error="No embedder configured. Pass an embedder to SPDFMigrator().",
            )

        try:
            # Read input file
            logger.info(f"Reading {input_path}")
            data = self._reader.read(input_path)

            old_model = data.metadata.get('embedding_model', 'unknown')

            # Extract chunk texts
            texts = [chunk['text'] for chunk in data.chunks]
            logger.info(f"Migrating {len(texts)} chunks from '{old_model}' to '{model_name}'")

            # Generate new embeddings
            if show_progress:
                embeddings = self.embedder.embed(texts, is_query=False, show_progress=True)
            else:
                embeddings = self.embedder.embed(texts, is_query=False)

            # Create new SPDF with updated embeddings
            writer = SPDFWriter()

            # Copy metadata (update embedding model info)
            writer.set_metadata(
                citation_key=data.citation_key,
                authors=data.authors,
                year=data.year,
                title=data.title,
                source_pdf_hash=data.metadata.get('source_pdf_hash'),
                source_pdf_filename=data.metadata.get('source_pdf_filename'),
                ocr_model=data.metadata.get('ocr_model', 'unknown'),
                embedding_model=model_name,
                embedding_dim=self.embedder.embedding_dim,
            )

            # Copy pages
            for page in data.pages:
                writer.add_page(
                    pdf_page=page['pdf_page'],
                    book_page=page['book_page'],
                    text=page['text'],
                    confidence=page['confidence'],
                    is_landscape_half=bool(page.get('is_landscape_half', 0)),
                )

            # Copy chunks
            for chunk in data.chunks:
                writer.add_chunk(
                    page_id=chunk['page_id'],
                    chunk_index=chunk['chunk_index'],
                    text=chunk['text'],
                    book_page=chunk['book_page'],
                    pdf_page=chunk['pdf_page'],
                )

            # Add new embeddings
            for emb in embeddings:
                writer.add_embedding(emb)

            # Copy previews
            for preview in data.previews:
                writer.add_preview(
                    pdf_page=preview['pdf_page'],
                    thumbnail=preview['thumbnail'],
                    width=preview['width'],
                    height=preview['height'],
                )

            # Add model checkpoint if requested
            if embed_model or storage_mode in ("embedded", "external"):
                if model_path is None:
                    return MigrationResult(
                        success=False,
                        input_path=input_path,
                        output_path=None,
                        error="model_path required for embed_model=True or storage_mode in (embedded, external)",
                    )

                actual_storage = "embedded" if embed_model else storage_mode
                writer.embed_model_checkpoint(
                    model_path=model_path,
                    model_name=model_name,
                    model_version=model_version,
                    storage_mode=actual_storage,
                    embedding_dim=self.embedder.embedding_dim,
                    max_tokens=getattr(self.embedder, 'max_tokens', 8192),
                    prefix_query=getattr(self.embedder, 'prefix_query', "search_query: "),
                    prefix_document=getattr(self.embedder, 'prefix_document', "search_document: "),
                    normalize=getattr(self.embedder, 'normalize', True),
                    source_url=source_url,
                )

            # Also add to embeddings_v2 for multi-model support
            model_id = f"local:{model_name}"
            for i, emb in enumerate(embeddings):
                writer.add_embedding_v2(
                    chunk_id=i,
                    model_id=model_id,
                    vector=emb,
                )

            # Save output
            logger.info(f"Writing {output_path}")
            writer.save(output_path)

            duration = time.time() - start_time

            return MigrationResult(
                success=True,
                input_path=input_path,
                output_path=output_path,
                chunks_migrated=len(texts),
                old_model=old_model,
                new_model=model_name,
                embed_model=embed_model or storage_mode == "embedded",
                storage_mode=storage_mode if not embed_model else "embedded",
                duration_seconds=duration,
            )

        except Exception as e:
            logger.error(f"Migration failed: {e}")
            return MigrationResult(
                success=False,
                input_path=input_path,
                output_path=None,
                error=str(e),
                duration_seconds=time.time() - start_time,
            )

    def info(self, path: Union[str, Path]) -> Dict[str, Any]:
        """Get migration-relevant info about an SPDF file.

        Args:
            path: Path to SPDF file

        Returns:
            Dictionary with embedding and model information
        """
        info = self._reader.info(path)

        # Add migration-specific info
        path = Path(path)
        data = self._reader.read(path)

        info["embedding_model"] = data.metadata.get('embedding_model', 'unknown')
        info["has_model_checkpoint"] = data.has_model_checkpoint
        info["is_reproducible"] = data.is_reproducible
        info["embedding_source"] = data.metadata.get('embedding_source', 'unknown')

        if data.model_checkpoint:
            info["model_checkpoint"] = {
                "model_name": data.model_checkpoint.model_name,
                "model_version": data.model_checkpoint.model_version,
                "storage_mode": data.model_checkpoint.storage_mode,
                "quantization": data.model_checkpoint.quantization,
            }

        info["v2_embedding_models"] = data.list_embedding_models()

        return info
