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
- [ ] Implement `POST /api/writer/documents/:id/edits` with operation-level payload validation.
- [ ] Persist revision snapshots and increment `revision_number` atomically.
- [ ] Maintain `documents.latest_revision_id` pointer.
- [ ] Build block reindexing pipeline after edits.

## Milestone 3 — Context Update Engine
- [ ] Add `POST /api/writer/documents/:id/context/update` endpoint.
- [ ] Implement changed-span detection and impacted-block identification.
- [ ] Generate `recent_changes`, `document_outline`, and `thesis_state` artifacts.
- [ ] Add staleness policy checks (`stale_after_edit_count`, `stale_after_seconds`).

## Milestone 4 — Assistant and Suggestions
- [ ] Implement `POST /api/writer/documents/:id/assist` in coach mode.
- [ ] Add suggestion persistence flow with pending/accepted/rejected statuses.
- [ ] Implement `POST /api/writer/documents/:id/suggestions/:sid/apply`.
- [ ] Implement `POST /api/writer/documents/:id/suggestions/:sid/reject`.

## Milestone 5 — Frontend MVP
- [ ] Add Writer app entry in start screen with route/state switch.
- [ ] Build document editor panel and basic toolbar actions.
- [ ] Integrate assistant panel with writer context + suggestion actions.
- [ ] Add revision timeline view (latest 10 revisions).

## Milestone 6 — Quality + Observability
- [ ] Add integration tests for document/revision/edit/suggestion endpoints.
- [ ] Add schema migration sanity test for writer DB startup.
- [ ] Add logging for context assembly latency and token payload size.
- [ ] Add failure-mode UX states (context stale, conflict, invalid range edits).

## Backlog
- [ ] Rubric-based scoring by writing genre.
- [ ] Personalized drill generation from recurring weakness patterns.
- [ ] Multi-document project folders and cross-document references.
- [ ] Export to Markdown and DOCX.
