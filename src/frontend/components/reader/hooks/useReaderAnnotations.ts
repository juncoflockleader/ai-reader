// Owns all reader annotation data for a book: highlights, bookmarks, drawings
// (with per-page undo/redo), and getting-started summaries — plus the CRUD that
// persists them. Lifted out of PdfPanel so the toolbar, surface, footer, and
// menus share one source of truth via the ReaderProvider.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type Book, type Highlight } from "../../../api";
import type { GettingStartedItem, Stroke } from "../types";
import { isAiNote, normalizeGettingStartedItem } from "../surface/pdfHelpers";

export type ReaderAnnotations = ReturnType<typeof useReaderAnnotations>;

export function useReaderAnnotations(book: Book, currentPage: number) {
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [drawingsByPage, setDrawingsByPage] = useState<Record<number, Stroke[]>>({});
  const [gettingStartedByPage, setGettingStartedByPage] = useState<Record<number, GettingStartedItem>>({});
  const [gettingStartedLoading, setGettingStartedLoading] = useState(false);
  const [gettingStartedError, setGettingStartedError] = useState<string | null>(null);

  const undoHistory = useRef<Record<number, Stroke[][]>>({});
  const redoHistory = useRef<Record<number, Stroke[][]>>({});

  // Load highlights when the book changes.
  useEffect(() => {
    let cancelled = false;
    setHighlights([]);
    setDrawingsByPage({});
    setGettingStartedByPage({});
    undoHistory.current = {};
    redoHistory.current = {};
    api<{ highlights: Highlight[] }>(`/api/books/${book.id}/highlights`)
      .then((result) => {
        if (!cancelled) setHighlights(result.highlights);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [book.id]);

  // Prefetch drawings + getting-started around the current page.
  useEffect(() => {
    const from = Math.max(1, currentPage - 4);
    const to = currentPage + 4;
    api<{ drawings: Array<{ page_number: number; strokes: Stroke[]; overlay_type?: string }> }>(
      `/api/books/${book.id}/drawings?from_page=${from}&to_page=${to}`
    )
      .then((result) => {
        const next: Record<number, Stroke[]> = {};
        for (const row of result.drawings) {
          if ((row.overlay_type ?? "scribble") !== "scribble") continue;
          next[row.page_number] = row.strokes;
        }
        setDrawingsByPage((current) => ({ ...current, ...next }));
      })
      .catch(() => undefined);
    api<{ item: GettingStartedItem | null }>(`/api/books/${book.id}/getting-started/${currentPage}`)
      .then((result) => {
        if (!result.item) return;
        setGettingStartedByPage((current) => ({ ...current, [currentPage]: normalizeGettingStartedItem(result.item!) }));
      })
      .catch(() => undefined);
  }, [book.id, currentPage]);

  const refreshHighlights = useCallback(async () => {
    const result = await api<{ highlights: Highlight[] }>(`/api/books/${book.id}/highlights`);
    setHighlights(result.highlights);
  }, [book.id]);

  const saveHighlightForSelection = useCallback(
    async (text: string, page: number) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      await api(`/api/books/${book.id}/highlights`, {
        method: "POST",
        body: JSON.stringify({
          page_number: page,
          selected_text: trimmed,
          color: "yellow",
          anchor: { page_index: page - 1, selected_text: trimmed },
        }),
      });
      await refreshHighlights();
    },
    [book.id, refreshHighlights]
  );

  const saveBookmark = useCallback(
    async (page: number) => {
      await api(`/api/books/${book.id}/highlights`, {
        method: "POST",
        body: JSON.stringify({
          page_number: page,
          selected_text: `Bookmark page ${page}`,
          color: "bookmark",
          note: null,
          anchor: { type: "bookmark", page_index: page - 1 },
        }),
      });
      await refreshHighlights();
    },
    [book.id, refreshHighlights]
  );

  const deleteBookmark = useCallback(async (highlightId: string) => {
    await api(`/api/highlights/${highlightId}`, { method: "DELETE" });
    setHighlights((current) => current.filter((h) => h.id !== highlightId));
  }, []);

  const deleteHighlights = useCallback(async (highlightIds: string[]) => {
    await Promise.all(highlightIds.map((id) => api(`/api/highlights/${id}`, { method: "DELETE" })));
    setHighlights((current) => current.filter((h) => !highlightIds.includes(h.id)));
  }, []);

  const applyStrokesChange = useCallback(
    (pageNumber: number, nextStrokes: Stroke[], options?: { recordHistory?: boolean }) => {
      const recordHistory = options?.recordHistory ?? true;
      setDrawingsByPage((current) => {
        const previous = current[pageNumber] ?? [];
        if (recordHistory) {
          const undoStack = undoHistory.current[pageNumber] ?? [];
          undoHistory.current[pageNumber] = [
            ...undoStack,
            previous.map((stroke) => ({ ...stroke, points: [...stroke.points] })),
          ].slice(-100);
          redoHistory.current[pageNumber] = [];
        }
        return { ...current, [pageNumber]: nextStrokes };
      });
      void api(`/api/books/${book.id}/drawings/${pageNumber}`, {
        method: "PUT",
        body: JSON.stringify({ strokes: nextStrokes, overlay_type: "scribble" }),
      });
    },
    [book.id]
  );

  const undo = useCallback(
    (pageNumber: number) => {
      const undoStack = undoHistory.current[pageNumber] ?? [];
      if (!undoStack.length) return;
      const previous = undoStack[undoStack.length - 1];
      undoHistory.current[pageNumber] = undoStack.slice(0, -1);
      setDrawingsByPage((current) => {
        const redoStack = redoHistory.current[pageNumber] ?? [];
        redoHistory.current[pageNumber] = [...redoStack, current[pageNumber] ?? []];
        return { ...current, [pageNumber]: previous };
      });
      void api(`/api/books/${book.id}/drawings/${pageNumber}`, {
        method: "PUT",
        body: JSON.stringify({ strokes: previous, overlay_type: "scribble" }),
      });
    },
    [book.id]
  );

  const redo = useCallback(
    (pageNumber: number) => {
      const redoStack = redoHistory.current[pageNumber] ?? [];
      if (!redoStack.length) return;
      const next = redoStack[redoStack.length - 1];
      redoHistory.current[pageNumber] = redoStack.slice(0, -1);
      setDrawingsByPage((current) => {
        const undoStack = undoHistory.current[pageNumber] ?? [];
        undoHistory.current[pageNumber] = [...undoStack, current[pageNumber] ?? []].slice(-100);
        return { ...current, [pageNumber]: next };
      });
      void api(`/api/books/${book.id}/drawings/${pageNumber}`, {
        method: "PUT",
        body: JSON.stringify({ strokes: next, overlay_type: "scribble" }),
      });
    },
    [book.id]
  );

  const clearPage = useCallback(
    (pageNumber: number) => {
      applyStrokesChange(pageNumber, []);
    },
    [applyStrokesChange]
  );

  const generateGettingStarted = useCallback(
    async (page: number, payload: { pageText: string; contextText: string; screenshotDataUrl: string }) => {
      setGettingStartedLoading(true);
      setGettingStartedError(null);
      try {
        const timeout = new Promise<never>((_, reject) =>
          window.setTimeout(() => reject(new Error("Getting started timed out after 45 seconds.")), 45_000)
        );
        const request = api<{ item: GettingStartedItem }>(`/api/books/${book.id}/getting-started/${page}`, {
          method: "POST",
          body: JSON.stringify({
            screenshot_data_url: payload.screenshotDataUrl,
            page_text: payload.pageText,
            page_context_text: payload.contextText,
          }),
        });
        const result = await Promise.race([request, timeout]);
        setGettingStartedByPage((current) => ({ ...current, [page]: normalizeGettingStartedItem(result.item) }));
      } catch (error) {
        setGettingStartedError(error instanceof Error ? error.message : "Could not generate getting started content.");
      } finally {
        setGettingStartedLoading(false);
      }
    },
    [book.id]
  );

  const displayHighlights = useMemo(() => highlights.filter((h) => !isAiNote(h)), [highlights]);
  const bookmarks = useMemo(
    () => displayHighlights.filter((h) => h.color === "bookmark" || h.anchor?.type === "bookmark"),
    [displayHighlights]
  );
  const pageHighlights = useMemo(
    () => displayHighlights.filter((h) => h.color !== "bookmark" && h.anchor?.type !== "bookmark"),
    [displayHighlights]
  );

  return {
    highlights,
    displayHighlights,
    bookmarks,
    pageHighlights,
    drawingsByPage,
    gettingStartedByPage,
    gettingStartedLoading,
    gettingStartedError,
    saveHighlightForSelection,
    saveBookmark,
    deleteBookmark,
    deleteHighlights,
    applyStrokesChange,
    undo,
    redo,
    clearPage,
    generateGettingStarted,
  };
}
