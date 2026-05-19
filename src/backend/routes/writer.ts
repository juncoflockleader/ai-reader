import { Router } from "express";
import { getWriterDb } from "../services/writer/db";
import { id, nowIso } from "../services/storage/db";

const writerRouter = Router();

const MAX_TITLE_LENGTH = 200;
const MAX_GENRE_LENGTH = 80;
const MAX_AUDIENCE_LENGTH = 120;
const MAX_TARGET_LENGTH = 1_000_000;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

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

writerRouter.get("/documents/:id", (req, res) => {
  const document = fetchDocumentById(req.params.id);
  if (!document) {
    res.status(404).json({ error: "Document not found." });
    return;
  }

  const latestRevision = document.latest_revision_id
    ? getWriterDb().prepare("SELECT * FROM document_revisions WHERE id = ?").get(document.latest_revision_id)
    : null;

  res.json({ document, latest_revision: latestRevision ?? null });
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

function fetchDocumentById(documentId: string) {
  return getWriterDb().prepare("SELECT * FROM documents WHERE id = ?").get(documentId);
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
