# SPDF Format

**Scholaris Processed Document Format** — A portable, self-contained file format for storing processed PDF documents ready for citation matching.

## Contents

```
spdf/
├── SPEC.md                 # Formal specification (v1.0)
├── schema/
│   └── v1.0.sql            # SQLite schema
├── validator/
│   ├── validator.py        # SPDFValidator class
│   └── cli.py              # Command-line interface
├── reference/
│   ├── reader.py           # Minimal reference reader
│   └── writer.py           # Minimal reference writer
├── examples/
│   ├── minimal.spdf        # Smallest valid file
│   └── full.spdf           # Complete example
└── tests/
    ├── test_validator.py   # Validator tests
    └── test_roundtrip.py   # Read/write tests
```

## Quick Start

### Validate a file

```bash
python -m spdf.validator file.spdf
python -m spdf.validator file.spdf --verbose
python -m spdf.validator *.spdf --json
```

### Read a file

```python
from spdf.reference import read_spdf

data = read_spdf("file.spdf")
print(data.citation_key)  # "smith2023"
print(data.title)         # "Example Paper"
print(len(data.chunks))   # 42
```

### Write a file

```python
from spdf.reference import SPDFWriter
import numpy as np

writer = SPDFWriter()
writer.set_metadata(
    citation_key="smith2023",
    authors=["John Smith"],
    year=2023,
    title="Example Paper",
    embedding_dim=768,
)
writer.add_page(pdf_page=1, book_page=1, text="...", confidence=0.95)
writer.add_chunk(page_id=0, chunk_index=0, text="...", book_page=1, pdf_page=1)
writer.add_embedding(np.random.randn(768))
writer.save("output.spdf")
```

## Specification

See [SPEC.md](SPEC.md) for the complete format specification.

## Testing

```bash
python -m pytest spdf/tests/ -v
```
