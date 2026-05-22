import { Router } from "express";
import { getProvider, normalizeModel } from "../services/llm";
import { getDb, id, json, nowIso, parseJson } from "../services/storage/db";
import { getApiKey, getAppSettings } from "./settings";

const router = Router();

type DrawingOverlayRow = {
  id: string;
  book_id: string;
  page_number: number;
  overlay_type: string;
  strokes_json: string;
  created_at: string;
  updated_at: string;
};

type Stroke = { color: string; width: number; points: Array<{ x: number; y: number }> };

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
      overlay_type: row.overlay_type ?? "scribble",
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
    const pageImageWidth = positiveNumber(req.body.page_image_width);
    const pageImageHeight = positiveNumber(req.body.page_image_height);
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
      maxTokens: 900,
      messages: [
        { role: "system", content: "You help readers get started on a textbook page. Return JSON only with keys summary and overlay_regions. overlay_regions is an array of 3-5 simple visual regions. Prefer rectangles and underlines over freehand strokes." },
        { role: "user", content: `Create a concise getting-started guide for page ${pageNumber}. Explain what to read first and why.

Coordinate instructions:
- The attached image is the PDF page itself with a faint normalized coordinate grid drawn on top.
- The page image size is ${pageImageWidth ? `${pageImageWidth}px` : "unknown width"} by ${pageImageHeight ? `${pageImageHeight}px` : "unknown height"}.
- Return coordinates in normalized page coordinates only: top-left of the PDF page is x=0,y=0 and bottom-right is x=1,y=1.
- Ignore browser position, scroll position, zoom, borders, shadows, and the reader UI.
- Do not return pixel coordinates. Do not offset coordinates for the grid labels.
- overlay_regions items should look like {kind:"box"|"underline", color:"#FF6B6B", x:0.12, y:0.08, width:0.55, height:0.06}.

Page text (possibly partial OCR/text layer):
${pageText.slice(0, 6000)}`, attachments: [{ type: "image", dataUrl: screenshotDataUrl, mimeType: "image/png" }] }
      ]
    }, apiKey);
    const parsed = safeParse(response.content);
    const summaryCandidate = typeof parsed.summary === "string" ? parsed.summary : (typeof parsed.summary_text === "string" ? parsed.summary_text : "");
    const summary = summaryCandidate || response.content;
    const generatedOverlayStrokes = Array.isArray(parsed.overlay_strokes)
      ? parsed.overlay_strokes
      : (Array.isArray(parsed.strokes) ? parsed.strokes : []);
    const generatedOverlayRegions = firstArray(parsed, ["overlay_regions", "overlay_boxes", "regions", "boxes", "highlights"]);
    const regionStrokes = overlayRegionsToStrokes(generatedOverlayRegions, pageImageWidth, pageImageHeight);
    const overlayStrokes = regionStrokes.length > 0
      ? regionStrokes
      : normalizeGeneratedOverlayStrokes(generatedOverlayStrokes);
    const visibleOverlayStrokes = overlayStrokes.length > 0 ? overlayStrokes : fallbackGettingStartedStrokes();
    const now = nowIso();
    const existing = getDb().prepare("SELECT id, created_at FROM getting_started_pages WHERE book_id = ? AND page_number = ?").get(req.params.bookId, pageNumber) as { id: string; created_at: string } | undefined;
    getDb().prepare(`INSERT INTO getting_started_pages (id, book_id, page_number, summary_text, overlay_strokes_json, screenshot_data_url, llm_model, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(book_id, page_number) DO UPDATE SET summary_text=excluded.summary_text, overlay_strokes_json=excluded.overlay_strokes_json, screenshot_data_url=excluded.screenshot_data_url, llm_model=excluded.llm_model, updated_at=excluded.updated_at`)
      .run(existing?.id ?? id("gstart"), req.params.bookId, pageNumber, summary, json(visibleOverlayStrokes), screenshotDataUrl, `${providerId}:${model}`, existing?.created_at ?? now, now);
    res.json({ item: { summary_text: summary, overlay_strokes: visibleOverlayStrokes } });
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

  const extractedSummary = extractSummaryField(normalized) ?? extractSummaryField(text);
  if (extractedSummary) return { summary: extractedSummary };

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

function extractSummaryField(input: string): string | null {
  const summaryMatch = input.match(/"summary(?:_text)?"\s*:\s*"([\s\S]*?)(?:"\s*,\s*"overlay_strokes"|"\\n\s*}\s*$|"\s*}\s*$)/i);
  if (!summaryMatch?.[1]) return null;
  try {
    return JSON.parse(`"${summaryMatch[1]}"`) as string;
  } catch {
    return summaryMatch[1]
      .replace(/\\"/g, "\"")
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t");
  }
}

const fallbackStrokeColors = ["#e85d4f", "#2f8f83", "#f0b429", "#6c63ff"];

function positiveNumber(input: unknown): number | null {
  const value = Number(input);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function firstArray(record: Record<string, unknown>, keys: string[]): unknown[] {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function overlayRegionsToStrokes(input: unknown, pageImageWidth: number | null, pageImageHeight: number | null): Stroke[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((region, index) => {
    if (!region || typeof region !== "object" || Array.isArray(region)) return [];
    const record = region as Record<string, unknown>;
    const x = normalizeCoordinate(record.x ?? record.left ?? record.x1, pageImageWidth);
    const y = normalizeCoordinate(record.y ?? record.top ?? record.y1, pageImageHeight);
    const right = normalizeCoordinate(record.right ?? record.x2, pageImageWidth);
    const bottom = normalizeCoordinate(record.bottom ?? record.y2, pageImageHeight);
    const width = normalizeSize(record.width, pageImageWidth) ?? (right === null || x === null ? null : right - x);
    const height = normalizeSize(record.height, pageImageHeight) ?? (bottom === null || y === null ? null : bottom - y);
    if (x === null || y === null || width === null || width <= 0) return [];
    const normalizedHeight = height !== null && height > 0 ? height : 0.018;
    const color = typeof record.color === "string" && record.color.trim()
      ? record.color
      : fallbackStrokeColors[index % fallbackStrokeColors.length];
    const strokeWidth = clamp(Number(record.stroke_width ?? record.strokeWidth ?? record.line_width), 2, 12);
    const kind = typeof record.kind === "string" ? record.kind.toLowerCase() : "";
    const left = clamp(x, 0, 1);
    const top = clamp(y, 0, 1);
    const boxWidth = clamp(width, 0, 1 - left);
    const boxHeight = clamp(normalizedHeight, 0.008, 1 - top);
    if (kind.includes("underline") || boxHeight < 0.025) {
      const underlineY = clamp(top + boxHeight, 0, 1);
      return [{ color, width: strokeWidth, points: [{ x: left, y: underlineY }, { x: left + boxWidth, y: underlineY }] }];
    }
    return [{
      color,
      width: strokeWidth,
      points: [
        { x: left, y: top },
        { x: left + boxWidth, y: top },
        { x: left + boxWidth, y: top + boxHeight },
        { x: left, y: top + boxHeight },
        { x: left, y: top }
      ]
    }];
  });
}

function normalizeCoordinate(input: unknown, axisLength: number | null): number | null {
  const value = Number(input);
  if (!Number.isFinite(value)) return null;
  if (value >= 0 && value <= 1) return value;
  if (value > 1 && value <= 100) return value / 100;
  if (axisLength && value > 1) return value / axisLength;
  return value;
}

function normalizeSize(input: unknown, axisLength: number | null): number | null {
  if (input === undefined || input === null) return null;
  const value = Number(input);
  if (!Number.isFinite(value)) return null;
  if (value >= 0 && value <= 1) return value;
  if (value > 1 && value <= 100) return value / 100;
  if (axisLength && value > 1) return value / axisLength;
  return value;
}

function normalizeGeneratedOverlayStrokes(input: unknown): Stroke[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((stroke, strokeIndex) => {
    if (!stroke || typeof stroke !== "object" || Array.isArray(stroke)) return [];
    const record = stroke as Record<string, unknown>;
    const color = typeof record.color === "string" && record.color.trim()
      ? record.color
      : fallbackStrokeColors[strokeIndex % fallbackStrokeColors.length];
    const width = Number(record.width);
    const points = Array.isArray(record.points)
      ? record.points.flatMap((point) => {
        if (!point || typeof point !== "object" || Array.isArray(point)) return [];
        const pointRecord = point as Record<string, unknown>;
        const x = Number(pointRecord.x);
        const y = Number(pointRecord.y);
        return Number.isFinite(x) && Number.isFinite(y) ? [{ x, y }] : [];
      })
      : [];
    if (points.length < 2) return [];
    return [{ color, width: clamp(width, 1, 18), points }];
  });
}

function fallbackGettingStartedStrokes(): Stroke[] {
  return [
    { color: fallbackStrokeColors[0], width: 5, points: [{ x: 0.12, y: 0.1 }, { x: 0.86, y: 0.1 }] },
    { color: fallbackStrokeColors[1], width: 3, points: [{ x: 0.12, y: 0.15 }, { x: 0.12, y: 0.29 }, { x: 0.88, y: 0.29 }, { x: 0.88, y: 0.15 }, { x: 0.12, y: 0.15 }] },
    { color: fallbackStrokeColors[2], width: 4, points: [{ x: 0.16, y: 0.42 }, { x: 0.78, y: 0.42 }] }
  ];
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export default router;
