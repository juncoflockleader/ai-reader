// Read-only Markdown reading surface (Phase 3). Shares ReadingSurface chrome
// with the PDF reader (scroll frame, typography) but renders parsed Markdown.
// Per decision §8.2, v2 Markdown is read-only — no highlights/search/drawing.

import { useEffect, useRef, useState } from "react";
import type { Book } from "../../../api";
import { api } from "../../../api";
import MarkdownText from "../../common/MarkdownText";
import ReadingSurface from "./ReadingSurface";

type MarkdownDocumentProps = {
  book: Book;
  onSelectedText: (text: string) => void;
};

type PageData = { clean_text: string };

export default function MarkdownDocument({ book, onSelectedText }: MarkdownDocumentProps) {
  const [text, setText] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setText(null);
    api<{ page: PageData }>(`/api/books/${book.id}/pages/1`)
      .then((result) => {
        if (!cancelled) setText(result.page.clean_text);
      })
      .catch(() => {
        if (!cancelled) setText("");
      });
    return () => {
      cancelled = true;
    };
  }, [book.id]);

  // Surface text selections to the assistant, matching the PDF reader.
  useEffect(() => {
    const onSelection = () => {
      const selected = window.getSelection?.()?.toString().trim() ?? "";
      if (selected) onSelectedText(selected);
    };
    document.addEventListener("selectionchange", onSelection);
    return () => document.removeEventListener("selectionchange", onSelection);
  }, [onSelectedText]);

  return (
    <ReadingSurface scrollRef={scrollRef}>
      <section className="markdown-reader">
        {text === null ? <div>Loading…</div> : <MarkdownText text={text} />}
      </section>
    </ReadingSurface>
  );
}
