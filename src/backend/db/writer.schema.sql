PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  genre TEXT,
  audience TEXT,
  target_length INTEGER,
  status TEXT NOT NULL DEFAULT 'draft',
  latest_revision_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS document_blocks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  block_index INTEGER NOT NULL,
  block_type TEXT NOT NULL,
  text TEXT NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS document_revisions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL,
  full_text TEXT NOT NULL,
  outline_json TEXT,
  thesis_json TEXT,
  change_summary TEXT,
  parent_revision_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY(parent_revision_id) REFERENCES document_revisions(id) ON DELETE SET NULL,
  UNIQUE(document_id, revision_number)
);

CREATE TABLE IF NOT EXISTS document_edits (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  base_revision_id TEXT,
  result_revision_id TEXT,
  op_type TEXT NOT NULL,
  range_start INTEGER NOT NULL,
  range_end INTEGER NOT NULL,
  inserted_text TEXT NOT NULL,
  deleted_text TEXT NOT NULL,
  block_id TEXT,
  rationale TEXT,
  source TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL,
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY(base_revision_id) REFERENCES document_revisions(id) ON DELETE SET NULL,
  FOREIGN KEY(result_revision_id) REFERENCES document_revisions(id) ON DELETE SET NULL,
  FOREIGN KEY(block_id) REFERENCES document_blocks(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS writer_context_artifacts (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  source_revision_id TEXT NOT NULL,
  computed_at TEXT NOT NULL,
  stale_after_edit_count INTEGER NOT NULL,
  stale_after_seconds INTEGER NOT NULL,
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY(source_revision_id) REFERENCES document_revisions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS writing_goals (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  goal_type TEXT NOT NULL,
  description TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 3,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS writing_profiles (
  id TEXT PRIMARY KEY,
  user_key TEXT NOT NULL,
  strengths_json TEXT,
  weaknesses_json TEXT,
  preferences_json TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  title TEXT,
  mode TEXT NOT NULL DEFAULT 'coach',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  context_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS suggestions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  conversation_id TEXT,
  message_id TEXT,
  suggestion_type TEXT NOT NULL,
  target_start INTEGER NOT NULL,
  target_end INTEGER NOT NULL,
  original_text TEXT NOT NULL,
  suggested_text TEXT NOT NULL,
  explanation TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  resolution_note TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE SET NULL,
  FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_document_blocks_doc ON document_blocks(document_id, block_index);
CREATE INDEX IF NOT EXISTS idx_document_revisions_doc ON document_revisions(document_id, revision_number DESC);
CREATE INDEX IF NOT EXISTS idx_document_edits_doc ON document_edits(document_id, created_at);
CREATE INDEX IF NOT EXISTS idx_writer_context_artifacts_doc_type ON writer_context_artifacts(document_id, artifact_type, computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_doc ON conversations(document_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_suggestions_doc_status ON suggestions(document_id, status, created_at);
