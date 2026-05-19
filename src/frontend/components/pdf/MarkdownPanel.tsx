import { useEffect, useState } from "react";
import type { Book } from "../../api";
import { api } from "../../api";
import MarkdownText from "../common/MarkdownText";

type Props = {
  book: Book;
  currentPage: number;
  selectedText: string;
  onPageChange: (page: number) => void;
  onSelectedText: (text: string) => void;
};

type PageData = {
  clean_text: string;
};

export default function MarkdownPanel({ book, onSelectedText }: Props) {
  const [page, setPage] = useState<PageData | null>(null);

  useEffect(() => {
    api<{ page: PageData }>(`/api/books/${book.id}/pages/1`).then((result) => setPage(result.page));
  }, [book.id]);

  useEffect(() => {
    const onSelection = () => {
      const text = window.getSelection?.()?.toString().trim() ?? "";
      onSelectedText(text);
    };
    document.addEventListener("selectionchange", onSelection);
    return () => document.removeEventListener("selectionchange", onSelection);
  }, [onSelectedText]);

  return <section className="markdown-reader">{page ? <MarkdownText text={page.clean_text} /> : <div>Loading…</div>}</section>;
}
