// A single rendered PDF page: canvas + selectable text layer + highlight marks,
// plus the per-page interaction layers (drawing/erase, area-capture, and the
// selection/highlight context menu). Ported from the legacy ReaderPage; reuses
// the existing global pdf classes so rendering is pixel-identical to v1.

import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { ChatAttachment, Highlight } from "../../../api";
import type { Stroke } from "../types";
import {
  applyHighlightMarks,
  captureCanvasRegion,
  clamp,
  localPoint,
  rectFromPoints,
  type PdfTextLayer,
} from "./pdfHelpers";

type PdfPageProps = {
  pdf: PDFDocumentProxy | null;
  pageNumber: number;
  active: boolean;
  highlights: Highlight[];
  shouldRender: boolean;
  zoom: number;
  onVisible: () => void;
  onSelect: (event: MouseEvent<HTMLDivElement>) => void;
  onContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
  loadText: (page: number) => void;
  strokes: Stroke[];
  drawEnabled: boolean;
  drawColor: string;
  eraseMode: boolean;
  areaCaptureEnabled: boolean;
  onStrokesChange: (strokes: Stroke[], options?: { recordHistory?: boolean }) => void;
  onScreenshot: (attachment: ChatAttachment) => void;
  onAreaCaptureComplete: () => void;
};

export default function PdfPage({
  pdf,
  pageNumber,
  active,
  highlights,
  shouldRender,
  zoom,
  onVisible,
  onSelect,
  onContextMenu,
  loadText,
  strokes,
  drawEnabled,
  drawColor,
  eraseMode,
  areaCaptureEnabled,
  onStrokesChange,
  onScreenshot,
  onAreaCaptureComplete,
}: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLElement>(null);
  const dragStart = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const drawStroke = useRef<Stroke | null>(null);
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
      canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
      canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
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
        transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
      });
      const textContent = await page.getTextContent();
      textLayer = new pdfjsLib.TextLayer({
        textContentSource: textContent,
        container: textLayerElement,
        viewport,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, pageNumber, canvasWidth, shouldRender]);

  useEffect(() => {
    if (!textLayerRef.current) return;
    applyHighlightMarks(textLayerRef.current, highlights);
  }, [highlights]);

  // ---- Drawing / eraser ----
  function startDraw(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !surfaceRef.current) return;
    const p = localPoint(event, event.currentTarget);
    const rect = surfaceRef.current.getBoundingClientRect();
    if (eraseMode) {
      const x = clamp(p.x / rect.width, 0, 1);
      const y = clamp(p.y / rect.height, 0, 1);
      const radius = 0.03;
      onStrokesChange(strokes.filter((s) => !s.points.some((pt) => Math.hypot(pt.x - x, pt.y - y) <= radius)));
      return;
    }
    drawStroke.current = { color: drawColor, width: 4, points: [{ x: p.x / rect.width, y: p.y / rect.height }] };
  }
  function moveDraw(event: PointerEvent<HTMLDivElement>) {
    if (!surfaceRef.current) return;
    const p = localPoint(event, event.currentTarget);
    const rect = surfaceRef.current.getBoundingClientRect();
    if (eraseMode) {
      const x = clamp(p.x / rect.width, 0, 1);
      const y = clamp(p.y / rect.height, 0, 1);
      const radius = 0.03;
      onStrokesChange(
        strokes.filter((s) => !s.points.some((pt) => Math.hypot(pt.x - x, pt.y - y) <= radius)),
        { recordHistory: false }
      );
      return;
    }
    if (!drawStroke.current) return;
    drawStroke.current.points.push({ x: clamp(p.x / rect.width, 0, 1), y: clamp(p.y / rect.height, 0, 1) });
    onStrokesChange([...(strokes ?? []), drawStroke.current], { recordHistory: false });
  }
  function endDraw() {
    if (drawStroke.current && !eraseMode) onStrokesChange([...(strokes ?? []), drawStroke.current]);
    drawStroke.current = null;
  }

  // ---- Area capture ----
  function startAreaCapture(event: PointerEvent<HTMLDivElement>) {
    if ((!event.ctrlKey && !areaCaptureEnabled) || !canvasRef.current || !surfaceRef.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = localPoint(event, event.currentTarget);
    dragStart.current = { ...point, pointerId: event.pointerId };
    setCaptureRect({ left: point.x, top: point.y, width: 0, height: 0 });
  }
  function updateAreaCapture(event: PointerEvent<HTMLDivElement>) {
    if (!dragStart.current || dragStart.current.pointerId !== event.pointerId) return;
    event.preventDefault();
    setCaptureRect(rectFromPoints(dragStart.current, localPoint(event, event.currentTarget)));
  }
  function finishAreaCapture(event: PointerEvent<HTMLDivElement>) {
    if (!dragStart.current || dragStart.current.pointerId !== event.pointerId) return;
    event.preventDefault();
    const start = dragStart.current;
    const rect = rectFromPoints(start, localPoint(event, event.currentTarget));
    dragStart.current = null;
    setCaptureRect(null);
    if (rect.width < 8 || rect.height < 8 || !canvasRef.current) return;
    const attachment = captureCanvasRegion(canvasRef.current, rect, pageNumber, Date.now());
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
    <article
      id={`pdf-page-${pageNumber}`}
      ref={pageRef}
      data-page={pageNumber}
      className={active ? "reader-page active" : "reader-page"}
    >
      <div
        className={shouldRender ? "pdf-page-surface" : "pdf-page-surface placeholder"}
        ref={surfaceRef}
        onPointerDown={(event) => {
          startAreaCapture(event);
          if (drawEnabled) startDraw(event);
        }}
        onPointerMove={(event) => {
          updateAreaCapture(event);
          if (drawEnabled) moveDraw(event);
        }}
        onPointerUp={(event) => {
          finishAreaCapture(event);
          if (drawEnabled) endDraw();
        }}
        onPointerCancel={cancelAreaCapture}
        onMouseUp={onSelect}
        onContextMenu={onContextMenu}
        data-capture-mode={areaCaptureEnabled ? "true" : undefined}
        data-draw-mode={drawEnabled ? "true" : undefined}
      >
        {shouldRender ? (
          <>
            <canvas ref={canvasRef} />
            <div className="textLayer" ref={textLayerRef} />
            <svg className="scribble-layer" viewBox="0 0 1 1" preserveAspectRatio="none">
              {strokes.map((stroke, index) => (
                <polyline
                  key={index}
                  points={stroke.points.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="none"
                  stroke={stroke.color}
                  strokeWidth={Math.max(0.001, stroke.width / 1000)}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
            </svg>
            {captureRect && <div className="area-capture-rect" style={captureRect} />}
          </>
        ) : (
          <div className="page-placeholder">Page {pageNumber}</div>
        )}
      </div>
    </article>
  );
}
