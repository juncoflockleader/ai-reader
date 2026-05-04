import { getDb } from "../storage/db";
import { getChunksForPage, searchChunks, type SourceSnippet } from "../retrieval/ftsSearch";

export type AnswerMode =
  | "explain_simple"
  | "explain_depth"
  | "summarize"
  | "define_terms"
  | "give_example"
  | "quiz_me";

export type ContextAssemblyInput = {
  bookId: string;
  userQuestion: string;
  currentPage?: number;
  selectedText?: string;
  conversationId?: string;
  mode?: AnswerMode;
};

export type AssembledContext = {
  systemInstruction: string;
  userPrompt: string;
  sources: SourceSnippet[];
  contextDebug: {
    selectedTextIncluded: boolean;
    currentPageIncluded: boolean;
    retrievedChunkIds: string[];
    notesIncluded: string[];
  };
};

type BookRow = { id: string; title: string | null; author: string | null };
type PageRow = { pdf_page_number: number; clean_text: string };
type HighlightRow = { id: string; page_number: number; selected_text: string; note: string | null };
type MessageRow = { role: string; content: string };

export function assembleContext(input: ContextAssemblyInput): AssembledContext {
  const db = getDb();
  const book = db.prepare("SELECT id, title, author FROM books WHERE id = ?").get(input.bookId) as BookRow;
  if (!book) throw new Error("Book not found.");

  const currentPage = input.currentPage
    ? (db
        .prepare("SELECT pdf_page_number, clean_text FROM pages WHERE book_id = ? AND pdf_page_number = ?")
        .get(input.bookId, input.currentPage) as PageRow | undefined)
    : undefined;

  const nearbyPages = input.currentPage
    ? (db
        .prepare(
          `SELECT pdf_page_number, clean_text FROM pages
           WHERE book_id = ? AND pdf_page_number BETWEEN ? AND ?
           ORDER BY pdf_page_number ASC`
        )
        .all(input.bookId, Math.max(1, input.currentPage - 1), input.currentPage + 1) as PageRow[])
    : [];

  const query = [input.userQuestion, input.selectedText?.slice(0, 500)].filter(Boolean).join("\n");
  const pageChunks = input.currentPage ? getChunksForPage(input.bookId, input.currentPage) : [];
  const retrieved = searchChunks(input.bookId, query, input.currentPage, 8);
  const sources = dedupeSources([
    ...pageChunks,
    ...retrieved,
    ...(currentPage
      ? [
          {
            sourceId: `page_${currentPage.pdf_page_number}`,
            bookId: input.bookId,
            pageStart: currentPage.pdf_page_number,
            pageEnd: currentPage.pdf_page_number,
            text: truncate(currentPage.clean_text, 6000)
          }
        ]
      : [])
  ]);

  const notes = getRelevantNotes(input.bookId, input.currentPage);
  const history = input.conversationId ? getRecentHistory(input.conversationId) : [];

  const userPrompt = `User question:
${input.userQuestion}

Answer mode:
${modeLabel(input.mode ?? "explain_simple")}

Current reading state:
- Book: ${book.title ?? "Unknown Title"}
- Author: ${book.author ?? "Unknown"}
- Current page: ${input.currentPage ?? "Not provided"}

Selected text:
${input.selectedText ? truncate(input.selectedText, 4500) : "No selected text provided."}

Current and nearby page context:
${nearbyPages.map((page) => `[p. ${page.pdf_page_number}]\n${truncate(page.clean_text, 3000)}`).join("\n\n") || "No current page context available."}

Retrieved relevant passages:
${sources
  .filter((source) => source.chunkId)
  .map((source) => `[p. ${pageRange(source)} | ${source.chunkId}]\n${truncate(source.text, 2600)}`)
  .join("\n\n") || "No retrieved passages found."}

User notes/highlights:
${notes.map((note) => `[p. ${note.page_number}] ${note.note ? `${note.note}: ` : ""}${truncate(note.selected_text, 700)}`).join("\n") || "No relevant notes found."}

Recent conversation:
${history.map((message) => `${message.role}: ${truncate(message.content, 600)}`).join("\n") || "No recent conversation."}

Instructions:
- Answer the user's question directly.
- Ground book-based claims in citations like [p. 87].
- Do not invent citations or quote text not present in the context.
- If the provided context is insufficient, say what is missing.
- If outside knowledge is useful, label it clearly as outside explanation.`;

  return {
    systemInstruction:
      "You are an AI study assistant helping the user read a textbook. Use the provided book context first. Cite page numbers for book-grounded claims. If outside knowledge is useful, clearly label it as outside explanation. Favor teaching, comprehension, and intellectual honesty.",
    userPrompt,
    sources,
    contextDebug: {
      selectedTextIncluded: Boolean(input.selectedText),
      currentPageIncluded: Boolean(currentPage),
      retrievedChunkIds: retrieved.map((source) => source.chunkId).filter(Boolean) as string[],
      notesIncluded: notes.map((note) => note.id)
    }
  };
}

export function citationCandidates(sources: SourceSnippet[]) {
  return sources.slice(0, 6).map((source) => ({
    page: source.pageStart,
    chunk_id: source.chunkId,
    quote: truncate(source.text.replace(/\s+/g, " "), 240)
  }));
}

function getRelevantNotes(bookId: string, currentPage?: number) {
  const db = getDb();
  if (currentPage) {
    return db
      .prepare(
        `SELECT id, page_number, selected_text, note FROM highlights
         WHERE book_id = ? AND page_number BETWEEN ? AND ?
         ORDER BY updated_at DESC LIMIT 8`
      )
      .all(bookId, Math.max(1, currentPage - 3), currentPage + 3) as HighlightRow[];
  }
  return db
    .prepare("SELECT id, page_number, selected_text, note FROM highlights WHERE book_id = ? ORDER BY updated_at DESC LIMIT 8")
    .all(bookId) as HighlightRow[];
}

function getRecentHistory(conversationId: string) {
  return getDb()
    .prepare(
      `SELECT role, content FROM messages
       WHERE conversation_id = ?
       ORDER BY created_at DESC LIMIT 6`
    )
    .all(conversationId)
    .reverse() as MessageRow[];
}

function dedupeSources(sources: SourceSnippet[]) {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = source.sourceId;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function modeLabel(mode: AnswerMode) {
  return {
    explain_simple: "Explain simply",
    explain_depth: "Explain in depth",
    summarize: "Summarize",
    define_terms: "Define terms",
    give_example: "Give example",
    quiz_me: "Quiz me"
  }[mode];
}

function pageRange(source: SourceSnippet) {
  return source.pageStart === source.pageEnd ? source.pageStart : `${source.pageStart}-${source.pageEnd}`;
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}
