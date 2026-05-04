import { Router } from "express";
import { getDb, id, json, nowIso, parseJson } from "../services/storage/db";

const router = Router();

router.post("/books/:bookId/highlights", (req, res) => {
  const createdAt = nowIso();
  const highlightId = id("hl");
  const anchor = req.body.anchor ?? {};
  getDb()
    .prepare(
      `INSERT INTO highlights (id, book_id, page_number, selected_text, anchor_json, color, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      highlightId,
      req.params.bookId,
      Number(req.body.page_number),
      req.body.selected_text,
      json(anchor),
      req.body.color ?? "yellow",
      req.body.note ?? null,
      createdAt,
      createdAt
    );
  res.json({ highlight_id: highlightId });
});

router.get("/books/:bookId/highlights", (req, res) => {
  const rows = getDb()
    .prepare("SELECT * FROM highlights WHERE book_id = ? ORDER BY page_number ASC, created_at DESC")
    .all(req.params.bookId) as Array<{ anchor_json: string }>;
  res.json({ highlights: rows.map((row) => ({ ...row, anchor: parseJson(row.anchor_json, {}) })) });
});

router.patch("/highlights/:highlightId", (req, res) => {
  const current = getDb().prepare("SELECT * FROM highlights WHERE id = ?").get(req.params.highlightId);
  if (!current) {
    res.status(404).json({ error: "Highlight not found." });
    return;
  }
  getDb()
    .prepare("UPDATE highlights SET color = COALESCE(?, color), note = COALESCE(?, note), updated_at = ? WHERE id = ?")
    .run(req.body.color ?? null, req.body.note ?? null, nowIso(), req.params.highlightId);
  res.json({ ok: true });
});

router.delete("/highlights/:highlightId", (req, res) => {
  getDb().prepare("DELETE FROM highlights WHERE id = ?").run(req.params.highlightId);
  res.json({ ok: true });
});

export default router;
