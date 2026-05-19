import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { writerDbPath } from "../../config";
import { ensureWriterDataDir, writerDataDir } from "../storage/files";

const writerSchemaPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../db/writer.schema.sql"
);

let writerDb: DatabaseSync | null = null;

export function getWriterDb() {
  if (writerDb) return writerDb;
  ensureWriterDataDir();

  const resolvedDbPath = path.isAbsolute(writerDbPath)
    ? writerDbPath
    : path.resolve(writerDataDir, writerDbPath);

  writerDb = new DatabaseSync(resolvedDbPath);
  writerDb.exec("PRAGMA foreign_keys = ON");
  writerDb.exec(fs.readFileSync(writerSchemaPath, "utf8"));
  return writerDb;
}
