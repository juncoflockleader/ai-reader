// Floating selection / highlight / bookmark context menu. Reads the active menu
// from the ReaderProvider and dispatches actions against the annotation layer.
// Ported from PdfPanel's inline menu; reuses the global `.selection-menu` styles.

import { useEffect } from "react";
import { getAction } from "../../../actions/registry";
import { useReader } from "../ReaderProvider";

export default function SelectionMenu() {
  const { contextMenu, setContextMenu, setSelectedText, onDraftQuestion, annotations } = useReader();

  // Dismiss on any outside click or key press (matches v1).
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", close);
    };
  }, [contextMenu, setContextMenu]);

  if (!contextMenu) return null;

  function explain(text: string, page: number) {
    setSelectedText(text);
    onDraftQuestion(`Explain this selected passage from page ${page} in clear study-friendly terms:\n\n${text}`);
    setContextMenu(null);
  }

  const removeAction = getAction("removeHighlights");
  const RemoveIcon = removeAction.icon;
  const highlightAction = getAction("highlightSelection");
  const HighlightIcon = highlightAction.icon;

  return (
    <div className="selection-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
      {contextMenu.type === "selection" ? (
        <>
          <button onClick={() => onDraftQuestion(`Answer a question about this selected passage:\n\n${contextMenu.text}`)} title="Ask (Ctrl+A)">
            <span>Ask</span>
          </button>
          <button onClick={() => explain(contextMenu.text, contextMenu.page)} title="Explain (Ctrl+E)">
            <span>Explain</span>
          </button>
          <button onClick={() => explain(contextMenu.text, contextMenu.page)} title="Summarize (Ctrl+S)">
            <span>Summarize</span>
          </button>
          <button
            onClick={() => {
              void annotations.saveHighlightForSelection(contextMenu.text, contextMenu.page);
              setContextMenu(null);
            }}
            title="Save note (Ctrl+N)"
          >
            <HighlightIcon size={15} />
            <span>Save note</span>
          </button>
        </>
      ) : contextMenu.type === "highlight" ? (
        <button
          className="danger-menu-item"
          onClick={() => {
            void annotations.deleteHighlights(contextMenu.highlightIds);
            setContextMenu(null);
          }}
        >
          <RemoveIcon size={15} />
          <span>{removeAction.label}</span>
        </button>
      ) : (
        <button
          className="danger-menu-item"
          onClick={() => {
            void annotations.deleteBookmark(contextMenu.bookmarkId);
            setContextMenu(null);
          }}
        >
          <span>Delete bookmark</span>
        </button>
      )}
    </div>
  );
}
