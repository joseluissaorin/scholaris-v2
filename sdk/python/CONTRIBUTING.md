# Contributing to Scholaris

Thank you for considering contributing to Scholaris! This guide will help you get started.

## Ways to Contribute

### Report Bugs

Found a bug? Please open an issue with:

1. **Clear title** - Descriptive summary of the bug
2. **Steps to reproduce** - Minimal code example
3. **Expected behavior** - What should happen
4. **Actual behavior** - What actually happens
5. **Environment** - Python version, OS, Scholaris version

**Example:**
```markdown
### Bug: PDF download fails for arXiv papers

**Steps to reproduce:**
```python
from scholaris import Scholaris
scholar = Scholaris()
papers = scholar.search_papers("neural networks")
paths = scholar.download_papers(papers)  # Returns empty
```

**Expected:** PDFs downloaded

**Actual:** Empty list, no error

**Environment:**
- Python 3.10
- Scholaris 1.0.0
- Ubuntu 22.04
```

### Suggest Features

Have an idea? Open an issue with:

1. **Use case** - What problem does it solve?
2. **Proposed solution** - How should it work?
3. **Alternatives** - Other approaches considered
4. **Impact** - Who benefits?

### Improve Documentation

Documentation improvements are always welcome:

- Fix typos or unclear explanations
- Add examples
- Improve API documentation
- Write tutorials

### Submit Code

Ready to code? Great! Follow the process below.

## Development Setup

### 1. Fork and Clone

```bash
# Fork on GitHub, then clone your fork
git clone https://github.com/YOUR_USERNAME/scholaris.git
cd scholaris
```

### 2. Create Virtual Environment

```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

### 3. Install in Development Mode

```bash
pip install -e .[dev]
```

This installs:
- Scholaris in editable mode
- Development dependencies (pytest, black, mypy, flake8)

### 4. Create a Branch

```bash
git checkout -b feature/your-feature-name
```

## Code Guidelines

### Code Style

We use **Black** for formatting:

```bash
black scholaris/
```

Run before committing:
```bash
black scholaris/ --check
```

### Type Hints

Use type hints for all functions:

```python
def search_papers(
    topic: str,
    max_papers: int = 10
) -> List[Paper]:
    """Search for papers.
    
    Args:
        topic: Research topic
        max_papers: Maximum results
        
    Returns:
        List of Paper objects
    """
    pass
```

### Docstrings

Use Google-style docstrings:

```python
def process_data(data: List[str], verbose: bool = False) -> Dict[str, Any]:
    """Process input data and return results.
    
    This function takes a list of strings and processes them
    according to the algorithm described in paper XYZ.
    
    Args:
        data: List of input strings to process
        verbose: If True, print progress messages
        
    Returns:
        Dictionary containing:
            - 'results': Processed data
            - 'count': Number of items processed
            - 'errors': List of errors encountered
            
    Raises:
        ValueError: If data is empty
        ProcessingError: If processing fails
        
    Example:
        >>> data = ["item1", "item2"]
        >>> results = process_data(data, verbose=True)
        >>> print(results['count'])
        2
    """
    pass
```

### Testing

Write tests for new features:

```python
# tests/test_feature.py
import pytest
from scholaris import Scholaris

def test_search_papers():
    """Test paper search functionality."""
    scholar = Scholaris()
    papers = scholar.search_papers(
        topic="test",
        max_papers=5
    )
    
    assert isinstance(papers, list)
    assert len(papers) <= 5
```

Run tests:
```bash
pytest tests/
```

### Linting

Check code quality:

```bash
# Type checking
mypy scholaris/

# Linting
flake8 scholaris/
```

## Pull Request Process

### 1. Make Your Changes

- Follow code guidelines above
- Write tests for new features
- Update documentation

### 2. Test Locally

```bash
# Format code
black scholaris/

# Run tests
pytest tests/

# Check types
mypy scholaris/

# Lint
flake8 scholaris/
```

### 3. Commit Changes

Write clear commit messages:

```bash
git add .
git commit -m "Add support for DeepSeek LLM provider

- Implement DeepSeekProvider class
- Add configuration options
- Add tests for DeepSeek integration
- Update documentation"
```

**Commit message format:**
- First line: Brief summary (50 chars)
- Blank line
- Detailed description with bullet points

### 4. Push to Your Fork

```bash
git push origin feature/your-feature-name
```

### 5. Create Pull Request

On GitHub:
1. Click "New Pull Request"
2. Select your branch
3. Fill in the template:

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation update
- [ ] Performance improvement

## Testing
- [ ] Added tests
- [ ] All tests pass
- [ ] Tested manually

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Documentation updated
- [ ] No breaking changes (or documented)
```

### 6. Code Review

- Respond to reviewer comments
- Make requested changes
- Push updates to the same branch

### 7. Merge

Once approved, a maintainer will merge your PR.

## Project Structure

```
scholaris/
├── scholaris/           # Main package
│   ├── core/           # Core logic
│   ├── providers/      # Pluggable backends
│   ├── converters/     # Format converters
│   └── utils/          # Utilities
├── tests/              # Test suite
├── examples/           # Usage examples
├── docs/               # Documentation
└── setup.py            # Package configuration
```

## Adding a New Provider

Want to add a new search/LLM/BibTeX provider?

### 1. Implement Interface

```python
# scholaris/providers/llm/custom.py
from .base import BaseLLMProvider

class CustomLLMProvider(BaseLLMProvider):
    """Custom LLM provider."""
    
    def generate(
        self,
        prompt: str,
        **kwargs
    ) -> str:
        """Generate text from prompt."""
        # Implement your logic
        pass
```

### 2. Add Tests

```python
# tests/test_custom_provider.py
def test_custom_provider():
    provider = CustomLLMProvider()
    result = provider.generate("test prompt")
    assert isinstance(result, str)
```

### 3. Update Documentation

Add to docs/wiki/API-Reference.md and README.md.

## Documentation Contributions

Documentation is in `docs/wiki/`:

- `Home.md` - Wiki home page
- `Installation.md` - Installation guide
- `Quick-Start.md` - Getting started
- `API-Reference.md` - API docs
- `FAQ.md` - Common questions

To contribute:
1. Edit markdown files
2. Test locally (preview)
3. Submit PR

## Community Guidelines

### Be Respectful

- Be kind and constructive
- Welcome newcomers
- Focus on the code, not the person

### Ask Questions

Not sure about something? Just ask! Open an issue or discussion.

### Give Credit

If you use someone else's code or idea, credit them.

## Release Process

(For maintainers)

1. Update version in `setup.py`
2. Update CHANGELOG.md
3. Create git tag: `git tag v1.0.1`
4. Push tag: `git push origin v1.0.1`
5. Create GitHub release
6. Publish to PyPI: `twine upload dist/*`

## Getting Help

- **Questions?** Open a discussion
- **Stuck?** Open an issue
- **Want to chat?** Check GitHub Discussions

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

**Thank you for contributing to Scholaris!** Every contribution, no matter how small, helps make Scholaris better for everyone.
