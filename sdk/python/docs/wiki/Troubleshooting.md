# Troubleshooting

Common issues and solutions when using Scholaris.

## Installation Issues

### "Module not found" errors

**Problem:** Import errors after installation

**Solution:**
```bash
# Reinstall with no cache
pip uninstall scholaris
pip install --no-cache-dir git+https://github.com/joseluissaorin/scholaris.git

# Or verify installation
pip show scholaris
```

### Permission denied errors

**Problem:** Cannot install due to permissions

**Solution:**
```bash
# Use --user flag
pip install --user git+https://github.com/joseluissaorin/scholaris.git

# Or use virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install scholaris
```

### SSL certificate errors

**Problem:** SSL errors during pip install

**Solution:**
```bash
pip install --trusted-host pypi.org --trusted-host files.pythonhosted.org scholaris
```

## Search Issues

### No papers found

**Problem:** `search_papers()` returns empty list

**Causes:**
1. **Too restrictive filters** - Try wider year range
2. **Network issues** - Check internet connection
3. **Google Scholar blocking** - May be rate-limited

**Solutions:**
```python
# Try with broader parameters
papers = scholar.search_papers(
    topic="your topic",
    max_papers=5,  # Start small
    min_year=None  # Remove year filter
)

# Add delay between searches
import time
time.sleep(5)
papers = scholar.search_papers(...)
```

### "PyPaperBot not found" error

**Problem:** Cannot execute PyPaperBot

**Solution:**
```bash
# Reinstall dependencies
pip install PyPaperBot selenium undetected-chromedriver
```

## Download Issues

### PDFs not downloading

**Problem:** `download_papers()` returns empty list

**Causes:**
1. **Sci-Hub unavailable** - Mirror may be down
2. **Papers behind paywall** - Not freely accessible
3. **Network/firewall blocking** - Check network

**Solutions:**
```python
# Try different Sci-Hub mirror
from scholaris import Config
config = Config(scihub_mirror="https://sci-hub.se")
scholar = Scholaris(config=config)

# Or configure via environment
# .env file:
# SCHOLARIS_SCIHUB_MIRROR=https://sci-hub.se
```

### Timeout errors during download

**Problem:** Downloads timing out

**Solution:**
```python
# Download papers one by one with error handling
for paper in papers:
    try:
        paths = scholar.download_papers([paper], output_dir="./papers")
    except Exception as e:
        print(f"Failed to download {paper.title}: {e}")
        continue
```

## BibTeX Issues

### BibTeX extraction returns empty

**Problem:** `generate_bibtex()` returns no entries

**Causes:**
1. **PDFs without metadata** - Scanned or old papers
2. **pdf2bib not installed** - Missing optional dependency
3. **Corrupt PDFs** - Damaged files

**Solutions:**
```bash
# Install pdf2bib for better results
pip install scholaris[pdf]
```

```python
# Use LLM fallback explicitly
bibtex = scholar.generate_bibtex(
    pdf_paths=pdf_paths,
    method="llm"  # Force AI extraction
)

# Or use auto method (tries both)
bibtex = scholar.generate_bibtex(
    pdf_paths=pdf_paths,
    method="auto"
)
```

### Invalid BibTeX format

**Problem:** Generated BibTeX has errors

**Solution:**
```python
# Validate entries before use
from bibtexparser import loads

for entry in bibtex_entries:
    try:
        # Test if valid
        loads(str(entry))
    except Exception as e:
        print(f"Invalid entry: {e}")
```

## Review Generation Issues

### "API key not configured" error

**Problem:** Missing or invalid Gemini API key

**Solution:**
```bash
# Set environment variable
export GEMINI_API_KEY="your-key-here"

# Or in .env file
echo "GEMINI_API_KEY=your-key-here" > .env
```

```python
# Or pass directly
scholar = Scholaris(gemini_api_key="your-key-here")
```

### Review generation too slow

**Problem:** Takes too long to generate

**Causes:**
- Large number of papers
- High min_words_per_section
- Network latency

**Solutions:**
```python
# Reduce parameters
review = scholar.generate_review(
    topic="your topic",
    papers=papers[:5],  # Limit papers
    min_words_per_section=300,  # Reduce words
    sections=["Introduction", "Conclusion"]  # Fewer sections
)
```

### API rate limit errors

**Problem:** "429 Too Many Requests" error

**Solution:**
```python
import time

# Add delays between API calls
# This is built-in, but you can increase delays
from scholaris import Config

config = Config(enable_rate_limiting=True)
scholar = Scholaris(config=config)
```

### Empty or low-quality reviews

**Problem:** Generated content is poor

**Solutions:**
```python
# Use thinking model for better quality
review = scholar.generate_review(
    topic="your topic",
    use_thinking_model=True,  # Better reasoning
    min_words_per_section=500  # More detailed
)

# Ensure PDFs are provided for context
review = scholar.generate_review(
    topic="your topic",
    papers=papers,  # Include papers
    bibtex_entries=bibtex  # Include citations
)
```

## Export Issues

### DOCX export fails

**Problem:** Cannot export to Word format

**Solution:**
```bash
# Install python-docx
pip install python-docx
```

### HTML export missing styles

**Problem:** HTML output has no CSS

**Solution:**
```python
# Enable CSS in export
scholar.export_html(review, "review.html", include_css=True)
```

### File permission errors

**Problem:** Cannot write to output directory

**Solution:**
```python
import os

# Ensure directory exists and is writable
output_dir = "./my_output"
os.makedirs(output_dir, exist_ok=True)

scholar.export_docx(review, os.path.join(output_dir, "review.docx"))
```

## Network Issues

### Connection timeouts

**Problem:** Operations timing out

**Solution:**
```python
# Increase timeout (if using custom requests)
import requests
requests.adapters.DEFAULT_TIMEOUT = 60  # seconds
```

### Proxy configuration

**Problem:** Behind corporate proxy

**Solution:**
```bash
# Set proxy environment variables
export HTTP_PROXY=http://proxy.example.com:8080
export HTTPS_PROXY=https://proxy.example.com:8080
```

## Performance Issues

### Memory usage too high

**Problem:** High memory consumption

**Solution:**
```python
# Process papers in batches
batch_size = 5
for i in range(0, len(papers), batch_size):
    batch = papers[i:i+batch_size]
    pdf_paths = scholar.download_papers(batch, output_dir="./papers")
    # Process batch...
```

### Slow operations

**Problem:** Everything is slow

**Solutions:**
1. **Check internet connection**
2. **Reduce paper count**
3. **Use local PDFs when possible**
4. **Disable verbose logging**

```python
import logging
logging.basicConfig(level=logging.WARNING)  # Reduce log output
```

## Getting Help

Still having issues?

1. **Check the [FAQ](FAQ)** for common questions
2. **Search [existing issues](https://github.com/joseluissaorin/scholaris/issues)**
3. **Open a new issue** with:
   - Error message
   - Code that reproduces the issue
   - Python and Scholaris versions
   - Operating system

**Provide this information:**
```python
import sys
import scholaris

print(f"Python: {sys.version}")
print(f"Scholaris: {scholaris.__version__}")
print(f"OS: {sys.platform}")
```

---

**Need More Help?** Visit the [FAQ](FAQ) or open an [issue](https://github.com/joseluissaorin/scholaris/issues).
