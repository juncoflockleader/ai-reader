// Read-only Markdown reader shell (Phase 3). The Markdown counterpart to
// ReaderWorkspace: same `.pdf-panel` grid slot and a minimal toolbar, with the
// shared ReadingSurface rendering parsed Markdown. No PDF tools.

import type { Book } from "../../api";
import MarkdownDocument from "./surface/MarkdownDocument";

type Props = {
  book: Book;
  onSelectedText: (text: string) => void;
};

export default function MarkdownReader({ book, onSelectedText }: Props) {
  return (
    <section className="pdf-panel">
      <div className="panel-toolbar">
        <div className="panel-book-meta" title={book.file_name}>
          <span className="topbar-book-label">Reading</span>
          <strong>{book.title ?? book.file_name}</strong>
        </div>
      </div>
      <MarkdownDocument book={book} onSelectedText={onSelectedText} />
    </section>
  );
}
