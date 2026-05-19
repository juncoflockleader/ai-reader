import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dataDir, ensureDataDirs } from "./files";

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
  const legacyDbPath = path.join(dataDir, "app.db");

  db = new DatabaseSync(readerDbPath);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(fs.readFileSync(schemaPath, "utf8"));
  migrateReaderDataFromLegacyAppDb(db, legacyDbPath);
  return db;
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
