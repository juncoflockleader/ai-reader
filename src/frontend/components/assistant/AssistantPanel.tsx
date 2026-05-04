import { BookMarked, ChevronDown, Save, Send, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type AppSettings, type Book, type ChatMessage, type ProviderId } from "../../api";

type Props = {
  book: Book;
  currentPage: number;
  selectedText: string;
  onNavigate: (page: number) => void;
  settingsVersion: number;
};

const modes = [
  ["explain_simple", "Simple"],
  ["explain_depth", "Depth"],
  ["summarize", "Summary"],
  ["define_terms", "Terms"],
  ["give_example", "Example"],
  ["quiz_me", "Quiz"]
] as const;

export default function AssistantPanel({ book, currentPage, selectedText, onNavigate, settingsVersion }: Props) {
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

  async function ask() {
    if (!question.trim() || busy) return;
    const userText = question.trim();
    setQuestion("");
    setError("");
    setBusy(true);
    setMessages((current) => [...current, { role: "user", content: userText }]);
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
            <div className="message-body">{message.content}</div>
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
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Why is this important?"
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void ask();
          }}
        />
        <button className="send-button" onClick={ask} disabled={busy || !question.trim()} title="Send">
          <Send size={18} />
        </button>
      </div>
    </aside>
  );
}
