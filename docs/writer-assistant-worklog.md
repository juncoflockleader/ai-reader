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

### Decisions
- Keep Reader and Writer storage isolated at the database level.
- Use revision-oriented context assembly rather than page/chunk retrieval semantics.
- Start with coach-first assistant mode, then expand to coauthor/curriculum.
- Require edit requests to include `base_revision_id`; use `null` only for the first edit against an empty document.

### Open Questions
- Should Writer conversations/messages remain in writer DB only, or support optional shared account-level chat history later?
- Should `document_revisions.full_text` remain mandatory for every revision, or switch to periodic snapshots + delta chain?
- What is the max accepted edit payload size before forcing chunked edit submission?

### Next Steps
1. Add first-pass `/api/writer/documents/:id/context/update` artifact generation.
2. Implement changed-span detection and impacted-block identification from edit rows.
3. Add context staleness checks for edit count and elapsed time.
4. Start frontend Writer app entry and editor panel once context artifacts have a stable response shape.

### Risks / Notes
- Revision growth could become expensive without pruning or periodic compaction.
- Offset-based edit targeting must be normalized consistently across frontend/editor/backend.
- Suggestion application must guard against stale revision conflicts.
