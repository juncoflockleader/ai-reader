import { ChevronDown, CornerDownRight, RefreshCw, Send, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, type AppSettings, type Book, type ChatAttachment, type ChatMessage, type ChatMode, type Conversation, type ModelChoice, type ProviderId } from "../../api";
import MarkdownText from "../common/MarkdownText";
import { getAction } from "../../actions/registry";

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
  onClearAttachments
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [historyMessages, setHistoryMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [chatMode, setChatMode] = useState<ChatMode>("pdf_fast");
  const [contextScope, setContextScope] = useState<"selection" | "page" | "document">("page");
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

  async function ask(input?: { text?: string; scope?: "selection" | "page" | "document" }) {
    const requestedText = input?.text ?? question;
    const requestedScope = input?.scope ?? contextScope;
    if ((!requestedText.trim() && attachments.length === 0) || busy) return;
    const outgoingAttachments = attachments;
    const userText = requestedText.trim() || attachmentOnlyQuestion(outgoingAttachments, currentPage);
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
          context_scope: requestedScope,
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

  async function saveAnswer(content: string, key: string, prompt: string) {
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
            selected_text: selectedText,
            prompt
          }
        })
      });
      setSavedNoteKeys((current) => new Set(current).add(key));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save note.");
    }
  }

  async function regenerateWithScope(prompt: string, scope: "selection" | "page" | "document") {
    if (!prompt.trim() || busy) return;
    setContextScope(scope);
    await ask({ text: prompt, scope });
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
      <div className="context-chip-row">
        <span>Context:</span>
        {(["selection", "page", "document"] as const).map((scope) => (
          <button key={scope} className={contextScope === scope ? "context-chip active" : "context-chip"} onClick={() => setContextScope(scope)}>
            {scope === "selection" ? "Selection" : scope === "page" ? "Page" : "Whole document"}
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
                regeneratePrompt={promptForAssistantMessage(historyMessages, index)}
                saved={savedNoteKeys.has(`history-${index}`)}
                onFollowUp={() => setFollowUpMessage({ role: message.role, content: message.content })}
                onSaveNote={() => saveAnswer(message.content, `history-${index}`, promptForAssistantMessage(historyMessages, index))}
                onNavigate={onNavigate}
                contextScope={contextScope}
                onScopeChange={setContextScope}
                onRegenerate={regenerateWithScope}
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
            regeneratePrompt={promptForAssistantMessage(messages, index)}
            saved={savedNoteKeys.has(`current-${index}`)}
            onFollowUp={() => setFollowUpMessage({ role: message.role, content: message.content })}
            onSaveNote={() => saveAnswer(message.content, `current-${index}`, promptForAssistantMessage(messages, index))}
            onNavigate={onNavigate}
            contextScope={contextScope}
            onScopeChange={setContextScope}
            onRegenerate={regenerateWithScope}
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
      <div className="follow-up-suggestions">
        {quickSuggestions({ selectedText, currentPage, hasAssistantMessage: messages.some((message) => message.role === "assistant") }).map((suggestion) => (
          <button key={suggestion} onClick={() => setQuestion(suggestion)}>
            {suggestion}
          </button>
        ))}
      </div>

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
        <button className="send-button" onClick={() => void ask()} disabled={busy || (!question.trim() && attachments.length === 0)} title="Send">
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
  regeneratePrompt,
  saved,
  onFollowUp,
  onSaveNote,
  onNavigate,
  contextScope,
  onScopeChange,
  onRegenerate
}: {
  message: ChatMessage;
  actionKey: string;
  regeneratePrompt: string;
  saved: boolean;
  onFollowUp: () => void;
  onSaveNote: () => void;
  onNavigate: (page: number) => void;
  contextScope: "selection" | "page" | "document";
  onScopeChange: (scope: "selection" | "page" | "document") => void;
  onRegenerate: (prompt: string, scope: "selection" | "page" | "document") => Promise<void>;
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
        <div className="context-chip-row">
          <span>Answer context:</span>
          {(["selection", "page", "document"] as const).map((scope) => (
            <button key={`${actionKey}-${scope}`} className={contextScope === scope ? "context-chip active" : "context-chip"} onClick={() => onScopeChange(scope)}>
              {scope === "selection" ? "Selection" : scope === "page" ? "Page" : "Whole document"}
            </button>
          ))}
        </div>
      )}
      {message.role === "assistant" && (
        <div className="citation-list">
          {(() => {
            const followUpAction = getAction("followUpAssistantMessage");
            const saveAction = getAction("saveAssistantMessageNote");
            const citationAction = getAction("jumpToCitationPage");
            const FollowUpIcon = followUpAction.icon;
            const SaveIcon = saveAction.icon;
            const CitationIcon = citationAction.icon;
            return (
              <>
                <button onClick={onFollowUp} title={followUpAction.shortcut ? `${followUpAction.label} (${followUpAction.shortcut})` : followUpAction.label}>
                  <FollowUpIcon size={14} />
                  <span>{followUpAction.label}</span>
                </button>
                <button onClick={onSaveNote} disabled={saved} title={saved ? "Note saved" : saveAction.label}>
                  <SaveIcon size={14} />
                  <span>{saved ? "Saved" : saveAction.label}</span>
                </button>
                {message.citations?.map((citation, citationIndex) => (
                  <button key={`${actionKey}-citation-${citationIndex}`} onClick={() => onNavigate(citation.page)} title={citationAction.label}>
                    <CitationIcon size={14} />
                    <span>p. {citation.page}</span>
                  </button>
                ))}
                <button onClick={() => void onRegenerate(regeneratePrompt, "selection")} title="Regenerate with narrower context">
                  <RefreshCw size={14} />
                  <span>Narrower</span>
                </button>
                <button onClick={() => void onRegenerate(regeneratePrompt, "document")} title="Regenerate with broader context">
                  <RefreshCw size={14} />
                  <span>Broader</span>
                </button>
              </>
            );
          })()}
        </div>
      )}
      {message.role === "assistant" && message.citations && message.citations.length > 0 && (
        <div className="source-anchors">
          {message.citations.map((citation, citationIndex) => (
            <a key={`${actionKey}-anchor-${citationIndex}`} href={`#pdf-page-${citation.page}`} onClick={() => onNavigate(citation.page)}>
              [p.{citation.page}{citation.chunk_id ? ` · ${citation.chunk_id}` : ""}]
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function truncateForUi(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function promptForAssistantMessage(messages: ChatMessage[], assistantIndex: number) {
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return messages[index].content;
  }
  return "";
}

function quickSuggestions(input: { selectedText: string; currentPage: number; hasAssistantMessage: boolean }) {
  const suggestions = input.selectedText.trim()
    ? [
        "Summarize this selection in 3 bullets.",
        "Explain this selection like I'm new to the topic.",
        "What assumptions does this selection make?"
      ]
    : [
        `Summarize page ${input.currentPage}.`,
        "List the key terms I should remember.",
        "Create 3 quiz questions from this page."
      ];
  if (input.hasAssistantMessage) suggestions.unshift("Can you verify the previous answer with citations?");
  return suggestions.slice(0, 4);
}
