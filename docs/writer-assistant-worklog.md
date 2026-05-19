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

### Decisions
- Keep Reader and Writer storage isolated at the database level.
- Use revision-oriented context assembly rather than page/chunk retrieval semantics.
- Start with coach-first assistant mode, then expand to coauthor/curriculum.

### Open Questions
- Should Writer conversations/messages remain in writer DB only, or support optional shared account-level chat history later?
- Should `document_revisions.full_text` remain mandatory for every revision, or switch to periodic snapshots + delta chain?
- What is the max accepted edit payload size before forcing chunked edit submission?

### Next Steps
1. Implement writer DB bootstrap and config plumbing.
2. Add `/api/writer/documents` create/fetch endpoints.
3. Add `/api/writer/documents/:id/edits` with atomic revision increment.
4. Add first-pass `/context/update` artifact generation.

### Risks / Notes
- Revision growth could become expensive without pruning or periodic compaction.
- Offset-based edit targeting must be normalized consistently across frontend/editor/backend.
- Suggestion application must guard against stale revision conflicts.
