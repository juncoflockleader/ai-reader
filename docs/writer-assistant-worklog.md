# Writer Assistant App Worklog

## 2026-05-19

### Completed
- Established initial Writer data layer artifacts:
  - `src/backend/db/writer.schema.sql`
  - `src/backend/services/writer/types.ts`
- Confirmed architectural direction: Reader and Writer must use separate databases.
- Drafted implementation plan for a Writer vertical slice:
  - document CRUD
  - edit/revision tracking
  - incremental context updates
  - assistant suggestion lifecycle.
- Completed Milestone 2 backend edit/revision flow:
  - `POST /api/writer/documents/:id/edits` accepts validated insert/delete/replace operations.
  - Edit submission writes a single revision snapshot, audit edit rows, document latest pointer, and rebuilt document blocks inside one transaction.
  - `GET /api/writer/documents/:id` now returns ordered `blocks` with the latest revision state.
- Completed Milestone 3 context update flow:
  - Added `writer_context_artifacts` storage for revision-sourced artifacts with edit-count and age staleness policy fields.
  - Added `POST /api/writer/documents/:id/context/update` for `recent_changes`, `document_outline`, and `thesis_state`.
  - Context updates detect revision-level changed spans, identify impacted current blocks, reuse fresh artifacts, and support forced regeneration.
- Completed Milestone 4 assistant and suggestion flow:
  - Added `POST /api/writer/documents/:id/assist` in coach mode with generated context artifacts, persisted writer conversations/messages, configured LLM support, and a local heuristic fallback when no API key is available.
  - Assistant responses can persist pending suggestions with exact document ranges and replacement text.
  - Added apply/reject suggestion lifecycle endpoints; apply creates a guarded revision edit, reject records resolution metadata.
- Completed Milestone 5 frontend MVP:
  - Added a Writer entry to the start screen and a persistent Reader/Writer app switch in the top bar.
  - Added a Writer workspace with document creation/listing, editor save-to-revision flow, context refresh, and document metrics.
  - Added coach UI, pending suggestion apply/reject actions, and a latest-10 revision timeline with preview.
- Completed Milestone 6 quality and observability:
  - Added a dependency-free writer integration test script covering document creation, revision edits, context update, local coach assist, suggestion apply/reject, stale-base conflicts, and invalid range edits.
  - Added a writer schema startup sanity check that verifies new context artifact tables/columns appear for an existing writer DB.
  - Added structured context assembly logs with latency, artifact counts, generated/reused artifact types, payload bytes, and estimated token count.
  - Added Writer workspace failure states for stale context/suggestions, revision conflicts, and invalid edit ranges.

### Decisions
- Keep Reader and Writer storage isolated at the database level.
- Use revision-oriented context assembly rather than page/chunk retrieval semantics.
- Start with coach-first assistant mode, then expand to coauthor/curriculum.
- Require edit requests to include `base_revision_id`; use `null` only for the first edit against an empty document.
- Keep first-pass context generation deterministic and local; LLM-backed refinement can layer on later without changing artifact storage.
- Coach assist should stay useful without network/API keys by falling back to deterministic local coaching, while using configured LLM providers when keys are present.
- Writer quality tests should stay dependency-free until the project adopts a broader test runner.

### Open Questions
- Should Writer conversations/messages remain in writer DB only, or support optional shared account-level chat history later?
- Should `document_revisions.full_text` remain mandatory for every revision, or switch to periodic snapshots + delta chain?
- What is the max accepted edit payload size before forcing chunked edit submission?
- Should context assembly metrics eventually flow to a persistent audit table or external telemetry sink?

### Next Steps
1. Expand the Writer test harness with frontend-driven failure-state checks.
2. Add export flows for Markdown and DOCX.
3. Prototype rubric-based scoring by genre.
4. Consider periodic revision compaction once drafts become large.

### Risks / Notes
- Revision growth could become expensive without pruning or periodic compaction.
- Offset-based edit targeting must be normalized consistently across frontend/editor/backend.
- Suggestion application must guard against stale revision conflicts.
