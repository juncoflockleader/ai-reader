// Pure helpers ported verbatim from the legacy PdfPanel so the v2 reading
// surface renders, selects, highlights, and tracks scroll position identically.
// Keeping these as free functions (no component state) makes them unit-testable
// and shared between PdfPage / PdfDocument.

import type { ChatAttachment, Highlight } from "../../../api";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { GettingStartedItem } from "../types";

export type PdfTextLayer = {
  render: () => Promise<void>;
  cancel: () => void;
};

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizedPieces(text: string): string[] {
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

/** Mark text-layer spans that fall inside a saved highlight (drives the highlight tint + click target). */
export function applyHighlightMarks(textLayerElement: HTMLDivElement, highlights: Highlight[]): void {
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

function isNodeInside(node: Node, element: HTMLElement): boolean {
  return node === element || element.contains(node);
}

function textFromSelectedSpans(surface: HTMLElement, range: Range): string {
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

export function bestSelectionText(primary: string, fallback: string): string {
  const primaryText = primary.trim();
  const fallbackText = fallback.trim();
  return normalizeText(fallbackText).length > normalizeText(primaryText).length ? fallbackText : primaryText;
}

/** Read the current text selection within a page surface, preferring span-accurate text. */
export function readPdfSelection(surface: HTMLElement): string {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return "";
  const range = selection.getRangeAt(0);
  if (!range.intersectsNode(surface)) return "";
  const nativeText = selection.toString().trim();
  const spanText = textFromSelectedSpans(surface, range);
  return bestSelectionText(nativeText, spanText);
}

/** Which page sits under the reading anchor line (38% down the viewport). Drives scroll → page sync. */
export function pageClosestToViewportAnchor(scroller: HTMLElement): number {
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

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const editable = target.closest("input, textarea, select, [contenteditable]");
  if (!editable) return false;
  return (
    editable instanceof HTMLInputElement ||
    editable instanceof HTMLTextAreaElement ||
    editable instanceof HTMLSelectElement ||
    (editable instanceof HTMLElement && editable.isContentEditable)
  );
}

export function isSelectionShortcutEvent(event: KeyboardEvent): boolean {
  return event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
}

export function isAiNote(highlight: Highlight): boolean {
  return (
    highlight.anchor?.type === "ai_note" ||
    (highlight.color === "blue" && highlight.selected_text.startsWith("AI note on page "))
  );
}

/** Pointer position relative to an element, clamped to its bounds. */
export function localPoint(event: ReactPointerEvent<HTMLDivElement>, element: HTMLDivElement) {
  const bounds = element.getBoundingClientRect();
  return {
    x: clamp(event.clientX - bounds.left, 0, bounds.width),
    y: clamp(event.clientY - bounds.top, 0, bounds.height),
  };
}

export function rectFromPoints(start: { x: number; y: number }, end: { x: number; y: number }) {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

/** Crop a region of a rendered page canvas into a chat-attachable PNG. */
export function captureCanvasRegion(
  canvas: HTMLCanvasElement,
  rect: { left: number; top: number; width: number; height: number },
  page: number,
  randomSeed: number
): ChatAttachment | null {
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
    id: `shot_${randomSeed.toString(36)}_${page}`,
    type: "image",
    dataUrl: output.toDataURL("image/png"),
    mimeType: "image/png",
    page,
    label: `Screenshot from page ${page}`,
  };
}

export function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "");
  const value =
    normalized.length === 3
      ? normalized.split("").map((char) => `${char}${char}`).join("")
      : normalized;
  const numeric = Number.parseInt(value, 16);
  if (!Number.isFinite(numeric)) return `rgba(90, 169, 163, ${alpha})`;
  const red = (numeric >> 16) & 255;
  const green = (numeric >> 8) & 255;
  const blue = numeric & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function tryParseMaybeJson(text: string): Record<string, unknown> | null {
  const normalized = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  for (const candidate of [normalized, text.trim()]) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // Ignore parse failures.
    }
  }
  return null;
}

export function normalizeGettingStartedItem(item: GettingStartedItem): GettingStartedItem {
  const text = item.summary_text?.trim() ?? "";
  const parsed = tryParseMaybeJson(text);
  const summary =
    parsed && typeof parsed.summary === "string"
      ? parsed.summary
      : parsed && typeof parsed.summary_text === "string"
        ? parsed.summary_text
        : item.summary_text;
  return { summary_text: summary };
}

export function gettingStartedAdjacentContext(
  pages: Record<number, { clean_text: string }>,
  currentPage: number
): string {
  return [currentPage - 1, currentPage + 1]
    .flatMap((pageNumber) => {
      const text = pages[pageNumber]?.clean_text?.trim();
      return text ? [`Page ${pageNumber}:\n${text}`] : [];
    })
    .join("\n\n")
    .slice(0, 12000);
}
