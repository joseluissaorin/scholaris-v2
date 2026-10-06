#!/usr/bin/env python3
"""SPDF Validator CLI - Command-line interface for validating .spdf files.

Usage:
    python -m spdf.validator file.spdf
    python -m spdf.validator file.spdf --strict
    python -m spdf.validator file.spdf --verify-hash source.pdf
    python -m spdf.validator *.spdf --json
"""

import argparse
import json
import sys
from pathlib import Path
from typing import List

from .validator import SPDFValidator, ValidationResult, ValidationSeverity


def format_result_text(result: ValidationResult, path: Path, verbose: bool = False) -> str:
    """Format validation result as human-readable text."""
    lines = []

    status = "VALID" if result.valid else "INVALID"
    status_symbol = "[OK]" if result.valid else "[FAIL]"

    lines.append(f"{status_symbol} {path.name}: {status}")

    if result.errors:
        for error in result.errors:
            symbol = {
                ValidationSeverity.ERROR: "  [x]",
                ValidationSeverity.WARNING: "  [!]",
                ValidationSeverity.INFO: "  [i]",
            }[error.severity]
            lines.append(f"{symbol} {error.code}: {error.message}")
            if verbose and error.details:
                lines.append(f"      Details: {error.details}")

    if verbose and result.stats:
        lines.append(f"  Stats: {result.stats}")

    if verbose and result.metadata:
        lines.append(f"  Citation: {result.metadata.get('citation_key', 'unknown')}")
        lines.append(f"  Title: {result.metadata.get('title', 'unknown')[:50]}...")

    return "\n".join(lines)


def format_result_json(result: ValidationResult, path: Path) -> dict:
    """Format validation result as JSON-serializable dict."""
    return {
        "file": str(path),
        "valid": result.valid,
        "errors": [
            {
                "code": e.code,
                "message": e.message,
                "severity": e.severity.value,
                "details": e.details,
            }
            for e in result.errors
        ],
        "stats": result.stats,
        "metadata": {
            "citation_key": result.metadata.get("citation_key") if result.metadata else None,
            "title": result.metadata.get("title") if result.metadata else None,
            "year": result.metadata.get("year") if result.metadata else None,
        } if result.metadata else None,
    }


def main(argv: List[str] = None) -> int:
    """Main entry point for CLI."""
    parser = argparse.ArgumentParser(
        description="Validate SPDF files against the specification",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python -m spdf.validator file.spdf           # Basic validation
  python -m spdf.validator file.spdf --strict  # Treat warnings as errors
  python -m spdf.validator *.spdf              # Validate multiple files
  python -m spdf.validator file.spdf --json    # JSON output
  python -m spdf.validator file.spdf --verify-hash source.pdf
        """,
    )

    parser.add_argument(
        "files",
        nargs="+",
        type=Path,
        help="SPDF file(s) to validate",
    )

    parser.add_argument(
        "--strict",
        action="store_true",
        help="Treat warnings as errors",
    )

    parser.add_argument(
        "--json",
        action="store_true",
        dest="json_output",
        help="Output results as JSON",
    )

    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Show detailed information",
    )

    parser.add_argument(
        "--verify-hash",
        type=Path,
        metavar="PDF",
        help="Verify SPDF matches source PDF hash",
    )

    parser.add_argument(
        "--quiet", "-q",
        action="store_true",
        help="Only show errors, suppress valid file messages",
    )

    args = parser.parse_args(argv)

    validator = SPDFValidator(strict=args.strict)

    results = []
    all_valid = True

    for file_path in args.files:
        if not file_path.exists():
            result = ValidationResult(
                valid=False,
                errors=[{
                    "code": "FILE_NOT_FOUND",
                    "message": f"File not found: {file_path}",
                    "severity": ValidationSeverity.ERROR,
                }]
            )
        else:
            result = validator.validate(file_path)

        # Verify hash if requested
        if args.verify_hash and result.valid:
            if not args.verify_hash.exists():
                if not args.json_output:
                    print(f"[ERROR] Source PDF not found: {args.verify_hash}", file=sys.stderr)
                all_valid = False
            else:
                hash_match = validator.validate_hash(file_path, args.verify_hash)
                if not hash_match:
                    from .validator import ValidationError
                    result.errors.append(ValidationError(
                        code="HASH_MISMATCH",
                        message=f"SPDF hash does not match {args.verify_hash.name}",
                        severity=ValidationSeverity.ERROR
                    ))
                    result.valid = False

        if not result.valid:
            all_valid = False

        results.append((file_path, result))

    # Output results
    if args.json_output:
        output = {
            "results": [format_result_json(r, p) for p, r in results],
            "summary": {
                "total": len(results),
                "valid": sum(1 for _, r in results if r.valid),
                "invalid": sum(1 for _, r in results if not r.valid),
            }
        }
        print(json.dumps(output, indent=2))
    else:
        for file_path, result in results:
            if args.quiet and result.valid:
                continue
            print(format_result_text(result, file_path, verbose=args.verbose))
            if len(results) > 1:
                print()  # Blank line between files

        # Summary for multiple files
        if len(results) > 1 and not args.quiet:
            valid_count = sum(1 for _, r in results if r.valid)
            print(f"Summary: {valid_count}/{len(results)} files valid")

    return 0 if all_valid else 1


if __name__ == "__main__":
    sys.exit(main())
