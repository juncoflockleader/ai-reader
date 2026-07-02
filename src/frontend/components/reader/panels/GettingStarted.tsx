// "Getting started" panel: an AI page summary in a draggable/resizable floating
// modal, with generate/refresh. Ported from PdfPanel; reuses the global
// `.getting-started-modal` styles and persists its rect per book.

import { useEffect, useRef, useState } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import MarkdownText from "../../common/MarkdownText";
import { useReader } from "../ReaderProvider";
import { readerStorage } from "../hooks/useReaderPersistence";
import { clamp, gettingStartedAdjacentContext } from "../surface/pdfHelpers";

type Rect = { left: number; top: number; width: number; height: number };

export default function GettingStarted() {
  const { book, currentPage, pages, annotations, exitMode } = useReader();
  const [rect, setRect] = useState<Rect>({ left: 0, top: 0, width: 620, height: 520 });
  const [initialized, setInitialized] = useState(false);
  const drag = useRef<{ offsetX: number; offsetY: number } | null>(null);
  const resize = useRef<{ startWidth: number; startHeight: number; startX: number; startY: number } | null>(null);

  // Initialize rect from storage (or centered fallback) + wire drag/resize.
  useEffect(() => {
    if (!initialized) {
      const fallbackWidth = Math.min(620, window.innerWidth - 32);
      const fallbackHeight = Math.min(560, window.innerHeight - 72);
      const fallback: Rect = {
        width: fallbackWidth,
        height: fallbackHeight,
        left: Math.max(16, (window.innerWidth - fallbackWidth) / 2),
        top: Math.max(16, (window.innerHeight - fallbackHeight) * 0.2),
      };
      const parsed = readerStorage.getJSON<Partial<Rect> | null>(
        readerStorage.keys.gettingStartedRect(book.id),
        null
      );
      if (parsed && [parsed.left, parsed.top, parsed.width, parsed.height].every((v) => typeof v === "number" && Number.isFinite(v))) {
        const width = clamp(parsed.width!, 360, window.innerWidth - 8);
        const height = clamp(parsed.height!, 260, window.innerHeight - 8);
        setRect({
          width,
          height,
          left: clamp(parsed.left!, 8, Math.max(8, window.innerWidth - width - 8)),
          top: clamp(parsed.top!, 8, Math.max(8, window.innerHeight - height - 8)),
        });
      } else {
        setRect(fallback);
      }
      setInitialized(true);
    }
    const onMouseMove = (event: MouseEvent) => {
      if (drag.current) {
        setRect((current) => ({
          ...current,
          left: clamp(event.clientX - drag.current!.offsetX, 8, Math.max(8, window.innerWidth - current.width - 8)),
          top: clamp(event.clientY - drag.current!.offsetY, 8, Math.max(8, window.innerHeight - current.height - 8)),
        }));
      } else if (resize.current) {
        setRect((current) => ({
          ...current,
          width: clamp(resize.current!.startWidth + (event.clientX - resize.current!.startX), 360, window.innerWidth - current.left - 8),
          height: clamp(resize.current!.startHeight + (event.clientY - resize.current!.startY), 260, window.innerHeight - current.top - 8),
        }));
      }
    };
    const onMouseUp = () => {
      drag.current = null;
      resize.current = null;
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [book.id, initialized]);

  // Persist rect.
  useEffect(() => {
    if (initialized) readerStorage.setJSON(readerStorage.keys.gettingStartedRect(book.id), rect);
  }, [book.id, rect, initialized]);

  async function generate() {
    const pageText = pages[currentPage]?.clean_text ?? "";
    const contextText = gettingStartedAdjacentContext(pages, currentPage);
    const pageCanvas = document.querySelector<HTMLCanvasElement>(`#pdf-page-${currentPage} canvas`);
    if (!pageCanvas) return;
    await annotations.generateGettingStarted(currentPage, {
      pageText,
      contextText,
      screenshotDataUrl: pageCanvas.toDataURL("image/png"),
    });
  }

  return (
    <div
      className="selection-menu command-palette getting-started-modal"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
    >
      <div
        className="getting-started-header"
        onMouseDown={(event) => {
          const parentRect = event.currentTarget.parentElement?.getBoundingClientRect();
          if (!parentRect) return;
          drag.current = { offsetX: event.clientX - parentRect.left, offsetY: event.clientY - parentRect.top };
        }}
      >
        <h4>Getting started · page {currentPage}</h4>
        <div className="getting-started-header-actions" onMouseDown={(event) => event.stopPropagation()}>
          <button
            type="button"
            className="getting-started-header-button"
            title="Generate or refresh getting started"
            aria-label="Generate or refresh getting started"
            disabled={annotations.gettingStartedLoading}
            onClick={() => void generate()}
          >
            {annotations.gettingStartedLoading ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
          </button>
          <button
            type="button"
            className="getting-started-header-button"
            onClick={() => exitMode()}
            title="Close getting started"
            aria-label="Close getting started"
          >
            <X size={15} />
          </button>
        </div>
      </div>
      <div className="getting-started-content">
        <MarkdownText text={annotations.gettingStartedByPage[currentPage]?.summary_text ?? "No summary yet."} />
      </div>
      {annotations.gettingStartedError ? <p className="inline-error">{annotations.gettingStartedError}</p> : null}
      <button
        className="getting-started-resize-handle"
        aria-label="Resize getting started"
        onMouseDown={(event) => {
          event.preventDefault();
          resize.current = { startWidth: rect.width, startHeight: rect.height, startX: event.clientX, startY: event.clientY };
        }}
      />
    </div>
  );
}
