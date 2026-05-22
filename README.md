# StudyReader AI

A local-first learning suite for reading, writing, algorithm visualization, and distributed-systems exploration.

## Apps

- **AI Reader**: upload PDFs or Markdown, read locally, highlight, take notes, and ask cited AI questions grounded in book context.
- **AI Writer**: draft, revise, inspect context, and work with AI coaching suggestions across document revisions.
- **Algorithm Lab**: step through sorting and traversal algorithms with visual traces, code highlighting, call stacks, and custom instrumented code.
- **Distributed Lab**: visualize and validate distributed algorithm runs with node states, channels, clocks, topologies, faults, recovery modes, random runs, stress tests, saved replays, and invariant diagnostics.

The Distributed Lab North Star and MVP notes live in [`docs/distributed-algorithms-lab.md`](docs/distributed-algorithms-lab.md).

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

## Development Checks

```bash
npm run typecheck
npm run build
npm run test:writer
npm run test:algolab
npm run test:distlab
```

On some macOS setups, if a bundled Node binary cannot load Rollup's native optional dependency, run npm with Homebrew Node first on `PATH`:

```bash
PATH=/opt/homebrew/bin:$PATH npm run build
```

## Run On A Mac Mini

For a home LAN deployment, build the frontend once and run the Express server as the single app process. The server will serve both the API and `dist/frontend`.

```bash
npm install
npm run build

HOST=0.0.0.0 \
PORT=3127 \
NODE_ENV=production \
STUDYREADER_DATA_DIR=/Users/Shared/StudyReader/data \
STUDYREADER_USER=family \
STUDYREADER_PASSWORD='choose-a-shared-password' \
npm run serve
```

Then open the app from another device on the home network:

```text
http://<mac-mini-ip>:3127
```

When `HOST=0.0.0.0`, the server refuses to start unless `STUDYREADER_USER` and `STUDYREADER_PASSWORD` are set. This is intentional because the app stores PDFs, reading history, settings, and LLM API keys locally.

## Public Access With Tailscale Funnel

Tailscale Funnel can publish the local Mac mini service to a public HTTPS URL without router port forwarding. Keep StudyReader bound to localhost, let Tailscale own the public tunnel, and keep the StudyReader shared password enabled.

First run the app locally in production mode:

```bash
npm install
npm run build

HOST=127.0.0.1 \
PORT=3127 \
NODE_ENV=production \
STUDYREADER_PUBLIC=true \
STUDYREADER_DATA_DIR=/Users/Shared/StudyReader/data \
STUDYREADER_USER=family \
STUDYREADER_PASSWORD='shared-password' \
npm run serve
```

Then expose it with Funnel:

```bash
tailscale funnel --bg --https=443 http://127.0.0.1:3127
tailscale funnel status
```

Tailscale Funnel public HTTPS ports are `443`, `8443`, and `10000`. To stop exposing the app:

```bash
tailscale funnel reset
```

Keep the StudyReader `launchd` service separate from Tailscale. StudyReader runs the local app process; Tailscale manages the public tunnel. Anyone who reaches the Funnel URL will see the browser's Basic Auth login prompt, so only share the StudyReader password with invited people.

Useful environment variables:

- `HOST`: listen address. Default is `127.0.0.1`; use `0.0.0.0` for LAN access, but keep `127.0.0.1` for Funnel.
- `PORT`: app port. Default is `3127`.
- `STUDYREADER_PUBLIC`: set to `true` when exposing through a public tunnel.
- `STUDYREADER_DATA_DIR`: data directory. Default is project-local `studyreader-data/`.
- `STUDYREADER_USER` and `STUDYREADER_PASSWORD`: shared Basic Auth credentials.
- `STUDYREADER_UPLOAD_MAX_MB`: PDF upload limit. Default is `512`.

Do not also port-forward this service through your router. Funnel is the public entry point.

### launchd Example

Create `/Users/<you>/Library/LaunchAgents/com.studyreader.ai.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.studyreader.ai</string>

  <key>WorkingDirectory</key>
  <string>/Users/<you>/Documents/ai-reader</string>

  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/npm</string>
    <string>run</string>
    <string>serve</string>
  </array>

  <key>EnvironmentVariables</key>
  <dict>
    <key>HOST</key>
    <string>127.0.0.1</string>
    <key>PORT</key>
    <string>3127</string>
    <key>NODE_ENV</key>
    <string>production</string>
    <key>STUDYREADER_PUBLIC</key>
    <string>true</string>
    <key>STUDYREADER_DATA_DIR</key>
    <string>/Users/Shared/StudyReader/data</string>
    <key>STUDYREADER_USER</key>
    <string>family</string>
    <key>STUDYREADER_PASSWORD</key>
    <string>choose-a-shared-password</string>
  </dict>

  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>/Users/Shared/StudyReader/stdout.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/Shared/StudyReader/stderr.log</string>
</dict>
</plist>
```

Load it:

```bash
mkdir -p /Users/Shared/StudyReader/data
mkdir -p /Users/Shared/StudyReader
launchctl load /Users/<you>/Library/LaunchAgents/com.studyreader.ai.plist
```

If `npm` is installed somewhere else, replace `/usr/local/bin/npm` with the output of `which npm`.

### Moving Or Backing Up Data

Stop the service first, then copy the whole data directory. For the default setup, copy `studyreader-data/`. For the Mac mini setup above, copy `/Users/Shared/StudyReader/data`.

The important files are the SQLite database files (`app.db`, `app.db-wal`, `app.db-shm`) and the `books/` directory. Copy them together while the service is stopped so SQLite's WAL files stay consistent.

## What The MVP Includes

Reader:

- Local PDF and Markdown upload/storage under `studyreader-data/`
- PDF rendering and Markdown reading
- Page-level text extraction with PDF.js
- SQLite metadata storage and FTS5 chunk search
- Project-local JSON artifacts for manifests, pages, and chunks
- Selectable extracted text per page
- Persistent highlights and notes
- Current-page tracking
- Right-panel AI assistant with answer modes
- Context assembly from selected text, current/nearby pages, retrieved chunks, highlights, and chat history
- Provider/model settings and clickable citations that navigate to cited pages

Writer:

- Local document workspace
- Draft/revision management
- Inline suggestions and coaching thread
- Context artifacts for recent changes, outlines, and thesis state

Algorithm Lab:

- Preset algorithm traces for sorting and tree traversal
- Playback, scrubber, timeline, code highlighting, and call-stack visualization
- LLM-assisted instrumentation path for learner code

Distributed Lab:

- Starter protocols: flooding broadcast, max consensus, and echo convergecast
- Topologies: ring, line, star, mesh, and tree
- Synchrony modes, clock modes, data synchronization views, node failures, recovery modes, and channel failures
- Visual node/channel/message state, shared-memory view, validator diagnostics, random runs, stress tests, and saved replays

## Privacy Notes

PDFs, extracted text, highlights, conversations, and settings are stored locally in `studyreader-data/`.

For this MVP, API keys are stored in the local SQLite settings table. The directory is ignored by git, but this is not a production-grade secret store. A later version should use the OS keychain as described in the technical design.

AI requests send only the assembled context packet to the selected provider, not the whole book.
