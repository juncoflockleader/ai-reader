import fs from "node:fs";
import multer from "multer";
import { Router } from "express";
import { uploadMaxBytes, uploadMaxMb } from "../config";
import { analyzeStoredBook, ingestPdf } from "../services/ingestion/ingestPdf";
import { getDb, nowIso, parseJson } from "../services/storage/db";
import { getBookDir, getBookPdfPath, tmpDir } from "../services/storage/files";

const router = Router();
const upload = multer({
  dest: tmpDir,
  limits: { fileSize: uploadMaxBytes },
  fileFilter: (_req, file, cb) => {
    if (file.originalname.toLowerCase().endsWith(".pdf")) {
      cb(null, true);
      return;
    }
    cb(new Error("Only PDF uploads are supported."));
  }
}).single("pdf");

router.post("/", (req, res, next) => {
  upload(req, res, async (uploadError) => {
    if (uploadError) {
      if (uploadError instanceof multer.MulterError && uploadError.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({ error: `PDF upload is too large. The current limit is ${uploadMaxMb} MB.` });
        return;
      }
      if (uploadError instanceof multer.MulterError || uploadError instanceof Error) {
        res.status(400).json({ error: uploadError.message });
        return;
      }
      next(uploadError);
      return;
    }

    try {
      if (!req.file) {
        res.status(400).json({ error: "Upload a PDF file." });
        return;
      }
      if (!hasPdfHeader(req.file.path)) {
        fs.rmSync(req.file.path, { force: true });
        res.status(400).json({ error: "Only PDF uploads are supported." });
        return;
      }
      const result = await ingestPdf(req.file.path, req.file.originalname);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });
});

router.get("/", (_req, res) => {
  const books = getDb().prepare("SELECT * FROM books ORDER BY updated_at DESC").all();
  res.json({ books });
});

router.get("/:bookId", (req, res) => {
  const book = getDb().prepare("SELECT * FROM books WHERE id = ?").get(req.params.bookId);
  if (!book) {
    res.status(404).json({ error: "Book not found." });
    return;
  }
  res.json({ book });
});

router.patch("/:bookId", (req, res) => {
  const title = typeof req.body.title === "string" ? req.body.title.trim() : "";
  if (!title) {
    res.status(400).json({ error: "Book title is required." });
    return;
  }
  const result = getDb()
    .prepare("UPDATE books SET title = ?, updated_at = ? WHERE id = ?")
    .run(title, nowIso(), req.params.bookId);
  if (result.changes === 0) {
    res.status(404).json({ error: "Book not found." });
    return;
  }
  const book = getDb().prepare("SELECT * FROM books WHERE id = ?").get(req.params.bookId);
  res.json({ book });
});

router.delete("/:bookId", (req, res) => {
  const db = getDb();
  const book = db.prepare("SELECT id FROM books WHERE id = ?").get(req.params.bookId);
  if (!book) {
    res.status(404).json({ error: "Book not found." });
    return;
  }
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM chunks_fts WHERE book_id = ?").run(req.params.bookId);
    db.prepare("DELETE FROM books WHERE id = ?").run(req.params.bookId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  fs.rmSync(getBookDir(req.params.bookId), { recursive: true, force: true });
  res.json({ ok: true });
});

router.delete("/:bookId/user-data", (req, res) => {
  const db = getDb();
  const book = db.prepare("SELECT id FROM books WHERE id = ?").get(req.params.bookId);
  if (!book) {
    res.status(404).json({ error: "Book not found." });
    return;
  }
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM highlights WHERE book_id = ?").run(req.params.bookId);
    db.prepare("DELETE FROM conversations WHERE book_id = ?").run(req.params.bookId);
    db.prepare("UPDATE books SET updated_at = ? WHERE id = ?").run(nowIso(), req.params.bookId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  res.json({ ok: true });
});

router.post("/:bookId/reanalyze", async (req, res, next) => {
  try {
    const book = getDb().prepare("SELECT id FROM books WHERE id = ?").get(req.params.bookId);
    if (!book) {
      res.status(404).json({ error: "Book not found." });
      return;
    }
    const result = await analyzeStoredBook(req.params.bookId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/:bookId/file", (req, res) => {
  const filePath = getBookPdfPath(req.params.bookId);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "PDF not found." });
    return;
  }
  res.sendFile(filePath);
});

router.get("/:bookId/ingestion", (req, res) => {
  const book = getDb().prepare("SELECT ingestion_status, page_count, updated_at FROM books WHERE id = ?").get(req.params.bookId);
  if (!book) {
    res.status(404).json({ error: "Book not found." });
    return;
  }
  res.json(book);
});

router.get("/:bookId/pages/:pageNumber", (req, res) => {
  const page = getDb()
    .prepare("SELECT * FROM pages WHERE book_id = ? AND pdf_page_number = ?")
    .get(req.params.bookId, Number(req.params.pageNumber)) as { blocks_json: string } | undefined;
  if (!page) {
    res.status(404).json({ error: "Page not found." });
    return;
  }
  res.json({ page: { ...page, blocks: parseJson(page.blocks_json, []) } });
});

router.get("/:bookId/chunks", (req, res) => {
  const page = Number(req.query.page);
  const chunks = Number.isFinite(page)
    ? getDb()
        .prepare("SELECT * FROM chunks WHERE book_id = ? AND page_start <= ? AND page_end >= ? ORDER BY page_start")
        .all(req.params.bookId, page, page)
    : getDb().prepare("SELECT * FROM chunks WHERE book_id = ? ORDER BY page_start LIMIT 100").all(req.params.bookId);
  res.json({ chunks });
});

function hasPdfHeader(filePath: string) {
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(5);
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    return bytesRead === buffer.length && buffer.toString("ascii") === "%PDF-";
  } finally {
    fs.closeSync(fd);
  }
}

export default router;
