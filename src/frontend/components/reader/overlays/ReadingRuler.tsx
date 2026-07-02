// Draggable reading ruler overlay. Ported from PdfPanel; tracks the active page
// surface so the ruler spans the page width, and supports pointer (mouse/touch/
// pen) dragging via setPointerCapture.

import { useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { clamp, hexToRgba } from "../surface/pdfHelpers";
import { RULER_HEIGHTS, type ReadingRulerHeight } from "../types";

type ReadingRulerProps = {
  frameRef: RefObject<HTMLDivElement | null>;
  scrollRef: RefObject<HTMLDivElement | null>;
  currentPage: number;
  zoom: number;
  visibleCount: number;
  height: ReadingRulerHeight;
  color: string;
  topRatio: number;
  onTopRatioChange: (ratio: number) => void;
};

export default function ReadingRuler({
  frameRef,
  scrollRef,
  currentPage,
  zoom,
  visibleCount,
  height,
  color,
  topRatio,
  onTopRatioChange,
}: ReadingRulerProps) {
  const [bounds, setBounds] = useState({ left: 12, width: 0 });
  const drag = useRef<{ offsetY: number; pointerId: number } | null>(null);
  const rulerHeight = RULER_HEIGHTS[height];

  useEffect(() => {
    const frame = frameRef.current;
    const scroller = scrollRef.current;
    if (!frame || !scroller) return;
    let animationFrame = 0;
    const updateBounds = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        const frameBounds = frame.getBoundingClientRect();
        const activeSurface = scroller.querySelector<HTMLElement>(`[data-page="${currentPage}"] .pdf-page-surface`);
        if (!activeSurface) {
          setBounds({ left: 12, width: Math.max(120, frameBounds.width - 24) });
          return;
        }
        const surfaceBounds = activeSurface.getBoundingClientRect();
        const left = clamp(surfaceBounds.left - frameBounds.left, 0, Math.max(0, frameBounds.width - 24));
        const right = clamp(surfaceBounds.right - frameBounds.left, left + 120, frameBounds.width);
        setBounds({ left, width: Math.max(120, right - left) });
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
  }, [currentPage, zoom, visibleCount, frameRef, scrollRef]);

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    drag.current = { offsetY: event.clientY - rect.top, pointerId: event.pointerId };
  }
  function updateDrag(event: PointerEvent<HTMLDivElement>) {
    if (!frameRef.current || !drag.current || drag.current.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const frameBounds = frameRef.current.getBoundingClientRect();
    const maxTop = Math.max(1, frameBounds.height - rulerHeight);
    const nextTop = clamp(event.clientY - frameBounds.top - drag.current.offsetY, 0, maxTop);
    onTopRatioChange(nextTop / maxTop);
  }
  function finishDrag(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    drag.current = null;
  }

  return (
    <div
      className="reading-ruler"
      style={{
        left: `${bounds.left}px`,
        width: `${bounds.width || 320}px`,
        height: `${rulerHeight}px`,
        top: `calc(${topRatio * 100}% - ${topRatio * rulerHeight}px)`,
        backgroundColor: hexToRgba(color, 0.28),
        borderColor: hexToRgba(color, 0.62),
      }}
      onPointerDown={startDrag}
      onPointerMove={updateDrag}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      title="Drag reading ruler"
    />
  );
}
