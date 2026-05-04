import { Bookmark, BookmarkPlus, Highlighter, MessageSquareText, Ruler, Search, Trash2, X, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { api, type Book, type ChatAttachment, type Highlight } from "../../api";

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
  | { type: "highlight"; x: number; y: number; highlightIds: string[] };

type ReadingRulerHeight = "small" | "medium" | "large";

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollFrameRef = useRef<HTMLDivElement>(null);
  const programmaticScrollUntil = useRef(0);
  const selectionCache = useRef<{ page: number; text: string } | null>(null);
  const rulerDrag = useRef<{ offsetY: number; pointerId: number } | null>(null);
  const [rulerBounds, setRulerBounds] = useState({ left: 12, width: 0 });

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
    const pageElement = scrollRef.current?.querySelector<HTMLElement>(`[data-page="${currentPage}"]`);
    if (!pageElement) return;
    programmaticScrollUntil.current = Date.now() + 700;
    pageElement.scrollIntoView({ block: "start" });
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
    }
  }

  function openSelectionMenu(event: React.MouseEvent<HTMLDivElement>, page: number) {
    if (event.ctrlKey) {
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
    if (Date.now() < programmaticScrollUntil.current) return;
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
    <section className="pdf-panel">
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
        <label className="search-box">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search loaded text" />
        </label>
        <button className="tool-button" onClick={saveHighlight} disabled={!selectedText.trim()} title="Save highlight">
          <Highlighter size={16} />
        </button>
        <button className="tool-button" onClick={saveBookmark} title="Bookmark page">
          <BookmarkPlus size={16} />
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
      </div>

      {bookmarks.length > 0 && (
        <div className="bookmark-strip">
          {bookmarks.map((bookmark) => (
            <button key={bookmark.id} className={bookmark.page_number === currentPage ? "bookmark-pill active" : "bookmark-pill"} onClick={() => changePage(bookmark.page_number)}>
              <Bookmark size={13} />
              <span>p. {bookmark.page_number}</span>
              <X
                size={13}
                onClick={(event) => {
                  event.stopPropagation();
                  void deleteBookmark(bookmark.id);
                }}
              />
            </button>
          ))}
        </div>
      )}

      <div className="pdf-scroll-frame" ref={scrollFrameRef}>
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
      </div>
      {contextMenu && (
        <div className="selection-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
          {contextMenu.type === "selection" ? (
            <>
              <button onClick={() => draftExplanation(contextMenu.text, contextMenu.page)}>
                <MessageSquareText size={15} />
                <span>Explain in chat</span>
              </button>
              <button onClick={() => void saveHighlightForSelection(contextMenu.text, contextMenu.page)}>
                <Highlighter size={15} />
                <span>Highlight</span>
              </button>
            </>
          ) : (
            <button className="danger-menu-item" onClick={() => void deleteHighlights(contextMenu.highlightIds)}>
              <Trash2 size={15} />
              <span>Remove highlights</span>
            </button>
          )}
        </div>
      )}
    </section>
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
    if (!event.ctrlKey || !canvasRef.current || !surfaceRef.current) return;
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
    if (attachment) onScreenshot(attachment);
  }

  function cancelAreaCapture() {
    dragStart.current = null;
    setCaptureRect(null);
  }

  return (
    <article ref={pageRef} data-page={pageNumber} className={active ? "reader-page active" : "reader-page"}>
      <div
        className={shouldRender ? "pdf-page-surface" : "pdf-page-surface placeholder"}
        ref={surfaceRef}
        onPointerDown={startAreaCapture}
        onPointerMove={updateAreaCapture}
        onPointerUp={finishAreaCapture}
        onPointerCancel={cancelAreaCapture}
        onMouseUp={onSelect}
        onContextMenu={onContextMenu}
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
