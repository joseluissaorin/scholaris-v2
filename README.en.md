<p align="center">
  <img src=".github/assets/social.png" alt="Scholaris" width="720">
</p>

<p align="center">
  <strong>A hand that points to the page, then steps aside.</strong><br>
  Your library, read and citable: on your computer, on your server or in the cloud.
</p>

<p align="center">
  <a href="https://github.com/joseluissaorin/scholaris-v2/actions/workflows/ci.yml"><img src="https://github.com/joseluissaorin/scholaris-v2/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-EUPL--1.2-1f3a5f" alt="EUPL-1.2"></a>
  <a href="https://pypi.org/project/scholaris-sdk/"><img src="https://img.shields.io/pypi/v/scholaris-sdk?label=scholaris-sdk" alt="PyPI"></a>
  <a href="README.md">Español</a>
</p>

In the margins of old books a small hand with a pointing finger turns up again and again. Palaeographers call it a manicule, and it was there to tell some future reader "look here", without telling them what to think of what they were about to see.

Scholaris wants to be that hand. It reads your books, your papers, your notes and your interviews, and when you ask it something it doesn't hand you an opinion. It points to the passage, the book and the printed page (the real one, the one you would put in a footnote) or the exact minute of the recording in which someone said it. If it can't find it, it says so. **It never invents a citation**: each one is checked against the text you gave it before you see it, and every piece of data shows where it came from. The thinking, the judging and the writing stay yours.

<p align="center">
  <img src=".github/assets/biblioteca.webp" alt="The library with Bécquer's Rimas going through the press, page by page" width="100%">
  <br><sub>The library, with a book on the press: its pages can be read and searched as soon as they appear.</sub>
</p>

<p align="center">
  <img src=".github/assets/lector.webp" alt="The reader with a scanned page of Lope de Vega's El casamiento en la muerte and its text alongside, cited by the printed folio (p. 4, physical page 10)" width="44%">
  <img src=".github/assets/video.webp" alt="A video interview: who speaks and how much, the transcript with each turn at its minute, and frames of what is on screen" width="54%">
  <br><sub>The real printed page (p. 4, even if it is the tenth of the scan) · in video, who speaks, at which minute, and what is on screen.</sub>
</p>

<p align="center">
  <img src=".github/assets/buscar.webp" alt="A two-stage search: on the left, the preliminary result while the ranking is refined; on the right, the final ranking with each passage and its page" width="100%">
  <br><sub>Search: a first result right away and, a moment later, the final ranking.</sub>
</p>

<p align="center">
  <img src=".github/assets/preguntar.webp" alt="A question about Lope de Vega answered with numbered citations, each with its page, and the sources alongside" width="50%">
  <img src=".github/assets/referencia.webp" alt="Copy reference: the document's reference in APA 7, ready to paste" width="48%">
  <br><sub>Ask, with every citation checked and its page · the reference in your style, one click away.</sub>
</p>

<p align="center">
  <img src=".github/assets/personas-y-obras.webp" alt="Explore, People and works: Charlemagne and the graph of characters and places he appears with across two books" width="49%">
  <img src=".github/assets/inspector.webp" alt="The whole SPDF: a document's inspector, with each metadata field, its source and its confidence" width="49%">
  <br><sub>People and works across the whole library · "The whole SPDF", everything Scholaris kept from each document and where it came from.</sub>
</p>

<p align="center">
  <img src=".github/assets/biblioteca-oscuro.webp" alt="The library in dark mode" width="49%">
  <img src=".github/assets/lector-oscuro.webp" alt="The reader in dark mode" width="49%">
  <br><sub>Dark mode too.</sub>
</p>

<p align="center">
  <img src=".github/assets/acerca.webp" alt="Scholaris's public landing page: “A hand that points to the page and then steps aside”" width="76%">
  <img src=".github/assets/movil.webp" alt="The library on a phone" width="22%">
  <br><sub>The landing page, and the library on a phone.</sub>
</p>

<p align="center">
  <img src=".github/assets/imprenta.gif" alt="The press at work: upload, convert, read the pages, sort the index, ready to search and cite" width="588">
</p>

The interface is in Spanish and English; the screenshots show the Spanish demo library.

## What it does

- **Anything goes in.** Born-digital or scanned PDFs, photos of pages, EPUB, Word, slides, spreadsheets, audio, video and links (web pages, PDFs, YouTube, podcasts). Everything becomes a library you can search and cite.
- **The printed page.** The real folio, even when the book starts in roman numerals, the pagination jumps, or it's a seventeenth-century chapbook; and in audio and video, the exact second and who is speaking.
- **Ask the whole library**, in any language (early modern Spanish and Latin included), and get answers whose citations are checked one by one.
- **Your citations, your style.** APA, MLA, Chicago, ISO 690 or any CSL style; BibTeX and RIS; and an auto-citer that goes through your draft (plain text or .docx) and proposes each reference with its page.
- **An open format that belongs to you.** Every document it reads becomes an **SPDF** file (SQLite with the text, the anchors, the vectors and the provenance) that you can take with you and open without Scholaris.
- **For agents and programs.** REST API, MCP server and a Python SDK: `pip install scholaris-sdk`.

## Four ways to run it

| | For whom | What you need |
|---|---|---|
| [1. On your computer, with Node](#1-on-your-computer-with-node) | Developers, or anyone who wants to touch the code | Node 22+, pnpm and a Gemini key |
| [2. Docker, one file](#2-docker-one-file) | A server at home, for a group or a department | Docker and a Gemini key |
| [3. A single desktop executable](#3-a-single-desktop-executable) | Anyone who just wants it on their laptop | The download and a Gemini key |
| [4. Cloudflare, one command](#4-cloudflare-one-command) | A cloud instance for several people | A Cloudflare account (Workers Paid) |
| [The hosted instance](https://scholaris.joseluissaorin.com) | Anyone who doesn't want to install anything | An account; there is a free plan and paid plans |

The first four are the same application: the same domain code behind different ports (SQLite and the filesystem locally; D1, R2, Durable Objects and Vectorize on Cloudflare). Whatever you keep in one exports as `.spdf` and opens in any of the others.

### API keys

Scholaris ships no intelligence of its own: whoever installs it brings it, with their own keys, and nothing goes through servers run by the project.

| Key | Required? | What for |
|---|---|---|
| `GEMINI_API_KEY` ([Google AI Studio](https://aistudio.google.com/apikey)) | **Yes**, except [offline](#offline) | Reading pages and scans, search vectors (Gemini Embedding), transcribing audio and video, metadata, answers |
| `OPENROUTER_API_KEY` | No | Fallback reader and writer when Gemini fails or is overloaded |
| `TYPESAFE_API_KEY` (Jev) | No, but search gets much better | Reranker and citation judge (+0.07 nDCG@10 on the benchmark) |
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` (Workers AI) | No | Cheap Whisper transcription, fallback reader and reranker |
| `OPENALEX_API_KEY` | No | Completing and checking bibliographic records (Crossref and Wikidata need no key) |
| `INFERBOX_URL` + `INFERBOX_API_KEY` | No | [InferBox](https://github.com/joseluissaorin/InferBox), your own GPU inference server: with cloud keys, it adds a second vector space and backs up transcription, reranking and writing; [offline](#offline), it can carry all the intelligence |

Any one of these is enough: **Gemini on its own**; **OpenRouter plus an InferBox**; **Workers AI** (`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`); or **no key at all**, [offline](#offline), with your own models. TypeSafe only adds the reranker and the judge.

#### Offline

With `SCHOLARIS_SIN_CONEXION=1`, Scholaris uses no cloud key (even if one is set) and all the intelligence runs on servers in your own network: it reads pages with a vision model, embeds, reranks, transcribes, judges and writes without anything leaving your machine. The home version also installs a network guard that blocks and logs any request to the internet; the benchmark and an end-to-end test check that none is made. Without online catalogues, the bibliographic record comes only from the document (`SCHOLARIS_CATALOGOS=1` knowingly opens OpenAlex, Crossref, Open Library and Wikidata: the title and authors go out, never the text), and there is no Clerk and no YouTube by URL.

| Variable | What |
|---|---|
| `SCHOLARIS_SIN_CONEXION=1` | Turns the mode on. Every URL must be local (localhost, private network, Tailscale, a Docker service or `.local`); otherwise it refuses to start |
| `INFERENCIA_URL` | The chat and vision server: Ollama, llama.cpp, vLLM, LM Studio or InferBox (`INFERENCIA_SABOR` if it can't be told from the port) |
| `INFERENCIA_MODELO_LECTOR` | The vision model that reads pages; it also writes and judges unless you set `INFERENCIA_MODELO_REDACTOR` or `INFERENCIA_MODELO_JUEZ` |
| `INFERENCIA_EMBEBEDOR_URL` | The vector server running EmbeddingGemma 2 ([`deploy/inferencia/embeddinggemma2`](deploy/inferencia/embeddinggemma2)) |
| `INFERENCIA_REORDENADOR_URL` | A `/v1/rerank` (the same vector server with bge-reranker-v2-m3, or llama.cpp with `--reranking`) |
| `INFERENCIA_TRANSCRIPCION_URL` | Whisper in the OpenAI format (whisper.cpp, faster-whisper-server) or InferBox's `/v1/transcribe` (Whisper or Parakeet) |
| `INFERENCIA_CLAVE`, `INFERENCIA_DIMS`, `INFERENCIA_CONCURRENCIA` | Server key, dimensions (768, 512, 256 or 128) and concurrent requests |

Recommended models, all openly licensed: **Qwen3-VL 8B Instruct** for reading (the "-instruct" variant: the thinking one won't let you switch reasoning off), Google DeepMind's **EmbeddingGemma 2** for vectors (text, image, audio and video in a single 768-dimension space; Ollama only serves it for text, which is why it has its own server), **bge-reranker-v2-m3** for reranking and **Whisper large-v3-turbo** (or Parakeet on InferBox) for transcription. With Docker, all together:

```bash
docker compose -f deploy/docker/compose.yml -f deploy/docker/compose.sin-conexion.yml up -d
docker compose -f deploy/docker/compose.yml -f deploy/docker/compose.sin-conexion.yml run --rm modelos   # the first time
```

(with an NVIDIA GPU, add `-f deploy/docker/compose.sin-conexion.gpu.yml`). The first time, about 9 GB of models are downloaded; after that you can unplug the network.

What it costs, measured on an M4 Max Mac ([full report, in Spanish](packages/proveedores/SIN-CONEXION.md)): an eighteenth-century scanned page takes about 26 s to read (the cloud reads the whole book in 13-20 s), with a CER of 0.06 on the hand-transcribed page (Gemini: 0.006); 19 minutes of audio are ready in 2 min 34 s, with 2.2 % of words differing from Gemini's transcript; search scores 0.804 nDCG@10 against 0.899 in the cloud; and every citation it accepts is correct, with none invented, though it leaves 5 of the 13 supported claims without a citation. On CPU alone, vectors and transcription run fine, but reading scans takes minutes per page.

And the format is still yours without a network: every `.spdf` is a SQLite file you can open, read and search without Scholaris (with `sqlite3`, or with `scholaris.v2.spdf4` in the Python SDK).

### 1. On your computer, with Node

Requirements: Node.js 22 or later and pnpm 10 (`corepack enable`).

```bash
git clone https://github.com/joseluissaorin/scholaris-v2 scholaris && cd scholaris
pnpm install
pnpm --filter @scholaris/web build
GEMINI_API_KEY=your-key pnpm --filter @scholaris/local start
```

Open <http://localhost:8790>. Without the web build the server only serves the API. Data goes to `apps/local/datos`; an absolute path is better: `DATA_DIR=/path/to/my-data`. If you'll use it from another device on your network (or behind a domain), also set `PUBLIC_URL=http://your-machine:8790`, because uploads sign absolute URLs. With no other variables it's a single-person instance with no password, meant for your own computer; to put it on a network, set `SCHOLARIS_TOKEN=a-long-token` or, for several people, `SCHOLARIS_USUARIOS="token:id:email:Name;…"`. The remaining variables (port, public URL, keys) are listed at the top of [`apps/local/src/principal.ts`](apps/local/src/principal.ts).

### 2. Docker, one file

```bash
git clone https://github.com/joseluissaorin/scholaris-v2 scholaris && cd scholaris
echo "GEMINI_API_KEY=your-key" > deploy/docker/.env
docker compose -f deploy/docker/compose.yml up -d
```

The first run builds the image (about 2 minutes; 1.3 GB). Open <http://localhost:8790>. Data lives in the `scholaris-datos` volume and survives `down` and `up`. The optional keys, `SCHOLARIS_TOKEN` or `SCHOLARIS_USUARIOS`, and `PUBLIC_URL` also go in `deploy/docker/.env`. Every release also publishes a prebuilt image:

```bash
docker run -d --name scholaris -p 8790:8790 -v scholaris-datos:/data \
  -e GEMINI_API_KEY=your-key ghcr.io/joseluissaorin/scholaris:latest
```

To depend on no cloud at all, see [Offline](#offline) (`compose.sin-conexion.yml`). With an NVIDIA GPU and cloud keys, [InferBox](https://github.com/joseluissaorin/InferBox) is built from its repository and takes vectors, transcription, reranking and writing home (put `INFERBOX_API_KEY` in the `.env`):

```bash
docker compose -f deploy/docker/compose.yml -f deploy/docker/compose.gpu.yml up -d --build
```

### 3. A single desktop executable

Download the one for your system from [Releases](https://github.com/joseluissaorin/scholaris-v2/releases) (macOS Apple Silicon and Intel, Windows, Linux x64 and ARM; 90 to 120 MB), unpack it and run it. It starts the server on <http://localhost:8791> (only reachable from your machine), opens your browser and keeps its data in `~/Scholaris`. Keys go in `~/Scholaris/claves.env`:

```bash
mkdir -p ~/Scholaris && echo "GEMINI_API_KEY=your-key" >> ~/Scholaris/claves.env
```

The executables aren't signed: on macOS open it the first time with right-click → Open (or `xattr -d com.apple.quarantine scholaris-macos-arm64`), and on Windows choose "More info" → "Run anyway". Other variables: `SCHOLARIS_DATOS` (another folder) and `SCHOLARIS_NO_NAVEGADOR=1`.

The executable doesn't bundle Node's native modules. Whatever you upload from the web app is converted in the browser and ends up exactly as in the other versions, but PDFs that arrive through the API are read without page images, and vector search runs without `sqlite-vec` (slower on large libraries). For a server with many documents, use Docker.

To build it yourself (you need [Bun](https://bun.sh)):

```bash
pnpm install && pnpm --filter @scholaris/web build
bun run apps/escritorio/build.ts          # for your system, in apps/escritorio/dist
```

### 4. Cloudflare, one command

For a cloud instance like the hosted one: a Worker with the API and the web app, one Durable Object per person, one Workflow per document, D1, R2, Vectorize, Workers AI and a queue.

You need a Cloudflare account on **Workers Paid** (for the 5 minutes of CPU that ingestion steps use; Workflows, Vectorize and Queues at real volumes need it too), `npx wrangler login`, and a [Clerk](https://clerk.com) application for user accounts (there is no local user in the cloud).

```bash
pnpm install
export CLOUDFLARE_ACCOUNT_ID=your-account
node deploy/cloudflare/bootstrap.mjs --secretos-de my-keys.env
```

`my-keys.env` holds `GEMINI_API_KEY`, `CLERK_PUBLISHABLE_KEY` and any of the optional keys above. The bootstrap is idempotent: it copies [`wrangler.plantilla.jsonc`](deploy/cloudflare/wrangler.plantilla.jsonc) to `wrangler.propio.jsonc` (ignored by git), creates whatever is missing (D1, KV, R2 with CORS, the Vectorize index and its metadata indexes, the queue), fills in the ids, uploads the secrets without printing them, generates its own (`SECRETO`, `CLAVE_MAESTRA`), builds the web app and deploys to `workers.dev`. Running it again updates. The template leaves out two pieces of the hosted instance: the server-side conversion container for Office files and video ([`deploy/contenedor`](deploy/contenedor/LEEME.md); without it, the web app converts in the browser) and invitation emails (they need Email Routing on a domain). `wrangler.jsonc` is the hosted instance's own configuration and won't work for you as it is.

### The hosted instance

<https://scholaris.joseluissaorin.com> is Scholaris already running, with no keys to set up and a free plan. Paying for it is also the best way to keep the open version going.

## Programming against Scholaris

```bash
pip install scholaris-sdk
```

```python
from scholaris.api import Scholaris

s = Scholaris(base="http://localhost:8790")       # or Scholaris("sch_…") against the hosted instance
doc = s.subir("chapter-3.pdf")                    # a URL works too: web page, PDF, YouTube, podcast
for p in s.buscar("the panopticon and the gaze", k=3):
    print(p["cita"], p["texto"][:80])
print(s.citar("Surveillance becomes internalised.")["texto"])
```

The full API guide (REST, MCP and an `llms.txt` for agents) is at `/en/api` on any instance; on the hosted one, <https://scholaris.joseluissaorin.com/en/api>.

## The benchmark

Search, citations and folios are measured against a public, reproducible benchmark: a CC BY paper, a scanned Lope de Vega play and a LibriVox reading of Bécquer, with 66 queries, 2,387 relevance judgments, 19 claims for the auto-citer and 21 folios checked by eye. Today: nDCG@10 0.90, Recall@20 0.95 and **no invented citations**. See [`bench/calidad/RESULTADOS.md`](bench/calidad/RESULTADOS.md) (in Spanish); run it with `GEMINI_API_KEY=… pnpm bench calidad`.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) (in Spanish; issues and pull requests in English are welcome). Questions go to [SUPPORT.md](SUPPORT.md); vulnerabilities to [SECURITY.md](SECURITY.md).

## License

Scholaris is free software under the [European Union Public Licence 1.2](LICENSE) (EUPL-1.2), which is compatible with the GPL, AGPL, MPL and others. CSL styles, fonts and other third-party material keep their own licenses, listed in [NOTICE.md](NOTICE.md).

Made by José Luis Saorín Ferrer, philologist, programmer and artist, in Santa Cruz de Tenerife.
