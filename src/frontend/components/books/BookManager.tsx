import { RefreshCw, Trash2, X } from "lucide-react";
import { useState } from "react";
import { api, type Book } from "../../api";

type Props = {
  books: Book[];
  activeBook: Book | null;
  onClose: () => void;
  onBooksChanged: (activeBookId?: string | null) => void;
};

export default function BookManager({ books, activeBook, onClose, onBooksChanged }: Props) {
  const [editing, setEditing] = useState<Record<string, string>>(() =>
    Object.fromEntries(books.map((book) => [book.id, book.title ?? book.file_name]))
  );
  const [busyBook, setBusyBook] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  async function rename(book: Book) {
    const title = editing[book.id]?.trim();
    if (!title) return;
    setBusyBook(book.id);
    setStatus("");
    try {
      await api(`/api/books/${book.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title })
      });
      setStatus("Renamed");
      onBooksChanged(book.id);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Rename failed.");
    } finally {
      setBusyBook(null);
    }
  }

  async function reanalyze(book: Book) {
    setBusyBook(book.id);
    setStatus(`Re-analyzing ${book.title ?? book.file_name}...`);
    try {
      await api(`/api/books/${book.id}/reanalyze`, { method: "POST", body: JSON.stringify({}) });
      setStatus("Re-analysis complete");
      onBooksChanged(book.id);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Re-analysis failed.");
    } finally {
      setBusyBook(null);
    }
  }

  async function deleteBook(book: Book) {
    const ok = window.confirm(`Delete "${book.title ?? book.file_name}" and its local study data?`);
    if (!ok) return;
    setBusyBook(book.id);
    setStatus("");
    try {
      await api(`/api/books/${book.id}`, { method: "DELETE" });
      setStatus("Deleted");
      onBooksChanged(activeBook?.id === book.id ? null : activeBook?.id);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setBusyBook(null);
    }
  }

  return (
    <div className="modal-backdrop">
      <section className="settings-modal book-manager">
        <div className="modal-header">
          <div>
            <h2>Book Management</h2>
            <p>Rename books, delete local data, or rebuild page text and search chunks from the original PDF.</p>
          </div>
          <button className="icon-button" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        <div className="book-list">
          {books.map((book) => (
            <div className="book-row" key={book.id}>
              <div className="book-row-main">
                <input
                  className="text-input"
                  value={editing[book.id] ?? ""}
                  onChange={(event) => setEditing((current) => ({ ...current, [book.id]: event.target.value }))}
                />
                <div className="book-meta">
                  {book.page_count || 0} pages · {book.ingestion_status} · {book.file_name}
                </div>
              </div>
              <button onClick={() => rename(book)} disabled={busyBook === book.id}>Save</button>
              <button className="tool-button" onClick={() => reanalyze(book)} disabled={busyBook === book.id} title="Re-analyze">
                <RefreshCw size={16} />
              </button>
              <button className="tool-button danger" onClick={() => deleteBook(book)} disabled={busyBook === book.id} title="Delete">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>

        <div className="modal-actions">
          <span>{status}</span>
          <button className="primary-button compact" onClick={onClose}>Done</button>
        </div>
      </section>
    </div>
  );
}
