import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import fs from "node:fs";
import { createRequire } from "node:module";
import { cleanPageText } from "./cleanText";
import type { ExtractedPage } from "./chunkText";

const require = createRequire(import.meta.url);
GlobalWorkerOptions.workerSrc = require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");

type TextItem = {
  str: string;
  transform?: number[];
  width?: number;
  height?: number;
  hasEOL?: boolean;
};

export async function extractPagesFromPdf(bookId: string, pdfPath: string): Promise<ExtractedPage[]> {
  const loadingTask = getDocument({
    data: new Uint8Array(fs.readFileSync(pdfPath)),
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true
  });
  const pdf = await loadingTask.promise;
  const pages: ExtractedPage[] = [];

  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const items = content.items as TextItem[];
    const rawText = textItemsToText(items);
    const cleanText = cleanPageText(rawText);
    const blocks = textToBlocks(i, cleanText);

    pages.push({
      bookId,
      pageIndex: i - 1,
      pdfPageNumber: i,
      rawText,
      cleanText,
      blocks
    });
  }

  await pdf.destroy();
  return pages;
}

function textItemsToText(items: TextItem[]) {
  let text = "";
  for (const item of items) {
    if (!item.str) continue;
    text += item.str;
    text += item.hasEOL ? "\n" : " ";
  }
  return text.trim();
}

function textToBlocks(pageNumber: number, cleanText: string) {
  const paragraphs = cleanText
    .split(/\n\s*\n/g)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const source = paragraphs.length > 0 ? paragraphs : [cleanText].filter(Boolean);
  return source.map((text, index) => ({
    block_id: `p${pageNumber}_b${String(index + 1).padStart(3, "0")}`,
    text,
    bbox: [],
    type: "paragraph"
  }));
}
