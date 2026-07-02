// Loads and caches the pdf.js document, per-page text, and saved highlights for
// a book. This is the data half of the reading surface, lifted out of the
// PdfPanel god component so the rendering components stay presentational.

import { useCallback, useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { api, type Book } from "../../../api";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).toString();

export type PageData = {
  pdf_page_number: number;
  clean_text: string;
};

export type PdfDocumentState = {
  pdf: PDFDocumentProxy | null;
  pages: Record<number, PageData>;
  /** Fetch a page's text on demand (deduplicated). Safe to call repeatedly. */
  loadText: (page: number) => void;
};

export function usePdfDocument(book: Book): PdfDocumentState {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pages, setPages] = useState<Record<number, PageData>>({});
  const requested = useRef<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setPdf(null);
    setPages({});
    requested.current = new Set();

    pdfjsLib
      .getDocument(`/api/books/${book.id}/file`)
      .promise.then((loaded) => {
        if (!cancelled) setPdf(loaded);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [book.id]);

  const loadText = useCallback(
    (page: number) => {
      if (page < 1 || requested.current.has(page)) return;
      requested.current.add(page);
      api<{ page: PageData }>(`/api/books/${book.id}/pages/${page}`)
        .then((result) => setPages((current) => ({ ...current, [page]: result.page })))
        .catch(() => {
          requested.current.delete(page);
        });
    },
    [book.id]
  );

  return { pdf, pages, loadText };
}
