# StudyReader AI

A local-first AI textbook reader built from the PRD and technical design in this repo.

## Run Locally

Requires Node.js 22.5 or newer. The app uses Node's built-in SQLite module to avoid native SQLite addon compilation.

```bash
npm install
npm start
```

Then open:

```text
http://127.0.0.1:5173
```

The API server runs at `http://127.0.0.1:3127`.

## What The MVP Includes

- Local PDF upload and storage under `studyreader-data/`
- PDF rendering in the left reading panel
- Page-level text extraction with PDF.js
- SQLite metadata storage and FTS5 chunk search
- Project-local JSON artifacts for manifests, pages, and chunks
- Selectable extracted text per page
- Persistent highlights
- Current-page tracking
- Right-panel AI assistant with answer modes
- Context assembly from selected text, current/nearby pages, retrieved chunks, highlights, and chat history
- OpenAI and Anthropic provider abstraction
- Settings UI for provider, model, and API key
- Clickable citations that navigate the reader to a cited page

## Privacy Notes

PDFs, extracted text, highlights, conversations, and settings are stored locally in `studyreader-data/`.

For this MVP, API keys are stored in the local SQLite settings table. The directory is ignored by git, but this is not a production-grade secret store. A later version should use the OS keychain as described in the technical design.

AI requests send only the assembled context packet to the selected provider, not the whole book.
