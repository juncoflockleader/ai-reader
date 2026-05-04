import { getDb } from "../storage/db";

export type SourceSnippet = {
  sourceId: string;
  bookId: string;
  pageStart: number;
  pageEnd: number;
  chunkId?: string;
  heading?: string | null;
  text: string;
};

type ChunkRow = {
  id: string;
  book_id: string;
  page_start: number;
  page_end: number;
  heading: string | null;
  text: string;
};

export function searchChunks(bookId: string, query: string, currentPage?: number, limit = 8): SourceSnippet[] {
  const db = getDb();
  const terms = sanitizeFtsQuery(query);
  if (!terms) return [];

  let rows: ChunkRow[] = [];
  try {
    rows = db
      .prepare(
        `SELECT c.*
         FROM chunks_fts f
         JOIN chunks c ON c.id = f.chunk_id
         WHERE chunks_fts MATCH ? AND f.book_id = ?
         LIMIT ?`
      )
      .all(terms, bookId, limit * 2) as ChunkRow[];
  } catch {
    rows = db
      .prepare(
        `SELECT * FROM chunks
         WHERE book_id = ? AND text LIKE ?
         LIMIT ?`
      )
      .all(bookId, `%${query.slice(0, 80)}%`, limit * 2) as ChunkRow[];
  }

  return rows
    .sort((a, b) => scoreChunk(b, currentPage) - scoreChunk(a, currentPage))
    .slice(0, limit)
    .map((row) => ({
      sourceId: row.id,
      bookId: row.book_id,
      pageStart: row.page_start,
      pageEnd: row.page_end,
      chunkId: row.id,
      heading: row.heading,
      text: row.text
    }));
}

export function getChunksForPage(bookId: string, pageNumber: number): SourceSnippet[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM chunks
       WHERE book_id = ? AND page_start <= ? AND page_end >= ?
       ORDER BY page_start ASC
       LIMIT 6`
    )
    .all(bookId, pageNumber, pageNumber) as ChunkRow[];
  return rows.map((row) => ({
    sourceId: row.id,
    bookId: row.book_id,
    pageStart: row.page_start,
    pageEnd: row.page_end,
    chunkId: row.id,
    heading: row.heading,
    text: row.text
  }));
}

function sanitizeFtsQuery(input: string) {
  const words = input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, 12);
  return words.map((word) => `"${word}"`).join(" OR ");
}

function scoreChunk(chunk: ChunkRow, currentPage?: number) {
  if (!currentPage) return 0;
  if (chunk.page_start <= currentPage && chunk.page_end >= currentPage) return 100;
  return Math.max(0, 30 - Math.abs(chunk.page_start - currentPage));
}
