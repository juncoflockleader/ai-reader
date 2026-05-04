import { BookMarked, ChevronDown, CornerDownRight, Save, Send, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, type AppSettings, type Book, type ChatAttachment, type ChatMessage, type ChatMode, type Conversation, type ModelChoice, type ProviderId } from "../../api";

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
  onNotesChanged: () => void;
};

const chatModes = [
  ["no_context_fast", "No context"],
  ["pdf_fast", "PDF fast"],
  ["pdf_thinking", "PDF thinking"]
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
  onClearAttachments,
  onNotesChanged
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [historyMessages, setHistoryMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [chatMode, setChatMode] = useState<ChatMode>("pdf_fast");
  const [provider, setProvider] = useState<ProviderId>("openai");
  const [model, setModel] = useState("gpt-4.1-mini");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [followUpMessage, setFollowUpMessage] = useState<{ role: ChatMessage["role"]; content: string } | null>(null);
  const [contextUsed, setContextUsed] = useState<unknown>(null);
  const [savedNoteKeys, setSavedNoteKeys] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const chatThreadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<AppSettings>("/api/settings")
      .then((settings) => {
        setSettings(settings);
        const choice = modelChoiceForMode(settings, chatMode);
        setProvider(choice.provider);
        setModel(choice.model);
      })
      .catch(() => undefined);
  }, [settingsVersion, chatMode]);

  useEffect(() => {
    if (!settings) return;
    const choice = modelChoiceForMode(settings, chatMode);
    setProvider(choice.provider);
    setModel(choice.model);
  }, [settings, chatMode]);

  useEffect(() => {
    if (!draftQuestion) return;
    setQuestion(draftQuestion.text);
  }, [draftQuestion]);

  useEffect(() => {
    let cancelled = false;
    setMessages([]);
    setHistoryMessages([]);
    setConversationId(null);
    setFollowUpMessage(null);
    setContextUsed(null);
    setSavedNoteKeys(new Set());
    api<{ conversations: Conversation[] }>(`/api/chat/books/${book.id}/conversations`)
      .then(async (result) => {
        const latest = result.conversations[0];
        if (!latest) return;
        const loaded = await api<{ messages: ChatMessage[] }>(`/api/chat/conversations/${latest.id}/messages`);
        if (!cancelled) setHistoryMessages(loaded.messages);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [book.id]);

  useEffect(() => {
    const thread = chatThreadRef.current;
    if (!thread) return;
    requestAnimationFrame(() => {
      thread.scrollTo({ top: thread.scrollHeight, behavior: "smooth" });
    });
  }, [messages, historyMessages, busy]);

  async function ask() {
    if ((!question.trim() && attachments.length === 0) || busy) return;
    const outgoingAttachments = attachments;
    const userText = question.trim() || attachmentOnlyQuestion(outgoingAttachments, currentPage);
    setQuestion("");
    onClearAttachments();
    setFollowUpMessage(null);
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
          chat_mode: chatMode,
          follow_up_message: followUpMessage ? `${followUpMessage.role}: ${followUpMessage.content}` : undefined,
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

  async function saveAnswer(content: string, key: string) {
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
            type: "ai_note",
            page_index: currentPage - 1,
            selected_text: selectedText
          }
        })
      });
      setSavedNoteKeys((current) => new Set(current).add(key));
      onNotesChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save note.");
    }
  }

  async function clearChatHistory() {
    const hasVisibleChat = historyMessages.length > 0 || messages.length > 0 || conversationId !== null;
    if (!hasVisibleChat || busy) return;
    const confirmed = window.confirm(`Clear chat history for "${book.title ?? book.file_name}"? Saved notes and highlights will stay.`);
    if (!confirmed) return;
    setError("");
    try {
      await api(`/api/chat/books/${book.id}/conversations`, { method: "DELETE" });
      setMessages([]);
      setHistoryMessages([]);
      setConversationId(null);
      setFollowUpMessage(null);
      setContextUsed(null);
      setSavedNoteKeys(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not clear chat history.");
    }
  }

  return (
    <aside className="assistant-panel">
      <div className="assistant-header">
        <div>
          <h2>Study Assistant</h2>
          <p>Page {currentPage} · {selectedText ? "selection included" : "current page context"} · {model}</p>
        </div>
        <div className="assistant-actions">
          {settings?.modelMode === "detailed" ? (
            <div className="model-badge" title="Configured in Settings">
              {provider === "openai" ? "OpenAI" : "Claude"}
            </div>
          ) : (
            <select
              value={provider}
              onChange={(event) => {
                const nextProvider = event.target.value as ProviderId;
                setProvider(nextProvider);
                setModel(settings?.providers[nextProvider].model ?? (nextProvider === "openai" ? "gpt-4.1-mini" : "claude-sonnet-4-6"));
              }}
              aria-label="LLM provider"
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic">Claude</option>
            </select>
          )}
          <button
            className="icon-button danger"
            onClick={() => void clearChatHistory()}
            disabled={busy || (historyMessages.length === 0 && messages.length === 0 && conversationId === null)}
            title="Clear chat history"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      <div className="mode-row compact">
        {chatModes.map(([value, label]) => (
          <button key={value} className={chatMode === value ? "mode active" : "mode"} onClick={() => setChatMode(value)}>
            {label}
          </button>
        ))}
      </div>

      <div className="chat-thread" ref={chatThreadRef}>
        {historyMessages.length > 0 && (
          <>
            {historyMessages.map((message, index) => (
              <ChatMessageView
                key={`history-${index}`}
                message={message}
                actionKey={`history-${index}`}
                saved={savedNoteKeys.has(`history-${index}`)}
                onFollowUp={() => setFollowUpMessage({ role: message.role, content: message.content })}
                onSaveNote={() => saveAnswer(message.content, `history-${index}`)}
                onNavigate={onNavigate}
              />
            ))}
            <div className="history-divider">Loaded history above is preserved for reference and will not be considered unless you choose Follow up.</div>
          </>
        )}
        {historyMessages.length === 0 && messages.length === 0 && (
          <div className="assistant-empty">
            <Sparkles size={28} />
            <h3>Ask about the page, a selection, or the whole book.</h3>
          </div>
        )}
        {messages.map((message, index) => (
          <ChatMessageView
            key={`current-${index}`}
            message={message}
            actionKey={`current-${index}`}
            saved={savedNoteKeys.has(`current-${index}`)}
            onFollowUp={() => setFollowUpMessage({ role: message.role, content: message.content })}
            onSaveNote={() => saveAnswer(message.content, `current-${index}`)}
            onNavigate={onNavigate}
          />
        ))}
        {busy && <div className="message assistant"><div className="message-body">{thinkingLabel(chatMode)}</div></div>}
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
        {followUpMessage && (
          <div className="follow-up-chip">
            <CornerDownRight size={14} />
            <span>{truncateForUi(followUpMessage.content, 150)}</span>
            <button onClick={() => setFollowUpMessage(null)} title="Clear follow-up">
              <X size={14} />
            </button>
          </div>
        )}
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

function modelChoiceForMode(settings: AppSettings, chatMode: ChatMode): ModelChoice {
  if (settings.modelMode === "detailed") return settings.chatModels[chatMode];
  return {
    provider: settings.defaultProvider,
    model: settings.providers[settings.defaultProvider].model
  };
}

function thinkingLabel(chatMode: ChatMode) {
  if (chatMode === "no_context_fast") return "Thinking without PDF context...";
  if (chatMode === "pdf_thinking") return "Thinking carefully with PDF context...";
  return "Thinking with PDF context...";
}

function attachmentOnlyQuestion(attachments: ChatAttachment[], currentPage: number) {
  const pages = Array.from(new Set(attachments.map((attachment) => attachment.page))).join(", ");
  return `Explain the attached PDF screenshot${attachments.length > 1 ? "s" : ""} from page ${pages || currentPage}.`;
}

function ChatMessageView({
  message,
  actionKey,
  saved,
  onFollowUp,
  onSaveNote,
  onNavigate
}: {
  message: ChatMessage;
  actionKey: string;
  saved: boolean;
  onFollowUp: () => void;
  onSaveNote: () => void;
  onNavigate: (page: number) => void;
}) {
  return (
    <div className={`message ${message.role}`}>
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
      {message.role === "assistant" && (
        <div className="citation-list">
          <button onClick={onFollowUp}>
            <CornerDownRight size={14} />
            <span>Follow up</span>
          </button>
          <button onClick={onSaveNote} disabled={saved} title={saved ? "Note saved" : "Save answer as note"}>
            <Save size={14} />
            <span>{saved ? "Saved" : "Save note"}</span>
          </button>
          {message.citations?.map((citation, citationIndex) => (
            <button key={`${actionKey}-citation-${citationIndex}`} onClick={() => onNavigate(citation.page)}>
              <BookMarked size={14} />
              <span>p. {citation.page}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function truncateForUi(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max)}...` : text;
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
