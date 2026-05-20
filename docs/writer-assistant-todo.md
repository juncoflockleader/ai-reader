# Writer Assistant App TODO

## Milestone 0 — Project Setup
- [x] Add writer app routes namespace under `/api/writer/*`.
- [x] Introduce writer-specific config values (`STUDYWRITER_DATA_DIR`, `STUDYWRITER_DB_PATH`).
- [x] Create writer DB bootstrap service (`getWriterDb`) separate from reader DB.
- [x] Wire writer schema initialization from `src/backend/db/writer.schema.sql`.

## Milestone 1 — Document Core
- [x] Implement `POST /api/writer/documents` (create draft).
- [x] Implement `GET /api/writer/documents/:id` (fetch latest document state).
- [x] Implement document list endpoint with pagination and status filter.
- [x] Add validation rules for title, genre, audience, and target length.

## Milestone 2 — Revision + Edit Tracking
- [x] Implement `POST /api/writer/documents/:id/edits` with operation-level payload validation.
- [x] Persist revision snapshots and increment `revision_number` atomically.
- [x] Maintain `documents.latest_revision_id` pointer.
- [x] Build block reindexing pipeline after edits.

## Milestone 3 — Context Update Engine
- [x] Add `POST /api/writer/documents/:id/context/update` endpoint.
- [x] Implement changed-span detection and impacted-block identification.
- [x] Generate `recent_changes`, `document_outline`, and `thesis_state` artifacts.
- [x] Add staleness policy checks (`stale_after_edit_count`, `stale_after_seconds`).

## Milestone 4 — Assistant and Suggestions
- [x] Implement `POST /api/writer/documents/:id/assist` in coach mode.
- [x] Add suggestion persistence flow with pending/accepted/rejected statuses.
- [x] Implement `POST /api/writer/documents/:id/suggestions/:sid/apply`.
- [x] Implement `POST /api/writer/documents/:id/suggestions/:sid/reject`.

## Milestone 5 — Frontend MVP
- [x] Add Writer app entry in start screen with route/state switch.
- [x] Build document editor panel and basic toolbar actions.
- [x] Integrate assistant panel with writer context + suggestion actions.
- [x] Add revision timeline view (latest 10 revisions).

## Milestone 6 — Quality + Observability
- [x] Add integration tests for document/revision/edit/suggestion endpoints.
- [x] Add schema migration sanity test for writer DB startup.
- [x] Add logging for context assembly latency and token payload size.
- [x] Add failure-mode UX states (context stale, conflict, invalid range edits).

## Backlog
- [ ] Rubric-based scoring by writing genre.
- [ ] Personalized drill generation from recurring weakness patterns.
- [ ] Multi-document project folders and cross-document references.
- [ ] Export to Markdown and DOCX.
