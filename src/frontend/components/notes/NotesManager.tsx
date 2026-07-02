import { BookMarked, Pencil, Save, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, type Book, type Highlight } from "../../api";
import MarkdownText from "../common/MarkdownText";
import Modal from "../common/Modal";

export default function NotesManager({
  book,
  onClose,
  onNavigate,
  onChanged
}: {
  book: Book;
  onClose: () => void;
  onNavigate: (page: number) => void;
  onChanged: () => void;
}) {
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftNote, setDraftNote] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void loadHighlights();
  }, [book.id]);

  const notes = useMemo(
    () => highlights.filter((highlight) => highlight.note?.trim()).sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? "")),
    [highlights]
  );

  async function loadHighlights() {
    setError("");
    try {
      const result = await api<{ highlights: Highlight[] }>(`/api/books/${book.id}/highlights`);
      setHighlights(result.highlights);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load notes.");
    }
  }

  async function saveNote(highlight: Highlight) {
    setError("");
    try {
      await api(`/api/highlights/${highlight.id}`, {
        method: "PATCH",
        body: JSON.stringify({ note: draftNote })
      });
      setEditingId(null);
      await loadHighlights();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save note.");
    }
  }

  async function deleteNote(highlight: Highlight) {
    setError("");
    try {
      await api(`/api/highlights/${highlight.id}`, { method: "DELETE" });
      await loadHighlights();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete note.");
    }
  }

  return (
    <Modal open onClose={onClose} unstyled ariaLabel="Notes">
      <section className="settings-modal notes-manager" role="dialog" aria-modal="true" aria-labelledby="notes-manager-title">
        <div className="modal-header">
          <div>
            <h2 id="notes-manager-title">Notes</h2>
            <p>{book.title ?? book.file_name}</p>
          </div>
          <button className="icon-button" onClick={onClose} title="Close" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {error && <div className="inline-error" role="alert">{error}</div>}

        <div className="note-list">
          {notes.length === 0 && (
            <div className="empty-note-state">
              Saved AI answers and highlight notes will show up here.
            </div>
          )}
          {notes.map((highlight) => (
            <article className="note-row" key={highlight.id}>
              <div className="note-row-header">
                <button
                  onClick={() => {
                    onNavigate(highlight.page_number);
                    onClose();
                  }}
                >
                  <BookMarked size={14} />
                  <span>p. {highlight.page_number}</span>
                </button>
                <div className="note-actions">
                  {editingId === highlight.id ? (
                    <button title="Save note" onClick={() => void saveNote(highlight)}>
                      <Save size={14} />
                    </button>
                  ) : (
                    <button
                      title="Edit note"
                      onClick={() => {
                        setEditingId(highlight.id);
                        setDraftNote(highlight.note ?? "");
                      }}
                    >
                      <Pencil size={14} />
                    </button>
                  )}
                  <button title="Delete note" onClick={() => void deleteNote(highlight)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              {notePrompt(highlight) && (
                <div className="note-prompt">
                  <div className="note-label">Prompt</div>
                  <MarkdownText text={notePrompt(highlight)} />
                </div>
              )}
              <div className="note-source">{highlight.selected_text}</div>
              {editingId === highlight.id ? (
                <textarea value={draftNote} onChange={(event) => setDraftNote(event.target.value)} />
              ) : (
                <MarkdownText text={highlight.note ?? ""} />
              )}
            </article>
          ))}
        </div>
      </section>
    </Modal>
  );
}

function notePrompt(highlight: Highlight) {
  return typeof highlight.anchor?.prompt === "string" ? highlight.anchor.prompt : "";
}
