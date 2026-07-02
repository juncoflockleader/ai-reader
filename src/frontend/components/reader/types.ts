// Shared reader value types.

export type Stroke = {
  color: string;
  width: number;
  points: Array<{ x: number; y: number }>;
};

export type GettingStartedItem = { summary_text: string };

export type ReadingRulerHeight = "small" | "medium" | "large";
export type ReaderTypographyPreset = "compact" | "comfortable" | "focused";

/** Floating menu anchored at a point — selection actions, highlight removal, or bookmark removal. */
export type ReaderContextMenu =
  | { type: "selection"; x: number; y: number; page: number; text: string }
  | { type: "highlight"; x: number; y: number; highlightIds: string[] }
  | { type: "bookmark"; x: number; y: number; bookmarkId: string };

export const RULER_HEIGHTS: Record<ReadingRulerHeight, number> = {
  small: 36,
  medium: 62,
  large: 96,
};

export const RULER_HEIGHT_LABELS: Record<ReadingRulerHeight, string> = {
  small: "S",
  medium: "M",
  large: "L",
};
