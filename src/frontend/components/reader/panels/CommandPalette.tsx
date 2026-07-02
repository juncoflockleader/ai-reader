// ⌘K command palette. Fuzzy-filters the action registry + reader commands.
// Ported from PdfPanel; reuses the global `.command-palette` styles.

import { useMemo, useState } from "react";
import { listActions } from "../../../actions/registry";
import { useReader } from "../ReaderProvider";

type CommandPaletteProps = {
  open: boolean;
  onClose: () => void;
  onToggleStructure: () => void;
};

export default function CommandPalette({ open, onClose, onToggleStructure }: CommandPaletteProps) {
  const { selectedText, currentPage, onDraftQuestion, setSelectedText, setContextMenu, annotations } = useReader();
  const [query, setQuery] = useState("");

  const entries = useMemo(() => {
    const base = [
      ...listActions().map((action) => ({
        id: action.id,
        label: action.label,
        shortcut: action.shortcut ?? "",
        run: () => {
          if (action.id === "highlightSelection") void annotations.saveHighlightForSelection(selectedText, currentPage);
          if (action.id === "summarizeSelection") {
            setSelectedText(selectedText);
            onDraftQuestion(`Explain this selected passage from page ${currentPage} in clear study-friendly terms:\n\n${selectedText}`);
            setContextMenu(null);
          }
        },
      })),
      { id: "toggleStructure", label: "Toggle document structure", shortcut: "", run: onToggleStructure },
    ];
    const q = query.trim().toLowerCase();
    if (!q) return base;
    const score = (label: string) => {
      let i = 0;
      for (const char of label.toLowerCase()) if (char === q[i]) i += 1;
      return i;
    };
    return base
      .map((entry) => ({ entry, score: score(`${entry.label} ${entry.id} ${entry.shortcut}`) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.entry);
  }, [query, currentPage, selectedText, annotations, onDraftQuestion, onToggleStructure, setSelectedText, setContextMenu]);

  if (!open) return null;

  return (
    <div className="selection-menu command-palette" style={{ left: "50%", top: "24%", transform: "translateX(-50%)" }}>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Type an action or shortcut"
        autoFocus
      />
      {entries.map((entry) => (
        <button
          key={entry.id}
          onClick={() => {
            entry.run();
            onClose();
          }}
        >
          <span>{entry.label}</span>
          {entry.shortcut ? <kbd>{entry.shortcut}</kbd> : null}
        </button>
      ))}
    </div>
  );
}
