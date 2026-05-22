import { ArrowRight, BookOpen, Brain, Library, PanelRightOpen, PenLine, Settings, Sparkles, StickyNote, Upload, X } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { api, type Book, type ChatAttachment } from "./api";
import PdfPanel from "./components/pdf/PdfPanel";
import MarkdownPanel from "./components/pdf/MarkdownPanel";
import AssistantPanel from "./components/assistant/AssistantPanel";
import BookManager from "./components/books/BookManager";
import ProviderSettings from "./components/settings/ProviderSettings";
import NotesManager from "./components/notes/NotesManager";
import WriterWorkspace from "./components/writer/WriterWorkspace";
import AlgorithmLabWorkspace from "./components/algolab/AlgorithmLabWorkspace";


const ASSISTANT_MIN_WIDTH_PX = 360;
const SPLITTER_WIDTH_PX = 8;
type StudyApp = "reader" | "writer" | "algolab";

function clampLeftPanePercent(percent: number, workspaceWidth: number) {
  if (!Number.isFinite(percent)) return 72;
  const maxByWidth = workspaceWidth > 0
    ? ((workspaceWidth - ASSISTANT_MIN_WIDTH_PX - SPLITTER_WIDTH_PX) / workspaceWidth) * 100
    : 80;
  const safeMax = Math.max(45, Math.min(80, maxByWidth));
  return Math.min(safeMax, Math.max(45, percent));
}

function isMarkdownBook(book: Book | null) {
  return Boolean(book?.file_name.toLowerCase().endsWith(".md"));
}
export default function App() {
  const [activeApp, setActiveApp] = useState<StudyApp>(() => {
    const saved = localStorage.getItem("studysuite:activeApp");
    return saved === "writer" || saved === "algolab" ? saved : "reader";
  });
  const [startOpen, setStartOpen] = useState(() => localStorage.getItem("studysuite:startDismissed") !== "1");
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

  const [leftPaneWidthPercent, setLeftPaneWidthPercent] = useState(() => {
    const saved = Number(localStorage.getItem("studyreader:ui:leftPaneWidthPercent") ?? "72");
    return Number.isFinite(saved) ? saved : 72;
  });
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
      setLeftPaneWidthPercent(clampLeftPanePercent(nextPercent, bounds.width));
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

  useEffect(() => {
    const width = workspaceRef.current?.getBoundingClientRect().width ?? window.innerWidth;
    const clamped = clampLeftPanePercent(leftPaneWidthPercent, width);
    if (clamped !== leftPaneWidthPercent) {
      setLeftPaneWidthPercent(clamped);
      return;
    }
    localStorage.setItem("studyreader:ui:leftPaneWidthPercent", String(clamped));
  }, [leftPaneWidthPercent]);

  function updateCurrentPage(page: number) {
    setCurrentPage(page);
    if (activeBook) {
      localStorage.setItem("studyreader:lastBookId", activeBook.id);
      localStorage.setItem(`studyreader:${activeBook.id}:page`, String(page));
    }
  }

  function chooseApp(app: StudyApp) {
    setActiveApp(app);
    setStartOpen(false);
    localStorage.setItem("studysuite:activeApp", app);
    localStorage.setItem("studysuite:startDismissed", "1");
  }

  function switchApp(app: StudyApp) {
    setActiveApp(app);
    localStorage.setItem("studysuite:activeApp", app);
  }

  return (
    <div className="app-shell">
      {startOpen && (
        <div className="start-screen" role="dialog" aria-modal="true" aria-label="Choose your learning experience">
          <div className="start-hero">
            <p className="start-kicker">Welcome</p>
            <h1>AI Powered Learning</h1>
            <p className="start-subtitle">for self-driven learners</p>
            <p className="start-description">Pick your workspace to begin focused reading, deeper understanding, and better retention.</p>

            <div className="start-grid">
              <button className="start-choice start-choice-primary" onClick={() => chooseApp("reader")}>
                <span className="start-choice-icon"><BookOpen size={18} /></span>
                <span className="start-choice-content">
                  <strong>AI Reader</strong>
                  <small>Read PDFs and notes, ask questions, and capture insights in one place.</small>
                </span>
                <ArrowRight size={16} />
              </button>

              <button className="start-choice start-choice-primary" onClick={() => chooseApp("writer")}>
                <span className="start-choice-icon"><PenLine size={18} /></span>
                <span className="start-choice-content">
                  <strong>AI Writer</strong>
                  <small>Draft, revise, track context, and turn coaching into applied suggestions.</small>
                </span>
                <ArrowRight size={16} />
              </button>

              <button className="start-choice start-choice-primary" onClick={() => chooseApp("algolab")}>
                <span className="start-choice-icon"><Brain size={18} /></span>
                <span className="start-choice-content">
                  <strong>Algorithm Lab</strong>
                  <small>Watch sorting algorithms compare, move, and settle objects step by step.</small>
                </span>
                <ArrowRight size={16} />
              </button>

              <article className="start-choice start-choice-coming-soon" aria-label="More apps coming soon">
                <span className="start-choice-icon"><Sparkles size={18} /></span>
                <span className="start-choice-content">
                  <strong>Practice Coach</strong>
                  <small>Personalized drills and spaced repetition to reinforce what you learn.</small>
                </span>
                <span className="start-pill">Coming soon</span>
              </article>
            </div>
          </div>
        </div>
      )}
      <header className="topbar">
        <div className="topbar-main">
          <div className="brand">
            <span className="brand-wordmark" aria-label="Study Reader">
              <strong>Study</strong>
              <em>{activeApp === "writer" ? "Writer" : activeApp === "algolab" ? "Lab" : "Reader"}</em>
            </span>
          </div>
          <div className="app-switcher" aria-label="App switcher">
            <button className={activeApp === "reader" ? "active" : ""} onClick={() => switchApp("reader")} title="AI Reader">
              <BookOpen size={16} />
            </button>
            <button className={activeApp === "writer" ? "active" : ""} onClick={() => switchApp("writer")} title="AI Writer">
              <PenLine size={16} />
            </button>
            <button className={activeApp === "algolab" ? "active" : ""} onClick={() => switchApp("algolab")} title="Algorithm Lab">
              <Brain size={16} />
            </button>
          </div>
          <div id="app-topbar-tools" className="topbar-tools" />
          <div id="app-topbar-assistant" className="topbar-assistant" />
          <div className="topbar-actions">
            {activeApp === "reader" && (
              <>
                <label className="icon-button" title="Upload file">
                  <Upload size={18} />
                  <input
                    type="file"
                    accept="application/pdf,.md,text/markdown"
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
                <button className="icon-button" onClick={() => setBooksOpen(true)} title="Manage books">
                  <Library size={18} />
                </button>
              </>
            )}
            <button className="icon-button" onClick={() => setSettingsOpen(true)} title="Settings">
              <Settings size={18} />
            </button>
          </div>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      {activeApp === "writer" ? (
        <WriterWorkspace />
      ) : activeApp === "algolab" ? (
        <AlgorithmLabWorkspace />
      ) : activeBook ? (
        <main
          className={isCompactLayout ? "workspace compact" : "workspace"}
          style={!isCompactLayout ? ({ ["--left-pane-width" as string]: `${leftPaneWidthPercent}%` } as CSSProperties) : undefined}
          ref={workspaceRef}
        >
          {isMarkdownBook(activeBook) ? (
            <MarkdownPanel
              book={activeBook}
              currentPage={currentPage}
              onPageChange={updateCurrentPage}
              selectedText={selectedText}
              onSelectedText={setSelectedText}
            />
          ) : (
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
          )}
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
          <h1>Open a book</h1>
          <p>Upload a local PDF or Markdown file to extract text, build searchable chunks, and start reading with cited AI help.</p>
          <label className="primary-button">
            <Upload size={18} />
            {uploading ? "Processing..." : "Upload file"}
            <input type="file" accept="application/pdf,.md,text/markdown" onChange={(event) => event.target.files?.[0] && void uploadPdf(event.target.files[0])} />
          </label>
        </main>
      )}

      {booksOpen && (
        <BookManager
          books={books}
          activeBook={activeBook}
          onSelectBook={(bookId) => {
            const nextBook = books.find((book) => book.id === bookId);
            if (!nextBook) return;
            setActiveBook(nextBook);
            setSelectedText("");
            setPendingAttachments([]);
            setBooksOpen(false);
          }}
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
