import { id, nowIso } from "../storage/db";
import { normalizeForChunking } from "./cleanText";

export type ExtractedPage = {
  bookId: string;
  pageIndex: number;
  pdfPageNumber: number;
  rawText: string;
  cleanText: string;
  blocks: Array<{ block_id: string; text: string; bbox: number[]; type: string }>;
};

export type TextChunk = {
  id: string;
  bookId: string;
  pageStart: number;
  pageEnd: number;
  heading: string | null;
  chunkType: string;
  text: string;
  sourceBlocks: string[];
  createdAt: string;
};

const TARGET_CHARS = 4200;
const MIN_CHARS = 1200;

export function chunkPages(bookId: string, pages: ExtractedPage[]): TextChunk[] {
  const chunks: TextChunk[] = [];
  let buffer = "";
  let pageStart = pages[0]?.pdfPageNumber ?? 1;
  let pageEnd = pageStart;
  let blockIds: string[] = [];
  let heading: string | null = null;

  const flush = () => {
    const text = buffer.trim();
    if (!text) return;
    chunks.push({
      id: id("chunk"),
      bookId,
      pageStart,
      pageEnd,
      heading,
      chunkType: inferChunkType(text),
      text,
      sourceBlocks: blockIds,
      createdAt: nowIso()
    });
    buffer = "";
    blockIds = [];
    heading = null;
  };

  for (const page of pages) {
    const paragraphs = splitParagraphs(page.cleanText);
    paragraphs.forEach((paragraph, paragraphIndex) => {
      const normalized = normalizeForChunking(paragraph);
      if (!normalized) return;
      if (!heading && looksLikeHeading(normalized)) {
        heading = normalized.slice(0, 160);
      }
      if (!buffer) pageStart = page.pdfPageNumber;
      pageEnd = page.pdfPageNumber;
      if (buffer.length > MIN_CHARS && buffer.length + normalized.length > TARGET_CHARS) {
        flush();
        pageStart = page.pdfPageNumber;
        pageEnd = page.pdfPageNumber;
      }
      buffer = `${buffer}\n\n${normalized}`.trim();
      blockIds.push(page.blocks[paragraphIndex]?.block_id ?? `p${page.pdfPageNumber}_b${String(paragraphIndex + 1).padStart(3, "0")}`);
    });
  }
  flush();
  return chunks;
}

function splitParagraphs(text: string) {
  const byBlankLine = text.split(/\n\s*\n/g).map((item) => item.trim()).filter(Boolean);
  if (byBlankLine.length > 1) return byBlankLine;
  return text.split(/(?<=[.!?])\s+(?=[A-Z0-9])/g).map((item) => item.trim()).filter(Boolean);
}

function looksLikeHeading(text: string) {
  if (text.length > 120) return false;
  return /^(\d+(\.\d+)*\s+)?[A-Z][\w\s:,\-()]+$/.test(text) || text === text.toUpperCase();
}

function inferChunkType(text: string) {
  const lower = text.toLowerCase();
  if (lower.includes("definition") || /\bmeans\b/.test(lower)) return "definition";
  if (lower.includes("example")) return "example";
  if (lower.includes("exercise") || lower.includes("problem set")) return "exercise";
  return "exposition";
}
