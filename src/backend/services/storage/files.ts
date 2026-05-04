import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

export const dataDir = path.join(root, "studyreader-data");
export const booksDir = path.join(dataDir, "books");
export const tmpDir = path.join(dataDir, "tmp");

export function ensureDataDirs() {
  fs.mkdirSync(booksDir, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });
}

export function getBookDir(bookId: string) {
  return path.join(booksDir, bookId);
}

export function getBookPdfPath(bookId: string) {
  return path.join(getBookDir(bookId), "original.pdf");
}

export function safeFileName(fileName: string) {
  return path.basename(fileName).replace(/[^\w.\- ()]/g, "_");
}
