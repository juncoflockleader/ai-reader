import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { chunkPages } from "./chunkText";
import { extractPagesFromPdf } from "./extractPages";
import { getDb, id, json, nowIso } from "../storage/db";
import { getBookDir, getBookPdfPath, safeFileName } from "../storage/files";

export async function ingestPdf(tempPath: string, originalName: string) {
  const db = getDb();
  const bookId = id("book");
  const createdAt = nowIso();
  const fileHash = `sha256:${hashFile(tempPath)}`;
  const fileName = safeFileName(originalName);
  const bookDir = getBookDir(bookId);
  fs.mkdirSync(bookDir, { recursive: true });
  fs.copyFileSync(tempPath, getBookPdfPath(bookId));

  db.prepare(
    `INSERT INTO books (id, title, author, file_name, file_hash, page_count, ingestion_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(bookId, titleFromFile(fileName), null, fileName, fileHash, 0, "ingesting", createdAt, createdAt);

  try {
    await analyzeStoredBook(bookId);
  } catch (error) {
    db.prepare("UPDATE books SET ingestion_status = ?, updated_at = ? WHERE id = ?").run("error", nowIso(), bookId);
    throw error;
  } finally {
    fs.rmSync(tempPath, { force: true });
  }

  return { book_id: bookId, status: "ready" };
}

export async function analyzeStoredBook(bookId: string) {
  const db = getDb();
  const bookDir = getBookDir(bookId);
  const pdfPath = getBookPdfPath(bookId);
  if (!fs.existsSync(pdfPath)) throw new Error("Original PDF is missing.");

  db.prepare("UPDATE books SET ingestion_status = ?, updated_at = ? WHERE id = ?").run("ingesting", nowIso(), bookId);
  const pages = await extractPagesFromPdf(bookId, pdfPath);
  const chunks = chunkPages(bookId, pages);
  const insertPage = db.prepare(
    `INSERT INTO pages (id, book_id, page_index, pdf_page_number, printed_page_label, raw_text, clean_text, blocks_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertChunk = db.prepare(
    `INSERT INTO chunks (id, book_id, page_start, page_end, section_id, heading, chunk_type, text, summary, source_blocks_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertFts = db.prepare(
    `INSERT INTO chunks_fts (chunk_id, book_id, heading, text, summary) VALUES (?, ?, ?, ?, ?)`
  );

  try {
    db.exec("BEGIN");
    db.prepare("DELETE FROM chunks_fts WHERE book_id = ?").run(bookId);
    db.prepare("DELETE FROM chunks WHERE book_id = ?").run(bookId);
    db.prepare("DELETE FROM pages WHERE book_id = ?").run(bookId);
    for (const page of pages) {
      insertPage.run(
        `page_${bookId}_${page.pdfPageNumber}`,
        bookId,
        page.pageIndex,
        page.pdfPageNumber,
        null,
        page.rawText,
        page.cleanText,
        json(page.blocks)
      );
    }
    for (const chunk of chunks) {
      insertChunk.run(
        chunk.id,
        bookId,
        chunk.pageStart,
        chunk.pageEnd,
        null,
        chunk.heading,
        chunk.chunkType,
        chunk.text,
        null,
        json(chunk.sourceBlocks),
        chunk.createdAt
      );
      insertFts.run(chunk.id, bookId, chunk.heading, chunk.text, null);
    }
    db.prepare("UPDATE books SET page_count = ?, ingestion_status = ?, updated_at = ? WHERE id = ?").run(
      pages.length,
      "ready",
      nowIso(),
      bookId
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    db.prepare("UPDATE books SET ingestion_status = ?, updated_at = ? WHERE id = ?").run("error", nowIso(), bookId);
    throw error;
  }

  writeArtifacts(bookDir, {
    manifest: getBook(bookId),
    pages,
    chunks
  });
  return { book_id: bookId, status: "ready", page_count: pages.length, chunks: chunks.length };
}

function hashFile(filePath: string) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function titleFromFile(fileName: string) {
  return path.basename(fileName, path.extname(fileName)).replace(/[_-]+/g, " ");
}

function getBook(bookId: string) {
  return getDb().prepare("SELECT * FROM books WHERE id = ?").get(bookId);
}

function writeArtifacts(bookDir: string, artifacts: Record<string, unknown>) {
  fs.writeFileSync(path.join(bookDir, "manifest.json"), JSON.stringify(artifacts.manifest, null, 2));
  writeJsonArray(path.join(bookDir, "pages.json"), artifacts.pages as unknown[]);
  writeJsonArray(path.join(bookDir, "chunks.json"), artifacts.chunks as unknown[]);
}

function writeJsonArray(filePath: string, rows: unknown[]) {
  const fd = fs.openSync(filePath, "w");
  try {
    fs.writeSync(fd, "[\n");
    rows.forEach((row, index) => {
      fs.writeSync(fd, index === 0 ? "  " : ",\n  ");
      fs.writeSync(fd, JSON.stringify(row));
    });
    fs.writeSync(fd, "\n]\n");
  } finally {
    fs.closeSync(fd);
  }
}
