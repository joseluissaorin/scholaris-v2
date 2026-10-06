#!/usr/bin/env python3
"""SPDF Migration CLI - Command-line interface for migrating .spdf files.

Usage:
    python -m spdf.migrate input.spdf output.spdf
    python -m spdf.migrate input.spdf output.spdf --embed-model
    python -m spdf.migrate input.spdf output.spdf --model nomic-embed-text-v2-moe-Q2_K
"""

import argparse
import json
import sys
from pathlib import Path
from typing import List

from .migrator import SPDFMigrator


def main(argv: List[str] = None) -> int:
    """Main entry point for CLI."""
    parser = argparse.ArgumentParser(
        description="Migrate SPDF files to use different embedding models",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Show info about an SPDF file's embeddings
  python -m spdf.migrate --info file.spdf

  # Migrate to local model (external reference)
  python -m spdf.migrate input.spdf output.spdf --model nomic-embed-text-v2-moe-Q2_K

  # Migrate with embedded model (fully reproducible, larger file)
  python -m spdf.migrate input.spdf output.spdf --model nomic-embed-text-v2-moe-Q2_K --embed-model

Notes:
  Requires llama-cpp-python for local inference:
    pip install llama-cpp-python
        """,
    )

    parser.add_argument(
        "input",
        type=Path,
        nargs="?",
        help="Input SPDF file",
    )

    parser.add_argument(
        "output",
        type=Path,
        nargs="?",
        help="Output SPDF file",
    )

    parser.add_argument(
        "--model", "-m",
        type=str,
        default="nomic-embed-text-v2-moe-Q2_K",
        help="Embedding model to use (default: nomic-embed-text-v2-moe-Q2_K)",
    )

    parser.add_argument(
        "--embed-model",
        action="store_true",
        help="Embed the model in the output file for full reproducibility",
    )

    parser.add_argument(
        "--info",
        action="store_true",
        help="Show embedding info about input file (no migration)",
    )

    parser.add_argument(
        "--json",
        action="store_true",
        dest="json_output",
        help="Output results as JSON",
    )

    parser.add_argument(
        "--quiet", "-q",
        action="store_true",
        help="Suppress progress output",
    )

    args = parser.parse_args(argv)

    # Info mode
    if args.info:
        if not args.input:
            print("Error: Input file required for --info", file=sys.stderr)
            return 1

        migrator = SPDFMigrator()
        try:
            info = migrator.info(args.input)
            if args.json_output:
                print(json.dumps(info, indent=2))
            else:
                print(f"File: {args.input}")
                print(f"  Citation: {info['citation_key']}")
                print(f"  Chunks: {info['chunks']}")
                print(f"  Embedding Model: {info['embedding_model']}")
                print(f"  Embedding Dim: {info['embedding_dim']}")
                print(f"  Has Model Checkpoint: {info['has_model_checkpoint']}")
                print(f"  Reproducible: {info['is_reproducible']}")
                if info.get('model_checkpoint'):
                    mc = info['model_checkpoint']
                    print(f"  Model Checkpoint:")
                    print(f"    Name: {mc['model_name']}")
                    print(f"    Version: {mc['model_version']}")
                    print(f"    Storage: {mc['storage_mode']}")
                if info.get('v2_embedding_models'):
                    print(f"  V2 Embedding Models: {', '.join(info['v2_embedding_models'])}")
            return 0
        except Exception as e:
            print(f"Error: {e}", file=sys.stderr)
            return 1

    # Migration mode
    if not args.input or not args.output:
        parser.print_help()
        print("\nError: Both input and output files required for migration", file=sys.stderr)
        return 1

    # Import model components
    try:
        from ..models import ModelStore, LocalEmbedder
    except ImportError as e:
        print(f"Error: Required dependencies not available: {e}", file=sys.stderr)
        print("Install with: pip install llama-cpp-python", file=sys.stderr)
        return 1

    # Get model
    if not args.quiet:
        print(f"Loading model: {args.model}")

    try:
        store = ModelStore()
        model_path = store.get_model(args.model)
    except Exception as e:
        print(f"Error loading model: {e}", file=sys.stderr)
        return 1

    # Create embedder
    embedder = LocalEmbedder(model_path, verbose=False)

    # Create migrator and run
    migrator = SPDFMigrator(embedder)

    if not args.quiet:
        print(f"Migrating: {args.input} -> {args.output}")

    result = migrator.migrate(
        input_path=args.input,
        output_path=args.output,
        model_path=model_path,
        model_name=args.model.split("-Q")[0] if "-Q" in args.model else args.model,
        embed_model=args.embed_model,
        storage_mode="embedded" if args.embed_model else "external",
        show_progress=not args.quiet,
    )

    if args.json_output:
        output = {
            "success": result.success,
            "input": str(result.input_path),
            "output": str(result.output_path) if result.output_path else None,
            "chunks_migrated": result.chunks_migrated,
            "old_model": result.old_model,
            "new_model": result.new_model,
            "embed_model": result.embed_model,
            "duration_seconds": result.duration_seconds,
            "error": result.error,
        }
        print(json.dumps(output, indent=2))
    else:
        if result.success:
            print(f"\n[OK] Migration complete")
            print(f"  Chunks migrated: {result.chunks_migrated}")
            print(f"  Old model: {result.old_model}")
            print(f"  New model: {result.new_model}")
            print(f"  Model embedded: {result.embed_model}")
            print(f"  Duration: {result.duration_seconds:.1f}s")
            print(f"  Output: {result.output_path}")
        else:
            print(f"\n[FAIL] Migration failed: {result.error}", file=sys.stderr)

    # Cleanup
    embedder.unload()

    return 0 if result.success else 1


if __name__ == "__main__":
    sys.exit(main())
