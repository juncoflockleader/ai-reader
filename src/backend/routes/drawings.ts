import { Router } from "express";
import { getProvider, normalizeModel } from "../services/llm";
import { getDb, id, json, nowIso, parseJson } from "../services/storage/db";
import { getApiKey, getAppSettings } from "./settings";

const router = Router();

type DrawingOverlayRow = {
  id: string;
  book_id: string;
  page_number: number;
  strokes_json: string;
  created_at: string;
  updated_at: string;
};

router.get("/books/:bookId/drawings", (req, res) => {
  const fromPage = Number(req.query.from_page ?? 0);
  const toPage = Number(req.query.to_page ?? 0);
  const hasRange = Number.isInteger(fromPage) && Number.isInteger(toPage) && fromPage > 0 && toPage >= fromPage;
  const rows = getDb()
    .prepare(
      hasRange
        ? "SELECT * FROM drawing_overlays WHERE book_id = ? AND page_number BETWEEN ? AND ? ORDER BY page_number ASC"
        : "SELECT * FROM drawing_overlays WHERE book_id = ? ORDER BY page_number ASC"
    )
    .all(...(hasRange ? [req.params.bookId, fromPage, toPage] : [req.params.bookId])) as DrawingOverlayRow[];

  res.json({
    drawings: rows.map((row) => ({
      id: row.id,
      book_id: row.book_id,
      page_number: row.page_number,
      strokes: parseJson(row.strokes_json, []),
      created_at: row.created_at,
      updated_at: row.updated_at
    }))
  });
});

router.put("/books/:bookId/drawings/:pageNumber", (req, res) => {
  const pageNumber = Number(req.params.pageNumber);
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    res.status(400).json({ error: "A valid page number is required." });
    return;
  }

  const strokes = Array.isArray(req.body.strokes) ? req.body.strokes : [];
  const overlayType = req.body.overlay_type === "getting_started" ? "getting_started" : "scribble";
  const updatedAt = nowIso();
  const existing = getDb()
    .prepare("SELECT id, created_at FROM drawing_overlays WHERE book_id = ? AND page_number = ? AND overlay_type = ?")
    .get(req.params.bookId, pageNumber, overlayType) as { id: string; created_at: string } | undefined;

  getDb()
    .prepare(
      `INSERT INTO drawing_overlays (id, book_id, page_number, overlay_type, strokes_json, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(book_id, page_number, overlay_type)
       DO UPDATE SET strokes_json = excluded.strokes_json, metadata_json = excluded.metadata_json, updated_at = excluded.updated_at`
    )
    .run(
      existing?.id ?? id("draw"),
      req.params.bookId,
      pageNumber,
      overlayType,
      json(strokes),
      req.body.metadata ? json(req.body.metadata) : null,
      existing?.created_at ?? updatedAt,
      updatedAt
    );

  res.json({ ok: true });
});

router.get("/books/:bookId/getting-started/:pageNumber", (req, res) => {
  const pageNumber = Number(req.params.pageNumber);
  const row = getDb()
    .prepare("SELECT * FROM getting_started_pages WHERE book_id = ? AND page_number = ?")
    .get(req.params.bookId, pageNumber) as
    | { id: string; summary_text: string; overlay_strokes_json: string; updated_at: string; llm_model: string | null }
    | undefined;
  if (!row) return res.json({ item: null });
  res.json({ item: { id: row.id, summary_text: row.summary_text, overlay_strokes: parseJson(row.overlay_strokes_json, []), updated_at: row.updated_at, llm_model: row.llm_model } });
});

router.post("/books/:bookId/getting-started/:pageNumber", async (req, res, next) => {
  try {
    const pageNumber = Number(req.params.pageNumber);
    const screenshotDataUrl = typeof req.body.screenshot_data_url === "string" ? req.body.screenshot_data_url : "";
    const pageText = typeof req.body.page_text === "string" ? req.body.page_text : "";
    if (!screenshotDataUrl) return res.status(400).json({ error: "screenshot_data_url is required." });
    const settings = getAppSettings();
    const providerId = settings.defaultProvider;
    const model = normalizeModel(providerId, settings.providers[providerId].model);
    const apiKey = getApiKey(providerId);
    if (!apiKey) return res.status(400).json({ error: `Missing ${providerId} API key.` });
    const provider = getProvider(providerId);
    const response = await provider.chat({
      model,
      temperature: 0.2,
      maxTokens: 700,
      messages: [
        { role: "system", content: "You help readers get started on a textbook page. Return JSON with keys summary and overlay_strokes. overlay_strokes is an array of simple strokes [{color,width,points:[{x,y}]}] using normalized coordinates 0..1." },
        { role: "user", content: `Create a concise getting-started guide for page ${pageNumber}. Explain what to read first and why.\n\nPage text (possibly partial OCR/text layer):\n${pageText.slice(0, 6000)}`, attachments: [{ type: "image", dataUrl: screenshotDataUrl, mimeType: "image/png" }] }
      ]
    }, apiKey);
    const parsed = safeParse(response.content);
    const summaryCandidate = typeof parsed.summary === "string" ? parsed.summary : (typeof parsed.summary_text === "string" ? parsed.summary_text : "");
    const summary = summaryCandidate || response.content;
    const overlayStrokes = Array.isArray(parsed.overlay_strokes)
      ? parsed.overlay_strokes
      : (Array.isArray(parsed.strokes) ? parsed.strokes : []);
    const now = nowIso();
    const existing = getDb().prepare("SELECT id, created_at FROM getting_started_pages WHERE book_id = ? AND page_number = ?").get(req.params.bookId, pageNumber) as { id: string; created_at: string } | undefined;
    getDb().prepare(`INSERT INTO getting_started_pages (id, book_id, page_number, summary_text, overlay_strokes_json, screenshot_data_url, llm_model, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(book_id, page_number) DO UPDATE SET summary_text=excluded.summary_text, overlay_strokes_json=excluded.overlay_strokes_json, screenshot_data_url=excluded.screenshot_data_url, llm_model=excluded.llm_model, updated_at=excluded.updated_at`)
      .run(existing?.id ?? id("gstart"), req.params.bookId, pageNumber, summary, json(overlayStrokes), screenshotDataUrl, `${providerId}:${model}`, existing?.created_at ?? now, now);
    res.json({ item: { summary_text: summary, overlay_strokes: overlayStrokes } });
  } catch (error) {
    next(error);
  }
});

function safeParse(text: string): Record<string, unknown> {
  const normalized = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  const candidates = [normalized, text];
  for (const candidate of candidates) {
    const direct = parseObject(candidate);
    if (direct) return direct;

    const unwrapped = unwrapJsonEnvelope(candidate);
    if (unwrapped) {
      const parsed = parseObject(unwrapped);
      if (parsed) return parsed;
    }

    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const sliced = candidate.slice(start, end + 1);
      const parsed = parseObject(sliced);
      if (parsed) return parsed;
    }
  }

  return {};
}

function parseObject(input: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(input) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function unwrapJsonEnvelope(input: string): string | null {
  const trimmed = input.trim();
  const maybeQuoted = (trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"));
  if (!maybeQuoted) return null;
  try {
    const jsonCompatible = trimmed.startsWith("'") ? JSON.stringify(trimmed.slice(1, -1)) : trimmed;
    const parsed = JSON.parse(jsonCompatible) as unknown;
    return typeof parsed === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export default router;
