import { Router } from "express";
import type { DatabaseSync } from "node:sqlite";
import { getProvider, normalizeModel } from "../services/llm";
import { getWriterDb } from "../services/writer/db";
import { id, json, nowIso, parseJson } from "../services/storage/db";
import { getApiKey, getAppSettings } from "./settings";

const writerRouter = Router();

const MAX_TITLE_LENGTH = 200;
const MAX_GENRE_LENGTH = 80;
const MAX_AUDIENCE_LENGTH = 120;
const MAX_TARGET_LENGTH = 1_000_000;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const MAX_EDIT_OPERATIONS = 100;
const MAX_INSERTED_TEXT_LENGTH = 1_000_000;
const MAX_CHANGE_SUMMARY_LENGTH = 1_000;
const MAX_RATIONALE_LENGTH = 2_000;
const MAX_CONTEXT_ARTIFACT_TYPES = 3;
const CONTEXT_PREVIEW_LENGTH = 240;
const OUTLINE_NODE_LIMIT = 80;
const RECENT_EDIT_LIMIT = 20;
const MAX_ASSIST_PROMPT_LENGTH = 4_000;
const DEFAULT_MAX_SUGGESTIONS = 4;
const MAX_ASSIST_SUGGESTIONS = 8;
const MAX_RESOLUTION_NOTE_LENGTH = 1_000;
const ASSIST_DOCUMENT_CONTEXT_LIMIT = 12_000;

const CONTEXT_ARTIFACT_TYPES = ["recent_changes", "document_outline", "thesis_state"] as const;
const SUGGESTION_TYPES = ["clarity", "grammar", "tone", "structure", "argument"] as const;
const CONTEXT_ARTIFACT_POLICIES: Record<WriterContextArtifactType, { staleAfterEditCount: number; staleAfterSeconds: number }> = {
  recent_changes: { staleAfterEditCount: 1, staleAfterSeconds: 10 * 60 },
  document_outline: { staleAfterEditCount: 5, staleAfterSeconds: 60 * 60 },
  thesis_state: { staleAfterEditCount: 3, staleAfterSeconds: 60 * 60 }
};

type ProviderId = "openai" | "anthropic";

type DocumentRow = {
  id: string;
  title: string;
  genre: string | null;
  audience: string | null;
  target_length: number | null;
  status: string;
  latest_revision_id: string | null;
  created_at: string;
  updated_at: string;
};

type RevisionRow = {
  id: string;
  document_id: string;
  revision_number: number;
  full_text: string;
  outline_json: string | null;
  thesis_json: string | null;
  change_summary: string | null;
  parent_revision_id: string | null;
  created_at: string;
};

type DocumentBlockType = "heading" | "paragraph" | "list_item" | "quote" | "code";
type EditOperationType = "insert" | "delete" | "replace";
type EditSource = "user" | "assistant" | "system";
type WriterContextArtifactType = (typeof CONTEXT_ARTIFACT_TYPES)[number];
type SuggestionType = (typeof SUGGESTION_TYPES)[number];
type SuggestionStatus = "pending" | "accepted" | "rejected";
type AssistProvider = ProviderId | "local";

type EditOperation = {
  opType: EditOperationType;
  rangeStart: number;
  rangeEnd: number;
  insertedText: string;
  rationale: string | null;
  source: EditSource;
};

type PersistedEditRow = {
  id: string;
  document_id: string;
  base_revision_id: string | null;
  result_revision_id: string;
  op_type: EditOperationType;
  range_start: number;
  range_end: number;
  inserted_text: string;
  deleted_text: string;
  block_id: string | null;
  rationale: string | null;
  source: EditSource;
  created_at: string;
};

type DocumentEditRow = PersistedEditRow;

type DocumentBlockRow = {
  id: string;
  document_id: string;
  block_index: number;
  block_type: DocumentBlockType;
  text: string;
  start_offset: number;
  end_offset: number;
  created_at: string;
  updated_at: string;
};

type ContextArtifactRow = {
  id: string;
  document_id: string;
  artifact_type: WriterContextArtifactType;
  payload_json: string;
  source_revision_id: string;
  computed_at: string;
  stale_after_edit_count: number;
  stale_after_seconds: number;
};

type ContextUpdateRequest = {
  artifactTypes: WriterContextArtifactType[];
  force: boolean;
  staleAfterEditCount: number | null;
  staleAfterSeconds: number | null;
};

type AssistRequest = {
  prompt: string;
  mode: "coach";
  conversationId: string | null;
  baseRevisionId: string | null | undefined;
  providerId: ProviderId | null;
  model: string | null;
  useLlm: boolean | null;
  forceContextUpdate: boolean;
  maxSuggestions: number;
};

type ChangedSpan = {
  previous_start: number;
  previous_end: number;
  current_start: number;
  current_end: number;
  deleted_length: number;
  inserted_length: number;
  deleted_text_preview: string;
  inserted_text_preview: string;
};

type ArtifactStaleness = {
  stale: boolean;
  reason: "missing" | "force" | "edit_count" | "age" | "fresh";
  edit_count_since_artifact: number;
  age_seconds: number | null;
  latest_revision_id: string;
  source_revision_id: string | null;
  stale_after_edit_count: number;
  stale_after_seconds: number;
};

type ContextBuildState = {
  document: DocumentRow;
  latestRevision: RevisionRow;
  parentRevision: RevisionRow | null;
  blocks: DocumentBlockRow[];
  latestRevisionEdits: DocumentEditRow[];
  changedSpan: ChangedSpan;
  impactedBlocks: DocumentBlockRow[];
};

type ConversationRow = {
  id: string;
  document_id: string;
  title: string | null;
  mode: string;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  context_json: string | null;
  created_at: string;
};

type SuggestionRow = {
  id: string;
  document_id: string;
  conversation_id: string | null;
  message_id: string | null;
  suggestion_type: SuggestionType;
  target_start: number;
  target_end: number;
  original_text: string;
  suggested_text: string;
  explanation: string | null;
  status: SuggestionStatus;
  resolution_note: string | null;
  created_at: string;
  resolved_at: string | null;
};

type SuggestionDraft = {
  suggestionType: SuggestionType;
  targetStart: number;
  targetEnd: number;
  originalText: string;
  suggestedText: string;
  explanation: string | null;
};

type CoachResult = {
  answer: string;
  provider: AssistProvider;
  model: string;
  rawContent: string | null;
  suggestions: SuggestionDraft[];
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
};

type ContextArtifactResponse = ReturnType<typeof formatContextArtifact>;
type HttpError = Error & { status: number };

writerRouter.post("/documents", (req, res) => {
  const title = normalizeBoundedString(req.body?.title, MAX_TITLE_LENGTH);
  if (!title) {
    res.status(400).json({ error: "title is required and must be a non-empty string up to 200 characters." });
    return;
  }

  const genre = normalizeOptionalBoundedString(req.body?.genre, MAX_GENRE_LENGTH, "genre");
  if (genre.error) {
    res.status(400).json({ error: genre.error });
    return;
  }

  const audience = normalizeOptionalBoundedString(req.body?.audience, MAX_AUDIENCE_LENGTH, "audience");
  if (audience.error) {
    res.status(400).json({ error: audience.error });
    return;
  }

  const targetLength = normalizeTargetLength(req.body?.target_length);
  if (targetLength.error) {
    res.status(400).json({ error: targetLength.error });
    return;
  }

  const normalizedGenre = genre.value ?? null;
  const normalizedAudience = audience.value ?? null;
  const normalizedTargetLength = targetLength.value ?? null;

  const db = getWriterDb();
  const documentId = id("doc");
  const createdAt = nowIso();

  db.prepare(
    `INSERT INTO documents (id, title, genre, audience, target_length, status, latest_revision_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'draft', NULL, ?, ?)`
  ).run(documentId, title, normalizedGenre, normalizedAudience, normalizedTargetLength, createdAt, createdAt);

  const document = fetchDocumentById(documentId);
  res.status(201).json({ document });
});

writerRouter.post("/documents/:id/edits", (req, res, next) => {
  try {
    if (!isRecord(req.body)) {
      throw createHttpError(400, "Request body must be a JSON object.");
    }

    const source = normalizeEditSource(req.body.source, "source", "user");
    const baseRevisionId = normalizeBaseRevisionId(
      readAliasedField(req.body, "base_revision_id", "baseRevisionId"),
      "base_revision_id"
    );
    const changeSummary = normalizeOptionalBoundedField(
      req.body.change_summary ?? req.body.changeSummary,
      MAX_CHANGE_SUMMARY_LENGTH,
      "change_summary"
    );
    const operations = normalizeEditOperations(req.body.operations, source);

    const db = getWriterDb();
    let transactionOpen = false;
    try {
      db.exec("BEGIN IMMEDIATE");
      transactionOpen = true;

      const document = fetchDocumentById(req.params.id, db);
      if (!document) {
        throw createHttpError(404, "Document not found.");
      }

      const latestRevision = fetchLatestRevision(document, db);
      const latestRevisionId = latestRevision?.id ?? null;
      if (baseRevisionId !== latestRevisionId) {
        throw createHttpError(409, "base_revision_id does not match the document's latest revision.");
      }

      const baseText = latestRevision?.full_text ?? "";
      const applied = applyEditOperations(baseText, operations);
      const createdAt = nowIso();
      const revisionId = id("rev");
      const revisionNumber = (latestRevision?.revision_number ?? 0) + 1;
      const summary = changeSummary ?? defaultChangeSummary(operations.length);

      db.prepare(
        `INSERT INTO document_revisions
          (id, document_id, revision_number, full_text, outline_json, thesis_json, change_summary, parent_revision_id, created_at)
         VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?)`
      ).run(revisionId, document.id, revisionNumber, applied.fullText, summary, latestRevisionId, createdAt);

      const persistedEdits = persistDocumentEdits(db, {
        documentId: document.id,
        baseRevisionId: latestRevisionId,
        resultRevisionId: revisionId,
        operations: applied.edits,
        createdAt
      });
      const blocks = reindexDocumentBlocks(db, document.id, applied.fullText, createdAt);

      db.prepare("UPDATE documents SET latest_revision_id = ?, updated_at = ? WHERE id = ?").run(
        revisionId,
        createdAt,
        document.id
      );

      const updatedDocument = fetchDocumentById(document.id, db);
      const revision = fetchRevisionById(revisionId, db);
      db.exec("COMMIT");
      transactionOpen = false;

      res.status(201).json({
        document: updatedDocument,
        base_revision: latestRevision ?? null,
        latest_revision: revision,
        edits: persistedEdits,
        blocks
      });
    } catch (error) {
      if (transactionOpen) {
        try {
          db.exec("ROLLBACK");
        } catch {}
      }
      throw error;
    }
  } catch (error) {
    if (isHttpError(error)) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    next(error);
  }
});

writerRouter.post("/documents/:id/assist", async (req, res, next) => {
  try {
    const contextStartedAtMs = Date.now();
    const request = normalizeAssistRequest(req.body);
    const db = getWriterDb();
    const computedAt = nowIso();
    let document: DocumentRow;
    let latestRevision: RevisionRow;
    let contextUpdate: ReturnType<typeof updateContextArtifacts>;
    let conversation: ConversationRow;
    let userMessageId: string;

    let transactionOpen = false;
    try {
      db.exec("BEGIN IMMEDIATE");
      transactionOpen = true;

      const fetchedDocument = fetchDocumentById(req.params.id, db);
      if (!fetchedDocument) {
        throw createHttpError(404, "Document not found.");
      }

      const fetchedLatestRevision = fetchLatestRevision(fetchedDocument, db);
      if (!fetchedLatestRevision) {
        throw createHttpError(409, "Document has no revision to assist with.");
      }

      if (request.baseRevisionId !== undefined && request.baseRevisionId !== fetchedLatestRevision.id) {
        throw createHttpError(409, "base_revision_id does not match the document's latest revision.");
      }

      document = fetchedDocument;
      contextUpdate = updateContextArtifacts(db, {
        document,
        latestRevision: fetchedLatestRevision,
        request: {
          artifactTypes: [...CONTEXT_ARTIFACT_TYPES],
          force: request.forceContextUpdate,
          staleAfterEditCount: null,
          staleAfterSeconds: null
        },
        computedAt
      });
      latestRevision = contextUpdate.latestRevision;
      conversation = resolveWriterConversation(db, document.id, request);
      userMessageId = saveWriterMessage(db, {
        conversationId: conversation.id,
        role: "user",
        content: request.prompt,
        context: null,
        createdAt: computedAt
      }).id;

      db.exec("COMMIT");
      transactionOpen = false;
    } catch (error) {
      if (transactionOpen) {
        try {
          db.exec("ROLLBACK");
        } catch {}
      }
      throw error;
    }

    logContextAssemblyMetrics({
      phase: "assist",
      documentId: document.id,
      revisionId: latestRevision.id,
      startedAtMs: contextStartedAtMs,
      artifacts: contextUpdate.artifacts,
      generatedArtifactTypes: contextUpdate.generatedArtifactTypes,
      reusedArtifactTypes: contextUpdate.reusedArtifactTypes
    });

    const coachResult = await generateCoachResult({
      request,
      document,
      latestRevision,
      artifacts: contextUpdate.artifacts,
      buildState: contextUpdate.buildState
    });

    const persistedAt = nowIso();
    let responseConversation: ConversationRow;
    let assistantMessage: MessageRow;
    let suggestions: SuggestionRow[];
    const assistantContext = {
      mode: request.mode,
      provider: coachResult.provider,
      model: coachResult.model,
      document_id: document.id,
      revision_id: latestRevision.id,
      context_artifact_types: contextUpdate.artifacts.map((artifact) => artifact.artifact_type),
      generated_artifact_types: contextUpdate.generatedArtifactTypes,
      reused_artifact_types: contextUpdate.reusedArtifactTypes,
      suggestion_count: coachResult.suggestions.length
    };

    transactionOpen = false;
    try {
      db.exec("BEGIN IMMEDIATE");
      transactionOpen = true;

      responseConversation = fetchWriterConversation(conversation.id, db) ?? conversation;
      assistantMessage = saveWriterMessage(db, {
        conversationId: responseConversation.id,
        role: "assistant",
        content: coachResult.answer,
        context: assistantContext,
        createdAt: persistedAt
      });
      suggestions = persistSuggestions(db, {
        documentId: document.id,
        conversationId: responseConversation.id,
        messageId: assistantMessage.id,
        drafts: coachResult.suggestions,
        createdAt: persistedAt
      });

      db.exec("COMMIT");
      transactionOpen = false;
    } catch (error) {
      if (transactionOpen) {
        try {
          db.exec("ROLLBACK");
        } catch {}
      }
      throw error;
    }

    res.status(201).json({
      document,
      latest_revision: latestRevision,
      conversation_id: responseConversation.id,
      user_message_id: userMessageId,
      assistant_message_id: assistantMessage.id,
      answer: coachResult.answer,
      provider: coachResult.provider,
      model: coachResult.model,
      usage: coachResult.usage ?? null,
      suggestions: suggestions.map(formatSuggestion),
      context_used: assistantContext,
      context_artifacts: contextUpdate.artifacts
    });
  } catch (error) {
    if (isHttpError(error)) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    next(error);
  }
});

writerRouter.post("/documents/:id/context/update", (req, res, next) => {
  try {
    const contextStartedAtMs = Date.now();
    const request = normalizeContextUpdateRequest(req.body);
    const db = getWriterDb();
    const computedAt = nowIso();
    let transactionOpen = false;

    try {
      db.exec("BEGIN IMMEDIATE");
      transactionOpen = true;

      const document = fetchDocumentById(req.params.id, db);
      if (!document) {
        throw createHttpError(404, "Document not found.");
      }

      const latestRevision = fetchLatestRevision(document, db);
      if (!latestRevision) {
        throw createHttpError(409, "Document has no revision to build context from.");
      }

      const contextUpdate = updateContextArtifacts(db, { document, latestRevision, request, computedAt });
      db.exec("COMMIT");
      transactionOpen = false;

      logContextAssemblyMetrics({
        phase: "context_update",
        documentId: document.id,
        revisionId: contextUpdate.latestRevision.id,
        startedAtMs: contextStartedAtMs,
        artifacts: contextUpdate.artifacts,
        generatedArtifactTypes: contextUpdate.generatedArtifactTypes,
        reusedArtifactTypes: contextUpdate.reusedArtifactTypes
      });

      res.status(201).json({
        document,
        latest_revision: contextUpdate.latestRevision,
        artifacts: contextUpdate.artifacts,
        generated_artifact_types: contextUpdate.generatedArtifactTypes,
        reused_artifact_types: contextUpdate.reusedArtifactTypes
      });
    } catch (error) {
      if (transactionOpen) {
        try {
          db.exec("ROLLBACK");
        } catch {}
      }
      throw error;
    }
  } catch (error) {
    if (isHttpError(error)) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    next(error);
  }
});

writerRouter.post("/documents/:id/suggestions/:sid/apply", (req, res, next) => {
  try {
    if (!isRecord(req.body)) {
      throw createHttpError(400, "Request body must be a JSON object.");
    }

    const baseRevisionId = normalizeBaseRevisionId(
      readAliasedField(req.body, "base_revision_id", "baseRevisionId"),
      "base_revision_id"
    );
    const resolutionNote = normalizeOptionalBoundedField(
      req.body.resolution_note ?? req.body.resolutionNote,
      MAX_RESOLUTION_NOTE_LENGTH,
      "resolution_note"
    );
    const db = getWriterDb();
    const appliedAt = nowIso();
    let transactionOpen = false;

    try {
      db.exec("BEGIN IMMEDIATE");
      transactionOpen = true;

      const document = fetchDocumentById(req.params.id, db);
      if (!document) {
        throw createHttpError(404, "Document not found.");
      }

      const latestRevision = fetchLatestRevision(document, db);
      if (!latestRevision) {
        throw createHttpError(409, "Document has no revision to apply suggestions to.");
      }
      if (baseRevisionId !== latestRevision.id) {
        throw createHttpError(409, "base_revision_id does not match the document's latest revision.");
      }

      const suggestion = fetchSuggestionById(db, document.id, req.params.sid);
      if (!suggestion) {
        throw createHttpError(404, "Suggestion not found.");
      }
      if (suggestion.status !== "pending") {
        throw createHttpError(409, `Suggestion is already ${suggestion.status}.`);
      }
      if (latestRevision.full_text.slice(suggestion.target_start, suggestion.target_end) !== suggestion.original_text) {
        throw createHttpError(409, "Suggestion target no longer matches the latest revision.");
      }

      const result = createRevisionFromOperations(db, {
        document,
        latestRevision,
        operations: [
          {
            opType: "replace",
            rangeStart: suggestion.target_start,
            rangeEnd: suggestion.target_end,
            insertedText: suggestion.suggested_text,
            rationale: suggestion.explanation,
            source: "assistant"
          }
        ],
        changeSummary: `Applied suggestion ${suggestion.id}.`,
        createdAt: appliedAt
      });

      db.prepare(
        `UPDATE suggestions
         SET status = 'accepted', resolution_note = ?, resolved_at = ?
         WHERE id = ?`
      ).run(resolutionNote, appliedAt, suggestion.id);

      const updatedSuggestion = fetchSuggestionById(db, document.id, suggestion.id);
      db.exec("COMMIT");
      transactionOpen = false;

      res.status(201).json({
        ...result,
        suggestion: updatedSuggestion ? formatSuggestion(updatedSuggestion) : null
      });
    } catch (error) {
      if (transactionOpen) {
        try {
          db.exec("ROLLBACK");
        } catch {}
      }
      throw error;
    }
  } catch (error) {
    if (isHttpError(error)) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    next(error);
  }
});

writerRouter.post("/documents/:id/suggestions/:sid/reject", (req, res, next) => {
  try {
    if (req.body !== undefined && req.body !== null && !isRecord(req.body)) {
      throw createHttpError(400, "Request body must be a JSON object when provided.");
    }

    const body = isRecord(req.body) ? req.body : {};
    const resolutionNote = normalizeOptionalBoundedField(
      body.resolution_note ?? body.resolutionNote,
      MAX_RESOLUTION_NOTE_LENGTH,
      "resolution_note"
    );
    const db = getWriterDb();
    const rejectedAt = nowIso();
    let transactionOpen = false;

    try {
      db.exec("BEGIN IMMEDIATE");
      transactionOpen = true;

      const document = fetchDocumentById(req.params.id, db);
      if (!document) {
        throw createHttpError(404, "Document not found.");
      }

      const suggestion = fetchSuggestionById(db, document.id, req.params.sid);
      if (!suggestion) {
        throw createHttpError(404, "Suggestion not found.");
      }
      if (suggestion.status !== "pending") {
        throw createHttpError(409, `Suggestion is already ${suggestion.status}.`);
      }

      db.prepare(
        `UPDATE suggestions
         SET status = 'rejected', resolution_note = ?, resolved_at = ?
         WHERE id = ?`
      ).run(resolutionNote, rejectedAt, suggestion.id);

      const updatedSuggestion = fetchSuggestionById(db, document.id, suggestion.id);
      db.exec("COMMIT");
      transactionOpen = false;

      res.json({ suggestion: updatedSuggestion ? formatSuggestion(updatedSuggestion) : null });
    } catch (error) {
      if (transactionOpen) {
        try {
          db.exec("ROLLBACK");
        } catch {}
      }
      throw error;
    }
  } catch (error) {
    if (isHttpError(error)) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    next(error);
  }
});

writerRouter.get("/documents/:id", (req, res) => {
  const db = getWriterDb();
  const document = fetchDocumentById(req.params.id, db);
  if (!document) {
    res.status(404).json({ error: "Document not found." });
    return;
  }

  const latestRevision = document.latest_revision_id
    ? db.prepare("SELECT * FROM document_revisions WHERE id = ?").get(document.latest_revision_id)
    : null;
  const blocks = fetchDocumentBlocks(document.id, db);

  res.json({ document, latest_revision: latestRevision ?? null, blocks });
});

writerRouter.get("/documents/:id/revisions", (req, res) => {
  const limit = normalizeListLimit(req.query.limit, 10, 50);
  const db = getWriterDb();
  const document = fetchDocumentById(req.params.id, db);
  if (!document) {
    res.status(404).json({ error: "Document not found." });
    return;
  }

  const revisions = db
    .prepare("SELECT * FROM document_revisions WHERE document_id = ? ORDER BY revision_number DESC LIMIT ?")
    .all(document.id, limit);
  res.json({ document, revisions });
});

writerRouter.get("/documents/:id/suggestions", (req, res) => {
  const status = normalizeOptionalSuggestionStatus(req.query.status);
  if (status.error) {
    res.status(400).json({ error: status.error });
    return;
  }

  const limit = normalizeListLimit(req.query.limit, 50, 200);
  const db = getWriterDb();
  const document = fetchDocumentById(req.params.id, db);
  if (!document) {
    res.status(404).json({ error: "Document not found." });
    return;
  }

  const whereClause = status.value ? "WHERE document_id = ? AND status = ?" : "WHERE document_id = ?";
  const params: Array<string | number> = status.value ? [document.id, status.value, limit] : [document.id, limit];
  const suggestions = db
    .prepare(`SELECT * FROM suggestions ${whereClause} ORDER BY created_at DESC LIMIT ?`)
    .all(...params) as SuggestionRow[];
  res.json({ document, suggestions: suggestions.map(formatSuggestion) });
});

writerRouter.get("/documents", (req, res) => {
  const status = normalizeOptionalStatus(req.query.status);
  if (status.error) {
    res.status(400).json({ error: status.error });
    return;
  }

  const page = normalizePage(req.query.page);
  const pageSize = normalizePageSize(req.query.page_size);
  const offset = (page - 1) * pageSize;

  const db = getWriterDb();
  const whereClause = status.value ? "WHERE status = ?" : "";
  const params: Array<string | number> = [];
  if (status.value) params.push(status.value);

  const totalRow = db.prepare(`SELECT COUNT(*) AS count FROM documents ${whereClause}`).get(...params) as { count: number };
  const documents = db
    .prepare(`SELECT * FROM documents ${whereClause} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, offset);

  res.json({
    documents,
    pagination: {
      page,
      page_size: pageSize,
      total: totalRow.count
    },
    filters: {
      status: status.value ?? null
    }
  });
});

function fetchDocumentById(documentId: string, db = getWriterDb()) {
  return db.prepare("SELECT * FROM documents WHERE id = ?").get(documentId) as DocumentRow | undefined;
}

function fetchLatestRevision(document: DocumentRow, db: DatabaseSync) {
  if (!document.latest_revision_id) return null;
  const revision = fetchRevisionById(document.latest_revision_id, db);
  if (!revision) {
    throw new Error(`Document ${document.id} points to missing latest revision ${document.latest_revision_id}.`);
  }
  return revision;
}

function fetchRevisionById(revisionId: string, db: DatabaseSync) {
  return db.prepare("SELECT * FROM document_revisions WHERE id = ?").get(revisionId) as RevisionRow | undefined;
}

function fetchDocumentBlocks(documentId: string, db: DatabaseSync) {
  return db
    .prepare("SELECT * FROM document_blocks WHERE document_id = ? ORDER BY block_index ASC")
    .all(documentId) as DocumentBlockRow[];
}

function normalizeAssistRequest(value: unknown): AssistRequest {
  const body = value === undefined || value === null ? {} : value;
  if (!isRecord(body)) {
    throw createHttpError(400, "Request body must be a JSON object when provided.");
  }

  const prompt = normalizeOptionalBoundedField(body.prompt, MAX_ASSIST_PROMPT_LENGTH, "prompt") ?? "Review the latest draft.";
  const mode = body.mode === undefined || body.mode === null || body.mode === "coach" ? "coach" : null;
  if (!mode) {
    throw createHttpError(400, "mode must be coach.");
  }

  return {
    prompt,
    mode,
    conversationId: normalizeOptionalStringId(body.conversation_id ?? body.conversationId, "conversation_id"),
    baseRevisionId: normalizeAssistBaseRevisionId(body.base_revision_id ?? body.baseRevisionId, "base_revision_id"),
    providerId: normalizeOptionalProviderId(body.provider),
    model: normalizeOptionalBoundedField(body.model, 120, "model"),
    useLlm: normalizeOptionalBoolean(body.use_llm ?? body.useLlm, "use_llm"),
    forceContextUpdate: normalizeOptionalBoolean(body.force_context_update ?? body.forceContextUpdate, "force_context_update") ?? false,
    maxSuggestions: normalizeMaxSuggestions(body.max_suggestions ?? body.maxSuggestions)
  };
}

function normalizeOptionalStringId(value: unknown, fieldName: string) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw createHttpError(400, `${fieldName} must be a string.`);
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeAssistBaseRevisionId(value: unknown, fieldName: string) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") {
    throw createHttpError(400, `${fieldName} must be a string when provided.`);
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeOptionalProviderId(value: unknown): ProviderId | null {
  if (value === undefined || value === null || value === "") return null;
  if (value === "openai" || value === "anthropic") return value;
  throw createHttpError(400, "provider must be one of: openai, anthropic.");
}

function normalizeMaxSuggestions(value: unknown) {
  if (value === undefined || value === null || value === "") return DEFAULT_MAX_SUGGESTIONS;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_ASSIST_SUGGESTIONS) {
    throw createHttpError(400, `max_suggestions must be an integer between 0 and ${MAX_ASSIST_SUGGESTIONS}.`);
  }
  return value;
}

function updateContextArtifacts(
  db: DatabaseSync,
  input: {
    document: DocumentRow;
    latestRevision: RevisionRow;
    request: ContextUpdateRequest;
    computedAt: string;
  }
) {
  const buildState = createContextBuildState(db, input.document, input.latestRevision);
  const artifacts = [];
  const generatedArtifactTypes: WriterContextArtifactType[] = [];
  const reusedArtifactTypes: WriterContextArtifactType[] = [];

  for (const artifactType of input.request.artifactTypes) {
    const existingArtifact = fetchLatestContextArtifact(db, input.document.id, artifactType);
    const policy = resolveArtifactPolicy(artifactType, input.request, existingArtifact);
    const staleness = evaluateArtifactStaleness(db, {
      artifact: existingArtifact,
      documentId: input.document.id,
      latestRevision: input.latestRevision,
      policy,
      force: input.request.force,
      now: input.computedAt
    });

    if (!existingArtifact || staleness.stale) {
      const payload = buildContextArtifactPayload(artifactType, buildState);
      const artifact = persistContextArtifact(db, {
        documentId: input.document.id,
        artifactType,
        payload,
        sourceRevisionId: input.latestRevision.id,
        computedAt: input.computedAt,
        staleAfterEditCount: policy.staleAfterEditCount,
        staleAfterSeconds: policy.staleAfterSeconds
      });
      artifacts.push(formatContextArtifact(artifact, createFreshArtifactStaleness(artifact, input.latestRevision), staleness.reason));
      generatedArtifactTypes.push(artifactType);
      continue;
    }

    artifacts.push(formatContextArtifact(existingArtifact, staleness, null));
    reusedArtifactTypes.push(artifactType);
  }

  return {
    latestRevision: fetchRevisionById(input.latestRevision.id, db) ?? input.latestRevision,
    artifacts,
    generatedArtifactTypes,
    reusedArtifactTypes,
    buildState
  };
}

function logContextAssemblyMetrics(input: {
  phase: "assist" | "context_update";
  documentId: string;
  revisionId: string;
  startedAtMs: number;
  artifacts: ContextArtifactResponse[];
  generatedArtifactTypes: WriterContextArtifactType[];
  reusedArtifactTypes: WriterContextArtifactType[];
}) {
  const payloadSample = input.artifacts.map((artifact) => ({
    artifact_type: artifact.artifact_type,
    payload: artifact.payload
  }));
  const payloadJson = json(payloadSample);
  const payloadBytes = Buffer.byteLength(payloadJson, "utf8");

  console.info(
    "[writer-context]",
    json({
      event: "context_assembly",
      phase: input.phase,
      document_id: input.documentId,
      revision_id: input.revisionId,
      artifact_count: input.artifacts.length,
      generated_artifact_types: input.generatedArtifactTypes,
      reused_artifact_types: input.reusedArtifactTypes,
      latency_ms: Date.now() - input.startedAtMs,
      payload_bytes: payloadBytes,
      approx_payload_tokens: estimateTokenCount(payloadJson)
    })
  );
}

function estimateTokenCount(text: string) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function normalizeContextUpdateRequest(value: unknown): ContextUpdateRequest {
  const body = value === undefined || value === null ? {} : value;
  if (!isRecord(body)) {
    throw createHttpError(400, "Request body must be a JSON object when provided.");
  }

  return {
    artifactTypes: normalizeContextArtifactTypes(body.artifact_types ?? body.artifactTypes),
    force: normalizeOptionalBoolean(body.force, "force") ?? false,
    staleAfterEditCount: normalizeOptionalNonNegativeInteger(
      body.stale_after_edit_count ?? body.staleAfterEditCount,
      "stale_after_edit_count"
    ),
    staleAfterSeconds: normalizeOptionalPositiveInteger(
      body.stale_after_seconds ?? body.staleAfterSeconds,
      "stale_after_seconds"
    )
  };
}

function normalizeContextArtifactTypes(value: unknown) {
  if (value === undefined || value === null || value === "") return [...CONTEXT_ARTIFACT_TYPES];

  const requestedTypes = typeof value === "string" ? [value] : value;
  if (!Array.isArray(requestedTypes) || requestedTypes.length === 0) {
    throw createHttpError(400, "artifact_types must be a non-empty array.");
  }
  if (requestedTypes.length > MAX_CONTEXT_ARTIFACT_TYPES) {
    throw createHttpError(400, `artifact_types must contain ${MAX_CONTEXT_ARTIFACT_TYPES} items or fewer.`);
  }

  const seen = new Set<WriterContextArtifactType>();
  for (const artifactType of requestedTypes) {
    if (!isWriterContextArtifactType(artifactType)) {
      throw createHttpError(400, "artifact_types may only include: recent_changes, document_outline, thesis_state.");
    }
    seen.add(artifactType);
  }

  return [...seen];
}

function isWriterContextArtifactType(value: unknown): value is WriterContextArtifactType {
  return typeof value === "string" && CONTEXT_ARTIFACT_TYPES.includes(value as WriterContextArtifactType);
}

function normalizeOptionalBoolean(value: unknown, fieldName: string) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "boolean") {
    throw createHttpError(400, `${fieldName} must be a boolean.`);
  }
  return value;
}

function normalizeOptionalNonNegativeInteger(value: unknown, fieldName: string) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw createHttpError(400, `${fieldName} must be a non-negative integer.`);
  }
  return value;
}

function normalizeOptionalPositiveInteger(value: unknown, fieldName: string) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw createHttpError(400, `${fieldName} must be a positive integer.`);
  }
  return value;
}

function resolveArtifactPolicy(
  artifactType: WriterContextArtifactType,
  request: ContextUpdateRequest,
  artifact: ContextArtifactRow | undefined
) {
  const storedOrDefaultPolicy = artifact
    ? {
        staleAfterEditCount: artifact.stale_after_edit_count,
        staleAfterSeconds: artifact.stale_after_seconds
      }
    : CONTEXT_ARTIFACT_POLICIES[artifactType];

  return {
    staleAfterEditCount: request.staleAfterEditCount ?? storedOrDefaultPolicy.staleAfterEditCount,
    staleAfterSeconds: request.staleAfterSeconds ?? storedOrDefaultPolicy.staleAfterSeconds
  };
}

function createContextBuildState(db: DatabaseSync, document: DocumentRow, latestRevision: RevisionRow): ContextBuildState {
  const parentRevision = latestRevision.parent_revision_id ? fetchRevisionById(latestRevision.parent_revision_id, db) ?? null : null;
  const blocks = fetchDocumentBlocks(document.id, db);
  const latestRevisionEdits = fetchDocumentEditsForRevision(db, document.id, latestRevision.id);
  const changedSpan = detectChangedSpan(parentRevision?.full_text ?? "", latestRevision.full_text);
  const impactedBlocks = identifyImpactedBlocks(blocks, changedSpan);

  return {
    document,
    latestRevision,
    parentRevision,
    blocks,
    latestRevisionEdits,
    changedSpan,
    impactedBlocks
  };
}

function fetchDocumentEditsForRevision(db: DatabaseSync, documentId: string, revisionId: string) {
  return db
    .prepare(
      `SELECT * FROM document_edits
       WHERE document_id = ? AND result_revision_id = ?
       ORDER BY created_at ASC, id ASC`
    )
    .all(documentId, revisionId) as DocumentEditRow[];
}

function detectChangedSpan(previousText: string, currentText: string): ChangedSpan {
  let prefixLength = 0;
  const shortestLength = Math.min(previousText.length, currentText.length);
  while (prefixLength < shortestLength && previousText[prefixLength] === currentText[prefixLength]) {
    prefixLength += 1;
  }

  let previousEnd = previousText.length;
  let currentEnd = currentText.length;
  while (
    previousEnd > prefixLength &&
    currentEnd > prefixLength &&
    previousText[previousEnd - 1] === currentText[currentEnd - 1]
  ) {
    previousEnd -= 1;
    currentEnd -= 1;
  }

  const deletedText = previousText.slice(prefixLength, previousEnd);
  const insertedText = currentText.slice(prefixLength, currentEnd);
  return {
    previous_start: prefixLength,
    previous_end: previousEnd,
    current_start: prefixLength,
    current_end: currentEnd,
    deleted_length: deletedText.length,
    inserted_length: insertedText.length,
    deleted_text_preview: previewText(deletedText),
    inserted_text_preview: previewText(insertedText)
  };
}

function identifyImpactedBlocks(blocks: DocumentBlockRow[], changedSpan: ChangedSpan) {
  if (blocks.length === 0) return [];

  const start = changedSpan.current_start;
  const end = changedSpan.current_end;
  const impactedBlocks =
    start === end
      ? blocks.filter((block) => block.start_offset <= start && block.end_offset >= start)
      : blocks.filter((block) => rangesOverlap(block.start_offset, block.end_offset, start, end));

  if (impactedBlocks.length > 0) return impactedBlocks;

  const nextBlock = blocks.find((block) => block.start_offset > start);
  return [nextBlock ?? blocks[blocks.length - 1]];
}

function rangesOverlap(firstStart: number, firstEnd: number, secondStart: number, secondEnd: number) {
  return firstStart < secondEnd && firstEnd > secondStart;
}

function fetchLatestContextArtifact(
  db: DatabaseSync,
  documentId: string,
  artifactType: WriterContextArtifactType
) {
  return db
    .prepare(
      `SELECT * FROM writer_context_artifacts
       WHERE document_id = ? AND artifact_type = ?
       ORDER BY computed_at DESC
       LIMIT 1`
    )
    .get(documentId, artifactType) as ContextArtifactRow | undefined;
}

function evaluateArtifactStaleness(
  db: DatabaseSync,
  input: {
    artifact: ContextArtifactRow | undefined;
    documentId: string;
    latestRevision: RevisionRow;
    policy: { staleAfterEditCount: number; staleAfterSeconds: number };
    force: boolean;
    now: string;
  }
): ArtifactStaleness {
  if (!input.artifact) {
    return {
      stale: true,
      reason: "missing",
      edit_count_since_artifact: 0,
      age_seconds: null,
      latest_revision_id: input.latestRevision.id,
      source_revision_id: null,
      stale_after_edit_count: input.policy.staleAfterEditCount,
      stale_after_seconds: input.policy.staleAfterSeconds
    };
  }

  const editCountSinceArtifact = countEditsSinceRevision(db, input.documentId, input.artifact.source_revision_id);
  const ageSeconds = getAgeSeconds(input.artifact.computed_at, input.now);
  const staleByEditCount = editCountSinceArtifact >= input.policy.staleAfterEditCount;
  const staleByAge = ageSeconds !== null && ageSeconds >= input.policy.staleAfterSeconds;
  const stale = input.force || staleByEditCount || staleByAge;

  return {
    stale,
    reason: input.force ? "force" : staleByEditCount ? "edit_count" : staleByAge ? "age" : "fresh",
    edit_count_since_artifact: editCountSinceArtifact,
    age_seconds: ageSeconds,
    latest_revision_id: input.latestRevision.id,
    source_revision_id: input.artifact.source_revision_id,
    stale_after_edit_count: input.policy.staleAfterEditCount,
    stale_after_seconds: input.policy.staleAfterSeconds
  };
}

function createFreshArtifactStaleness(artifact: ContextArtifactRow, latestRevision: RevisionRow): ArtifactStaleness {
  return {
    stale: false,
    reason: "fresh",
    edit_count_since_artifact: 0,
    age_seconds: 0,
    latest_revision_id: latestRevision.id,
    source_revision_id: artifact.source_revision_id,
    stale_after_edit_count: artifact.stale_after_edit_count,
    stale_after_seconds: artifact.stale_after_seconds
  };
}

function countEditsSinceRevision(db: DatabaseSync, documentId: string, revisionId: string) {
  const revision = fetchRevisionById(revisionId, db);
  if (!revision) return Number.MAX_SAFE_INTEGER;

  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM document_edits edits
       JOIN document_revisions revisions ON revisions.id = edits.result_revision_id
       WHERE edits.document_id = ? AND revisions.revision_number > ?`
    )
    .get(documentId, revision.revision_number) as { count: number };
  return row.count;
}

function getAgeSeconds(computedAt: string, now: string) {
  const computedTime = Date.parse(computedAt);
  const nowTime = Date.parse(now);
  if (!Number.isFinite(computedTime) || !Number.isFinite(nowTime)) return null;
  return Math.max(0, Math.floor((nowTime - computedTime) / 1000));
}

function persistContextArtifact(
  db: DatabaseSync,
  input: {
    documentId: string;
    artifactType: WriterContextArtifactType;
    payload: unknown;
    sourceRevisionId: string;
    computedAt: string;
    staleAfterEditCount: number;
    staleAfterSeconds: number;
  }
) {
  const artifact: ContextArtifactRow = {
    id: id("ctx"),
    document_id: input.documentId,
    artifact_type: input.artifactType,
    payload_json: json(input.payload),
    source_revision_id: input.sourceRevisionId,
    computed_at: input.computedAt,
    stale_after_edit_count: input.staleAfterEditCount,
    stale_after_seconds: input.staleAfterSeconds
  };

  db.prepare(
    `INSERT INTO writer_context_artifacts
      (id, document_id, artifact_type, payload_json, source_revision_id, computed_at, stale_after_edit_count, stale_after_seconds)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    artifact.id,
    artifact.document_id,
    artifact.artifact_type,
    artifact.payload_json,
    artifact.source_revision_id,
    artifact.computed_at,
    artifact.stale_after_edit_count,
    artifact.stale_after_seconds
  );

  if (input.artifactType === "document_outline") {
    db.prepare("UPDATE document_revisions SET outline_json = ? WHERE id = ?").run(artifact.payload_json, input.sourceRevisionId);
  }
  if (input.artifactType === "thesis_state") {
    db.prepare("UPDATE document_revisions SET thesis_json = ? WHERE id = ?").run(artifact.payload_json, input.sourceRevisionId);
  }

  return artifact;
}

function formatContextArtifact(
  artifact: ContextArtifactRow,
  staleness: ArtifactStaleness,
  refreshReason: ArtifactStaleness["reason"] | null
) {
  return {
    id: artifact.id,
    document_id: artifact.document_id,
    artifact_type: artifact.artifact_type,
    payload: parseJson<unknown>(artifact.payload_json, null),
    source_revision_id: artifact.source_revision_id,
    computed_at: artifact.computed_at,
    stale_after_edit_count: artifact.stale_after_edit_count,
    stale_after_seconds: artifact.stale_after_seconds,
    refresh_reason: refreshReason,
    staleness
  };
}

function buildContextArtifactPayload(artifactType: WriterContextArtifactType, state: ContextBuildState) {
  if (artifactType === "recent_changes") return buildRecentChangesPayload(state);
  if (artifactType === "document_outline") return buildDocumentOutlinePayload(state);
  return buildThesisStatePayload(state);
}

function buildRecentChangesPayload(state: ContextBuildState) {
  return {
    revision_id: state.latestRevision.id,
    revision_number: state.latestRevision.revision_number,
    parent_revision_id: state.parentRevision?.id ?? null,
    changed_at: state.latestRevision.created_at,
    changed_span: state.changedSpan,
    impacted_blocks: state.impactedBlocks.map(formatBlockReference),
    edits: state.latestRevisionEdits.slice(-RECENT_EDIT_LIMIT).map((edit) => ({
      id: edit.id,
      op_type: edit.op_type,
      range_start: edit.range_start,
      range_end: edit.range_end,
      inserted_length: edit.inserted_text.length,
      deleted_length: edit.deleted_text.length,
      inserted_text_preview: previewText(edit.inserted_text),
      deleted_text_preview: previewText(edit.deleted_text),
      source: edit.source,
      rationale: edit.rationale,
      created_at: edit.created_at
    }))
  };
}

function buildDocumentOutlinePayload(state: ContextBuildState) {
  const headingNodes = state.blocks
    .filter((block) => block.block_type === "heading")
    .map((block) => {
      const heading = parseHeading(block.text);
      return {
        id: `outline_${block.id}`,
        depth: heading.depth,
        label: heading.label,
        block_id: block.id,
        block_index: block.block_index,
        start_offset: block.start_offset,
        end_offset: block.end_offset
      };
    });

  const nodes =
    headingNodes.length > 0
      ? headingNodes
      : state.blocks
          .filter((block) => block.text.trim().length > 0)
          .slice(0, OUTLINE_NODE_LIMIT)
          .map((block) => ({
            id: `outline_${block.id}`,
            depth: 1,
            label: previewText(block.text, 96),
            block_id: block.id,
            block_index: block.block_index,
            start_offset: block.start_offset,
            end_offset: block.end_offset
          }));

  return {
    revision_id: state.latestRevision.id,
    revision_number: state.latestRevision.revision_number,
    strategy: headingNodes.length > 0 ? "markdown_headings" : "block_summaries",
    node_count: Math.min(nodes.length, OUTLINE_NODE_LIMIT),
    nodes: nodes.slice(0, OUTLINE_NODE_LIMIT)
  };
}

function buildThesisStatePayload(state: ContextBuildState) {
  const candidateBlocks = state.blocks.filter((block) => block.block_type === "paragraph" || block.block_type === "heading");
  const thesisCandidate = findThesisCandidate(candidateBlocks);
  const statement = thesisCandidate?.statement ?? "";
  const evidenceBlockIds = [
    ...(thesisCandidate?.block ? [thesisCandidate.block.id] : []),
    ...state.blocks
      .filter((block) => block.block_type === "paragraph" && block.id !== thesisCandidate?.block.id)
      .slice(0, 2)
      .map((block) => block.id)
  ];

  return {
    revision_id: state.latestRevision.id,
    revision_number: state.latestRevision.revision_number,
    statement,
    confidence: thesisCandidate?.confidence ?? 0,
    evidence_block_ids: evidenceBlockIds,
    source: thesisCandidate ? "heuristic_sentence" : "none",
    signals: thesisCandidate?.signals ?? {
      has_argument_marker: false,
      has_causal_marker: false,
      sentence_length: 0
    }
  };
}

function findThesisCandidate(blocks: DocumentBlockRow[]) {
  let bestCandidate:
    | {
        block: DocumentBlockRow;
        statement: string;
        confidence: number;
        signals: { has_argument_marker: boolean; has_causal_marker: boolean; sentence_length: number };
      }
    | null = null;

  for (const block of blocks) {
    const sentence = firstSentence(block.text);
    if (!sentence) continue;

    const hasArgumentMarker = /\b(argue|claim|thesis|should|must|need to|in this essay|this paper)\b/i.test(sentence);
    const hasCausalMarker = /\b(because|therefore|so that|as a result|leads to|depends on)\b/i.test(sentence);
    const sentenceLength = sentence.length;
    const blockBonus = block.block_type === "paragraph" ? 0.2 : 0;
    const confidence = Math.min(
      1,
      0.25 + blockBonus + (hasArgumentMarker ? 0.3 : 0) + (hasCausalMarker ? 0.15 : 0) + (sentenceLength >= 60 ? 0.1 : 0)
    );

    if (!bestCandidate || confidence > bestCandidate.confidence) {
      bestCandidate = {
        block,
        statement: sentence,
        confidence,
        signals: {
          has_argument_marker: hasArgumentMarker,
          has_causal_marker: hasCausalMarker,
          sentence_length: sentenceLength
        }
      };
    }
  }

  return bestCandidate;
}

function firstSentence(text: string) {
  const normalized = text.replace(/^#{1,6}\s+/, "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const match = normalized.match(/^.+?[.!?](?:\s|$)/);
  return previewText((match?.[0] ?? normalized).trim(), 320);
}

function parseHeading(text: string) {
  const match = text.trim().match(/^(#{1,6})\s+(.+)$/);
  return {
    depth: match?.[1].length ?? 1,
    label: previewText(match?.[2] ?? text, 120)
  };
}

function formatBlockReference(block: DocumentBlockRow) {
  return {
    id: block.id,
    block_index: block.block_index,
    block_type: block.block_type,
    start_offset: block.start_offset,
    end_offset: block.end_offset,
    text_preview: previewText(block.text)
  };
}

function previewText(text: string, maxLength = CONTEXT_PREVIEW_LENGTH) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

async function generateCoachResult(input: {
  request: AssistRequest;
  document: DocumentRow;
  latestRevision: RevisionRow;
  artifacts: ReturnType<typeof updateContextArtifacts>["artifacts"];
  buildState: ContextBuildState;
}): Promise<CoachResult> {
  const settings = getAppSettings();
  const providerId = input.request.providerId ?? settings.defaultProvider;
  const model = normalizeModel(providerId, input.request.model ?? settings.providers[providerId].model);
  const apiKey = getApiKey(providerId);

  if (input.request.useLlm === true && !apiKey) {
    throw createHttpError(400, `Missing ${providerId} API key. Add it in Settings before using LLM writer coaching.`);
  }

  if (input.request.useLlm !== false && apiKey) {
    const provider = getProvider(providerId);
    const response = await provider.chat(
      {
        model,
        temperature: 0.2,
        maxTokens: 1400,
        messages: [
          { role: "system", content: writerCoachSystemPrompt() },
          {
            role: "user",
            content: writerCoachUserPrompt({
              request: input.request,
              document: input.document,
              latestRevision: input.latestRevision,
              artifacts: input.artifacts
            })
          }
        ]
      },
      apiKey
    );
    const parsed = parseCoachJsonResponse(response.content);
    const answer = parsed.answer || response.content.trim() || "I reviewed the latest draft.";
    return {
      answer,
      provider: providerId,
      model,
      rawContent: response.content,
      usage: response.usage,
      suggestions: normalizeSuggestionDrafts(parsed.suggestions, input.latestRevision.full_text, input.request.maxSuggestions)
    };
  }

  return buildLocalCoachResult(input);
}

function writerCoachSystemPrompt() {
  return [
    "You are a writing coach. Help the writer improve their own draft; do not rewrite the whole document.",
    "Return strict JSON only with this shape:",
    `{"answer":"short coaching response","suggestions":[{"suggestion_type":"clarity|grammar|tone|structure|argument","target_start":0,"target_end":0,"original_text":"exact text from document","suggested_text":"replacement text","explanation":"why this helps"}]}`,
    "Suggestions must use exact character offsets in the provided full_text and original_text must exactly match that range.",
    "Prefer a few high-value suggestions over many minor edits."
  ].join("\n");
}

function writerCoachUserPrompt(input: {
  request: AssistRequest;
  document: DocumentRow;
  latestRevision: RevisionRow;
  artifacts: ReturnType<typeof updateContextArtifacts>["artifacts"];
}) {
  return [
    `Document: ${input.document.title}`,
    `Genre: ${input.document.genre ?? "unspecified"}`,
    `Audience: ${input.document.audience ?? "unspecified"}`,
    `Revision: ${input.latestRevision.revision_number} (${input.latestRevision.id})`,
    `Writer request: ${input.request.prompt}`,
    `Maximum suggestions: ${input.request.maxSuggestions}`,
    "",
    "Context artifacts:",
    JSON.stringify(
      input.artifacts.map((artifact) => ({
        artifact_type: artifact.artifact_type,
        payload: artifact.payload
      })),
      null,
      2
    ),
    "",
    "full_text:",
    input.latestRevision.full_text.slice(0, ASSIST_DOCUMENT_CONTEXT_LIMIT)
  ].join("\n");
}

function parseCoachJsonResponse(content: string): { answer: string; suggestions: unknown[] } {
  const parsed = parseJsonObject(content);
  if (!isRecord(parsed)) return { answer: content.trim(), suggestions: [] };
  return {
    answer: typeof parsed.answer === "string" ? parsed.answer.trim() : content.trim(),
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : []
  };
}

function parseJsonObject(content: string) {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {}

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

function buildLocalCoachResult(input: {
  request: AssistRequest;
  document: DocumentRow;
  latestRevision: RevisionRow;
  artifacts: ReturnType<typeof updateContextArtifacts>["artifacts"];
  buildState: ContextBuildState;
}): CoachResult {
  const outline = input.artifacts.find((artifact) => artifact.artifact_type === "document_outline")?.payload;
  const thesis = input.artifacts.find((artifact) => artifact.artifact_type === "thesis_state")?.payload;
  const recentChanges = input.artifacts.find((artifact) => artifact.artifact_type === "recent_changes")?.payload;
  const thesisStatement = isRecord(thesis) && typeof thesis.statement === "string" ? thesis.statement : "";
  const outlineCount = isRecord(outline) && typeof outline.node_count === "number" ? outline.node_count : input.buildState.blocks.length;
  const impactedCount =
    isRecord(recentChanges) && Array.isArray(recentChanges.impacted_blocks) ? recentChanges.impacted_blocks.length : input.buildState.impactedBlocks.length;
  const suggestions = buildLocalSuggestionDrafts(input.latestRevision.full_text, input.buildState.blocks, input.request.maxSuggestions);

  const answer = [
    thesisStatement
      ? `The current draft's central claim reads as: "${previewText(thesisStatement, 180)}"`
      : "I could not identify a clear thesis yet, so start by making the central claim explicit.",
    `The outline currently has ${outlineCount} visible section${outlineCount === 1 ? "" : "s"}, and the latest revision touched ${impactedCount} block${impactedCount === 1 ? "" : "s"}.`,
    suggestions.length > 0
      ? "I left targeted suggestions that keep the draft in your voice while tightening clarity and argument."
      : "My next coaching move would be to add more specific evidence before making line edits."
  ].join("\n\n");

  return {
    answer,
    provider: "local",
    model: "heuristic-coach",
    rawContent: null,
    suggestions
  };
}

function normalizeSuggestionDrafts(value: unknown[], fullText: string, maxSuggestions: number) {
  const drafts: SuggestionDraft[] = [];
  for (const candidate of value) {
    const draft = normalizeSuggestionDraft(candidate, fullText);
    if (!draft) continue;
    if (drafts.some((existing) => existing.targetStart === draft.targetStart && existing.targetEnd === draft.targetEnd)) continue;
    drafts.push(draft);
    if (drafts.length >= maxSuggestions) break;
  }
  return drafts;
}

function normalizeSuggestionDraft(value: unknown, fullText: string): SuggestionDraft | null {
  if (!isRecord(value)) return null;

  const suggestionType = normalizeSuggestionType(value.suggestion_type ?? value.suggestionType);
  const rawTargetStart = value.target_start ?? value.targetStart;
  const rawTargetEnd = value.target_end ?? value.targetEnd;
  const targetStart = typeof rawTargetStart === "number" ? rawTargetStart : null;
  const targetEnd = typeof rawTargetEnd === "number" ? rawTargetEnd : null;
  if (!suggestionType || targetStart === null || targetEnd === null) return null;
  if (!Number.isInteger(targetStart) || !Number.isInteger(targetEnd)) return null;
  if (targetStart < 0 || targetEnd <= targetStart || targetEnd > fullText.length) return null;

  const originalText = typeof (value.original_text ?? value.originalText) === "string"
    ? (value.original_text ?? value.originalText) as string
    : fullText.slice(targetStart, targetEnd);
  const suggestedText = typeof (value.suggested_text ?? value.suggestedText) === "string"
    ? ((value.suggested_text ?? value.suggestedText) as string)
    : "";
  if (suggestedText === originalText) return null;
  if (fullText.slice(targetStart, targetEnd) !== originalText) return null;

  return {
    suggestionType,
    targetStart,
    targetEnd,
    originalText,
    suggestedText,
    explanation: normalizeSuggestionExplanation(value.explanation)
  };
}

function normalizeSuggestionType(value: unknown): SuggestionType | null {
  return typeof value === "string" && SUGGESTION_TYPES.includes(value as SuggestionType) ? value as SuggestionType : null;
}

function normalizeSuggestionExplanation(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, MAX_RATIONALE_LENGTH) : null;
}

function buildLocalSuggestionDrafts(fullText: string, blocks: DocumentBlockRow[], maxSuggestions: number) {
  const drafts: SuggestionDraft[] = [];
  const replacements: Array<{ pattern: RegExp; replacement: string; suggestionType: SuggestionType; explanation: string }> = [
    { pattern: /\bvery\s+/i, replacement: "", suggestionType: "clarity", explanation: "Remove filler so the sentence reads more directly." },
    { pattern: /\breally\s+/i, replacement: "", suggestionType: "clarity", explanation: "Cut vague emphasis and let the claim carry the weight." },
    { pattern: /\bthing\b/i, replacement: "point", suggestionType: "clarity", explanation: "Use a more specific noun." },
    { pattern: /\bstuff\b/i, replacement: "evidence", suggestionType: "tone", explanation: "Use a more precise academic word." },
    { pattern: /\ba lot of\b/i, replacement: "substantial", suggestionType: "tone", explanation: "Make the phrasing more concise." }
  ];

  for (const replacement of replacements) {
    const match = replacement.pattern.exec(fullText);
    if (!match || match.index < 0) continue;
    const originalText = match[0];
    drafts.push({
      suggestionType: replacement.suggestionType,
      targetStart: match.index,
      targetEnd: match.index + originalText.length,
      originalText,
      suggestedText: replacement.replacement,
      explanation: replacement.explanation
    });
    if (drafts.length >= maxSuggestions) return drafts;
  }

  const firstParagraph = blocks.find((block) => block.block_type === "paragraph");
  if (firstParagraph) {
    const sentence = firstSentence(firstParagraph.text);
    const sentenceStartInBlock = firstParagraph.text.indexOf(sentence);
    const targetStart = firstParagraph.start_offset + Math.max(0, sentenceStartInBlock);
    const targetEnd = targetStart + sentence.length;
    if (sentence && !/\b(because|therefore|so that|as a result|leads to|depends on)\b/i.test(sentence)) {
      const withoutPunctuation = sentence.replace(/[.!?]\s*$/, "");
      drafts.push({
        suggestionType: "argument",
        targetStart,
        targetEnd,
        originalText: sentence,
        suggestedText: `${withoutPunctuation} because the evidence shows a clear cause-and-effect relationship.`,
        explanation: "A thesis is easier to develop when it names the reason behind the claim."
      });
    } else if (sentence.includes("This essay argues that")) {
      drafts.push({
        suggestionType: "tone",
        targetStart,
        targetEnd,
        originalText: sentence,
        suggestedText: sentence.replace("This essay argues that", "The central claim is that"),
        explanation: "This keeps the claim direct and reduces formulaic framing."
      });
    }
  }

  return normalizeSuggestionDrafts(drafts, fullText, maxSuggestions);
}

function resolveWriterConversation(db: DatabaseSync, documentId: string, request: AssistRequest) {
  if (request.conversationId) {
    const conversation = fetchWriterConversation(request.conversationId, db);
    if (!conversation || conversation.document_id !== documentId) {
      throw createHttpError(404, "Conversation not found.");
    }
    return conversation;
  }

  const createdAt = nowIso();
  const conversation: ConversationRow = {
    id: id("conv"),
    document_id: documentId,
    title: request.prompt.slice(0, 80),
    mode: request.mode,
    created_at: createdAt,
    updated_at: createdAt
  };
  db.prepare("INSERT INTO conversations (id, document_id, title, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    conversation.id,
    conversation.document_id,
    conversation.title,
    conversation.mode,
    conversation.created_at,
    conversation.updated_at
  );
  return conversation;
}

function fetchWriterConversation(conversationId: string, db: DatabaseSync) {
  return db.prepare("SELECT * FROM conversations WHERE id = ?").get(conversationId) as ConversationRow | undefined;
}

function saveWriterMessage(
  db: DatabaseSync,
  input: {
    conversationId: string;
    role: "user" | "assistant" | "system";
    content: string;
    context: unknown;
    createdAt: string;
  }
) {
  const message: MessageRow = {
    id: id("msg"),
    conversation_id: input.conversationId,
    role: input.role,
    content: input.content,
    context_json: input.context ? json(input.context) : null,
    created_at: input.createdAt
  };
  db.prepare("INSERT INTO messages (id, conversation_id, role, content, context_json, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    message.id,
    message.conversation_id,
    message.role,
    message.content,
    message.context_json,
    message.created_at
  );
  db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(input.createdAt, input.conversationId);
  return message;
}

function persistSuggestions(
  db: DatabaseSync,
  input: {
    documentId: string;
    conversationId: string;
    messageId: string;
    drafts: SuggestionDraft[];
    createdAt: string;
  }
) {
  const insertSuggestion = db.prepare(
    `INSERT INTO suggestions
      (id, document_id, conversation_id, message_id, suggestion_type, target_start, target_end,
       original_text, suggested_text, explanation, status, resolution_note, created_at, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, NULL)`
  );

  return input.drafts.map((draft) => {
    const suggestion: SuggestionRow = {
      id: id("sug"),
      document_id: input.documentId,
      conversation_id: input.conversationId,
      message_id: input.messageId,
      suggestion_type: draft.suggestionType,
      target_start: draft.targetStart,
      target_end: draft.targetEnd,
      original_text: draft.originalText,
      suggested_text: draft.suggestedText,
      explanation: draft.explanation,
      status: "pending",
      resolution_note: null,
      created_at: input.createdAt,
      resolved_at: null
    };
    insertSuggestion.run(
      suggestion.id,
      suggestion.document_id,
      suggestion.conversation_id,
      suggestion.message_id,
      suggestion.suggestion_type,
      suggestion.target_start,
      suggestion.target_end,
      suggestion.original_text,
      suggestion.suggested_text,
      suggestion.explanation,
      suggestion.created_at
    );
    return suggestion;
  });
}

function fetchSuggestionById(db: DatabaseSync, documentId: string, suggestionId: string) {
  return db
    .prepare("SELECT * FROM suggestions WHERE id = ? AND document_id = ?")
    .get(suggestionId, documentId) as SuggestionRow | undefined;
}

function formatSuggestion(suggestion: SuggestionRow) {
  return {
    id: suggestion.id,
    document_id: suggestion.document_id,
    conversation_id: suggestion.conversation_id,
    message_id: suggestion.message_id,
    suggestion_type: suggestion.suggestion_type,
    target_start: suggestion.target_start,
    target_end: suggestion.target_end,
    original_text: suggestion.original_text,
    suggested_text: suggestion.suggested_text,
    explanation: suggestion.explanation,
    status: suggestion.status,
    resolution_note: suggestion.resolution_note,
    created_at: suggestion.created_at,
    resolved_at: suggestion.resolved_at
  };
}

function normalizeEditOperations(value: unknown, defaultSource: EditSource) {
  if (!Array.isArray(value)) {
    throw createHttpError(400, "operations must be a non-empty array.");
  }
  if (value.length === 0) {
    throw createHttpError(400, "operations must contain at least one edit operation.");
  }
  if (value.length > MAX_EDIT_OPERATIONS) {
    throw createHttpError(400, `operations must contain ${MAX_EDIT_OPERATIONS} items or fewer.`);
  }

  return value.map((operation, index) => normalizeEditOperation(operation, index, defaultSource));
}

function normalizeEditOperation(value: unknown, index: number, defaultSource: EditSource): EditOperation {
  const label = `operations[${index}]`;
  if (!isRecord(value)) {
    throw createHttpError(400, `${label} must be an object.`);
  }

  const rawType = value.op_type ?? value.opType ?? value.type;
  if (rawType !== "insert" && rawType !== "delete" && rawType !== "replace") {
    throw createHttpError(400, `${label}.op_type must be one of: insert, delete, replace.`);
  }

  const rangeStart = normalizeNonNegativeInteger(value.range_start ?? value.rangeStart, `${label}.range_start`);
  const rangeEnd = normalizeNonNegativeInteger(value.range_end ?? value.rangeEnd, `${label}.range_end`);
  if (rangeStart > rangeEnd) {
    throw createHttpError(400, `${label}.range_start must be less than or equal to range_end.`);
  }

  const insertedText = normalizeInsertedText(value.inserted_text ?? value.insertedText, `${label}.inserted_text`);
  const rationale = normalizeOptionalBoundedField(value.rationale, MAX_RATIONALE_LENGTH, `${label}.rationale`);
  const source = normalizeEditSource(value.source, `${label}.source`, defaultSource);

  if (rawType === "insert") {
    if (rangeStart !== rangeEnd) {
      throw createHttpError(400, `${label} insert operations must use an empty range.`);
    }
    if (!insertedText) {
      throw createHttpError(400, `${label} insert operations require inserted_text.`);
    }
  }

  if (rawType === "delete") {
    if (rangeStart === rangeEnd) {
      throw createHttpError(400, `${label} delete operations require a non-empty range.`);
    }
    if (insertedText) {
      throw createHttpError(400, `${label} delete operations cannot include inserted_text.`);
    }
  }

  if (rawType === "replace" && rangeStart === rangeEnd) {
    throw createHttpError(400, `${label} replace operations require a non-empty range.`);
  }

  return {
    opType: rawType,
    rangeStart,
    rangeEnd,
    insertedText,
    rationale,
    source
  };
}

function normalizeNonNegativeInteger(value: unknown, fieldName: string) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw createHttpError(400, `${fieldName} must be a non-negative integer.`);
  }
  return value;
}

function normalizeInsertedText(value: unknown, fieldName: string) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") {
    throw createHttpError(400, `${fieldName} must be a string.`);
  }
  if (value.length > MAX_INSERTED_TEXT_LENGTH) {
    throw createHttpError(400, `${fieldName} must be ${MAX_INSERTED_TEXT_LENGTH} characters or fewer.`);
  }
  return value;
}

function normalizeEditSource(value: unknown, fieldName: string, fallback: EditSource) {
  if (value === undefined || value === null || value === "") return fallback;
  if (value === "user" || value === "assistant" || value === "system") return value;
  throw createHttpError(400, `${fieldName} must be one of: user, assistant, system.`);
}

function normalizeBaseRevisionId(value: unknown, fieldName: string) {
  if (value === undefined) {
    throw createHttpError(400, `${fieldName} is required; use null when the document has no revision yet.`);
  }
  if (value === null || value === "") return null;
  if (typeof value !== "string") {
    throw createHttpError(400, `${fieldName} must be a string when provided.`);
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeOptionalBoundedField(value: unknown, maxLength: number, fieldName: string) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw createHttpError(400, `${fieldName} must be a string.`);
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) {
    throw createHttpError(400, `${fieldName} must be ${maxLength} characters or fewer.`);
  }
  return trimmed;
}

function applyEditOperations(baseText: string, operations: EditOperation[]) {
  let fullText = baseText;
  const edits: Array<EditOperation & { deletedText: string }> = [];

  for (const [index, operation] of operations.entries()) {
    if (operation.rangeEnd > fullText.length) {
      throw createHttpError(
        400,
        `operations[${index}].range_end exceeds the current document length of ${fullText.length}.`
      );
    }

    const deletedText = fullText.slice(operation.rangeStart, operation.rangeEnd);
    fullText =
      fullText.slice(0, operation.rangeStart) + operation.insertedText + fullText.slice(operation.rangeEnd);
    edits.push({ ...operation, deletedText });
  }

  return { fullText, edits };
}

function createRevisionFromOperations(
  db: DatabaseSync,
  input: {
    document: DocumentRow;
    latestRevision: RevisionRow | null;
    operations: EditOperation[];
    changeSummary: string;
    createdAt: string;
  }
) {
  const latestRevisionId = input.latestRevision?.id ?? null;
  const baseText = input.latestRevision?.full_text ?? "";
  const applied = applyEditOperations(baseText, input.operations);
  const revisionId = id("rev");
  const revisionNumber = (input.latestRevision?.revision_number ?? 0) + 1;

  db.prepare(
    `INSERT INTO document_revisions
      (id, document_id, revision_number, full_text, outline_json, thesis_json, change_summary, parent_revision_id, created_at)
     VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?)`
  ).run(revisionId, input.document.id, revisionNumber, applied.fullText, input.changeSummary, latestRevisionId, input.createdAt);

  const edits = persistDocumentEdits(db, {
    documentId: input.document.id,
    baseRevisionId: latestRevisionId,
    resultRevisionId: revisionId,
    operations: applied.edits,
    createdAt: input.createdAt
  });
  const blocks = reindexDocumentBlocks(db, input.document.id, applied.fullText, input.createdAt);
  db.prepare("UPDATE documents SET latest_revision_id = ?, updated_at = ? WHERE id = ?").run(
    revisionId,
    input.createdAt,
    input.document.id
  );

  return {
    document: fetchDocumentById(input.document.id, db),
    base_revision: input.latestRevision,
    latest_revision: fetchRevisionById(revisionId, db),
    edits,
    blocks
  };
}

function persistDocumentEdits(
  db: DatabaseSync,
  input: {
    documentId: string;
    baseRevisionId: string | null;
    resultRevisionId: string;
    operations: Array<EditOperation & { deletedText: string }>;
    createdAt: string;
  }
) {
  const insertEdit = db.prepare(
    `INSERT INTO document_edits
      (id, document_id, base_revision_id, result_revision_id, op_type, range_start, range_end,
       inserted_text, deleted_text, block_id, rationale, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
  );

  return input.operations.map((operation) => {
    const edit: PersistedEditRow = {
      id: id("edit"),
      document_id: input.documentId,
      base_revision_id: input.baseRevisionId,
      result_revision_id: input.resultRevisionId,
      op_type: operation.opType,
      range_start: operation.rangeStart,
      range_end: operation.rangeEnd,
      inserted_text: operation.insertedText,
      deleted_text: operation.deletedText,
      block_id: null,
      rationale: operation.rationale,
      source: operation.source,
      created_at: input.createdAt
    };

    insertEdit.run(
      edit.id,
      edit.document_id,
      edit.base_revision_id,
      edit.result_revision_id,
      edit.op_type,
      edit.range_start,
      edit.range_end,
      edit.inserted_text,
      edit.deleted_text,
      edit.rationale,
      edit.source,
      edit.created_at
    );
    return edit;
  });
}

function reindexDocumentBlocks(db: DatabaseSync, documentId: string, fullText: string, timestamp: string) {
  const blocks = buildDocumentBlocks(documentId, fullText, timestamp);
  db.prepare("DELETE FROM document_blocks WHERE document_id = ?").run(documentId);

  const insertBlock = db.prepare(
    `INSERT INTO document_blocks
      (id, document_id, block_index, block_type, text, start_offset, end_offset, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const block of blocks) {
    insertBlock.run(
      block.id,
      block.document_id,
      block.block_index,
      block.block_type,
      block.text,
      block.start_offset,
      block.end_offset,
      block.created_at,
      block.updated_at
    );
  }

  return blocks;
}

function buildDocumentBlocks(documentId: string, fullText: string, timestamp: string) {
  const blocks: DocumentBlockRow[] = [];
  const separator = /\r?\n\s*\r?\n/g;
  let segmentStart = 0;
  let match: RegExpExecArray | null;

  while ((match = separator.exec(fullText)) !== null) {
    appendBlockFromSegment(blocks, documentId, fullText, segmentStart, match.index, timestamp);
    segmentStart = match.index + match[0].length;
  }

  appendBlockFromSegment(blocks, documentId, fullText, segmentStart, fullText.length, timestamp);
  return blocks;
}

function appendBlockFromSegment(
  blocks: DocumentBlockRow[],
  documentId: string,
  fullText: string,
  segmentStart: number,
  segmentEnd: number,
  timestamp: string
) {
  const segment = fullText.slice(segmentStart, segmentEnd);
  const leadingWhitespaceLength = segment.search(/\S/);
  if (leadingWhitespaceLength < 0) return;

  let contentEnd = segment.length;
  while (contentEnd > leadingWhitespaceLength && /\s/.test(segment[contentEnd - 1])) {
    contentEnd -= 1;
  }

  const startOffset = segmentStart + leadingWhitespaceLength;
  const endOffset = segmentStart + contentEnd;
  const text = fullText.slice(startOffset, endOffset);

  blocks.push({
    id: id("block"),
    document_id: documentId,
    block_index: blocks.length,
    block_type: classifyBlockType(text),
    text,
    start_offset: startOffset,
    end_offset: endOffset,
    created_at: timestamp,
    updated_at: timestamp
  });
}

function classifyBlockType(text: string): DocumentBlockType {
  const trimmed = text.trimStart();
  const firstLine = trimmed.split(/\r?\n/, 1)[0]?.trim() ?? "";

  if (trimmed.startsWith("```")) return "code";
  if (/^#{1,6}\s+/.test(firstLine)) return "heading";
  if (/^(?:[-*+]|\d+[.)])\s+/.test(firstLine)) return "list_item";
  if (/^>\s?/.test(firstLine)) return "quote";
  return "paragraph";
}

function defaultChangeSummary(operationCount: number) {
  return `Applied ${operationCount} edit${operationCount === 1 ? "" : "s"}.`;
}

function createHttpError(status: number, message: string): HttpError {
  const error = new Error(message) as HttpError;
  error.status = status;
  return error;
}

function isHttpError(error: unknown): error is HttpError {
  return error instanceof Error && typeof (error as Partial<HttpError>).status === "number";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readAliasedField(record: Record<string, unknown>, primaryKey: string, fallbackKey: string) {
  return Object.prototype.hasOwnProperty.call(record, primaryKey) ? record[primaryKey] : record[fallbackKey];
}

function normalizeBoundedString(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return "";
  return trimmed;
}

function normalizeOptionalBoundedString(
  value: unknown,
  maxLength: number,
  fieldName: string
): { value: string | null; error?: undefined } | { value?: undefined; error: string } {
  if (value === undefined || value === null) return { value: null as string | null };
  if (typeof value !== "string") return { error: `${fieldName} must be a string.` };
  const trimmed = value.trim();
  if (!trimmed) return { value: null as string | null };
  if (trimmed.length > maxLength) {
    return { error: `${fieldName} must be ${maxLength} characters or fewer.` };
  }
  return { value: trimmed };
}

function normalizeTargetLength(value: unknown): { value: number | null; error?: undefined } | { value?: undefined; error: string } {
  if (value === undefined || value === null || value === "") return { value: null as number | null };
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_TARGET_LENGTH) {
    return { error: `target_length must be an integer between 1 and ${MAX_TARGET_LENGTH}.` };
  }
  return { value: parsed };
}

function normalizeOptionalStatus(value: unknown): { value: string | null; error?: undefined } | { value?: undefined; error: string } {
  if (value === undefined) return { value: null as string | null };
  const allowed = new Set(["draft", "review", "final", "archived"]);
  if (typeof value !== "string" || !allowed.has(value)) {
    return { error: "status must be one of: draft, review, final, archived." };
  }
  return { value };
}

function normalizePage(value: unknown) {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  return 1;
}

function normalizePageSize(value: unknown) {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0) return Math.min(parsed, MAX_PAGE_SIZE);
  return DEFAULT_PAGE_SIZE;
}

function normalizeListLimit(value: unknown, fallback: number, max: number) {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0) return Math.min(parsed, max);
  return fallback;
}

function normalizeOptionalSuggestionStatus(
  value: unknown
): { value: SuggestionStatus | null; error?: undefined } | { value?: undefined; error: string } {
  if (value === undefined) return { value: null };
  if (value === "pending" || value === "accepted" || value === "rejected") {
    return { value };
  }
  return { error: "status must be one of: pending, accepted, rejected." };
}

export default writerRouter;
