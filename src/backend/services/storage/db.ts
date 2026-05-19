import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { booksDir, dataDir, ensureDataDirs, safeFileName } from "./files";

const schemaPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../db/schema.sql"
);

const readerTables = ["books", "pages", "chunks", "chunks_fts", "highlights", "conversations", "messages"] as const;

let db: DatabaseSync | null = null;

export function getDb() {
  if (db) return db;
  ensureDataDirs();

  const readerDbPath = path.join(dataDir, "reader.db");
  const hadReaderDb = fs.existsSync(readerDbPath);
  const legacyDbPath = path.join(dataDir, "app.db");

  db = new DatabaseSync(readerDbPath);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(fs.readFileSync(schemaPath, "utf8"));
  migrateReaderDataFromLegacyAppDb(db, legacyDbPath);
  rebuildMinimalBookIndexIfNeeded(db, { hadReaderDb });
  return db;
}

function rebuildMinimalBookIndexIfNeeded(readerDb: DatabaseSync, options: { hadReaderDb: boolean }) {
  if (options.hadReaderDb) return;

  const hasAnyBooks = (readerDb.prepare("SELECT 1 FROM books LIMIT 1").get() as unknown) !== undefined;
  if (hasAnyBooks || !fs.existsSync(booksDir)) return;

  const discoveredBooks = fs
    .readdirSync(booksDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const bookId = entry.name;
      const bookPath = path.join(booksDir, bookId);
      const pdfPath = path.join(bookPath, "original.pdf");
      const markdownPath = path.join(bookPath, "original.md");
      const filePath = fs.existsSync(pdfPath) ? pdfPath : fs.existsSync(markdownPath) ? markdownPath : null;
      if (!filePath) return null;

      const fileName = safeFileName(path.basename(filePath));
      return {
        bookId,
        title: path.basename(fileName, path.extname(fileName)).replace(/[_-]+/g, " "),
        fileName,
        fileHash: `sha256:${hashFile(filePath)}`
      };
    })
    .filter((book): book is { bookId: string; title: string; fileName: string; fileHash: string } => Boolean(book));

  if (discoveredBooks.length === 0) return;

  const createdAt = nowIso();
  const insertBook = readerDb.prepare(
    `INSERT OR IGNORE INTO books (id, title, author, file_name, file_hash, page_count, ingestion_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  readerDb.exec("BEGIN");
  try {
    for (const book of discoveredBooks) {
      insertBook.run(book.bookId, book.title, null, book.fileName, book.fileHash, 0, "ready", createdAt, createdAt);
    }
    readerDb.exec("COMMIT");
  } catch {
    readerDb.exec("ROLLBACK");
    throw new Error("Failed rebuilding minimal reader book index");
  }
}

function hashFile(filePath: string) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function migrateReaderDataFromLegacyAppDb(readerDb: DatabaseSync, legacyDbPath: string) {
  if (!fs.existsSync(legacyDbPath)) return;
  if (path.resolve(legacyDbPath) === path.resolve(path.join(dataDir, "reader.db"))) return;

  const hasReaderBooks = (readerDb.prepare("SELECT 1 FROM books LIMIT 1").get() as unknown) !== undefined;
  if (hasReaderBooks) return;

  const legacyDb = new DatabaseSync(legacyDbPath, { readOnly: true });
  try {
    const hasLegacyBooks = (legacyDb.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'books'").get() as unknown) !== undefined;
    if (!hasLegacyBooks) return;

    const hasLegacyData = (legacyDb.prepare("SELECT 1 FROM books LIMIT 1").get() as unknown) !== undefined;
    if (!hasLegacyData) return;

    readerDb.exec("BEGIN");
    readerDb.exec(`ATTACH DATABASE ${json(legacyDbPath)} AS legacy`);
    for (const table of readerTables) {
      const hasLegacyTable =
        (legacyDb.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as unknown) !== undefined;
      if (!hasLegacyTable) continue;
      readerDb.prepare(`INSERT INTO ${table} SELECT * FROM legacy.${table}`).run();
    }
    readerDb.exec("COMMIT");
    readerDb.exec("DETACH DATABASE legacy");
  } catch {
    readerDb.exec("ROLLBACK");
    try {
      readerDb.exec("DETACH DATABASE legacy");
    } catch {}
    throw new Error("Failed migrating legacy reader data from app.db to reader.db");
  } finally {
    legacyDb.close();
  }
}

export function nowIso() {
  return new Date().toISOString();
}

export function json<T>(value: T) {
  return JSON.stringify(value);
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function id(prefix: string) {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}
