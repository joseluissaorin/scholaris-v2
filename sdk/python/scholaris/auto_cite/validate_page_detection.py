"""Validation script for page offset detection.

This script tests the PageOffsetDetector on a corpus of PDFs to ensure
>85% accuracy before proceeding with full citation implementation.

Usage:
    python -m scholaris.auto_cite.validate_page_detection \
        --test-dir /path/to/test/pdfs \
        --bibtex-file /path/to/references.bib

The test directory should contain PDFs with known page offsets.
"""

import argparse
import logging
import json
from pathlib import Path
from typing import List, Dict, Any, Tuple, Optional
from dataclasses import dataclass, asdict

from .page_offset import PageOffsetDetector
from ..converters.bibtex_parser import parse_bibtex_file

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@dataclass
class ValidationResult:
    """Result of validating one PDF."""
    pdf_name: str
    citation_key: str
    expected_offset: int
    detected_offset: int
    confidence: float
    strategy_used: str
    is_correct: bool
    error_margin: int = 0

    @property
    def is_close(self) -> bool:
        """Check if detection is within acceptable error margin (±2 pages)."""
        return abs(self.expected_offset - self.detected_offset) <= 2


class PageDetectionValidator:
    """Validates page offset detection accuracy."""

    def __init__(
        self,
        detector: PageOffsetDetector,
        acceptable_error_margin: int = 2,
    ):
        """Initialize validator.

        Args:
            detector: PageOffsetDetector instance
            acceptable_error_margin: Acceptable error in pages (default: 2)
        """
        self.detector = detector
        self.acceptable_error_margin = acceptable_error_margin

    def validate_corpus(
        self,
        test_cases: List[Dict[str, Any]],
    ) -> Tuple[List[ValidationResult], Dict[str, Any]]:
        """Validate page detection on a corpus of test PDFs.

        Args:
            test_cases: List of test case dictionaries with:
                - pdf_path: Path to PDF
                - citation_key: BibTeX key
                - bib_entry: BibTeX entry dict
                - expected_offset: Ground truth offset

        Returns:
            Tuple of (results_list, statistics_dict)
        """
        logger.info(f"Validating page detection on {len(test_cases)} test cases...")

        results = []

        for i, test_case in enumerate(test_cases, 1):
            logger.info(f"\n[{i}/{len(test_cases)}] Testing: {test_case['citation_key']}")

            pdf_path = test_case['pdf_path']
            citation_key = test_case['citation_key']
            bib_entry = test_case['bib_entry']
            expected_offset = test_case['expected_offset']

            # Run detection
            detection_result = self.detector.detect_offset(pdf_path, bib_entry)

            # Create validation result
            is_correct = detection_result.offset == expected_offset
            error_margin = abs(detection_result.offset - expected_offset)

            result = ValidationResult(
                pdf_name=Path(pdf_path).name,
                citation_key=citation_key,
                expected_offset=expected_offset,
                detected_offset=detection_result.offset,
                confidence=detection_result.confidence,
                strategy_used=detection_result.strategy_used.value,
                is_correct=is_correct,
                error_margin=error_margin,
            )

            results.append(result)

            # Log result
            status = "✓" if is_correct else ("~" if result.is_close else "✗")
            logger.info(
                f"{status} Expected: {expected_offset}, "
                f"Detected: {detection_result.offset} "
                f"(confidence: {detection_result.confidence:.2f}, "
                f"strategy: {detection_result.strategy_used.value})"
            )

        # Calculate statistics
        stats = self._calculate_statistics(results)

        return results, stats

    def _calculate_statistics(
        self,
        results: List[ValidationResult],
    ) -> Dict[str, Any]:
        """Calculate validation statistics.

        Args:
            results: List of validation results

        Returns:
            Dictionary with statistics
        """
        total = len(results)
        if total == 0:
            return {}

        exact_correct = sum(1 for r in results if r.is_correct)
        close_correct = sum(1 for r in results if r.is_close)

        # Calculate by strategy
        strategy_stats = {}
        for result in results:
            strategy = result.strategy_used
            if strategy not in strategy_stats:
                strategy_stats[strategy] = {'total': 0, 'correct': 0}
            strategy_stats[strategy]['total'] += 1
            if result.is_correct:
                strategy_stats[strategy]['correct'] += 1

        # Calculate accuracy percentages
        for strategy, counts in strategy_stats.items():
            counts['accuracy'] = (counts['correct'] / counts['total'] * 100) if counts['total'] > 0 else 0

        # Average confidence
        avg_confidence = sum(r.confidence for r in results) / total

        # Average error margin
        avg_error = sum(r.error_margin for r in results) / total

        stats = {
            'total_cases': total,
            'exact_correct': exact_correct,
            'exact_accuracy': exact_correct / total * 100,
            'close_correct': close_correct,
            'close_accuracy': close_correct / total * 100,
            'avg_confidence': avg_confidence,
            'avg_error_margin': avg_error,
            'strategy_breakdown': strategy_stats,
        }

        return stats

    def print_report(
        self,
        results: List[ValidationResult],
        stats: Dict[str, Any],
    ):
        """Print validation report.

        Args:
            results: List of validation results
            stats: Statistics dictionary
        """
        print("\n" + "=" * 80)
        print("PAGE OFFSET DETECTION VALIDATION REPORT")
        print("=" * 80)

        print(f"\nTotal Test Cases: {stats['total_cases']}")
        print(f"\nExact Accuracy: {stats['exact_accuracy']:.1f}% ({stats['exact_correct']}/{stats['total_cases']})")
        print(f"Close Accuracy (±{self.acceptable_error_margin} pages): {stats['close_accuracy']:.1f}% ({stats['close_correct']}/{stats['total_cases']})")
        print(f"Average Confidence: {stats['avg_confidence']:.2f}")
        print(f"Average Error Margin: {stats['avg_error_margin']:.1f} pages")

        print("\n" + "-" * 80)
        print("STRATEGY BREAKDOWN")
        print("-" * 80)

        for strategy, counts in stats['strategy_breakdown'].items():
            print(f"\n{strategy.upper()}:")
            print(f"  Used: {counts['total']} times")
            print(f"  Correct: {counts['correct']}/{counts['total']}")
            print(f"  Accuracy: {counts['accuracy']:.1f}%")

        print("\n" + "-" * 80)
        print("FAILURES")
        print("-" * 80)

        failures = [r for r in results if not r.is_correct]
        if not failures:
            print("\n✓ No failures! All detections were exact.")
        else:
            for failure in failures:
                print(f"\n✗ {failure.citation_key} ({failure.pdf_name})")
                print(f"  Expected: {failure.expected_offset}")
                print(f"  Detected: {failure.detected_offset}")
                print(f"  Error: {failure.error_margin} pages")
                print(f"  Strategy: {failure.strategy_used}")
                print(f"  Confidence: {failure.confidence:.2f}")

        print("\n" + "=" * 80)

        # Pass/fail determination
        if stats['exact_accuracy'] >= 85.0:
            print("✓✓✓ VALIDATION PASSED - Accuracy meets 85% threshold!")
        elif stats['close_accuracy'] >= 85.0:
            print("~ VALIDATION MARGINAL - Close accuracy meets threshold but exact accuracy does not.")
        else:
            print("✗✗✗ VALIDATION FAILED - Accuracy below 85% threshold.")

        print("=" * 80 + "\n")

    def export_results(
        self,
        results: List[ValidationResult],
        stats: Dict[str, Any],
        output_path: str,
    ):
        """Export validation results to JSON.

        Args:
            results: List of validation results
            stats: Statistics dictionary
            output_path: Path to save JSON file
        """
        data = {
            'statistics': stats,
            'results': [asdict(r) for r in results],
        }

        with open(output_path, 'w') as f:
            json.dump(data, f, indent=2)

        logger.info(f"Results exported to {output_path}")


def load_test_cases_from_bibtex(
    pdf_dir: str,
    bibtex_file: str,
    ground_truth_file: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Load test cases from a directory of PDFs and BibTeX file.

    Args:
        pdf_dir: Directory containing test PDFs
        bibtex_file: Path to BibTeX file
        ground_truth_file: Optional JSON file with ground truth offsets

    Returns:
        List of test case dictionaries
    """
    pdf_dir = Path(pdf_dir)
    bib_entries = parse_bibtex_file(bibtex_file)

    # Load ground truth if available
    ground_truth = {}
    if ground_truth_file:
        with open(ground_truth_file) as f:
            ground_truth = json.load(f)

    test_cases = []

    for bib_entry in bib_entries:
        citation_key = bib_entry.get('ID', '')

        # Find matching PDF
        pdf_candidates = [
            pdf_dir / f"{citation_key}.pdf",
            pdf_dir / f"{citation_key.lower()}.pdf",
        ]

        pdf_path = None
        for candidate in pdf_candidates:
            if candidate.exists():
                pdf_path = str(candidate)
                break

        if not pdf_path:
            logger.warning(f"No PDF found for {citation_key}")
            continue

        # Get ground truth offset
        expected_offset = ground_truth.get(citation_key, {}).get('offset', 0)

        test_cases.append({
            'pdf_path': pdf_path,
            'citation_key': citation_key,
            'bib_entry': bib_entry,
            'expected_offset': expected_offset,
        })

    return test_cases


def main():
    """Main validation script."""
    parser = argparse.ArgumentParser(
        description="Validate page offset detection accuracy"
    )
    parser.add_argument(
        '--test-dir',
        required=True,
        help="Directory containing test PDFs"
    )
    parser.add_argument(
        '--bibtex-file',
        required=True,
        help="BibTeX file with references"
    )
    parser.add_argument(
        '--ground-truth',
        help="JSON file with ground truth offsets (citation_key -> offset)"
    )
    parser.add_argument(
        '--crossref-email',
        help="Email for Crossref API polite pool"
    )
    parser.add_argument(
        '--output',
        default='validation_results.json',
        help="Output file for results (JSON)"
    )

    args = parser.parse_args()

    # Load test cases
    logger.info("Loading test cases...")
    test_cases = load_test_cases_from_bibtex(
        args.test_dir,
        args.bibtex_file,
        args.ground_truth,
    )

    if not test_cases:
        logger.error("No test cases found!")
        return

    logger.info(f"Loaded {len(test_cases)} test cases")

    # Initialize detector
    detector = PageOffsetDetector(
        min_confidence=0.7,
        crossref_email=args.crossref_email,
    )

    # Run validation
    validator = PageDetectionValidator(detector)
    results, stats = validator.validate_corpus(test_cases)

    # Print report
    validator.print_report(results, stats)

    # Export results
    validator.export_results(results, stats, args.output)


if __name__ == '__main__':
    main()
