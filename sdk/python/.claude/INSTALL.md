# Installing Scholaris Claude Code Skill

This directory contains a Claude Code skill and slash commands for using Scholaris directly within Claude Code.

## What's Included

```
.claude/
├── INSTALL.md                    # This file
├── skills/
│   └── scholaris/
│       ├── SKILL.md              # Main skill (auto-discovered)
│       ├── REFERENCE.md          # Complete API documentation
│       ├── WORKFLOWS.md          # Common workflow patterns
│       └── scripts/
│           ├── cite_document.py  # CLI citation script
│           └── process_pdf.py    # CLI PDF processing script
└── commands/
    ├── cite.md                   # /cite command
    ├── process-pdf.md            # /process-pdf command
    ├── search-papers.md          # /search-papers command
    └── batch-process.md          # /batch-process command
```

## Installation

### Option 1: CLI Command (Recommended)

After installing scholaris, use the built-in command:

```bash
# Install to ~/.claude (global - works in all projects)
scholaris install-skills --global

# Or install to current project only
scholaris install-skills
```

### Option 2: Manual Copy

Copy the skill and commands to your personal Claude configuration:

```bash
# From the scholaris repository root
cp -r .claude/skills/scholaris ~/.claude/skills/
cp .claude/commands/*.md ~/.claude/commands/
```

### Option 3: Project-Specific

Keep the `.claude` directory in your project. Claude Code will automatically discover skills and commands in the project's `.claude` folder.

### Option 4: Symlink (Development)

If you want to keep the skill synced with the repository:

```bash
ln -s "$(pwd)/.claude/skills/scholaris" ~/.claude/skills/scholaris
ln -s "$(pwd)/.claude/commands/cite.md" ~/.claude/commands/cite.md
ln -s "$(pwd)/.claude/commands/process-pdf.md" ~/.claude/commands/process-pdf.md
ln -s "$(pwd)/.claude/commands/search-papers.md" ~/.claude/commands/search-papers.md
ln -s "$(pwd)/.claude/commands/batch-process.md" ~/.claude/commands/batch-process.md
```

## Verification

After installation, verify the skill is available:

1. Start Claude Code in any project
2. Type `/help` to see available commands - you should see `/cite`, `/process-pdf`, etc.
3. Ask Claude "What skills are available?" - it should mention scholaris

## Usage

### CLI Commands (No Claude Code Required)

```bash
# Cite a document using SPDF bibliography
scholaris cite paper.md ./spdf -o paper_cited.md

# Process a PDF to SPDF format
scholaris process paper.pdf --key smith2024 --authors "John Smith" --year 2024

# Show info about SPDF files
scholaris info ./spdf
```

### Auto-Discovery (Skill)

Claude will automatically suggest using scholaris when you:
- Mention citations, bibliography, or academic writing
- Work with PDF or SPDF files
- Ask about reference management

### Slash Commands

```bash
# Cite a document
/cite paper.md ./bibliography

# Process a PDF to SPDF
/process-pdf paper.pdf smith2024 "John Smith" 2024 "Paper Title"

# Search for papers
/search-papers "transformer attention" 10

# Batch process PDFs
/batch-process ./pdfs ./spdf
```

## Key Pattern: CitationIndex with SPDF Files

The most efficient approach for auto-citation:

```python
from scholaris.auto_cite.citation_index import CitationIndex
from scholaris.auto_cite.models import CitationStyle

# Load pre-processed SPDF files
index = CitationIndex(gemini_api_key=GEMINI_API_KEY)
index.add_directory("./spdf")

# Cite document
result = index.cite_document(
    document_text=document_text,
    style=CitationStyle.APA7,
    min_confidence=0.5,
)
```

This approach:
- Uses pre-computed embeddings from SPDF files
- No re-processing or external database needed
- Fast in-memory vector search

## Requirements

- Claude Code CLI installed
- Python 3.9+
- Scholaris library installed: `pip install scholaris` or `pip install git+https://github.com/joseluissaorin/scholaris`
- `GEMINI_API_KEY` environment variable set

## Updating

To update the skill after pulling new changes:

```bash
# If using CLI (Option 1)
scholaris install-skills --global

# If using manual copy (Option 2)
cp -r .claude/skills/scholaris ~/.claude/skills/
cp .claude/commands/*.md ~/.claude/commands/

# If using symlink (Option 4)
# No action needed - symlinks auto-update
```

## Customization

Feel free to modify the skill files to match your workflow:

- **SKILL.md**: Change the description to improve auto-discovery
- **REFERENCE.md**: Add project-specific API notes
- **WORKFLOWS.md**: Add your own workflow patterns
- **commands/*.md**: Customize default arguments and behavior

## Troubleshooting

### Skill not discovered
- Ensure files are in `~/.claude/skills/scholaris/` or `.claude/skills/scholaris/`
- Check that `SKILL.md` has valid YAML frontmatter

### Commands not showing
- Ensure files are in `~/.claude/commands/` or `.claude/commands/`
- Restart Claude Code after adding commands

### API errors
- Verify `GEMINI_API_KEY` is set in your environment or `.env` file
- Check API quota and rate limits

### CLI not found
- Ensure scholaris is installed: `pip install scholaris`
- Check that your Python bin directory is in PATH
