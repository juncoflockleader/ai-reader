// Document structure panel: bookmarks + naively-inferred headings, each a jump
// target. Ported from PdfPanel; reuses the global `.doc-structure-nav` styles.

import { useMemo } from "react";
import { useReader } from "../ReaderProvider";

export default function StructureNavigator() {
  const { pages, setCurrentPage, annotations } = useReader();

  const inferredHeadings = useMemo(
    () =>
      Object.entries(pages)
        .map(([page, data]) => ({
          page: Number(page),
          text:
            data.clean_text
              .split(/\n+/)
              .map((line) => line.trim())
              .find((line) => line.length > 24 && line.length < 120) ?? "",
        }))
        .filter((entry) => entry.text)
        .slice(0, 80),
    [pages]
  );

  return (
    <div className="doc-structure-nav">
      <h4>Document structure</h4>
      {annotations.bookmarks.map((bookmark) => (
        <button key={bookmark.id} onClick={() => setCurrentPage(bookmark.page_number)}>
          Bookmark · p.{bookmark.page_number}
        </button>
      ))}
      {inferredHeadings.map((heading) => (
        <button key={`${heading.page}-${heading.text}`} onClick={() => setCurrentPage(heading.page)}>
          p.{heading.page} · {heading.text}
        </button>
      ))}
    </div>
  );
}
