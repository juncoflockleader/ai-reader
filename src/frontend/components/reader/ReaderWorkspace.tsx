// Reader v2 — top-level workspace. Drop-in replacement for PdfPanel (same props,
// same `.pdf-panel` grid slot) selected behind the READER_V2 flag in App.tsx.
//
// Assembles the reader from the decomposed pieces: an in-panel toolbar (no topbar
// portal), the reading-progress bar, the pdf surface, and the floating overlays /
// panels — all sharing state through ReaderProvider.

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BookmarkPlus,
  Brush,
  ChevronDown,
  Eraser,
  Eye,
  ImagePlus,
  Keyboard,
  MoreHorizontal,
  Ruler,
  Search,
  Sparkles,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { Book, ChatAttachment } from "../../api";
import { getAction } from "../../actions/registry";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  ReaderProvider,
  useReader,
} from "./ReaderProvider";
import PdfDocument from "./surface/PdfDocument";
import ReadingProgress from "./footer/ReadingProgress";
import SelectionMenu from "./overlays/SelectionMenu";
import StructureNavigator from "./panels/StructureNavigator";
import GettingStarted from "./panels/GettingStarted";
import CommandPalette from "./panels/CommandPalette";
import { clamp, isEditableKeyboardTarget, isSelectionShortcutEvent } from "./surface/pdfHelpers";
import { RULER_HEIGHT_LABELS, type ReadingRulerHeight, type ReaderTypographyPreset } from "./types";

type Props = {
  book: Book;
  currentPage: number;
  selectedText: string;
  onPageChange: (page: number) => void;
  onSelectedText: (text: string) => void;
  onDraftQuestion: (text: string) => void;
  onScreenshot: (attachment: ChatAttachment) => void;
};

const ZOOM_STEP = 0.1;

function roundZoom(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Inline dropdown matching v1's ToolPopover (caret button + outside-click close). */
function ToolPopover({
  icon: Icon,
  active,
  title,
  align = "left",
  children,
}: {
  icon: typeof Search;
  active?: boolean;
  title: string;
  align?: "left" | "right";
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (wrapRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);
  return (
    <div className="tool-popover-wrap" ref={wrapRef}>
      <button
        type="button"
        className={active || open ? "tool-button has-caret active" : "tool-button has-caret"}
        onClick={() => setOpen((value) => !value)}
        title={title}
        aria-label={title}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <Icon size={16} />
        <ChevronDown size={10} className="tool-caret" aria-hidden="true" />
      </button>
      {open && (
        <div className={`tool-popover tool-popover-${align}`} role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function ReaderToolbar({ onOpenCommandPalette }: { onOpenCommandPalette: () => void }) {
  const {
    book,
    currentPage,
    setCurrentPage,
    selectedText,
    zoom,
    setZoom,
    activeMode,
    toggleMode,
    searchQuery,
    setSearchQuery,
    tools,
    updateTools,
    annotations,
  } = useReader();
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  const goToPage = (page: number) => setCurrentPage(clamp(page, 1, Math.max(1, book.page_count || 1)));
  const stepZoom = (delta: number) => setZoom(clamp(roundZoom(zoom + delta), MIN_ZOOM, MAX_ZOOM));
  const highlightAction = getAction("highlightSelection");
  const HighlightIcon = highlightAction.icon;
  const captureActive = activeMode === "capture";

  return (
    <div className="panel-toolbar">
      <div className="panel-book-meta" title={book.file_name}>
        <span className="topbar-book-label">Reading</span>
        <strong>{book.title ?? book.file_name}</strong>
      </div>

      <div className="tool-group" aria-label="Navigate">
        <span className="tool-group-label">Navigate</span>
        <div className="page-stepper">
          <button onClick={() => goToPage(currentPage - 1)} title="Previous page" aria-label="Previous page">‹</button>
          <input value={currentPage} onChange={(event) => goToPage(Number(event.target.value))} aria-label="Current page" />
          <span>/ {book.page_count || "..."}</span>
          <button onClick={() => goToPage(currentPage + 1)} title="Next page" aria-label="Next page">›</button>
        </div>
        <div className="search-popover-wrap">
          <button
            type="button"
            className={searchOpen || searchQuery.trim() ? "tool-button active" : "tool-button"}
            onClick={() => setSearchOpen((open) => !open)}
            title="Search loaded text"
            aria-label="Search loaded text"
            aria-expanded={searchOpen}
          >
            <Search size={16} />
          </button>
          {searchOpen && (
            <div className="search-popover">
              <label className="search-box">
                <Search size={16} />
                <input
                  ref={searchInputRef}
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search loaded text"
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setSearchOpen(false);
                  }}
                />
                {searchQuery.trim() ? (
                  <button type="button" onClick={() => setSearchQuery("")} title="Clear search" aria-label="Clear search">
                    <X size={14} />
                  </button>
                ) : null}
              </label>
            </div>
          )}
        </div>
      </div>

      <div
        className={`tool-group tool-group-annotate${selectedText.trim() || captureActive || tools.drawEnabled ? " is-active" : ""}`}
        aria-label="Annotate"
      >
        <span className="tool-group-label">Annotate</span>
        <button
          className={selectedText.trim() ? "tool-button is-primed" : "tool-button"}
          onClick={() => void annotations.saveHighlightForSelection(selectedText, currentPage)}
          disabled={!selectedText.trim()}
          title={highlightAction.label}
        >
          <HighlightIcon size={16} />
        </button>
        <button className="tool-button" onClick={() => void annotations.saveBookmark(currentPage)} title="Bookmark page">
          <BookmarkPlus size={16} />
        </button>
        <button
          className={captureActive ? "tool-button active" : "tool-button"}
          onClick={() => toggleMode("capture")}
          title="Capture PDF area"
        >
          <ImagePlus size={16} />
        </button>
        <ToolPopover icon={Brush} active={tools.drawEnabled} title="Drawing tools">
          {() => (
            <div className="tool-popover-body">
              <div className="tool-popover-title">Drawing</div>
              <button className={tools.drawEnabled ? "popover-row is-on" : "popover-row"} onClick={() => updateTools({ drawEnabled: !tools.drawEnabled })}>
                <Brush size={15} />
                <span>{tools.drawEnabled ? "Drawing on" : "Enable drawing"}</span>
              </button>
              <button className={tools.showStrokes ? "popover-row is-on" : "popover-row"} onClick={() => updateTools({ showStrokes: !tools.showStrokes })}>
                <Eye size={15} />
                <span>{tools.showStrokes ? "Strokes visible" : "Strokes hidden"}</span>
              </button>
              <button
                className={tools.eraser ? "popover-row is-on" : "popover-row"}
                onClick={() => updateTools({ drawEnabled: true, eraser: !tools.eraser })}
              >
                <Eraser size={15} />
                <span>Eraser</span>
              </button>
              <label className="popover-row popover-row-color">
                <span className="scribble-color" title="Stroke color">
                  <input type="color" value={tools.drawColor} onChange={(event) => updateTools({ drawColor: event.target.value })} disabled={tools.eraser} />
                </span>
                <span>Stroke color</span>
              </label>
              <button className="popover-row is-danger" onClick={() => annotations.clearPage(currentPage)}>
                <Trash2 size={15} />
                <span>Clear page</span>
              </button>
            </div>
          )}
        </ToolPopover>
      </div>

      <div className="tool-group" aria-label="View">
        <span className="tool-group-label">View</span>
        <ToolPopover icon={Ruler} active={tools.rulerEnabled} title="Reading ruler" align="right">
          {() => (
            <div className="tool-popover-body">
              <div className="tool-popover-title">Reading ruler</div>
              <button className={tools.rulerEnabled ? "popover-row is-on" : "popover-row"} onClick={() => updateTools({ rulerEnabled: !tools.rulerEnabled })}>
                <Ruler size={15} />
                <span>{tools.rulerEnabled ? "Ruler on" : "Enable ruler"}</span>
              </button>
              <div className="popover-seg" aria-label="Ruler size">
                {(["small", "medium", "large"] as ReadingRulerHeight[]).map((height) => (
                  <button
                    key={height}
                    className={tools.rulerHeight === height ? "active" : ""}
                    onClick={() => updateTools({ rulerEnabled: true, rulerHeight: height })}
                    title={`${height} ruler`}
                  >
                    {RULER_HEIGHT_LABELS[height]}
                  </button>
                ))}
              </div>
              <label className="popover-row popover-row-color">
                <span className="ruler-color" title="Ruler color">
                  <input type="color" value={tools.rulerColor} onChange={(event) => updateTools({ rulerColor: event.target.value })} />
                </span>
                <span>Ruler color</span>
              </label>
            </div>
          )}
        </ToolPopover>
        <div className="zoom-controls" aria-label="PDF zoom controls">
          <button className="tool-button" onClick={() => stepZoom(-ZOOM_STEP)} disabled={zoom <= MIN_ZOOM} title="Zoom out">
            <ZoomOut size={16} />
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button className="tool-button" onClick={() => stepZoom(ZOOM_STEP)} disabled={zoom >= MAX_ZOOM} title="Zoom in">
            <ZoomIn size={16} />
          </button>
        </div>
        <ToolPopover icon={MoreHorizontal} active={activeMode === "gettingStarted" || activeMode === "structure"} title="More tools" align="right">
          {(close) => (
            <div className="tool-popover-body">
              <button
                className={activeMode === "gettingStarted" ? "popover-row is-on" : "popover-row"}
                onClick={() => {
                  toggleMode("gettingStarted");
                  close();
                }}
              >
                <Sparkles size={15} />
                <span>Getting started</span>
              </button>
              <button
                className={activeMode === "structure" ? "popover-row is-on" : "popover-row"}
                onClick={() => {
                  toggleMode("structure");
                  close();
                }}
              >
                <Eye size={15} />
                <span>Document structure</span>
              </button>
              <div className="tool-popover-title">Typography</div>
              <div className="popover-seg" aria-label="Typography preset">
                {(["compact", "comfortable", "focused"] as ReaderTypographyPreset[]).map((preset) => (
                  <button key={preset} className={tools.typography === preset ? "active" : ""} onClick={() => updateTools({ typography: preset })}>
                    {preset[0].toUpperCase()}
                  </button>
                ))}
              </div>
              <button
                className="popover-row"
                onClick={() => {
                  onOpenCommandPalette();
                  close();
                }}
              >
                <Keyboard size={15} />
                <span>Command palette</span>
                <kbd className="popover-kbd">⌘K</kbd>
              </button>
            </div>
          )}
        </ToolPopover>
      </div>
    </div>
  );
}

function ReaderShell() {
  const {
    currentPage,
    selectedText,
    zoom,
    activeMode,
    setZoom,
    setCurrentPage,
    toggleMode,
    exitMode,
    onDraftQuestion,
    setSelectedText,
    setContextMenu,
    annotations,
  } = useReader();
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  // Global keyboard: ⌘K palette, undo/redo, selection shortcuts, page nav, zoom.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === "k") {
        event.preventDefault();
        setCommandPaletteOpen((open) => !open);
        return;
      }
      if (key === "escape") {
        setCommandPaletteOpen(false);
        if (activeMode !== "read") exitMode();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && key === "z") {
        event.preventDefault();
        if (event.shiftKey) annotations.redo(currentPage);
        else annotations.undo(currentPage);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && key === "f") {
        return; // search handled by the toolbar/Phase-1 binding
      }
      if (commandPaletteOpen) return;
      if (isEditableKeyboardTarget(event.target)) return;
      // Selection shortcuts (Ctrl, no meta/alt/shift).
      if (isSelectionShortcutEvent(event) && selectedText.trim()) {
        if (key === "a") {
          event.preventDefault();
          onDraftQuestion(`Answer a question about this selected passage:\n\n${selectedText}`);
          return;
        }
        if (key === "e" || key === "s") {
          event.preventDefault();
          setSelectedText(selectedText);
          onDraftQuestion(`Explain this selected passage from page ${currentPage} in clear study-friendly terms:\n\n${selectedText}`);
          setContextMenu(null);
          return;
        }
        if (key === "n") {
          event.preventDefault();
          void annotations.saveHighlightForSelection(selectedText, currentPage);
          return;
        }
      }
      // Page nav + zoom (no modifiers).
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "[") {
        event.preventDefault();
        setCurrentPage(clamp(currentPage - 1, 1, Number.MAX_SAFE_INTEGER));
      } else if (event.key === "]") {
        event.preventDefault();
        setCurrentPage(currentPage + 1);
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        setZoom(clamp(roundZoom(zoom + ZOOM_STEP), MIN_ZOOM, MAX_ZOOM));
      } else if (event.key === "-") {
        event.preventDefault();
        setZoom(clamp(roundZoom(zoom - ZOOM_STEP), MIN_ZOOM, MAX_ZOOM));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeMode, commandPaletteOpen, currentPage, selectedText, zoom, annotations, exitMode, onDraftQuestion, setContextMenu, setCurrentPage, setSelectedText, setZoom]);

  return (
    <section className="pdf-panel">
      <ReaderToolbar onOpenCommandPalette={() => setCommandPaletteOpen(true)} />
      <ReadingProgress />
      <PdfDocument />
      <SelectionMenu />
      {activeMode === "structure" && <StructureNavigator />}
      {activeMode === "gettingStarted" && <GettingStarted />}
      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onToggleStructure={() => toggleMode("structure")}
      />
    </section>
  );
}

export default function ReaderWorkspace({
  book,
  currentPage,
  selectedText,
  onPageChange,
  onSelectedText,
  onDraftQuestion,
  onScreenshot,
}: Props) {
  return (
    <ReaderProvider
      book={book}
      currentPage={currentPage}
      onPageChange={onPageChange}
      selectedText={selectedText}
      onSelectedText={onSelectedText}
      onDraftQuestion={onDraftQuestion}
      onScreenshot={onScreenshot}
    >
      <ReaderShell />
    </ReaderProvider>
  );
}
