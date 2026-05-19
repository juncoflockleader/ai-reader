import { Router } from "express";
import type { DatabaseSync } from "node:sqlite";
import { getWriterDb } from "../services/writer/db";
import { id, nowIso } from "../services/storage/db";

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

export default writerRouter;
