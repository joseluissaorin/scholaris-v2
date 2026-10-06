# Frequently Asked Questions

## General Questions

### What is Scholaris?

Scholaris is a Python library that automates academic research workflows. It helps researchers search for papers, download PDFs, manage citations, and generate literature reviews using AI.

### Is Scholaris free?

Yes, Scholaris is open-source software under the MIT License. It's completely free to use. However, some features require a Google Gemini API key, which has free and paid tiers.

### What can I do with Scholaris?

- Search Google Scholar for academic papers
- Download papers from open-access sources (Sci-Hub)
- Extract BibTeX citations from PDFs
- Format bibliographies in APA 7th edition
- Generate AI-powered literature reviews
- Export to Markdown, Word (DOCX), and HTML

## Installation & Setup

### Do I need an API key?

You need a Google Gemini API key only for AI-powered features (literature review generation). Paper search, download, and BibTeX extraction work without an API key.

Get a free key at: https://makersuite.google.com/app/apikey

### Which Python version do I need?

Python 3.9 or higher. Check with:
```bash
python --version
```

### Can I use Scholaris offline?

Partially. You need internet for:
- Paper search (Google Scholar)
- PDF download (Sci-Hub)
- AI features (Gemini API)

BibTeX extraction and formatting can work offline if you have PDFs locally.

## Usage Questions

### How many papers can I search for?

Technically unlimited, but:
- Google Scholar may rate-limit heavy usage
- Larger searches take longer
- Start with 10-20 papers for testing

### Why can't I find some papers?

Common reasons:
- Paper is too new or too old
- Not indexed in Google Scholar
- Behind strict paywall
- Title/keywords don't match

Try:
- Broader search terms
- Different year ranges
- Specific paper titles

### Why aren't PDFs downloading?

Common causes:
- Sci-Hub doesn't have the paper
- Sci-Hub mirror is down/blocked
- Network/firewall blocking
- Papers behind strict paywalls

Expected success rate: 50-80% depending on papers.

### How accurate is BibTeX extraction?

Accuracy depends on the method:

- **pdf2bib**: ~70-90% for papers with DOI
- **AI extraction**: ~60-80% accuracy
- **Best results**: Recent papers from major publishers

### Can I use my own PDFs?

Yes! You don't need to search or download:

```python
review = scholar.complete_workflow(
    topic="Your Topic",
    auto_search=False,
    user_pdfs=["paper1.pdf", "paper2.pdf"],
    output_format="docx"
)
```

## AI & Review Generation

### How good are the generated reviews?

Quality depends on:
- Quality of input papers
- Topic complexity
- Section length settings
- Whether papers are provided for context

Generally suitable for:
- Initial drafts
- Background research
- Learning new topics

Always review and edit the output.

### Can I customize the review structure?

Yes, define your own sections:

```python
review = scholar.generate_review(
    topic="Your Topic",
    sections=[
        "Background",
        "Methodology",
        "Current State",
        "Future Directions",
        "Implications"
    ]
)
```

### How long does review generation take?

Typical times:
- Simple review (3 sections, 500 words each): 15-30 seconds
- Complex review (5 sections, 1000 words each): 1-2 minutes

Depends on:
- Number of sections
- Words per section
- API response time
- Number of papers

### Can I use a different AI model?

Yes, Scholaris supports:
- **Gemini** (default, recommended)
- **DeepSeek**
- **Perplexity**

```python
scholar = Scholaris(
    llm_provider="deepseek",
    deepseek_api_key="your-key"
)
```

## Citation & Bibliography

### What citation styles are supported?

Currently only APA 7th edition. More styles coming in future versions.

### Can I import existing BibTeX files?

Yes:

```python
# Parse existing .bib file
entries = scholar.parse_bibtex_file("my_refs.bib")

# Use in review
review = scholar.generate_review(
    topic="Your Topic",
    bibtex_entries=entries
)
```

### How do I fix incorrect citations?

1. Edit the .bib file manually
2. Re-import and regenerate

Or:

```python
# Modify entries programmatically
for entry in bibtex_entries:
    if entry['ID'] == 'incorrect_citation':
        entry['author'] = 'Corrected Author'
        entry['year'] = '2024'
```

## Export & Output

### What export formats are supported?

- **Markdown** (.md) - For GitHub, documentation
- **DOCX** (.docx) - Microsoft Word
- **HTML** (.html) - Web pages
- **BibTeX** (.bib) - Citation management

### Can I customize the Word document format?

The DOCX export uses academic styling:
- A4 page size
- Times New Roman 12pt
- APA-compliant formatting

For custom formatting, export to Markdown and use a Word template.

### How do I merge multiple reviews?

Export to Markdown and concatenate:

```python
review1 = scholar.generate_review(...)
review2 = scholar.generate_review(...)

combined = review1.markdown + "\n\n" + review2.markdown

with open("combined_review.md", "w") as f:
    f.write(combined)
```

## Integration & Advanced Use

### Can I use Scholaris in a web application?

Yes, it's just a Python library. Works with:
- Flask
- FastAPI
- Django
- Streamlit

See [Examples](Examples) for integration patterns.

### Can I run Scholaris in a Jupyter notebook?

Yes:

```python
# In Jupyter cell
from scholaris import Scholaris
scholar = Scholaris(gemini_api_key="your-key")
papers = scholar.search_papers("quantum computing")
```

### How do I batch process many topics?

```python
topics = ["Topic 1", "Topic 2", "Topic 3"]

for topic in topics:
    review = scholar.complete_workflow(
        topic=topic,
        max_papers=10,
        output_path=f"./reviews/{topic.replace(' ', '_')}.docx"
    )
```

### Can I extend Scholaris with custom providers?

Yes, Scholaris has a provider-based architecture. You can implement custom:
- Search providers
- LLM providers
- BibTeX extractors

See the [Architecture](Architecture) guide.

## Performance & Limits

### How much does it cost?

Scholaris itself is free. Costs:
- **Gemini API**: Free tier available, then pay-per-use
- **Sci-Hub**: Free
- **Google Scholar**: Free

### Are there rate limits?

Yes:
- **Google Scholar**: May block heavy usage
- **Gemini API**: 60 requests/minute (free tier)
- **Sci-Hub**: Informal limits

Scholaris has built-in rate limiting to help avoid blocks.

### Can I process 1000+ papers?

Technically yes, but:
- Search will take hours
- May hit rate limits
- Large memory usage
- Review quality may suffer

Recommendation: Process in batches of 50-100 papers.

## Troubleshooting

### "API key not configured" error

Set your Gemini API key:

```bash
export GEMINI_API_KEY="your-key"
```

Or in code:
```python
scholar = Scholaris(gemini_api_key="your-key")
```

### "PyPaperBot not found" error

Install dependencies:
```bash
pip install PyPaperBot selenium undetected-chromedriver
```

### Review generation fails

Check:
1. Valid API key
2. Internet connection
3. Topic is not empty
4. At least some papers/citations provided

See [Troubleshooting](Troubleshooting) for more solutions.

## Legal & Ethical

### Is using Sci-Hub legal?

Legal status varies by country. Sci-Hub operates in a legal gray area. Use responsibly and check your local laws.

### Can I use generated reviews in my thesis?

AI-generated content should be:
- Reviewed and edited
- Fact-checked
- Properly cited
- Disclosed to advisors

Check your institution's policies on AI assistance.

### How do I cite Scholaris?

```bibtex
@software{scholaris2026,
  title={Scholaris: Academic Research Automation Library for Python},
  author={Saor\'{i}n Ferrer, Jos\'{e} Luis},
  year={2026},
  url={https://github.com/joseluissaorin/scholaris}
}
```

## Getting Help

### Where can I get support?

1. Check this FAQ
2. Read [Troubleshooting](Troubleshooting)
3. Search [GitHub Issues](https://github.com/joseluissaorin/scholaris/issues)
4. Open a new issue

### How do I report a bug?

Open an issue with:
- Clear description
- Steps to reproduce
- Error message
- Python version
- Scholaris version

### Can I request features?

Yes! Open an issue with:
- Use case description
- Why it's useful
- Suggested implementation (optional)

### How can I contribute?

See [Contributing](Contributing) guide for:
- Code contributions
- Documentation
- Bug reports
- Testing

---

**Still have questions?** Open an [issue](https://github.com/joseluissaorin/scholaris/issues) or check the [full documentation](Home).
