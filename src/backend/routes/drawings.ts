import { Router } from "express";
import { getDb, id, json, nowIso, parseJson } from "../services/storage/db";

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
  const rows = getDb()
    .prepare("SELECT * FROM drawing_overlays WHERE book_id = ? ORDER BY page_number ASC")
    .all(req.params.bookId) as DrawingOverlayRow[];

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
  const updatedAt = nowIso();
  const existing = getDb()
    .prepare("SELECT id, created_at FROM drawing_overlays WHERE book_id = ? AND page_number = ?")
    .get(req.params.bookId, pageNumber) as { id: string; created_at: string } | undefined;

  getDb()
    .prepare(
      `INSERT INTO drawing_overlays (id, book_id, page_number, strokes_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(book_id, page_number)
       DO UPDATE SET strokes_json = excluded.strokes_json, updated_at = excluded.updated_at`
    )
    .run(existing?.id ?? id("draw"), req.params.bookId, pageNumber, json(strokes), existing?.created_at ?? updatedAt, updatedAt);

  res.json({ ok: true });
});

export default router;
