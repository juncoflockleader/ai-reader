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

let db: DatabaseSync | null = null;

export function getDb() {
  if (db) return db;
  ensureDataDirs();
  db = new DatabaseSync(path.join(dataDir, "app.db"));
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(fs.readFileSync(schemaPath, "utf8"));
  return db;
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
