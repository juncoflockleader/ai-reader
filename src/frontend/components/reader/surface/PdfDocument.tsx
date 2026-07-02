// PDF reading surface: scrollable page list with two-way page/scroll sync, lazy
// render windowing, on-demand page-text loading, search filtering, highlight
// rendering, drawing/erase, area-capture, the selection/highlight menu, and the
// reading ruler. Reads everything from the ReaderProvider.

import { useEffect, useMemo, useRef, type MouseEvent } from "react";
import { ImagePlus, X } from "lucide-react";
import { useReader } from "../ReaderProvider";
import ReadingSurface from "./ReadingSurface";
import PdfPage from "./PdfPage";
import ReadingRuler from "../overlays/ReadingRuler";
import { bestSelectionText, pageClosestToViewportAnchor, readPdfSelection } from "./pdfHelpers";

const RENDER_WINDOW = 3;

export default function PdfDocument() {
  const {
    book,
    currentPage,
    setCurrentPage,
    zoom,
    activeMode,
    searchQuery,
    setSelectedText,
    setContextMenu,
    onScreenshot,
    exitMode,
    pdf,
    pages,
    loadText,
    tools,
    updateTools,
    annotations,
  } = useReader();

  const scrollRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const programmaticScrollUntil = useRef(0);
  const scrollDrivenPageChange = useRef(false);
  const scrollUpdateFrame = useRef(0);
  const selectionCache = useRef<{ page: number; text: string } | null>(null);

  const captureActive = activeMode === "capture";

  const visiblePages = useMemo(() => {
    const all = Array.from({ length: book.page_count || 0 }, (_, index) => index + 1);
    const query = searchQuery.trim().toLowerCase();
    if (!query) return all;
    return all.filter((page) => pages[page]?.clean_text.toLowerCase().includes(query));
  }, [book.page_count, pages, searchQuery]);

  useEffect(() => {
    [currentPage - 1, currentPage, currentPage + 1]
      .filter((page) => page >= 1 && page <= (book.page_count || 0))
      .forEach(loadText);
  }, [book.page_count, currentPage, loadText]);

  useEffect(() => {
    if (!currentPage) return;
    if (scrollDrivenPageChange.current) {
      scrollDrivenPageChange.current = false;
      return;
    }
    const scroller = scrollRef.current;
    const pageElement = scroller?.querySelector<HTMLElement>(`[data-page="${currentPage}"]`);
    if (!scroller || !pageElement) return;
    programmaticScrollUntil.current = Date.now() + 1200;
    scroller.scrollTo({ top: Math.max(0, pageElement.offsetTop - 16), behavior: "auto" });
  }, [book.id, currentPage]);

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
          setCurrentPage(nextPage);
        }
      });
    };
    scroller.addEventListener("scroll", updatePageFromScroll, { passive: true });
    updatePageFromScroll();
    return () => {
      cancelAnimationFrame(scrollUpdateFrame.current);
      scroller.removeEventListener("scroll", updatePageFromScroll);
    };
  }, [currentPage, setCurrentPage, visiblePages.length, zoom]);

  function captureSelection(event: MouseEvent<HTMLDivElement>, page: number) {
    const text = readPdfSelection(event.currentTarget);
    if (!text) return;
    selectionCache.current = { page, text };
    setSelectedText(text);
    const selection = window.getSelection();
    const rect = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).getBoundingClientRect() : null;
    if (rect && rect.width > 0 && rect.height > 0) {
      setContextMenu({
        type: "selection",
        x: Math.min(rect.left + rect.width / 2, window.innerWidth - 220),
        y: Math.max(18, rect.top - 8),
        page,
        text,
      });
    }
  }

  function openSelectionMenu(event: MouseEvent<HTMLDivElement>, page: number) {
    if (event.ctrlKey || captureActive) {
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
        highlightIds,
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
    setSelectedText(text);
    setContextMenu({
      type: "selection",
      x: Math.min(event.clientX, window.innerWidth - 220),
      y: Math.min(event.clientY, window.innerHeight - 120),
      page,
      text,
    });
  }

  function handleVisible(page: number) {
    if (Date.now() < programmaticScrollUntil.current || page === currentPage) return;
    scrollDrivenPageChange.current = true;
    setCurrentPage(page);
  }

  const frameOverlay = (
    <>
      {tools.rulerEnabled && (
        <ReadingRuler
          frameRef={frameRef}
          scrollRef={scrollRef}
          currentPage={currentPage}
          zoom={zoom}
          visibleCount={visiblePages.length}
          height={tools.rulerHeight}
          color={tools.rulerColor}
          topRatio={tools.rulerTopRatio}
          onTopRatioChange={(ratio) => updateTools({ rulerTopRatio: ratio })}
        />
      )}
      {captureActive && (
        <div className="capture-hint">
          <ImagePlus size={15} />
          <span>Drag on the PDF to capture an area</span>
          <button onClick={() => exitMode()} title="Cancel capture">
            <X size={14} />
          </button>
        </div>
      )}
    </>
  );

  return (
    <ReadingSurface ref={frameRef} scrollRef={scrollRef} typography={tools.typography} frameOverlay={frameOverlay}>
      {visiblePages.map((pageNumber) => (
        <PdfPage
          key={pageNumber}
          pdf={pdf}
          pageNumber={pageNumber}
          active={pageNumber === currentPage}
          highlights={annotations.pageHighlights.filter((h) => h.page_number === pageNumber)}
          shouldRender={Math.abs(pageNumber - currentPage) <= RENDER_WINDOW}
          zoom={zoom}
          onVisible={() => handleVisible(pageNumber)}
          onSelect={(event) => captureSelection(event, pageNumber)}
          onContextMenu={(event) => openSelectionMenu(event, pageNumber)}
          loadText={loadText}
          strokes={tools.showStrokes ? annotations.drawingsByPage[pageNumber] ?? [] : []}
          drawEnabled={tools.drawEnabled}
          drawColor={tools.drawColor}
          eraseMode={tools.eraser}
          areaCaptureEnabled={captureActive}
          onStrokesChange={(strokes, options) => annotations.applyStrokesChange(pageNumber, strokes, options)}
          onScreenshot={onScreenshot}
          onAreaCaptureComplete={() => exitMode()}
        />
      ))}
      {visiblePages.length === 0 && (
        <div
          style={{
            margin: "48px auto",
            maxWidth: 420,
            textAlign: "center",
            color: "var(--text-secondary)",
            fontSize: 14,
            lineHeight: 1.5,
          }}
        >
          No pages match “{searchQuery.trim()}”. Pages load their text as you scroll —
          try scrolling near the section you’re searching.
        </div>
      )}
    </ReadingSurface>
  );
}
