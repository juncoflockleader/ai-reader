// Reading progress bar with bookmark pips and hover preview cards. Drag to seek;
// right-click a pip to remove it. Ported from PdfPanel; reuses the global
// `.reading-progress` / `.bookmark-hover-card` styles. Preview thumbnails are
// rendered on demand from the pdf.js document.

import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import { Bookmark, Trash2 } from "lucide-react";
import { useReader } from "../ReaderProvider";
import { clamp } from "../surface/pdfHelpers";

export default function ReadingProgress() {
  const { book, currentPage, setCurrentPage, pdf, pages, annotations, setContextMenu } = useReader();
  const { bookmarks } = annotations;

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [cardPlacement, setCardPlacement] = useState<"top" | "bottom">("top");
  const [cardReady, setCardReady] = useState(false);
  const [cardOffset, setCardOffset] = useState(0);
  const [previewImages, setPreviewImages] = useState<Record<string, string>>({});

  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const cardRef = useRef<HTMLDivElement | null>(null);
  const hoverTimeout = useRef<number | null>(null);
  const progressDrag = useRef<{ pointerId: number } | null>(null);

  const totalPages = Math.max(book.page_count || 1, 1);

  const clearHoverTimeout = () => {
    if (hoverTimeout.current) {
      window.clearTimeout(hoverTimeout.current);
      hoverTimeout.current = null;
    }
  };
  const scheduleClose = (id: string) => {
    clearHoverTimeout();
    hoverTimeout.current = window.setTimeout(() => {
      setHoveredId((current) => (current === id ? null : current));
      setCardReady(false);
      setCardOffset(0);
    }, 220);
  };
  const openCard = (id: string) => {
    clearHoverTimeout();
    if (hoveredId !== id) {
      setCardReady(false);
      setCardOffset(0);
    }
    setHoveredId(id);
  };

  useLayoutEffect(() => {
    if (!hoveredId) return;
    const button = buttonRefs.current[hoveredId];
    const card = cardRef.current;
    if (!button || !card) return;
    const buttonRect = button.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const viewportPadding = 10;
    const cardGap = 10;
    const topFits = buttonRect.top - cardRect.height - cardGap >= viewportPadding;
    const bottomFits = buttonRect.bottom + cardRect.height + cardGap <= window.innerHeight - viewportPadding;
    let horizontalOffset = 0;
    if (cardRect.left < viewportPadding) horizontalOffset = viewportPadding - cardRect.left;
    else if (cardRect.right > window.innerWidth - viewportPadding) horizontalOffset = window.innerWidth - viewportPadding - cardRect.right;
    setCardPlacement(topFits || !bottomFits ? "top" : "bottom");
    setCardOffset(horizontalOffset);
    setCardReady(true);
  }, [hoveredId, previewImages]);

  async function ensurePreviewImage(id: string, pageNumber: number) {
    if (previewImages[id] || !pdf) return;
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
      setPreviewImages((current) => (current[id] ? current : { ...current, [id]: dataUrl }));
    } catch {
      // Ignore preview render failures.
    }
  }

  function seekFromPointer(clientX: number, element: HTMLElement) {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    const target = Math.min(totalPages, Math.max(1, Math.round(ratio * (totalPages - 1)) + 1));
    if (target !== currentPage) setCurrentPage(target);
  }

  return (
    <div
      className="reading-progress"
      aria-label="Reading progress"
      onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        if ((event.target as HTMLElement).closest(".progress-bookmark-wrap")) return;
        progressDrag.current = { pointerId: event.pointerId };
        event.currentTarget.setPointerCapture(event.pointerId);
        seekFromPointer(event.clientX, event.currentTarget);
      }}
      onPointerMove={(event) => {
        if (!progressDrag.current || progressDrag.current.pointerId !== event.pointerId) return;
        seekFromPointer(event.clientX, event.currentTarget);
      }}
      onPointerUp={(event) => {
        if (!progressDrag.current || progressDrag.current.pointerId !== event.pointerId) return;
        progressDrag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={(event) => {
        if (!progressDrag.current || progressDrag.current.pointerId !== event.pointerId) return;
        progressDrag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
    >
      <div className="reading-progress-bar" style={{ width: `${Math.round((currentPage / totalPages) * 100)}%` }} />
      <span className="reading-progress-page-count">{currentPage}/{book.page_count || 1}</span>
      {bookmarks.map((bookmark) => {
        const left = ((bookmark.page_number - 1) / Math.max(totalPages - 1, 1)) * 100;
        const snippet = pages[bookmark.page_number]?.clean_text.split(/\s+/).slice(0, 18).join(" ") ?? "Page preview is loading...";
        const previewImage = previewImages[bookmark.id];
        return (
          <div
            key={`progress-bookmark-${bookmark.id}`}
            className={bookmark.page_number === currentPage ? "progress-bookmark-wrap active" : "progress-bookmark-wrap"}
            style={{ left: `${left}%` }}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseEnter={() => {
              openCard(bookmark.id);
              void ensurePreviewImage(bookmark.id, bookmark.page_number);
            }}
            onMouseLeave={() => scheduleClose(bookmark.id)}
            onFocus={() => {
              openCard(bookmark.id);
              void ensurePreviewImage(bookmark.id, bookmark.page_number);
            }}
            onBlur={(event) => {
              const nextFocused = event.relatedTarget as Node | null;
              if (nextFocused && event.currentTarget.contains(nextFocused)) return;
              scheduleClose(bookmark.id);
            }}
          >
            <button
              className="progress-bookmark"
              onClick={() => setCurrentPage(bookmark.page_number)}
              onContextMenu={(event) => {
                event.preventDefault();
                setContextMenu({
                  type: "bookmark",
                  x: Math.min(event.clientX, window.innerWidth - 220),
                  y: Math.min(event.clientY, window.innerHeight - 80),
                  bookmarkId: bookmark.id,
                });
              }}
              onKeyDown={(event) => {
                if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
                event.preventDefault();
                const sorted = [...bookmarks].sort((a, b) => a.page_number - b.page_number);
                const index = sorted.findIndex((item) => item.id === bookmark.id);
                if (index < 0) return;
                const next = sorted[index + (event.key === "ArrowRight" ? 1 : -1)];
                if (!next) return;
                setCurrentPage(next.page_number);
                buttonRefs.current[next.id]?.focus();
              }}
              ref={(element) => {
                buttonRefs.current[bookmark.id] = element;
              }}
              title={`Bookmark · page ${bookmark.page_number}`}
            >
              <Bookmark size={10} />
            </button>
            {hoveredId === bookmark.id && (
              <div
                className="bookmark-hover-card"
                data-placement={cardPlacement}
                data-ready={cardReady ? "true" : "false"}
                style={{ "--bookmark-card-offset": `${cardOffset}px` } as CSSProperties}
                ref={cardRef}
                onMouseEnter={() => openCard(bookmark.id)}
                onMouseLeave={() => scheduleClose(bookmark.id)}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <div className="bookmark-hover-header">
                  <span className="bookmark-page-meta"><Bookmark size={11} /> Page {bookmark.page_number}</span>
                  <button
                    className="bookmark-delete"
                    onClick={(event) => {
                      event.stopPropagation();
                      void annotations.deleteBookmark(bookmark.id);
                    }}
                    aria-label={`Delete bookmark on page ${bookmark.page_number}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                <div className="bookmark-mini-preview">
                  {previewImage ? (
                    <img src={previewImage} alt={`Preview for page ${bookmark.page_number}`} />
                  ) : (
                    <span className="bookmark-preview-text">{snippet}</span>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
