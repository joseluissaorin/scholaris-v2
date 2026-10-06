#!/usr/bin/env python3
"""SPDF Model Management CLI - Download, list, and manage embedding models.

Usage:
    python -m spdf.models list              # List available models
    python -m spdf.models download MODEL    # Download a model
    python -m spdf.models info MODEL        # Show model info
    python -m spdf.models path MODEL        # Get path to model
"""

import argparse
import json
import sys
from pathlib import Path
from typing import List

from .store import ModelStore, KNOWN_MODELS, DEFAULT_MODEL


def cmd_list(args, store: ModelStore) -> int:
    """List available and installed models."""
    if args.json_output:
        models = []
        for key, info in KNOWN_MODELS.items():
            installed = store.has_model(info.full_hash)
            models.append({
                "key": key,
                "name": info.name,
                "quantization": info.quantization,
                "size_mb": round(info.size_mb, 1),
                "installed": installed,
                "default": key == DEFAULT_MODEL,
            })
        print(json.dumps({"models": models}, indent=2))
    else:
        print("Available Embedding Models:")
        print("-" * 60)
        for key, info in KNOWN_MODELS.items():
            installed = store.has_model(info.full_hash)
            status = "[installed]" if installed else ""
            default = "(default)" if key == DEFAULT_MODEL else ""
            size = f"{info.size_mb:.0f}MB"
            print(f"  {key:<40} {size:>8} {status} {default}")
        print()
        print(f"Store location: {store.store_path}")
    return 0


def cmd_download(args, store: ModelStore) -> int:
    """Download a model."""
    model_key = args.model

    if model_key not in KNOWN_MODELS:
        print(f"Error: Unknown model '{model_key}'", file=sys.stderr)
        print(f"Available: {', '.join(KNOWN_MODELS.keys())}", file=sys.stderr)
        return 1

    info = KNOWN_MODELS[model_key]

    if not args.force and store.has_model(info.full_hash):
        path = store.get_path_by_hash(info.full_hash)
        if args.json_output:
            print(json.dumps({"status": "already_installed", "path": str(path)}))
        else:
            print(f"Model already installed: {path}")
        return 0

    print(f"Downloading {model_key} ({info.size_mb:.0f}MB)...")

    try:
        path = store.get_model(model_key, force_download=args.force)
        if args.json_output:
            print(json.dumps({"status": "downloaded", "path": str(path)}))
        else:
            print(f"Downloaded to: {path}")
        return 0
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1


def cmd_info(args, store: ModelStore) -> int:
    """Show info about a model."""
    model_key = args.model

    if model_key not in KNOWN_MODELS:
        print(f"Error: Unknown model '{model_key}'", file=sys.stderr)
        return 1

    info = KNOWN_MODELS[model_key]
    installed = store.has_model(info.full_hash)
    path = store.get_path_by_hash(info.full_hash) if installed else None

    if args.json_output:
        data = info.to_dict()
        data["installed"] = installed
        data["path"] = str(path) if path else None
        print(json.dumps(data, indent=2))
    else:
        print(f"Model: {info.name}")
        print(f"  Version: {info.version}")
        print(f"  Quantization: {info.quantization}")
        print(f"  Format: {info.format}")
        print(f"  Embedding Dim: {info.embedding_dim}")
        print(f"  Max Tokens: {info.max_tokens}")
        print(f"  Size: {info.size_mb:.0f}MB")
        print(f"  License: {info.license}")
        print(f"  Installed: {installed}")
        if path:
            print(f"  Path: {path}")
        print(f"  URL: {info.url}")
    return 0


def cmd_path(args, store: ModelStore) -> int:
    """Get path to a model."""
    model_key = args.model

    if model_key not in KNOWN_MODELS:
        print(f"Error: Unknown model '{model_key}'", file=sys.stderr)
        return 1

    info = KNOWN_MODELS[model_key]

    if not store.has_model(info.full_hash):
        print(f"Error: Model not installed. Run: python -m spdf.models download {model_key}", file=sys.stderr)
        return 1

    path = store.get_path_by_hash(info.full_hash)
    print(str(path))
    return 0


def cmd_delete(args, store: ModelStore) -> int:
    """Delete a model from the store."""
    model_key = args.model

    if model_key not in KNOWN_MODELS:
        print(f"Error: Unknown model '{model_key}'", file=sys.stderr)
        return 1

    info = KNOWN_MODELS[model_key]

    if not store.has_model(info.full_hash):
        print(f"Model not installed: {model_key}")
        return 0

    if not args.force:
        response = input(f"Delete {model_key}? [y/N] ")
        if response.lower() != 'y':
            print("Cancelled")
            return 0

    if store.delete_model(info.full_hash):
        print(f"Deleted: {model_key}")
    else:
        print(f"Failed to delete: {model_key}", file=sys.stderr)
        return 1

    return 0


def cmd_extract(args, store: ModelStore) -> int:
    """Extract a model from an SPDF file."""
    from ..reference.reader import SPDFReader

    input_path = Path(args.input)
    output_path = Path(args.output) if args.output else None

    if not input_path.exists():
        print(f"Error: File not found: {input_path}", file=sys.stderr)
        return 1

    reader = SPDFReader()
    data = reader.read(input_path)

    if not data.has_model_checkpoint:
        print(f"Error: No model checkpoint in {input_path}", file=sys.stderr)
        return 1

    if not data.model_checkpoint.is_embedded:
        print(f"Error: Model is not embedded (storage_mode: {data.model_checkpoint.storage_mode})", file=sys.stderr)
        return 1

    if output_path is None:
        output_path = Path(f"{data.model_checkpoint.model_name}.gguf")

    extracted = data.extract_model_checkpoint(output_path)
    if extracted:
        print(f"Extracted to: {extracted}")

        # Optionally import into store
        if args.import_to_store:
            model_hash = store.import_model(extracted)
            print(f"Imported to store: {model_hash[:24]}...")

        return 0
    else:
        print("Error: Failed to extract model", file=sys.stderr)
        return 1


def main(argv: List[str] = None) -> int:
    """Main entry point for CLI."""
    parser = argparse.ArgumentParser(
        description="Manage SPDF embedding models",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Commands:
  list              List available and installed models
  download MODEL    Download a model to the local store
  info MODEL        Show detailed model information
  path MODEL        Get the filesystem path to an installed model
  delete MODEL      Delete a model from the store
  extract FILE      Extract embedded model from an SPDF file

Examples:
  python -m spdf.models list
  python -m spdf.models download nomic-embed-text-v2-moe-Q2_K
  python -m spdf.models path nomic-embed-text-v2-moe-Q2_K
  python -m spdf.models extract document.spdf --output model.gguf
        """,
    )

    parser.add_argument(
        "--json",
        action="store_true",
        dest="json_output",
        help="Output results as JSON",
    )

    subparsers = parser.add_subparsers(dest="command", help="Command to run")

    # list command
    list_parser = subparsers.add_parser("list", help="List available models")

    # download command
    download_parser = subparsers.add_parser("download", help="Download a model")
    download_parser.add_argument("model", help="Model key to download")
    download_parser.add_argument("--force", "-f", action="store_true", help="Re-download even if exists")

    # info command
    info_parser = subparsers.add_parser("info", help="Show model info")
    info_parser.add_argument("model", help="Model key")

    # path command
    path_parser = subparsers.add_parser("path", help="Get model path")
    path_parser.add_argument("model", help="Model key")

    # delete command
    delete_parser = subparsers.add_parser("delete", help="Delete a model")
    delete_parser.add_argument("model", help="Model key to delete")
    delete_parser.add_argument("--force", "-f", action="store_true", help="Don't ask for confirmation")

    # extract command
    extract_parser = subparsers.add_parser("extract", help="Extract model from SPDF")
    extract_parser.add_argument("input", type=Path, help="SPDF file with embedded model")
    extract_parser.add_argument("--output", "-o", type=Path, help="Output path for model file")
    extract_parser.add_argument("--import", dest="import_to_store", action="store_true",
                                help="Import extracted model to the model store")

    args = parser.parse_args(argv)

    if not args.command:
        parser.print_help()
        return 1

    store = ModelStore()

    commands = {
        "list": cmd_list,
        "download": cmd_download,
        "info": cmd_info,
        "path": cmd_path,
        "delete": cmd_delete,
        "extract": cmd_extract,
    }

    return commands[args.command](args, store)


if __name__ == "__main__":
    sys.exit(main())
