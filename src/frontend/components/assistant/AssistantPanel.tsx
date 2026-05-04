import { BookMarked, ChevronDown, Save, Send, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type AppSettings, type Book, type ChatAttachment, type ChatMessage, type ProviderId } from "../../api";

type Props = {
  book: Book;
  currentPage: number;
  selectedText: string;
  onNavigate: (page: number) => void;
  settingsVersion: number;
  draftQuestion: { id: number; text: string } | null;
  attachments: ChatAttachment[];
  onRemoveAttachment: (attachmentId: string) => void;
  onClearAttachments: () => void;
};

const modes = [
  ["explain_simple", "Simple"],
  ["explain_depth", "Depth"],
  ["summarize", "Summary"],
  ["define_terms", "Terms"],
  ["give_example", "Example"],
  ["quiz_me", "Quiz"]
] as const;

export default function AssistantPanel({
  book,
  currentPage,
  selectedText,
  onNavigate,
  settingsVersion,
  draftQuestion,
  attachments,
  onRemoveAttachment,
  onClearAttachments
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState<(typeof modes)[number][0]>("explain_simple");
  const [provider, setProvider] = useState<ProviderId>("openai");
  const [model, setModel] = useState("gpt-4.1-mini");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [contextUsed, setContextUsed] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<AppSettings>("/api/settings")
      .then((settings) => {
        setSettings(settings);
        setProvider(settings.defaultProvider);
        setModel(settings.providers[settings.defaultProvider].model);
      })
      .catch(() => undefined);
  }, [settingsVersion]);

  useEffect(() => {
    if (!draftQuestion) return;
    setQuestion(draftQuestion.text);
  }, [draftQuestion]);

  async function ask() {
    if ((!question.trim() && attachments.length === 0) || busy) return;
    const outgoingAttachments = attachments;
    const userText = question.trim() || attachmentOnlyQuestion(outgoingAttachments, currentPage);
    setQuestion("");
    onClearAttachments();
    setError("");
    setBusy(true);
    setMessages((current) => [...current, { role: "user", content: userText, attachments: outgoingAttachments }]);
    try {
      const result = await api<{
        conversation_id: string;
        answer: string;
        citations: Array<{ page: number; chunk_id?: string; quote: string }>;
        context_used: unknown;
      }>("/api/chat", {
        method: "POST",
        body: JSON.stringify({
          book_id: book.id,
          conversation_id: conversationId,
          question: userText,
          current_page: currentPage,
          selected_text: selectedText,
          attachments: outgoingAttachments.map((attachment) => ({
            type: attachment.type,
            dataUrl: attachment.dataUrl,
            mimeType: attachment.mimeType
          })),
          mode,
          provider,
          model
        })
      });
      setConversationId(result.conversation_id);
      setContextUsed(result.context_used);
      setMessages((current) => [...current, { role: "assistant", content: result.answer, citations: result.citations }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI request failed.");
    } finally {
      setBusy(false);
    }
  }

  async function saveAnswer(content: string) {
    setError("");
    try {
      await api(`/api/books/${book.id}/highlights`, {
        method: "POST",
        body: JSON.stringify({
          page_number: currentPage,
          selected_text: selectedText || `AI note on page ${currentPage}`,
          note: content,
          color: "blue",
          anchor: {
            page_index: currentPage - 1,
            selected_text: selectedText
          }
        })
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save note.");
    }
  }

  return (
    <aside className="assistant-panel">
      <div className="assistant-header">
        <div>
          <h2>Study Assistant</h2>
          <p>Page {currentPage} · {selectedText ? "selection included" : "current page context"} · {model}</p>
        </div>
        <select
          value={provider}
          onChange={(event) => {
            const nextProvider = event.target.value as ProviderId;
            setProvider(nextProvider);
            setModel(settings?.providers[nextProvider].model ?? (nextProvider === "openai" ? "gpt-4.1-mini" : "claude-sonnet-4-20250514"));
          }}
          aria-label="LLM provider"
        >
          <option value="openai">OpenAI</option>
          <option value="anthropic">Claude</option>
        </select>
      </div>

      <div className="mode-row">
        {modes.map(([value, label]) => (
          <button key={value} className={mode === value ? "mode active" : "mode"} onClick={() => setMode(value)}>
            {label}
          </button>
        ))}
      </div>

      <div className="chat-thread">
        {messages.length === 0 && (
          <div className="assistant-empty">
            <Sparkles size={28} />
            <h3>Ask about the page, a selection, or the whole book.</h3>
          </div>
        )}
        {messages.map((message, index) => (
          <div key={index} className={`message ${message.role}`}>
            <div className="message-body">
              <MarkdownText text={message.content} />
              {message.attachments && message.attachments.length > 0 && (
                <div className="message-attachments">
                  {message.attachments.map((attachment) => (
                    <img key={attachment.id} src={attachment.dataUrl} alt={attachment.label} />
                  ))}
                </div>
              )}
            </div>
            {message.citations && message.citations.length > 0 && (
              <div className="citation-list">
                <button onClick={() => saveAnswer(message.content)}>
                  <Save size={14} />
                  <span>Save note</span>
                </button>
                {message.citations.map((citation, citationIndex) => (
                  <button key={citationIndex} onClick={() => onNavigate(citation.page)}>
                    <BookMarked size={14} />
                    <span>p. {citation.page}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="message assistant"><div className="message-body">Thinking with the local context...</div></div>}
      </div>

      {contextUsed !== null && (
        <details className="context-drawer">
          <summary>
            Context used <ChevronDown size={14} />
          </summary>
          <pre>{JSON.stringify(contextUsed, null, 2)}</pre>
        </details>
      )}

      {error && <div className="inline-error">{error}</div>}

      <div className="chat-input">
        {attachments.length > 0 && (
          <div className="composer-attachments">
            {attachments.map((attachment) => (
              <div className="composer-attachment" key={attachment.id}>
                <img src={attachment.dataUrl} alt={attachment.label} />
                <span>{attachment.label}</span>
                <button onClick={() => onRemoveAttachment(attachment.id)} title="Remove screenshot">
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Why is this important?"
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void ask();
            }
          }}
        />
        <button className="send-button" onClick={ask} disabled={busy || (!question.trim() && attachments.length === 0)} title="Send">
          <Send size={18} />
        </button>
      </div>
    </aside>
  );
}

function attachmentOnlyQuestion(attachments: ChatAttachment[], currentPage: number) {
  const pages = Array.from(new Set(attachments.map((attachment) => attachment.page))).join(", ");
  return `Explain the attached PDF screenshot${attachments.length > 1 ? "s" : ""} from page ${pages || currentPage}.`;
}

function MarkdownText({ text }: { text: string }) {
  const blocks = parseMarkdownBlocks(text);
  return (
    <div className="markdown-body">
      {blocks.map((block, index) => {
        if (block.type === "code") return <pre key={index}><code>{block.text}</code></pre>;
        if (block.type === "heading") {
          const Heading = `h${block.level}` as "h1" | "h2" | "h3";
          return <Heading key={index}>{renderInlineMarkdown(block.text)}</Heading>;
        }
        if (block.type === "list") {
          const List = block.ordered ? "ol" : "ul";
          return (
            <List key={index}>
              {block.items.map((item, itemIndex) => <li key={itemIndex}>{renderInlineMarkdown(item)}</li>)}
            </List>
          );
        }
        return <p key={index}>{renderInlineMarkdown(block.text)}</p>;
      })}
    </div>
  );
}

type MarkdownBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "code"; text: string };

function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let code: string[] | null = null;

  function flushParagraph() {
    if (paragraph.length) {
      blocks.push({ type: "paragraph", text: paragraph.join(" ") });
      paragraph = [];
    }
  }

  function flushList() {
    if (list?.items.length) {
      blocks.push({ type: "list", ordered: list.ordered, items: list.items });
      list = null;
    }
  }

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (code) {
        blocks.push({ type: "code", text: code.join("\n") });
        code = null;
      } else {
        flushParagraph();
        flushList();
        code = [];
      }
      continue;
    }
    if (code) {
      code.push(line);
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", level: heading[1].length as 1 | 2 | 3, text: heading[2] });
      continue;
    }

    const listItem = /^\s*(?:([-*])|(\d+)\.)\s+(.+)$/.exec(line);
    if (listItem) {
      flushParagraph();
      const ordered = Boolean(listItem[2]);
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push(listItem[3]);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }

  if (code) blocks.push({ type: "code", text: code.join("\n") });
  flushParagraph();
  flushList();
  return blocks.length ? blocks : [{ type: "paragraph", text }];
}

function renderInlineMarkdown(text: string) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*")) return <em key={index}>{part.slice(1, -1)}</em>;
    return part;
  });
}
