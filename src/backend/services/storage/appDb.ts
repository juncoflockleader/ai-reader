import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { dataDir, ensureDataDirs } from "./files";

let appDb: DatabaseSync | null = null;

export function getAppDb() {
  if (appDb) return appDb;
  ensureDataDirs();
  appDb = new DatabaseSync(path.join(dataDir, "app.db"));
  appDb.exec("PRAGMA foreign_keys = ON");
  appDb.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return appDb;
}
