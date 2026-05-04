import { Bookmark, BookmarkPlus, Highlighter, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { api, type Book, type Highlight } from "../../api";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).toString();

type Props = {
  book: Book;
  currentPage: number;
  selectedText: string;
  onPageChange: (page: number) => void;
  onSelectedText: (text: string) => void;
};

type PageData = {
  pdf_page_number: number;
  clean_text: string;
};

export default function PdfPanel({ book, currentPage, selectedText, onPageChange, onSelectedText }: Props) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pages, setPages] = useState<Record<number, PageData>>({});
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [query, setQuery] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const programmaticScrollUntil = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setPdf(null);
    setPages({});
    setHighlights([]);
    pdfjsLib.getDocument(`/api/books/${book.id}/file`).promise.then((loaded) => {
      if (!cancelled) setPdf(loaded);
    });
    api<{ highlights: Highlight[] }>(`/api/books/${book.id}/highlights`).then((result) => setHighlights(result.highlights));
    return () => {
      cancelled = true;
    };
  }, [book.id]);

  useEffect(() => {
    if (!currentPage) return;
    const pageElement = scrollRef.current?.querySelector<HTMLElement>(`[data-page="${currentPage}"]`);
    if (!pageElement) return;
    programmaticScrollUntil.current = Date.now() + 700;
    pageElement.scrollIntoView({ block: "start" });
  }, [book.id, currentPage]);

  useEffect(() => {
    if (!book.page_count) return;
    const wanted = [currentPage - 1, currentPage, currentPage + 1].filter((page) => page >= 1 && page <= book.page_count);
    for (const page of wanted) {
      if (!pages[page]) {
        api<{ page: PageData }>(`/api/books/${book.id}/pages/${page}`).then((result) =>
          setPages((current) => ({ ...current, [page]: result.page }))
        );
      }
    }
  }, [book.id, book.page_count, currentPage, pages]);

  const visiblePages = useMemo(() => {
    const all = Array.from({ length: book.page_count || 0 }, (_, index) => index + 1);
    if (!query.trim()) return all;
    return all.filter((page) => pages[page]?.clean_text.toLowerCase().includes(query.toLowerCase()));
  }, [book.page_count, pages, query]);

  async function saveHighlight() {
    if (!selectedText.trim()) return;
    await api(`/api/books/${book.id}/highlights`, {
      method: "POST",
      body: JSON.stringify({
        page_number: currentPage,
        selected_text: selectedText.trim(),
        color: "yellow",
        anchor: {
          page_index: currentPage - 1,
          selected_text: selectedText.trim()
        }
      })
    });
    const result = await api<{ highlights: Highlight[] }>(`/api/books/${book.id}/highlights`);
    setHighlights(result.highlights);
  }

  async function saveBookmark() {
    await api(`/api/books/${book.id}/highlights`, {
      method: "POST",
      body: JSON.stringify({
        page_number: currentPage,
        selected_text: `Bookmark page ${currentPage}`,
        color: "bookmark",
        note: null,
        anchor: {
          type: "bookmark",
          page_index: currentPage - 1
        }
      })
    });
    const result = await api<{ highlights: Highlight[] }>(`/api/books/${book.id}/highlights`);
    setHighlights(result.highlights);
  }

  async function deleteBookmark(highlightId: string) {
    await api(`/api/highlights/${highlightId}`, { method: "DELETE" });
    setHighlights((current) => current.filter((highlight) => highlight.id !== highlightId));
  }

  function captureSelection(page: number) {
    const text = window.getSelection()?.toString().trim() ?? "";
    if (text) {
      onSelectedText(text);
      onPageChange(page);
    }
  }

  function changePage(page: number) {
    const nextPage = clamp(page, 1, book.page_count || 1);
    programmaticScrollUntil.current = Date.now() + 700;
    onPageChange(nextPage);
  }

  function setVisiblePage(page: number) {
    if (Date.now() < programmaticScrollUntil.current) return;
    onPageChange(page);
  }

  const bookmarks = highlights.filter((highlight) => highlight.color === "bookmark" || highlight.anchor?.type === "bookmark");
  const pageHighlights = highlights.filter((highlight) => highlight.color !== "bookmark" && highlight.anchor?.type !== "bookmark");

  return (
    <section className="pdf-panel">
      <div className="panel-toolbar">
        <div className="page-stepper">
          <button onClick={() => changePage(currentPage - 1)}>Prev</button>
          <input
            value={currentPage}
            onChange={(event) => changePage(Number(event.target.value))}
          />
          <span>/ {book.page_count || "..."}</span>
          <button onClick={() => changePage(currentPage + 1)}>Next</button>
        </div>
        <label className="search-box">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search loaded text" />
        </label>
        <button className="tool-button" onClick={saveHighlight} disabled={!selectedText.trim()} title="Save highlight">
          <Highlighter size={16} />
        </button>
        <button className="tool-button" onClick={saveBookmark} title="Bookmark page">
          <BookmarkPlus size={16} />
        </button>
      </div>

      {bookmarks.length > 0 && (
        <div className="bookmark-strip">
          {bookmarks.map((bookmark) => (
            <button key={bookmark.id} className={bookmark.page_number === currentPage ? "bookmark-pill active" : "bookmark-pill"} onClick={() => changePage(bookmark.page_number)}>
              <Bookmark size={13} />
              <span>p. {bookmark.page_number}</span>
              <X
                size={13}
                onClick={(event) => {
                  event.stopPropagation();
                  void deleteBookmark(bookmark.id);
                }}
              />
            </button>
          ))}
        </div>
      )}

      {selectedText && (
        <div className="selection-chip">
          <Bookmark size={14} />
          <span>{selectedText}</span>
        </div>
      )}

      <div className="pdf-scroll" ref={scrollRef}>
        {visiblePages.map((pageNumber) => (
          <ReaderPage
            key={pageNumber}
            pdf={pdf}
            bookId={book.id}
            pageNumber={pageNumber}
            pageData={pages[pageNumber]}
            active={pageNumber === currentPage}
            highlights={pageHighlights.filter((highlight) => highlight.page_number === pageNumber)}
            bookmarked={bookmarks.some((bookmark) => bookmark.page_number === pageNumber)}
            onVisible={() => setVisiblePage(pageNumber)}
            onSelect={() => captureSelection(pageNumber)}
            loadText={(page) => {
              if (!pages[page]) {
                api<{ page: PageData }>(`/api/books/${book.id}/pages/${page}`).then((result) =>
                  setPages((current) => ({ ...current, [page]: result.page }))
                );
              }
            }}
          />
        ))}
      </div>
    </section>
  );
}

function ReaderPage({
  pdf,
  pageNumber,
  pageData,
  active,
  highlights,
  bookmarked,
  onVisible,
  onSelect,
  loadText
}: {
  pdf: PDFDocumentProxy | null;
  bookId: string;
  pageNumber: number;
  pageData?: PageData;
  active: boolean;
  highlights: Highlight[];
  bookmarked: boolean;
  onVisible: () => void;
  onSelect: () => void;
  loadText: (page: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pageRef = useRef<HTMLElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(760);

  useEffect(() => {
    const element = pageRef.current;
    if (!element) return;
    const resizeObserver = new ResizeObserver(([entry]) => {
      const nextWidth = Math.max(320, Math.floor(entry.contentRect.width - 24));
      setCanvasWidth(nextWidth);
    });
    resizeObserver.observe(element);
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          onVisible();
          loadText(pageNumber);
        }
      },
      { threshold: 0.55 }
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      resizeObserver.disconnect();
    };
  }, [loadText, onVisible, pageNumber]);

  useEffect(() => {
    if (!pdf || !canvasRef.current) return;
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | null = null;
    pdf.getPage(pageNumber).then(async (page) => {
      if (cancelled || !canvasRef.current) return;
      const baseViewport = page.getViewport({ scale: 1 });
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const scale = (canvasWidth / baseViewport.width) * dpr;
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      const context = canvas.getContext("2d");
      if (!context) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${Math.round(viewport.width / dpr)}px`;
      canvas.style.height = `${Math.round(viewport.height / dpr)}px`;
      renderTask = page.render({ canvasContext: context, viewport });
      await renderTask.promise.catch((error: unknown) => {
        if (!cancelled) throw error;
      });
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [pdf, pageNumber, canvasWidth]);

  return (
    <article ref={pageRef} data-page={pageNumber} className={active ? "reader-page active" : "reader-page"}>
      <div className="page-label">
        <span>Page {pageNumber}</span>
        {bookmarked && <Bookmark size={15} />}
      </div>
      <canvas ref={canvasRef} />
      <div className="page-text" onMouseUp={onSelect}>
        {pageData?.clean_text || "Loading extracted text..."}
      </div>
      {highlights.length > 0 && (
        <div className="highlight-list">
          {highlights.map((highlight) => (
            <div key={highlight.id} className="highlight-card">
              {highlight.selected_text}
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
