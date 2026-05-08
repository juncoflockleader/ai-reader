import { Bookmark, BookmarkPlus, Highlighter, ImagePlus, Keyboard, Ruler, Search, Settings2, Trash2, X, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { api, type Book, type ChatAttachment, type Highlight } from "../../api";
import { getAction, listActions } from "../../actions/registry";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).toString();

type Props = {
  book: Book;
  currentPage: number;
  selectedText: string;
  onPageChange: (page: number) => void;
  onSelectedText: (text: string) => void;
  onDraftQuestion: (text: string) => void;
  onScreenshot: (attachment: ChatAttachment) => void;
};

type PageData = {
  pdf_page_number: number;
  clean_text: string;
};

type PdfTextLayer = {
  render: () => Promise<void>;
  cancel: () => void;
};

type PdfContextMenu =
  | { type: "selection"; x: number; y: number; page: number; text: string }
  | { type: "highlight"; x: number; y: number; highlightIds: string[] }
  | { type: "bookmark"; x: number; y: number; bookmarkId: string };

type ReadingRulerHeight = "small" | "medium" | "large";
type ReaderTypographyPreset = "compact" | "comfortable" | "focused";

const rulerHeights: Record<ReadingRulerHeight, number> = {
  small: 36,
  medium: 62,
  large: 96
};

const rulerHeightLabels: Record<ReadingRulerHeight, string> = {
  small: "S",
  medium: "M",
  large: "L"
};

export default function PdfPanel({ book, currentPage, selectedText, onPageChange, onSelectedText, onDraftQuestion, onScreenshot }: Props) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pages, setPages] = useState<Record<number, PageData>>({});
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [query, setQuery] = useState("");
  const [zoom, setZoom] = useState(1);
  const [contextMenu, setContextMenu] = useState<PdfContextMenu | null>(null);
  const [rulerEnabled, setRulerEnabled] = useState(false);
  const [rulerHeight, setRulerHeight] = useState<ReadingRulerHeight>("medium");
  const [rulerColor, setRulerColor] = useState("#5aa9a3");
  const [rulerTopRatio, setRulerTopRatio] = useState(0.42);
  const [areaCaptureEnabled, setAreaCaptureEnabled] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollFrameRef = useRef<HTMLDivElement>(null);
  const programmaticScrollUntil = useRef(0);
  const selectionCache = useRef<{ page: number; text: string } | null>(null);
  const rulerDrag = useRef<{ offsetY: number; pointerId: number } | null>(null);
  const scrollUpdateFrame = useRef(0);
  const scrollDrivenPageChange = useRef(false);
  const [rulerBounds, setRulerBounds] = useState({ left: 12, width: 0 });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [focusModeEnabled, setFocusModeEnabled] = useState(false);
  const [typographyPreset, setTypographyPreset] = useState<ReaderTypographyPreset>("comfortable");
  const [commandQuery, setCommandQuery] = useState("");
  const [showStructureNavigator, setShowStructureNavigator] = useState(false);
  const [hoveredBookmarkId, setHoveredBookmarkId] = useState<string | null>(null);
  const [hoveredBookmarkCardPlacement, setHoveredBookmarkCardPlacement] = useState<"top" | "bottom">("top");
  const [bookmarkHoverCardReady, setBookmarkHoverCardReady] = useState(false);
  const [bookmarkHoverCardOffset, setBookmarkHoverCardOffset] = useState(0);
  const [bookmarkPreviewImages, setBookmarkPreviewImages] = useState<Record<string, string>>({});
  const bookmarkButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const bookmarkHoverCardRef = useRef<HTMLDivElement | null>(null);
  const readingProgressDrag = useRef<{ pointerId: number } | null>(null);
  const bookmarkHoverTimeout = useRef<number | null>(null);



  const clearBookmarkHoverTimeout = () => {
    if (bookmarkHoverTimeout.current) {
      window.clearTimeout(bookmarkHoverTimeout.current);
      bookmarkHoverTimeout.current = null;
    }
  };

  const scheduleBookmarkHoverClose = (bookmarkId: string) => {
    clearBookmarkHoverTimeout();
    bookmarkHoverTimeout.current = window.setTimeout(() => {
      setHoveredBookmarkId((current) => (current === bookmarkId ? null : current));
      setBookmarkHoverCardReady(false);
      setBookmarkHoverCardOffset(0);
    }, 220);
  };

  const openBookmarkHoverCard = (bookmarkId: string) => {
    clearBookmarkHoverTimeout();
    if (hoveredBookmarkId !== bookmarkId) {
      setBookmarkHoverCardReady(false);
      setBookmarkHoverCardOffset(0);
    }
    setHoveredBookmarkId(bookmarkId);
  };

  useLayoutEffect(() => {
    if (!hoveredBookmarkId) return;
    const button = bookmarkButtonRefs.current[hoveredBookmarkId];
    const card = bookmarkHoverCardRef.current;
    if (!button || !card) return;
    const buttonRect = button.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const viewportPadding = 10;
    const cardGap = 10;
    const topFits = buttonRect.top - cardRect.height - cardGap >= viewportPadding;
    const bottomFits = buttonRect.bottom + cardRect.height + cardGap <= window.innerHeight - viewportPadding;
    let horizontalOffset = 0;
    if (cardRect.left < viewportPadding) {
      horizontalOffset = viewportPadding - cardRect.left;
    } else if (cardRect.right > window.innerWidth - viewportPadding) {
      horizontalOffset = window.innerWidth - viewportPadding - cardRect.right;
    }
    setHoveredBookmarkCardPlacement(topFits || !bottomFits ? "top" : "bottom");
    setBookmarkHoverCardOffset(horizontalOffset);
    setBookmarkHoverCardReady(true);
  }, [hoveredBookmarkId, bookmarkPreviewImages]);

  const ensureBookmarkPreviewImage = async (bookmarkId: string, pageNumber: number) => {
    if (bookmarkPreviewImages[bookmarkId] || !pdf) return;
    try {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 0.34 });
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) return;
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      await page.render({ canvasContext: context, viewport }).promise;
      const dataUrl = canvas.toDataURL("image/jpeg", 0.78);
      setBookmarkPreviewImages((current) => (current[bookmarkId] ? current : { ...current, [bookmarkId]: dataUrl }));
    } catch (error) {
      console.error("Failed to render bookmark preview", error);
    }
  };
  const seekFromProgressPointer = (clientX: number, element: HTMLElement) => {
    const bounds = element.getBoundingClientRect();
    if (bounds.width <= 0) return;
    const ratio = clamp((clientX - bounds.left) / bounds.width, 0, 1);
    const totalPages = Math.max(book.page_count || 1, 1);
    const target = Math.min(totalPages, Math.max(1, Math.round(ratio * (totalPages - 1)) + 1));
    if (target !== currentPage) changePage(target);
  };

  useEffect(() => {
    let cancelled = false;
    setPdf(null);
    setPages({});
    setHighlights([]);
    pdfjsLib.getDocument(`/api/books/${book.id}/file`).promise.then((loaded) => {
      if (!cancelled) setPdf(loaded);
    });
    api<{ highlights: Highlight[] }>(`/api/books/${book.id}/highlights`).then((result) => setHighlights(result.highlights));
    return () => {
      cancelled = true;
    };
  }, [book.id]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", close);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!currentPage) return;
    if (scrollDrivenPageChange.current) {
      scrollDrivenPageChange.current = false;
      return;
    }
    const pageElement = scrollRef.current?.querySelector<HTMLElement>(`[data-page="${currentPage}"]`);
    if (!pageElement) return;
    programmaticScrollUntil.current = Date.now() + 1200;
    const scroller = scrollRef.current;
    if (!scroller) return;
    const top = pageElement.offsetTop - 16;
    scroller.scrollTo({ top: Math.max(0, top), behavior: "auto" });
  }, [book.id, currentPage]);

  useEffect(() => {
    if (!book.page_count) return;
    const wanted = [currentPage - 1, currentPage, currentPage + 1].filter((page) => page >= 1 && page <= book.page_count);
    for (const page of wanted) {
      if (!pages[page]) {
        api<{ page: PageData }>(`/api/books/${book.id}/pages/${page}`).then((result) =>
          setPages((current) => ({ ...current, [page]: result.page }))
        );
      }
    }
  }, [book.id, book.page_count, currentPage, pages]);

  const visiblePages = useMemo(() => {
    const all = Array.from({ length: book.page_count || 0 }, (_, index) => index + 1);
    if (!query.trim()) return all;
    return all.filter((page) => pages[page]?.clean_text.toLowerCase().includes(query.toLowerCase()));
  }, [book.page_count, pages, query]);

  useEffect(() => {
    if (!rulerEnabled) return;
    const frame = scrollFrameRef.current;
    const scroller = scrollRef.current;
    if (!frame || !scroller) return;
    let animationFrame = 0;
    const updateBounds = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        const frameBounds = frame.getBoundingClientRect();
        const activeSurface = scroller.querySelector<HTMLElement>(`[data-page="${currentPage}"] .pdf-page-surface`);
        if (!activeSurface) {
          setRulerBounds({ left: 12, width: Math.max(120, frameBounds.width - 24) });
          return;
        }
        const surfaceBounds = activeSurface.getBoundingClientRect();
        const left = clamp(surfaceBounds.left - frameBounds.left, 0, Math.max(0, frameBounds.width - 24));
        const right = clamp(surfaceBounds.right - frameBounds.left, left + 120, frameBounds.width);
        setRulerBounds({ left, width: Math.max(120, right - left) });
      });
    };
    updateBounds();
    const resizeObserver = new ResizeObserver(updateBounds);
    resizeObserver.observe(frame);
    scroller.addEventListener("scroll", updateBounds);
    window.addEventListener("resize", updateBounds);
    const timeout = window.setTimeout(updateBounds, 120);
    return () => {
      cancelAnimationFrame(animationFrame);
      window.clearTimeout(timeout);
      resizeObserver.disconnect();
      scroller.removeEventListener("scroll", updateBounds);
      window.removeEventListener("resize", updateBounds);
    };
  }, [currentPage, rulerEnabled, zoom, visiblePages.length]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const updatePageFromScroll = () => {
      cancelAnimationFrame(scrollUpdateFrame.current);
      scrollUpdateFrame.current = requestAnimationFrame(() => {
        if (Date.now() < programmaticScrollUntil.current) return;
        const nextPage = pageClosestToViewportAnchor(scroller);
        if (nextPage && nextPage !== currentPage) {
          scrollDrivenPageChange.current = true;
          onPageChange(nextPage);
        }
      });
    };
    scroller.addEventListener("scroll", updatePageFromScroll, { passive: true });
    updatePageFromScroll();
    return () => {
      cancelAnimationFrame(scrollUpdateFrame.current);
      scroller.removeEventListener("scroll", updatePageFromScroll);
    };
  }, [currentPage, onPageChange, visiblePages.length, zoom]);


  const inferredHeadings = useMemo(() => {
    return Object.entries(pages)
      .map(([page, data]) => ({ page: Number(page), text: data.clean_text.split(/\n+/).map((line) => line.trim()).find((line) => line.length > 24 && line.length < 120) ?? "" }))
      .filter((entry) => entry.text)
      .slice(0, 80);
  }, [pages]);

  const commandEntries = useMemo(() => {
    const base = [
      ...listActions().map((action) => ({ id: action.id, label: action.label, shortcut: action.shortcut ?? "", run: () => {
        if (action.id === "highlightSelection") void saveHighlightForSelection(selectedText, currentPage);
        if (action.id === "summarizeSelection") draftExplanation(selectedText, currentPage);
      }})),
      { id: "toggleFocus", label: "Toggle focus mode", shortcut: "F", run: () => setFocusModeEnabled((v) => !v) },
      { id: "toggleStructure", label: "Toggle document structure", shortcut: "", run: () => setShowStructureNavigator((v) => !v) }
    ];
    const q = commandQuery.trim().toLowerCase();
    if (!q) return base;
    const score = (label: string) => {
      let i = 0;
      for (const c of label.toLowerCase()) if (c === q[i]) i += 1;
      return i;
    };
    return base
      .map((entry) => ({ entry, score: score(entry.label + " " + entry.id + " " + entry.shortcut) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.entry);
  }, [commandQuery, currentPage, selectedText]);
  useEffect(() => {
    const onKeydown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === "k") {
        event.preventDefault();
        setCommandPaletteOpen((current) => !current);
        setCommandQuery("");
        return;
      }
      if (key === "escape") {
        setCommandPaletteOpen(false);
        setSettingsOpen(false);
      }
      if (commandPaletteOpen) return;
      if (key === "a" && selectedText.trim()) {
        event.preventDefault();
        onDraftQuestion(`Answer a question about this selected passage:\n\n${selectedText}`);
      }
      if (key === "e" && selectedText.trim()) {
        event.preventDefault();
        draftExplanation(selectedText, currentPage);
      }
      if (key === "s" && selectedText.trim()) {
        event.preventDefault();
        draftExplanation(selectedText, currentPage);
      }
      if (key === "n" && selectedText.trim()) {
        event.preventDefault();
        void saveHighlightForSelection(selectedText, currentPage);
      }
      if (key === "f") {
        event.preventDefault();
        setFocusModeEnabled((current) => !current);
      }
    };
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [commandPaletteOpen, currentPage, selectedText]);

  async function saveHighlight() {
    await saveHighlightForSelection(selectedText, currentPage);
  }

  async function saveHighlightForSelection(text: string, page: number) {
    const trimmed = text.trim();
    if (!trimmed) return;
    await api(`/api/books/${book.id}/highlights`, {
      method: "POST",
      body: JSON.stringify({
        page_number: page,
        selected_text: trimmed,
        color: "yellow",
        anchor: {
          page_index: page - 1,
          selected_text: trimmed
        }
      })
    });
    const result = await api<{ highlights: Highlight[] }>(`/api/books/${book.id}/highlights`);
    setHighlights(result.highlights);
    setContextMenu(null);
  }

  async function saveBookmark() {
    await api(`/api/books/${book.id}/highlights`, {
      method: "POST",
      body: JSON.stringify({
        page_number: currentPage,
        selected_text: `Bookmark page ${currentPage}`,
        color: "bookmark",
        note: null,
        anchor: {
          type: "bookmark",
          page_index: currentPage - 1
        }
      })
    });
    const result = await api<{ highlights: Highlight[] }>(`/api/books/${book.id}/highlights`);
    setHighlights(result.highlights);
  }

  async function deleteBookmark(highlightId: string) {
    await api(`/api/highlights/${highlightId}`, { method: "DELETE" });
    setHighlights((current) => current.filter((highlight) => highlight.id !== highlightId));
    setContextMenu((current) => (current?.type === "bookmark" && current.bookmarkId === highlightId ? null : current));
  }

  async function deleteHighlights(highlightIds: string[]) {
    await Promise.all(highlightIds.map((highlightId) => api(`/api/highlights/${highlightId}`, { method: "DELETE" })));
    setHighlights((current) => current.filter((highlight) => !highlightIds.includes(highlight.id)));
    setContextMenu(null);
  }

  function captureSelection(event: React.MouseEvent<HTMLDivElement>, page: number) {
    const text = readPdfSelection(event.currentTarget);
    if (text) {
      selectionCache.current = { page, text };
      onSelectedText(text);
      const selection = window.getSelection();
      const rect = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).getBoundingClientRect() : null;
      if (rect && rect.width > 0 && rect.height > 0) {
        setContextMenu({
          type: "selection",
          x: Math.min(rect.left + rect.width / 2, window.innerWidth - 220),
          y: Math.max(18, rect.top - 8),
          page,
          text
        });
      }
    }
  }

  function openSelectionMenu(event: React.MouseEvent<HTMLDivElement>, page: number) {
    if (event.ctrlKey || areaCaptureEnabled) {
      event.preventDefault();
      setContextMenu(null);
      return;
    }
    const highlightedSpan = (event.target as HTMLElement).closest<HTMLElement>(".saved-highlight");
    const highlightIds = highlightedSpan?.dataset.highlightIds?.split(",").filter(Boolean) ?? [];
    if (highlightIds.length > 0) {
      event.preventDefault();
      setContextMenu({
        type: "highlight",
        x: Math.min(event.clientX, window.innerWidth - 220),
        y: Math.min(event.clientY, window.innerHeight - 80),
        highlightIds
      });
      return;
    }
    const liveText = readPdfSelection(event.currentTarget);
    const cached = selectionCache.current?.page === page ? selectionCache.current.text : "";
    const text = bestSelectionText(liveText, cached);
    if (!text) {
      setContextMenu(null);
      return;
    }
    event.preventDefault();
    onSelectedText(text);
    setContextMenu({
      type: "selection",
      x: Math.min(event.clientX, window.innerWidth - 220),
      y: Math.min(event.clientY, window.innerHeight - 120),
      page,
      text
    });
  }

  function draftExplanation(text: string, page: number) {
    onSelectedText(text);
    onDraftQuestion(`Explain this selected passage from page ${page} in clear study-friendly terms:\n\n${text}`);
    setContextMenu(null);
  }

  function changePage(page: number) {
    const nextPage = clamp(page, 1, book.page_count || 1);
    programmaticScrollUntil.current = Date.now() + 700;
    onPageChange(nextPage);
  }

  function setVisiblePage(page: number) {
    if (Date.now() < programmaticScrollUntil.current || page === currentPage) return;
    scrollDrivenPageChange.current = true;
    onPageChange(page);
  }

  function changeZoom(delta: number) {
    setZoom((current) => clamp(Math.round((current + delta) * 10) / 10, 0.7, 2.5));
  }

  function startRulerDrag(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rulerRect = event.currentTarget.getBoundingClientRect();
    rulerDrag.current = {
      offsetY: event.clientY - rulerRect.top,
      pointerId: event.pointerId
    };
  }

  function updateRulerDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!scrollFrameRef.current || !rulerDrag.current || rulerDrag.current.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const frameBounds = scrollFrameRef.current.getBoundingClientRect();
    const height = rulerHeights[rulerHeight];
    const maxTop = Math.max(1, frameBounds.height - height);
    const nextTop = clamp(event.clientY - frameBounds.top - rulerDrag.current.offsetY, 0, maxTop);
    setRulerTopRatio(nextTop / maxTop);
  }

  function finishRulerDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!rulerDrag.current || rulerDrag.current.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    rulerDrag.current = null;
  }

  const displayHighlights = highlights.filter((highlight) => !isAiNote(highlight));
  const bookmarks = displayHighlights.filter((highlight) => highlight.color === "bookmark" || highlight.anchor?.type === "bookmark");
  const pageHighlights = displayHighlights.filter((highlight) => highlight.color !== "bookmark" && highlight.anchor?.type !== "bookmark");

  return (
    <section className={focusModeEnabled ? "pdf-panel focus-mode" : "pdf-panel"}>
      <div className="panel-toolbar">
        <div className="page-stepper">
          <button onClick={() => changePage(currentPage - 1)}>Prev</button>
          <input
            value={currentPage}
            onChange={(event) => changePage(Number(event.target.value))}
          />
          <span>/ {book.page_count || "..."}</span>
          <button onClick={() => changePage(currentPage + 1)}>Next</button>
        </div>
        {!focusModeEnabled && <label className="search-box">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search loaded text" />
        </label>}
        {(() => {
          const action = getAction("highlightSelection");
          const Icon = action.icon;
          return (
            <button className="tool-button" onClick={saveHighlight} disabled={!selectedText.trim()} title={action.label}>
              <Icon size={16} />
            </button>
          );
        })()}
        <button className="tool-button" onClick={saveBookmark} title="Bookmark page">
          <BookmarkPlus size={16} />
        </button>
        <button
          className={areaCaptureEnabled ? "tool-button active" : "tool-button"}
          onClick={() => setAreaCaptureEnabled((enabled) => !enabled)}
          title="Capture PDF area"
        >
          <ImagePlus size={16} />
        </button>
        <button className={rulerEnabled ? "tool-button active" : "tool-button"} onClick={() => setRulerEnabled((enabled) => !enabled)} title="Reading ruler">
          <Ruler size={16} />
        </button>
        {rulerEnabled && (
          <div className="ruler-controls" aria-label="Reading ruler controls">
            {(["small", "medium", "large"] as const).map((height) => (
              <button
                key={height}
                className={rulerHeight === height ? "ruler-size active" : "ruler-size"}
                onClick={() => setRulerHeight(height)}
                title={`${height} ruler`}
              >
                {rulerHeightLabels[height]}
              </button>
            ))}
            <label className="ruler-color" title="Ruler color">
              <input type="color" value={rulerColor} onChange={(event) => setRulerColor(event.target.value)} />
            </label>
          </div>
        )}
        <div className="zoom-controls" aria-label="PDF zoom controls">
          <button className="tool-button" onClick={() => changeZoom(-0.1)} disabled={zoom <= 0.7} title="Zoom out">
            <ZoomOut size={16} />
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button className="tool-button" onClick={() => changeZoom(0.1)} disabled={zoom >= 2.5} title="Zoom in">
            <ZoomIn size={16} />
          </button>
        </div>
        <button className={settingsOpen ? "tool-button active" : "tool-button"} onClick={() => setSettingsOpen((open) => !open)} title="Reader settings">
          <Settings2 size={16} />
        </button>
        <button className={commandPaletteOpen ? "tool-button active" : "tool-button"} onClick={() => setCommandPaletteOpen((open) => !open)} title="Command palette (Ctrl/Cmd+K)">
          <Keyboard size={16} />
        </button>
      </div>
      <div
        className="reading-progress"
        aria-label="Reading progress"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          if ((event.target as HTMLElement).closest(".progress-bookmark-wrap")) return;
          readingProgressDrag.current = { pointerId: event.pointerId };
          event.currentTarget.setPointerCapture(event.pointerId);
          seekFromProgressPointer(event.clientX, event.currentTarget);
        }}
        onPointerMove={(event) => {
          if (!readingProgressDrag.current || readingProgressDrag.current.pointerId !== event.pointerId) return;
          seekFromProgressPointer(event.clientX, event.currentTarget);
        }}
        onPointerUp={(event) => {
          if (!readingProgressDrag.current || readingProgressDrag.current.pointerId !== event.pointerId) return;
          readingProgressDrag.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={(event) => {
          if (!readingProgressDrag.current || readingProgressDrag.current.pointerId !== event.pointerId) return;
          readingProgressDrag.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }}
      >
        <div className="reading-progress-bar" style={{ width: `${Math.round((currentPage / Math.max(book.page_count || 1, 1)) * 100)}%` }} />
        <span className="reading-progress-page-count">{currentPage}/{book.page_count || 1}</span>
        {!focusModeEnabled && bookmarks.map((bookmark) => {
          const left = ((bookmark.page_number - 1) / Math.max((book.page_count || 1) - 1, 1)) * 100;
          const pageSnippet = pages[bookmark.page_number]?.clean_text.split(/\s+/).slice(0, 18).join(" ") ?? "Page preview is loading...";
          const previewImage = bookmarkPreviewImages[bookmark.id];
          return (
            <div
              key={`progress-bookmark-${bookmark.id}`}
              className={bookmark.page_number === currentPage ? "progress-bookmark-wrap active" : "progress-bookmark-wrap"}
              style={{ left: `${left}%` }}
              onPointerDown={(event) => event.stopPropagation()}
              onMouseEnter={() => {
                openBookmarkHoverCard(bookmark.id);
                void ensureBookmarkPreviewImage(bookmark.id, bookmark.page_number);
              }}
              onMouseLeave={() => scheduleBookmarkHoverClose(bookmark.id)}
              onFocus={() => {
                openBookmarkHoverCard(bookmark.id);
                void ensureBookmarkPreviewImage(bookmark.id, bookmark.page_number);
              }}
              onBlur={(event) => {
                const nextFocused = event.relatedTarget as Node | null;
                if (nextFocused && event.currentTarget.contains(nextFocused)) return;
                scheduleBookmarkHoverClose(bookmark.id);
              }}
            >
              <button
                className="progress-bookmark"
                onClick={() => changePage(bookmark.page_number)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setContextMenu({
                    type: "bookmark",
                    x: Math.min(event.clientX, window.innerWidth - 220),
                    y: Math.min(event.clientY, window.innerHeight - 80),
                    bookmarkId: bookmark.id
                  });
                }}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
                  event.preventDefault();
                  const sorted = [...bookmarks].sort((a, b) => a.page_number - b.page_number);
                  const currentIndex = sorted.findIndex((item) => item.id === bookmark.id);
                  if (currentIndex < 0) return;
                  const offset = event.key === "ArrowRight" ? 1 : -1;
                  const next = sorted[currentIndex + offset];
                  if (!next) return;
                  changePage(next.page_number);
                  bookmarkButtonRefs.current[next.id]?.focus();
                }}
                ref={(element) => {
                  bookmarkButtonRefs.current[bookmark.id] = element;
                }}
                title={`Bookmark · page ${bookmark.page_number}`}
              >
                <Bookmark size={10} />
              </button>
              {hoveredBookmarkId === bookmark.id && (
                <div
                  className="bookmark-hover-card"
                  data-placement={hoveredBookmarkCardPlacement}
                  data-ready={bookmarkHoverCardReady ? "true" : "false"}
                  style={{ "--bookmark-card-offset": `${bookmarkHoverCardOffset}px` } as React.CSSProperties}
                  ref={bookmarkHoverCardRef}
                  onMouseEnter={() => openBookmarkHoverCard(bookmark.id)}
                  onMouseLeave={() => scheduleBookmarkHoverClose(bookmark.id)}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <div className="bookmark-hover-header">
                    <span className="bookmark-page-meta"><Bookmark size={11} /> Page {bookmark.page_number}</span>
                    <button
                      className="bookmark-delete"
                      onClick={(event) => {
                        event.stopPropagation();
                        void deleteBookmark(bookmark.id);
                      }}
                      aria-label={`Delete bookmark on page ${bookmark.page_number}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  <div className="bookmark-mini-preview">
                    {previewImage ? <img src={previewImage} alt={`Preview for page ${bookmark.page_number}`} /> : <span className="bookmark-preview-text">{pageSnippet}</span>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {settingsOpen && (
        <div className="reader-settings-popover">
          <h4>Reader settings</h4>
          <label>Typography & spacing</label>
          <div className="preset-row">
            {(["compact", "comfortable", "focused"] as const).map((preset) => (
              <button key={preset} className={typographyPreset === preset ? "active" : ""} onClick={() => setTypographyPreset(preset)}>
                {preset}
              </button>
            ))}
          </div>
          <label className="toggle-row">
            <input type="checkbox" checked={focusModeEnabled} onChange={(event) => setFocusModeEnabled(event.target.checked)} />
            <span>Focus mode (hide non-critical controls)</span>
          </label>
        </div>
      )}

      <div className={`pdf-scroll-frame ${typographyPreset}`} ref={scrollFrameRef}>
        <div className="pdf-scroll" ref={scrollRef}>
          {visiblePages.map((pageNumber) => (
            <ReaderPage
              key={pageNumber}
              pdf={pdf}
              bookId={book.id}
              pageNumber={pageNumber}
              active={pageNumber === currentPage}
              highlights={pageHighlights.filter((highlight) => highlight.page_number === pageNumber)}
              bookmarked={bookmarks.some((bookmark) => bookmark.page_number === pageNumber)}
              shouldRender={Math.abs(pageNumber - currentPage) <= 3}
              zoom={zoom}
              onVisible={() => setVisiblePage(pageNumber)}
              onSelect={(event) => captureSelection(event, pageNumber)}
              onContextMenu={(event) => openSelectionMenu(event, pageNumber)}
              onScreenshot={onScreenshot}
              areaCaptureEnabled={areaCaptureEnabled}
              onAreaCaptureComplete={() => setAreaCaptureEnabled(false)}
              loadText={(page) => {
                if (!pages[page]) {
                  api<{ page: PageData }>(`/api/books/${book.id}/pages/${page}`).then((result) =>
                    setPages((current) => ({ ...current, [page]: result.page }))
                  );
                }
              }}
            />
          ))}
        </div>
        {rulerEnabled && (
          <div
            className="reading-ruler"
            style={{
              left: `${rulerBounds.left}px`,
              width: `${rulerBounds.width || 320}px`,
              height: `${rulerHeights[rulerHeight]}px`,
              top: `calc(${rulerTopRatio * 100}% - ${rulerTopRatio * rulerHeights[rulerHeight]}px)`,
              backgroundColor: hexToRgba(rulerColor, 0.28),
              borderColor: hexToRgba(rulerColor, 0.62)
            }}
            onPointerDown={startRulerDrag}
            onPointerMove={updateRulerDrag}
            onPointerUp={finishRulerDrag}
            onPointerCancel={finishRulerDrag}
            title="Drag reading ruler"
          />
        )}
        {areaCaptureEnabled && (
          <div className="capture-hint">
            <ImagePlus size={15} />
            <span>Drag on the PDF to capture an area</span>
            <button onClick={() => setAreaCaptureEnabled(false)} title="Cancel capture">
              <X size={14} />
            </button>
          </div>
        )}
      </div>
      {contextMenu && (
        <div className="selection-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
          {contextMenu.type === "selection" ? (
            <>
              {(() => {
                const highlightAction = getAction("highlightSelection");
                const HighlightIcon = highlightAction.icon;
                return (
                  <>
                    <button onClick={() => onDraftQuestion(`Answer a question about this selected passage:\n\n${contextMenu.text}`)} title="Ask (A)">
                      <span>Ask</span>
                    </button>
                    <button onClick={() => draftExplanation(contextMenu.text, contextMenu.page)} title="Explain (E)">
                      <span>Explain</span>
                    </button>
                    <button onClick={() => draftExplanation(contextMenu.text, contextMenu.page)} title="Summarize (S)">
                      <span>Summarize</span>
                    </button>
                    <button onClick={() => void saveHighlightForSelection(contextMenu.text, contextMenu.page)} title="Save note (N)">
                      <HighlightIcon size={15} />
                      <span>Save note</span>
                    </button>
                  </>
                );
              })()}
            </>
          ) : (
            contextMenu.type === "highlight" ? (
              <SelectionRemoveHighlightsButton onRemove={() => void deleteHighlights(contextMenu.highlightIds)} />
            ) : (
              <button className="danger-menu-item" onClick={() => void deleteBookmark(contextMenu.bookmarkId)}>
                <span>Delete bookmark</span>
              </button>
            )
          )}
        </div>
      )}
      {showStructureNavigator && !focusModeEnabled && (
        <div className="doc-structure-nav">
          <h4>Document structure</h4>
          {bookmarks.map((bookmark) => <button key={bookmark.id} onClick={() => changePage(bookmark.page_number)}>Bookmark · p.{bookmark.page_number}</button>)}
          {inferredHeadings.map((heading) => <button key={`${heading.page}-${heading.text}`} onClick={() => changePage(heading.page)}>p.{heading.page} · {heading.text}</button>)}
        </div>
      )}
      {commandPaletteOpen && (
        <div className="selection-menu command-palette" style={{ left: "50%", top: "24%", transform: "translateX(-50%)" }}>
          <input value={commandQuery} onChange={(e) => setCommandQuery(e.target.value)} placeholder="Type an action or shortcut" autoFocus />
          {commandEntries.map((entry) => <button key={entry.id} onClick={() => { entry.run(); setCommandPaletteOpen(false); }}><span>{entry.label}</span>{entry.shortcut ? <kbd>{entry.shortcut}</kbd> : null}</button>)}
        </div>
      )}
    </section>
  );
}


function SelectionRemoveHighlightsButton({ onRemove }: { onRemove: () => void }) {
  const action = getAction("removeHighlights");
  const Icon = action.icon;
  return (
    <button className="danger-menu-item" onClick={onRemove}>
      <Icon size={15} />
      <span>{action.label}</span>
    </button>
  );
}

function ReaderPage({
  pdf,
  pageNumber,
  active,
  highlights,
  bookmarked,
  shouldRender,
  zoom,
  onVisible,
  onSelect,
  onContextMenu,
  onScreenshot,
  areaCaptureEnabled,
  onAreaCaptureComplete,
  loadText
}: {
  pdf: PDFDocumentProxy | null;
  bookId: string;
  pageNumber: number;
  active: boolean;
  highlights: Highlight[];
  bookmarked: boolean;
  shouldRender: boolean;
  zoom: number;
  onVisible: () => void;
  onSelect: (event: React.MouseEvent<HTMLDivElement>) => void;
  onContextMenu: (event: React.MouseEvent<HTMLDivElement>) => void;
  onScreenshot: (attachment: ChatAttachment) => void;
  areaCaptureEnabled: boolean;
  onAreaCaptureComplete: () => void;
  loadText: (page: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLElement>(null);
  const dragStart = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const [fitWidth, setFitWidth] = useState(760);
  const [captureRect, setCaptureRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const canvasWidth = Math.round(fitWidth * zoom);

  useEffect(() => {
    const element = pageRef.current;
    if (!element) return;
    const scrollContainer = element.closest<HTMLElement>(".pdf-scroll");
    if (!scrollContainer) return;
    const resizeObserver = new ResizeObserver(([entry]) => {
      const nextWidth = Math.max(320, Math.floor(entry.contentRect.width - 86));
      setFitWidth(nextWidth);
    });
    resizeObserver.observe(scrollContainer);
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          onVisible();
          loadText(pageNumber);
        }
      },
      { threshold: 0.55 }
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      resizeObserver.disconnect();
    };
  }, [loadText, onVisible, pageNumber]);

  useEffect(() => {
    if (!shouldRender || !pdf || !canvasRef.current || !surfaceRef.current || !textLayerRef.current) return;
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | null = null;
    let textLayer: PdfTextLayer | null = null;
    pdf.getPage(pageNumber).then(async (page) => {
      if (cancelled || !canvasRef.current || !surfaceRef.current || !textLayerRef.current) return;
      const baseViewport = page.getViewport({ scale: 1 });
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const scale = canvasWidth / baseViewport.width;
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      const surface = surfaceRef.current;
      const textLayerElement = textLayerRef.current;
      const context = canvas.getContext("2d");
      if (!context) return;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${Math.round(viewport.width)}px`;
      canvas.style.height = `${Math.round(viewport.height)}px`;
      surface.style.width = `${Math.round(viewport.width)}px`;
      surface.style.height = `${Math.round(viewport.height)}px`;
      textLayerElement.replaceChildren();
      textLayerElement.style.width = `${Math.round(viewport.width)}px`;
      textLayerElement.style.height = `${Math.round(viewport.height)}px`;

      renderTask = page.render({
        canvasContext: context,
        viewport,
        transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0]
      });
      const textContent = await page.getTextContent();
      textLayer = new pdfjsLib.TextLayer({
        textContentSource: textContent,
        container: textLayerElement,
        viewport
      }) as PdfTextLayer;

      await Promise.all([renderTask.promise, textLayer.render()]).catch((error: unknown) => {
        if (!cancelled) throw error;
      });
      if (!cancelled) applyHighlightMarks(textLayerElement, highlights);
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [pdf, pageNumber, canvasWidth, shouldRender]);

  useEffect(() => {
    if (!textLayerRef.current) return;
    applyHighlightMarks(textLayerRef.current, highlights);
  }, [highlights]);

  function startAreaCapture(event: React.PointerEvent<HTMLDivElement>) {
    if ((!event.ctrlKey && !areaCaptureEnabled) || !canvasRef.current || !surfaceRef.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = localPoint(event, event.currentTarget);
    dragStart.current = { ...point, pointerId: event.pointerId };
    setCaptureRect({ left: point.x, top: point.y, width: 0, height: 0 });
  }

  function updateAreaCapture(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragStart.current || dragStart.current.pointerId !== event.pointerId) return;
    event.preventDefault();
    const point = localPoint(event, event.currentTarget);
    setCaptureRect(rectFromPoints(dragStart.current, point));
  }

  function finishAreaCapture(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragStart.current || dragStart.current.pointerId !== event.pointerId) return;
    event.preventDefault();
    const start = dragStart.current;
    const rect = rectFromPoints(start, localPoint(event, event.currentTarget));
    dragStart.current = null;
    setCaptureRect(null);
    if (rect.width < 8 || rect.height < 8 || !canvasRef.current) return;
    const attachment = captureCanvasRegion(canvasRef.current, rect, pageNumber);
    if (attachment) {
      onScreenshot(attachment);
      onAreaCaptureComplete();
    }
  }

  function cancelAreaCapture() {
    dragStart.current = null;
    setCaptureRect(null);
  }

  return (
    <article id={`pdf-page-${pageNumber}`} ref={pageRef} data-page={pageNumber} className={active ? "reader-page active" : "reader-page"}>
      <div
        className={shouldRender ? "pdf-page-surface" : "pdf-page-surface placeholder"}
        ref={surfaceRef}
        onPointerDown={startAreaCapture}
        onPointerMove={updateAreaCapture}
        onPointerUp={finishAreaCapture}
        onPointerCancel={cancelAreaCapture}
        onMouseUp={onSelect}
        onContextMenu={onContextMenu}
        data-capture-mode={areaCaptureEnabled ? "true" : undefined}
      >
        {shouldRender ? (
          <>
            <canvas ref={canvasRef} />
            <div className="textLayer" ref={textLayerRef} />
            {captureRect && <div className="area-capture-rect" style={captureRect} />}
          </>
        ) : (
          <div className="page-placeholder">Page {pageNumber}</div>
        )}
      </div>
    </article>
  );
}

function applyHighlightMarks(textLayerElement: HTMLDivElement, highlights: Highlight[]) {
  const spans = Array.from(textLayerElement.querySelectorAll("span"));
  for (const span of spans) {
    span.classList.remove("saved-highlight");
    delete span.dataset.highlightIds;
  }
  for (const highlight of highlights) {
    const pieces = normalizedPieces(highlight.selected_text);
    if (pieces.length === 0) continue;
    for (const span of spans) {
      const text = normalizeText(span.textContent ?? "");
      if (!text) continue;
      if (pieces.some((piece) => piece.length > 2 && (text.includes(piece) || piece.includes(text)))) {
        span.classList.add("saved-highlight");
        const ids = span.dataset.highlightIds ? span.dataset.highlightIds.split(",") : [];
        if (!ids.includes(highlight.id)) {
          span.dataset.highlightIds = [...ids, highlight.id].join(",");
        }
      }
    }
  }
}

function normalizedPieces(text: string) {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  const words = normalized.split(" ").filter(Boolean);
  const pieces = [normalized];
  for (let index = 0; index < words.length; index += 4) {
    const piece = words.slice(index, index + 8).join(" ");
    if (piece.length > 12) pieces.push(piece);
  }
  return pieces;
}

function normalizeText(text: string) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function readPdfSelection(surface: EventTarget & HTMLDivElement) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return "";
  const range = selection.getRangeAt(0);
  if (!range.intersectsNode(surface)) return "";
  const nativeText = selection.toString().trim();
  const spanText = textFromSelectedSpans(surface, range);
  return bestSelectionText(nativeText, spanText);
}

function textFromSelectedSpans(surface: HTMLDivElement, range: Range) {
  const spans = Array.from(surface.querySelectorAll<HTMLSpanElement>(".textLayer span"));
  const pieces = spans.flatMap((span) => {
    if (!range.intersectsNode(span)) return [];
    const text = span.textContent ?? "";
    if (!text) return [];
    if (isNodeInside(range.startContainer, span) && isNodeInside(range.endContainer, span)) {
      return [text.slice(range.startOffset, range.endOffset)];
    }
    if (isNodeInside(range.startContainer, span)) return [text.slice(range.startOffset)];
    if (isNodeInside(range.endContainer, span)) return [text.slice(0, range.endOffset)];
    return [text];
  });
  return pieces.join(" ").replace(/\s+/g, " ").trim();
}

function isNodeInside(node: Node, element: HTMLElement) {
  return node === element || element.contains(node);
}

function bestSelectionText(primary: string, fallback: string) {
  const primaryText = primary.trim();
  const fallbackText = fallback.trim();
  return normalizeText(fallbackText).length > normalizeText(primaryText).length ? fallbackText : primaryText;
}

function isAiNote(highlight: Highlight) {
  return highlight.anchor?.type === "ai_note" || (highlight.color === "blue" && highlight.selected_text.startsWith("AI note on page "));
}

function pageClosestToViewportAnchor(scroller: HTMLDivElement) {
  const scrollerBounds = scroller.getBoundingClientRect();
  const anchorY = scrollerBounds.top + scrollerBounds.height * 0.38;
  const pageElements = Array.from(scroller.querySelectorAll<HTMLElement>("[data-page]"));
  let closestPage = 0;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const element of pageElements) {
    const bounds = element.getBoundingClientRect();
    const intersectsViewport = bounds.bottom >= scrollerBounds.top && bounds.top <= scrollerBounds.bottom;
    if (!intersectsViewport) continue;
    const clampedAnchor = clamp(anchorY, bounds.top, bounds.bottom);
    const distance = Math.abs(clampedAnchor - anchorY);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestPage = Number(element.dataset.page);
    }
  }
  return Number.isFinite(closestPage) ? closestPage : 0;
}

function localPoint(event: React.PointerEvent<HTMLDivElement>, element: HTMLDivElement) {
  const bounds = element.getBoundingClientRect();
  return {
    x: clamp(event.clientX - bounds.left, 0, bounds.width),
    y: clamp(event.clientY - bounds.top, 0, bounds.height)
  };
}

function rectFromPoints(start: { x: number; y: number }, end: { x: number; y: number }) {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y)
  };
}

function captureCanvasRegion(canvas: HTMLCanvasElement, rect: { left: number; top: number; width: number; height: number }, page: number): ChatAttachment | null {
  const cssWidth = canvas.clientWidth;
  const cssHeight = canvas.clientHeight;
  if (!cssWidth || !cssHeight) return null;
  const scaleX = canvas.width / cssWidth;
  const scaleY = canvas.height / cssHeight;
  const sourceX = Math.round(rect.left * scaleX);
  const sourceY = Math.round(rect.top * scaleY);
  const sourceWidth = Math.round(rect.width * scaleX);
  const sourceHeight = Math.round(rect.height * scaleY);
  if (sourceWidth < 8 || sourceHeight < 8) return null;
  const output = document.createElement("canvas");
  output.width = sourceWidth;
  output.height = sourceHeight;
  const context = output.getContext("2d");
  if (!context) return null;
  context.drawImage(canvas, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
  return {
    id: `shot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: "image",
    dataUrl: output.toDataURL("image/png"),
    mimeType: "image/png",
    page,
    label: `Screenshot from page ${page}`
  };
}

function hexToRgba(hex: string, alpha: number) {
  const normalized = hex.replace("#", "");
  const value = normalized.length === 3
    ? normalized.split("").map((char) => `${char}${char}`).join("")
    : normalized;
  const numeric = Number.parseInt(value, 16);
  if (!Number.isFinite(numeric)) return `rgba(90, 169, 163, ${alpha})`;
  const red = (numeric >> 16) & 255;
  const green = (numeric >> 8) & 255;
  const blue = numeric & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
