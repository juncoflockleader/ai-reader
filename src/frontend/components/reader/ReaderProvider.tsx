// Reader v2 state hub.
//
// Composes the reader's data layer (pdf.js document + page text, annotations)
// with its cross-cutting UI state (zoom, active tool mode, search, tool
// settings, the floating context menu) and exposes everything through one
// context. Toolbar, surface, footer, overlays, and panels all read from here
// instead of the ~38 useState hooks that used to live in PdfPanel.

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type ReactNode,
} from "react";
import type { Book, ChatAttachment } from "../../api";
import { readerStorage } from "./hooks/useReaderPersistence";
import { usePdfDocument, type PageData } from "./hooks/usePdfDocument";
import { useReaderAnnotations, type ReaderAnnotations } from "./hooks/useReaderAnnotations";
import type { ReaderContextMenu, ReaderTypographyPreset, ReadingRulerHeight } from "./types";

export type ReaderMode =
  | "read"
  | "search"
  | "ruler"
  | "draw"
  | "capture"
  | "structure"
  | "gettingStarted";

export const MIN_ZOOM = 0.7;
export const MAX_ZOOM = 2.5;
const DEFAULT_ZOOM = 1;

type ReaderState = {
  zoom: number;
  activeMode: ReaderMode;
  searchQuery: string;
};

type ReaderAction =
  | { type: "setZoom"; zoom: number }
  | { type: "setMode"; mode: ReaderMode }
  | { type: "toggleMode"; mode: Exclude<ReaderMode, "read"> }
  | { type: "setSearchQuery"; query: string }
  | { type: "reset" };

function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return DEFAULT_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

function reducer(state: ReaderState, action: ReaderAction): ReaderState {
  switch (action.type) {
    case "setZoom":
      return { ...state, zoom: clampZoom(action.zoom) };
    case "setMode":
      return { ...state, activeMode: action.mode };
    case "toggleMode":
      return { ...state, activeMode: state.activeMode === action.mode ? "read" : action.mode };
    case "setSearchQuery":
      return { ...state, searchQuery: action.query };
    case "reset":
      return { ...state, activeMode: "read", searchQuery: "" };
    default:
      return state;
  }
}

/** Mutable per-session tool settings (drawing, ruler, typography). */
export type ToolSettings = {
  drawEnabled: boolean;
  drawColor: string;
  eraser: boolean;
  showStrokes: boolean;
  rulerEnabled: boolean;
  rulerHeight: ReadingRulerHeight;
  rulerColor: string;
  rulerTopRatio: number;
  typography: ReaderTypographyPreset;
};

const DEFAULT_TOOLS: ToolSettings = {
  drawEnabled: false,
  drawColor: "#e74c3c",
  eraser: false,
  showStrokes: true,
  rulerEnabled: false,
  rulerHeight: "medium",
  rulerColor: "#5aa9a3",
  rulerTopRatio: 0.42,
  typography: "comfortable",
};

export type ReaderContextValue = {
  // Shell-owned.
  book: Book;
  currentPage: number;
  setCurrentPage: (page: number) => void;
  selectedText: string;
  setSelectedText: (text: string) => void;
  onDraftQuestion: (text: string) => void;
  onScreenshot: (attachment: ChatAttachment) => void;
  // UI state.
  zoom: number;
  activeMode: ReaderMode;
  searchQuery: string;
  setZoom: (zoom: number) => void;
  setMode: (mode: ReaderMode) => void;
  toggleMode: (mode: Exclude<ReaderMode, "read">) => void;
  setSearchQuery: (query: string) => void;
  exitMode: () => void;
  // Tool settings.
  tools: ToolSettings;
  updateTools: (patch: Partial<ToolSettings>) => void;
  // Floating context menu.
  contextMenu: ReaderContextMenu | null;
  setContextMenu: (menu: ReaderContextMenu | null) => void;
  // Data layer.
  pdf: ReturnType<typeof usePdfDocument>["pdf"];
  pages: Record<number, PageData>;
  loadText: (page: number) => void;
  annotations: ReaderAnnotations;
};

const ReaderContext = createContext<ReaderContextValue | null>(null);

export function useReader(): ReaderContextValue {
  const value = useContext(ReaderContext);
  if (!value) throw new Error("useReader must be used within <ReaderProvider>");
  return value;
}

type ReaderProviderProps = {
  book: Book;
  currentPage: number;
  onPageChange: (page: number) => void;
  selectedText: string;
  onSelectedText: (text: string) => void;
  onDraftQuestion: (text: string) => void;
  onScreenshot: (attachment: ChatAttachment) => void;
  children: ReactNode;
};

export function ReaderProvider({
  book,
  currentPage,
  onPageChange,
  selectedText,
  onSelectedText,
  onDraftQuestion,
  onScreenshot,
  children,
}: ReaderProviderProps) {
  const [state, dispatch] = useReducer(reducer, book.id, (bookId) => ({
    zoom: clampZoom(readerStorage.getNumber(readerStorage.keys.zoom(bookId), DEFAULT_ZOOM)),
    activeMode: "read" as ReaderMode,
    searchQuery: "",
  }));
  const [tools, setTools] = useState<ToolSettings>(DEFAULT_TOOLS);
  const [contextMenu, setContextMenu] = useState<ReaderContextMenu | null>(null);

  const { pdf, pages, loadText } = usePdfDocument(book);
  const annotations = useReaderAnnotations(book, currentPage);

  // Persist zoom per book; reset transient state when the book changes.
  useEffect(() => {
    readerStorage.setNumber(readerStorage.keys.zoom(book.id), state.zoom);
  }, [book.id, state.zoom]);

  useEffect(() => {
    dispatch({ type: "reset" });
    setContextMenu(null);
    setTools((current) => ({ ...current, drawEnabled: false, eraser: false, rulerEnabled: false }));
  }, [book.id]);

  const value = useMemo<ReaderContextValue>(
    () => ({
      book,
      currentPage,
      setCurrentPage: onPageChange,
      selectedText,
      setSelectedText: onSelectedText,
      onDraftQuestion,
      onScreenshot,
      zoom: state.zoom,
      activeMode: state.activeMode,
      searchQuery: state.searchQuery,
      setZoom: (zoom) => dispatch({ type: "setZoom", zoom }),
      setMode: (mode) => dispatch({ type: "setMode", mode }),
      toggleMode: (mode) => dispatch({ type: "toggleMode", mode }),
      setSearchQuery: (query) => dispatch({ type: "setSearchQuery", query }),
      exitMode: () => dispatch({ type: "setMode", mode: "read" }),
      tools,
      updateTools: (patch) => setTools((current) => ({ ...current, ...patch })),
      contextMenu,
      setContextMenu,
      pdf,
      pages,
      loadText,
      annotations,
    }),
    [
      book,
      currentPage,
      onPageChange,
      selectedText,
      onSelectedText,
      onDraftQuestion,
      onScreenshot,
      state,
      tools,
      contextMenu,
      pdf,
      pages,
      loadText,
      annotations,
    ]
  );

  return <ReaderContext.Provider value={value}>{children}</ReaderContext.Provider>;
}
