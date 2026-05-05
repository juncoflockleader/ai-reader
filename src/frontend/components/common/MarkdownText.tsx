import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";

export default function MarkdownText({ text }: { text: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
        {normalizeMarkdownTables(text)}
      </ReactMarkdown>
    </div>
  );
}

function normalizeMarkdownTables(text: string) {
  return text.replace(/((?:\|[^\n|]+)+\|)(?:\s+(?=\|))/g, (match) => {
    const rows = match.match(/\|[^|]+(?:\|[^|]+)+\|/g);
    return rows && rows.length >= 2 ? `${rows.join("\n")}\n` : match;
  });
}
