"""Citation export utilities for detailed analysis and verification.

Exports citation results to CSV with full metadata including:
- Source sentence/paragraph being cited
- Retrieved evidence chunks with similarity scores
- Generated citations with confidence values
- Page number verification data
"""

import csv
import json
from dataclasses import dataclass, field, asdict
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional, Union

from .models import RetrievedChunk
from .citation_engine import GroundedCitation


@dataclass
class CitationExportRow:
    """Single row in citation export.

    Supports page ranges (e.g., pp. 3-11) via book_page_end/pdf_page_end fields.
    """
    row_type: str  # "retrieved_chunk" or "citation"
    sentence_id: int  # Which sentence this relates to
    sentence_text: str  # The actual sentence being cited
    rank: int  # Rank within type (1st chunk, 2nd citation, etc.)
    citation_key: str
    book_page: int
    pdf_page: int
    confidence: float  # similarity for chunks, confidence for citations
    evidence_text: str
    citation_string: str = ""
    claim_text: str = ""
    book_page_end: Optional[int] = None  # End page for page ranges
    pdf_page_end: Optional[int] = None  # End PDF page for page ranges

    @property
    def is_page_range(self) -> bool:
        """Return True if this row spans multiple pages."""
        return self.book_page_end is not None and self.book_page_end != self.book_page

    @property
    def page_display(self) -> str:
        """Format page(s) as 'p. X' or 'pp. X-Y'."""
        if self.is_page_range:
            return f"pp. {self.book_page}-{self.book_page_end}"
        return f"p. {self.book_page}"


@dataclass
class CitationExportResult:
    """Complete export result with all citation data."""
    timestamp: str
    document_excerpt: str
    total_sentences: int
    total_citations: int
    total_chunks_retrieved: int
    rows: List[CitationExportRow] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_csv(self, output_path: Union[str, Path]) -> str:
        """Export to CSV file.

        Args:
            output_path: Path to save CSV file

        Returns:
            Path to saved file
        """
        output_path = Path(output_path)

        fieldnames = [
            "row_type",
            "sentence_id",
            "sentence_text",
            "rank",
            "citation_key",
            "book_page",
            "book_page_end",
            "pdf_page",
            "pdf_page_end",
            "confidence",
            "evidence_text",
            "citation_string",
            "claim_text",
        ]

        with open(output_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()

            for row in self.rows:
                writer.writerow(asdict(row))

        return str(output_path)

    def to_json(self, output_path: Union[str, Path]) -> str:
        """Export to JSON file.

        Args:
            output_path: Path to save JSON file

        Returns:
            Path to saved file
        """
        output_path = Path(output_path)

        data = {
            "timestamp": self.timestamp,
            "document_excerpt": self.document_excerpt,
            "total_sentences": self.total_sentences,
            "total_citations": self.total_citations,
            "total_chunks_retrieved": self.total_chunks_retrieved,
            "metadata": self.metadata,
            "rows": [asdict(row) for row in self.rows],
        }

        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

        return str(output_path)

    def get_summary(self) -> str:
        """Get human-readable summary."""
        lines = [
            f"Citation Export Summary",
            f"=" * 50,
            f"Timestamp: {self.timestamp}",
            f"Total sentences analyzed: {self.total_sentences}",
            f"Total citations generated: {self.total_citations}",
            f"Total chunks retrieved: {self.total_chunks_retrieved}",
            f"",
            f"Citations by sentence:",
        ]

        # Group by sentence
        sentences = {}
        for row in self.rows:
            if row.sentence_id not in sentences:
                sentences[row.sentence_id] = {
                    "text": row.sentence_text[:80] + "..." if len(row.sentence_text) > 80 else row.sentence_text,
                    "citations": [],
                    "chunks": [],
                }

            if row.row_type == "citation":
                sentences[row.sentence_id]["citations"].append(row)
            else:
                sentences[row.sentence_id]["chunks"].append(row)

        for sent_id, data in sentences.items():
            lines.append(f"\n  Sentence {sent_id}: \"{data['text']}\"")
            lines.append(f"    Retrieved chunks: {len(data['chunks'])}")
            lines.append(f"    Citations generated: {len(data['citations'])}")
            for cit in data["citations"]:
                lines.append(f"      - {cit.citation_string} (conf: {cit.confidence:.2f})")

        return "\n".join(lines)


class CitationExporter:
    """Exports citation results with full traceability."""

    def __init__(self):
        """Initialize exporter."""
        self.rows: List[CitationExportRow] = []
        self.sentence_map: Dict[int, str] = {}
        self.chunk_map: Dict[int, List[RetrievedChunk]] = {}

    def add_sentence(self, sentence_id: int, sentence_text: str):
        """Register a sentence being analyzed.

        Args:
            sentence_id: Unique ID for this sentence
            sentence_text: The sentence text
        """
        self.sentence_map[sentence_id] = sentence_text

    def add_retrieved_chunks(
        self,
        sentence_id: int,
        chunks: List[RetrievedChunk],
        max_chunks: int = 10,
    ):
        """Add retrieved chunks for a sentence.

        Args:
            sentence_id: Which sentence these chunks are for
            chunks: List of retrieved chunks
            max_chunks: Maximum chunks to include
        """
        sentence_text = self.sentence_map.get(sentence_id, "")
        self.chunk_map[sentence_id] = chunks[:max_chunks]

        for rank, chunk in enumerate(chunks[:max_chunks], 1):
            self.rows.append(CitationExportRow(
                row_type="retrieved_chunk",
                sentence_id=sentence_id,
                sentence_text=sentence_text[:200],
                rank=rank,
                citation_key=chunk.citation_key,
                book_page=chunk.book_page,
                pdf_page=chunk.pdf_page,
                confidence=chunk.similarity,
                evidence_text=chunk.text[:500].replace('\n', ' '),
                citation_string="",
                claim_text="",
            ))

    def add_citation(
        self,
        sentence_id: int,
        citation: GroundedCitation,
        rank: int = 1,
    ):
        """Add a generated citation.

        Args:
            sentence_id: Which sentence this citation is for
            citation: The generated citation
            rank: Rank of this citation (1st, 2nd, etc.)
        """
        sentence_text = self.sentence_map.get(sentence_id, "")

        self.rows.append(CitationExportRow(
            row_type="citation",
            sentence_id=sentence_id,
            sentence_text=sentence_text[:200],
            rank=rank,
            citation_key=citation.citation_key,
            book_page=citation.page_number,
            book_page_end=getattr(citation, 'page_end', None),  # Page range end
            pdf_page=citation.pdf_page_number,
            pdf_page_end=getattr(citation, 'pdf_page_end', None),  # PDF page range end
            confidence=citation.confidence,
            evidence_text=citation.evidence_text[:500].replace('\n', ' ') if citation.evidence_text else "",
            citation_string=citation.citation_string,
            claim_text=citation.claim_text[:200] if citation.claim_text else "",
        ))

    def add_citations_batch(
        self,
        sentence_id: int,
        citations: List[GroundedCitation],
    ):
        """Add multiple citations for a sentence.

        Args:
            sentence_id: Which sentence these citations are for
            citations: List of generated citations
        """
        for rank, citation in enumerate(citations, 1):
            self.add_citation(sentence_id, citation, rank)

    def export(
        self,
        document_text: str = "",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> CitationExportResult:
        """Create export result.

        Args:
            document_text: Original document text
            metadata: Additional metadata to include

        Returns:
            CitationExportResult ready for CSV/JSON export
        """
        # Count totals
        citation_rows = [r for r in self.rows if r.row_type == "citation"]
        chunk_rows = [r for r in self.rows if r.row_type == "retrieved_chunk"]

        return CitationExportResult(
            timestamp=datetime.now().isoformat(),
            document_excerpt=document_text[:500] if document_text else "",
            total_sentences=len(self.sentence_map),
            total_citations=len(citation_rows),
            total_chunks_retrieved=len(chunk_rows),
            rows=self.rows,
            metadata=metadata or {},
        )

    def clear(self):
        """Clear all data for reuse."""
        self.rows = []
        self.sentence_map = {}
        self.chunk_map = {}


def export_citations_to_csv(
    citations: List[GroundedCitation],
    sentences: List[str],
    chunks_per_sentence: Optional[Dict[int, List[RetrievedChunk]]] = None,
    output_path: Union[str, Path] = "citations.csv",
    metadata: Optional[Dict[str, Any]] = None,
) -> CitationExportResult:
    """Convenience function to export citations to CSV.

    Args:
        citations: List of generated citations
        sentences: List of sentences that were analyzed
        chunks_per_sentence: Optional dict mapping sentence_id to retrieved chunks
        output_path: Path to save CSV
        metadata: Additional metadata

    Returns:
        CitationExportResult with export data
    """
    exporter = CitationExporter()

    # Register sentences
    for i, sentence in enumerate(sentences):
        exporter.add_sentence(i, sentence)

    # Add chunks if provided
    if chunks_per_sentence:
        for sent_id, chunks in chunks_per_sentence.items():
            exporter.add_retrieved_chunks(sent_id, chunks)

    # Match citations to sentences
    for citation in citations:
        # Find which sentence this citation belongs to
        best_match = 0
        best_overlap = 0

        for sent_id, sentence in enumerate(sentences):
            # Check if claim text overlaps with sentence
            if citation.claim_text:
                overlap = len(set(citation.claim_text.lower().split()) &
                             set(sentence.lower().split()))
                if overlap > best_overlap:
                    best_overlap = overlap
                    best_match = sent_id

        exporter.add_citation(best_match, citation)

    # Export
    result = exporter.export(
        document_text="\n".join(sentences),
        metadata=metadata,
    )

    result.to_csv(output_path)

    return result
