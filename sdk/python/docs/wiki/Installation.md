# Installation Guide

This guide covers all methods for installing Scholaris on your system.

## Quick Installation

### From GitHub (Recommended)

```bash
pip install git+https://github.com/joseluissaorin/scholaris.git
```

### With Optional Features

```bash
# With PDF metadata extraction (recommended)
pip install git+https://github.com/joseluissaorin/scholaris.git[pdf]

# With development tools
pip install git+https://github.com/joseluissaorin/scholaris.git[dev]

# With all optional features
pip install git+https://github.com/joseluissaorin/scholaris.git[all]
```

## From Source

### 1. Clone the Repository

```bash
git clone https://github.com/joseluissaorin/scholaris.git
cd scholaris
```

### 2. Install in Development Mode

```bash
# Standard installation
pip install -e .

# With optional features
pip install -e .[pdf]
pip install -e .[dev]
pip install -e .[all]
```

## System Requirements

### Python Version

Scholaris requires **Python 3.9 or higher**. Check your version:

```bash
python --version
```

### Supported Operating Systems

- **Linux**: All major distributions (Ubuntu, Debian, Fedora, etc.)
- **macOS**: 10.14 (Mojave) or higher
- **Windows**: Windows 10 or higher

## Dependencies

### Core Dependencies

These are installed automatically:

- **python-dotenv** - Environment variable management
- **requests** - HTTP requests
- **bibtexparser** - BibTeX file parsing
- **PyPaperBot** - Google Scholar integration
- **selenium** - Web automation
- **undetected-chromedriver** - Browser automation
- **google-generativeai** - Gemini API client
- **python-docx** - Word document generation
- **markdown** - Markdown processing
- **beautifulsoup4** - HTML parsing

### Optional Dependencies

Install with extras for enhanced functionality:

#### PDF Enhancement (`[pdf]`)

```bash
pip install scholaris[pdf]
```

Adds **pdf2bib** for improved citation extraction from PDFs.

#### Development Tools (`[dev]`)

```bash
pip install scholaris[dev]
```

Adds:
- **pytest** - Testing framework
- **black** - Code formatting
- **mypy** - Type checking
- **flake8** - Linting

## API Keys

### Google Gemini API (Required for AI Features)

1. Visit [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Sign in with your Google account
3. Click "Create API Key"
4. Copy your API key

Set the API key:

```bash
# As environment variable
export GEMINI_API_KEY="your-api-key-here"

# Or in .env file
echo "GEMINI_API_KEY=your-api-key-here" > .env
```

Or pass directly to Scholaris:

```python
from scholaris import Scholaris
scholar = Scholaris(gemini_api_key="your-api-key-here")
```

## Verification

Verify your installation:

```python
from scholaris import Scholaris
print("Scholaris installed successfully!")

# Check version
import scholaris
print(f"Version: {scholaris.__version__}")
```

## Troubleshooting

### Permission Errors

On Linux/macOS, use `--user` flag:

```bash
pip install --user scholaris
```

### SSL Certificate Errors

```bash
pip install --trusted-host pypi.org --trusted-host files.pythonhosted.org scholaris
```

### PyPaperBot Not Found

Ensure selenium and chromedriver are installed:

```bash
pip install selenium undetected-chromedriver
```

### Import Errors

If you get import errors, try reinstalling:

```bash
pip uninstall scholaris
pip install --no-cache-dir scholaris
```

## Upgrading

### From GitHub

```bash
pip install --upgrade git+https://github.com/joseluissaorin/scholaris.git
```

### From Source

```bash
cd scholaris
git pull
pip install --upgrade -e .
```

## Uninstallation

```bash
pip uninstall scholaris
```

## Next Steps

- [Quick Start](Quick-Start) - Get started with your first workflow
- [Configuration](Configuration) - Configure Scholaris for your needs
- [API Reference](API-Reference) - Explore the full API

---

**Need Help?** See [Troubleshooting](Troubleshooting) or open an [issue](https://github.com/joseluissaorin/scholaris/issues).
