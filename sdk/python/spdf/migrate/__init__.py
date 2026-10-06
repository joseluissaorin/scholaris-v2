"""SPDF Migration Module - Re-embed documents with different models.

This module provides tools for migrating SPDF files to use different
embedding models, including local models for reproducibility.

Example:
    from spdf.migrate import SPDFMigrator
    from spdf.models import ModelStore

    store = ModelStore()
    model_path = store.get_model("nomic-embed-text-v2-moe-Q2_K")

    migrator = SPDFMigrator()
    migrator.migrate(
        input_path="old.spdf",
        output_path="new.spdf",
        model_path=model_path,
        embed_model=True,  # Include model in output for reproducibility
    )
"""

from .migrator import SPDFMigrator, MigrationResult

__all__ = ["SPDFMigrator", "MigrationResult"]
