import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

export const dataDir = process.env.STUDYREADER_DATA_DIR
  ? path.resolve(process.env.STUDYREADER_DATA_DIR)
  : path.join(root, "studyreader-data");
export const booksDir = path.join(dataDir, "books");
export const tmpDir = path.join(dataDir, "tmp");

export const writerDataDir = process.env.STUDYWRITER_DATA_DIR
  ? path.resolve(process.env.STUDYWRITER_DATA_DIR)
  : path.join(root, "studywriter-data");

export function ensureDataDirs() {
  fs.mkdirSync(booksDir, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });
}

export function ensureWriterDataDir() {
  fs.mkdirSync(writerDataDir, { recursive: true });
}

export function getBookDir(bookId: string) {
  return path.join(booksDir, bookId);
}

export function getBookPdfPath(bookId: string) {
  return path.join(getBookDir(bookId), "original.pdf");
}

export function getBookMarkdownPath(bookId: string) {
  return path.join(getBookDir(bookId), "original.md");
}

export function safeFileName(fileName: string) {
  return path.basename(fileName).replace(/[^\w.\- ()]/g, "_");
}
