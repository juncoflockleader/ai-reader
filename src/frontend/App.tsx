import { BookOpen, Library, PanelRightOpen, Settings, StickyNote, Upload, X } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { api, type Book, type ChatAttachment } from "./api";
import PdfPanel from "./components/pdf/PdfPanel";
import AssistantPanel from "./components/assistant/AssistantPanel";
import BookManager from "./components/books/BookManager";
import ProviderSettings from "./components/settings/ProviderSettings";
import NotesManager from "./components/notes/NotesManager";

export default function App() {
  const [books, setBooks] = useState<Book[]>([]);
  const [activeBook, setActiveBook] = useState<Book | null>(null);
  const [currentPage, setCurrentPage] = useState(() => {
    const lastBookId = localStorage.getItem("studyreader:lastBookId");
    const savedPage = lastBookId ? Number(localStorage.getItem(`studyreader:${lastBookId}:page`) ?? "1") : 1;
    return Number.isFinite(savedPage) && savedPage > 0 ? savedPage : 1;
  });
  const [selectedText, setSelectedText] = useState("");
  const [draftQuestion, setDraftQuestion] = useState<{ id: number; text: string } | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [booksOpen, setBooksOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [settingsVersion, setSettingsVersion] = useState(0);
  const [pdfDataVersion, setPdfDataVersion] = useState(0);
  const [assistantResetVersion, setAssistantResetVersion] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const [leftPaneWidthPercent, setLeftPaneWidthPercent] = useState(75);
  const [assistantDrawerOpen, setAssistantDrawerOpen] = useState(false);
  const [isCompactLayout, setIsCompactLayout] = useState(() => window.innerWidth < 1080);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const draggingSplitter = useRef(false);

  useEffect(() => {
    refreshBooks();
  }, []);

  useEffect(() => {
    if (!activeBook) return;
    localStorage.setItem("studyreader:lastBookId", activeBook.id);
    const savedPage = Number(localStorage.getItem(`studyreader:${activeBook.id}:page`) ?? "1");
    const maxPage = activeBook.page_count || savedPage || 1;
    setCurrentPage(Number.isFinite(savedPage) && savedPage > 0 ? Math.min(savedPage, maxPage) : 1);
  }, [activeBook?.id]);

  async function refreshBooks() {
    const result = await api<{ books: Book[] }>("/api/books");
    setBooks(result.books);
    setActiveBook((current) => {
      const lastBookId = localStorage.getItem("studyreader:lastBookId");
      if (!current) return result.books.find((book) => book.id === lastBookId) ?? result.books[0] ?? null;
      return result.books.find((book) => book.id === current.id) ?? result.books.find((book) => book.id === lastBookId) ?? result.books[0] ?? null;
    });
  }

  async function refreshBooksAfterManagement(activeBookId?: string | null) {
    const result = await api<{ books: Book[] }>("/api/books");
    setBooks(result.books);
    setActiveBook(activeBookId ? result.books.find((book) => book.id === activeBookId) ?? result.books[0] ?? null : result.books[0] ?? null);
  }

  async function uploadPdf(file: File) {
    setError("");
    setUploading(true);
    try {
      const form = new FormData();
      form.append("pdf", file);
      const result = await api<{ book_id: string }>("/api/books", { method: "POST", body: form });
      await refreshBooks();
      const created = await api<{ book: Book }>(`/api/books/${result.book_id}`);
      setActiveBook(created.book);
      setCurrentPage(1);
      localStorage.setItem("studyreader:lastBookId", created.book.id);
      localStorage.setItem(`studyreader:${created.book.id}:page`, "1");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }


  useEffect(() => {
    const onResize = () => {
      const compact = window.innerWidth < 1080;
      setIsCompactLayout(compact);
      if (!compact) setAssistantDrawerOpen(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (!draggingSplitter.current || !workspaceRef.current) return;
      const bounds = workspaceRef.current.getBoundingClientRect();
      const nextPercent = ((event.clientX - bounds.left) / bounds.width) * 100;
      setLeftPaneWidthPercent(Math.min(85, Math.max(55, nextPercent)));
    };
    const stopDrag = () => {
      draggingSplitter.current = false;
      document.body.classList.remove("split-resizing");
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopDrag);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopDrag);
    };
  }, []);

  function updateCurrentPage(page: number) {
    setCurrentPage(page);
    if (activeBook) {
      localStorage.setItem("studyreader:lastBookId", activeBook.id);
      localStorage.setItem(`studyreader:${activeBook.id}:page`, String(page));
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <BookOpen size={22} />
          <span>StudyReader AI</span>
        </div>
        <div className="library-strip">
          {books.map((book) => (
            <button
              key={book.id}
              className={book.id === activeBook?.id ? "book-tab active" : "book-tab"}
              onClick={() => {
                setActiveBook(book);
                setSelectedText("");
                setPendingAttachments([]);
              }}
              title={book.file_name}
            >
              {book.title ?? book.file_name}
            </button>
          ))}
        </div>
        <label className="icon-button" title="Upload PDF">
          <Upload size={18} />
          <input
            type="file"
            accept="application/pdf"
            disabled={uploading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadPdf(file);
              event.currentTarget.value = "";
            }}
          />
        </label>
        <button className="icon-button" onClick={() => activeBook && setNotesOpen(true)} disabled={!activeBook} title="Notes">
          <StickyNote size={18} />
        </button>
        <button className="icon-button" onClick={() => setSettingsOpen(true)} title="Settings">
          <Settings size={18} />
        </button>
        <button className="icon-button" onClick={() => setBooksOpen(true)} title="Manage books">
          <Library size={18} />
        </button>
      </header>

      {error && <div className="error-banner">{error}</div>}

      {activeBook ? (
        <main
          className={isCompactLayout ? "workspace compact" : "workspace"}
          style={!isCompactLayout ? ({ ["--left-pane-width" as string]: `${leftPaneWidthPercent}%` } as CSSProperties) : undefined}
          ref={workspaceRef}
        >
          <PdfPanel
            key={`pdf-${activeBook.id}-${pdfDataVersion}`}
            book={activeBook}
            currentPage={currentPage}
            onPageChange={updateCurrentPage}
            selectedText={selectedText}
            onSelectedText={setSelectedText}
            onDraftQuestion={(text) => setDraftQuestion({ id: Date.now(), text })}
            onScreenshot={(attachment) => {
              setPendingAttachments((current) => [...current, attachment]);
              setDraftQuestion({
                id: Date.now(),
                text: "Explain the attached screenshot from the PDF. Focus on the selected area and connect it to the surrounding page context."
              });
            }}
          />
          {!isCompactLayout && (
            <div
              className="pane-splitter"
              onPointerDown={() => {
                draggingSplitter.current = true;
                document.body.classList.add("split-resizing");
              }}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize panels"
            />
          )}
          <aside className={isCompactLayout ? `assistant-drawer ${assistantDrawerOpen ? "open" : ""}` : "assistant-host"}>
            <AssistantPanel
              key={`assistant-${activeBook.id}-${assistantResetVersion}`}
            book={activeBook}
            currentPage={currentPage}
            selectedText={selectedText}
            onNavigate={updateCurrentPage}
            settingsVersion={settingsVersion}
            draftQuestion={draftQuestion}
            attachments={pendingAttachments}
            onRemoveAttachment={(attachmentId) =>
              setPendingAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId))
            }
            onClearAttachments={() => setPendingAttachments([])}
          />
          </aside>
          {isCompactLayout && !assistantDrawerOpen && (
            <button className="assistant-drawer-toggle" onClick={() => setAssistantDrawerOpen(true)} title="Open assistant">
              <PanelRightOpen size={18} />
            </button>
          )}
          {isCompactLayout && assistantDrawerOpen && <div className="drawer-backdrop" onClick={() => setAssistantDrawerOpen(false)} />}
          {isCompactLayout && assistantDrawerOpen && (
            <button className="assistant-drawer-close" onClick={() => setAssistantDrawerOpen(false)} title="Close assistant">
              <X size={18} />
            </button>
          )}
        </main>
      ) : (
        <main className="empty-state">
          <BookOpen size={42} />
          <h1>Open a PDF textbook</h1>
          <p>Upload a local PDF to extract page text, build searchable chunks, and start reading with cited AI help.</p>
          <label className="primary-button">
            <Upload size={18} />
            {uploading ? "Processing..." : "Upload PDF"}
            <input type="file" accept="application/pdf" onChange={(event) => event.target.files?.[0] && void uploadPdf(event.target.files[0])} />
          </label>
        </main>
      )}

      {booksOpen && (
        <BookManager
          books={books}
          activeBook={activeBook}
          onClose={() => setBooksOpen(false)}
          onBooksChanged={(activeBookId) => void refreshBooksAfterManagement(activeBookId)}
          onUserDataCleared={(bookId) => {
            if (activeBook?.id === bookId) {
              setSelectedText("");
              setPendingAttachments([]);
              setDraftQuestion(null);
              setCurrentPage(1);
              localStorage.setItem(`studyreader:${bookId}:page`, "1");
              setPdfDataVersion((version) => version + 1);
              setAssistantResetVersion((version) => version + 1);
            }
          }}
        />
      )}
      {settingsOpen && (
        <ProviderSettings
          onClose={() => setSettingsOpen(false)}
          onSaved={() => setSettingsVersion((version) => version + 1)}
        />
      )}
      {notesOpen && activeBook && (
        <NotesManager
          book={activeBook}
          onClose={() => setNotesOpen(false)}
          onNavigate={updateCurrentPage}
          onChanged={() => setPdfDataVersion((version) => version + 1)}
        />
      )}
    </div>
  );
}
