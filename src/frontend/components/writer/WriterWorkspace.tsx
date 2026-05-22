import {
  AlertTriangle,
  Check,
  Clock3,
  FilePlus2,
  FileText,
  History,
  ListTree,
  MessageCircleMore,
  MessageSquareText,
  RefreshCw,
  Save,
  Sparkles,
  X
} from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  api,
  type WriterBlock,
  type WriterContextArtifact,
  type WriterDocument,
  type WriterRevision,
  type WriterSuggestion
} from "../../api";
import MarkdownText from "../common/MarkdownText";

type DocumentListResponse = {
  documents: WriterDocument[];
  pagination: { page: number; page_size: number; total: number };
};

type DocumentResponse = {
  document: WriterDocument;
  latest_revision: WriterRevision | null;
  blocks: WriterBlock[];
};

type RevisionListResponse = {
  document: WriterDocument;
  revisions: WriterRevision[];
};

type SuggestionListResponse = {
  document: WriterDocument;
  suggestions: WriterSuggestion[];
};

type EditResponse = DocumentResponse & {
  base_revision: WriterRevision | null;
  edits: unknown[];
};

type AssistResponse = {
  document: WriterDocument;
  latest_revision: WriterRevision;
  conversation_id: string;
  answer: string;
  provider: string;
  model: string;
  suggestions: WriterSuggestion[];
  context_artifacts: WriterContextArtifact[];
};

type ApplySuggestionResponse = EditResponse & {
  suggestion: WriterSuggestion | null;
};

type AssistantMessage = {
  role: "user" | "assistant";
  content: string;
  suggestions?: WriterSuggestion[];
};

type NewDocumentDraft = {
  title: string;
  genre: string;
  audience: string;
  targetLength: string;
};

type WriterFailureState = {
  kind: "context-stale" | "conflict" | "invalid-range" | "error";
  title: string;
  message: string;
};

export default function WriterWorkspace() {
  const [documents, setDocuments] = useState<WriterDocument[]>([]);
  const [activeDocument, setActiveDocument] = useState<WriterDocument | null>(null);
  const [latestRevision, setLatestRevision] = useState<WriterRevision | null>(null);
  const [blocks, setBlocks] = useState<WriterBlock[]>([]);
  const [revisions, setRevisions] = useState<WriterRevision[]>([]);
  const [suggestions, setSuggestions] = useState<WriterSuggestion[]>([]);
  const [contextArtifacts, setContextArtifacts] = useState<WriterContextArtifact[]>([]);
  const [draftText, setDraftText] = useState("");
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(null);
  const [newDocument, setNewDocument] = useState<NewDocumentDraft>({ title: "", genre: "", audience: "", targetLength: "" });
  const [assistantPrompt, setAssistantPrompt] = useState("Review the latest draft and suggest the highest-value next edits.");
  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [coachMode, setCoachMode] = useState<"auto" | "local">("auto");
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [error, setError] = useState("");
  const [failureState, setFailureState] = useState<WriterFailureState | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void refreshDocuments();
  }, []);

  useEffect(() => {
    if (!activeDocument) return;
    localStorage.setItem("studywriter:lastDocumentId", activeDocument.id);
    void loadDocument(activeDocument.id);
  }, [activeDocument?.id]);

  const serverText = latestRevision?.full_text ?? "";
  const hasUnsavedChanges = draftText !== serverText;
  const wordTotal = wordCount(draftText);
  const selectedRevision = revisions.find((revision) => revision.id === selectedRevisionId) ?? revisions[0] ?? null;
  const pendingSuggestions = suggestions.filter((suggestion) => suggestion.status === "pending");
  const latestContextSummary = useMemo(() => summarizeContextArtifacts(contextArtifacts), [contextArtifacts]);
  const contextIsStale = isContextStale(contextArtifacts, latestRevision?.id ?? null);
  const activeSuggestions = useMemo(() => suggestions.filter((suggestion) => suggestion.status === "pending"), [suggestions]);

  async function refreshDocuments(selectDocumentId?: string | null) {
    const result = await api<DocumentListResponse>("/api/writer/documents?page_size=100");
    setDocuments(result.documents);
    setActiveDocument((current) => {
      const preferredId = selectDocumentId ?? current?.id ?? localStorage.getItem("studywriter:lastDocumentId");
      return result.documents.find((document) => document.id === preferredId) ?? result.documents[0] ?? null;
    });
  }

  async function loadDocument(documentId: string) {
    clearErrorState();
    setBusy(true);
    try {
      const result = await api<DocumentResponse>(`/api/writer/documents/${documentId}`);
      applyDocumentState(result);
      await Promise.all([
        refreshRevisions(documentId),
        refreshSuggestions(documentId),
        result.latest_revision ? refreshContextForDocument(documentId, false) : Promise.resolve()
      ]);
    } catch (err) {
      showWriterError(err, "Could not load document.");
    } finally {
      setBusy(false);
    }
  }

  async function refreshRevisions(documentId = activeDocument?.id) {
    if (!documentId) return;
    const result = await api<RevisionListResponse>(`/api/writer/documents/${documentId}/revisions?limit=10`);
    setRevisions(result.revisions);
    setSelectedRevisionId((current) => current && result.revisions.some((revision) => revision.id === current) ? current : result.revisions[0]?.id ?? null);
  }

  async function refreshSuggestions(documentId = activeDocument?.id) {
    if (!documentId) return;
    const result = await api<SuggestionListResponse>(`/api/writer/documents/${documentId}/suggestions?limit=100`);
    setSuggestions(result.suggestions);
  }

  async function createDocument() {
    const title = newDocument.title.trim();
    if (!title || busy) return;
    clearErrorState();
    setBusy(true);
    try {
      const created = await api<{ document: WriterDocument }>("/api/writer/documents", {
        method: "POST",
        body: JSON.stringify({
          title,
          genre: newDocument.genre || undefined,
          audience: newDocument.audience || undefined,
          target_length: newDocument.targetLength ? Number(newDocument.targetLength) : undefined
        })
      });
      setNewDocument({ title: "", genre: "", audience: "", targetLength: "" });
      setAssistantMessages([]);
      setConversationId(null);
      await refreshDocuments(created.document.id);
    } catch (err) {
      showWriterError(err, "Could not create document.");
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    clearErrorState();
    setSaving(true);
    try {
      await persistDraftIfNeeded();
    } catch (err) {
      showWriterError(err, "Could not save draft.");
    } finally {
      setSaving(false);
    }
  }

  async function persistDraftIfNeeded() {
    if (!activeDocument) throw new Error("Create a document before saving.");
    const operations = buildTextOperations(serverText, draftText);
    if (operations.length === 0) return latestRevision;
    const result = await api<EditResponse>(`/api/writer/documents/${activeDocument.id}/edits`, {
      method: "POST",
      body: JSON.stringify({
        base_revision_id: latestRevision?.id ?? null,
        operations,
        change_summary: latestRevision ? "Saved editor changes." : "Initial draft text."
      })
    });
    applyDocumentState(result);
    await Promise.all([refreshDocuments(result.document.id), refreshRevisions(result.document.id), refreshSuggestions(result.document.id)]);
    return result.latest_revision;
  }

  async function refreshContext(force = false) {
    if (!activeDocument || !latestRevision) return;
    clearErrorState();
    setBusy(true);
    try {
      await refreshContextForDocument(activeDocument.id, force);
    } catch (err) {
      showWriterError(err, "Could not refresh writer context.");
    } finally {
      setBusy(false);
    }
  }

  async function refreshContextForDocument(documentId: string, force: boolean) {
    const result = await api<{ artifacts: WriterContextArtifact[]; latest_revision: WriterRevision }>(
      `/api/writer/documents/${documentId}/context/update`,
      {
        method: "POST",
        body: JSON.stringify({ force })
      }
    );
    setLatestRevision(result.latest_revision);
    setContextArtifacts(result.artifacts);
    return result;
  }

  async function askCoach() {
    const prompt = assistantPrompt.trim();
    if (!activeDocument || !prompt || assistantBusy) return;
    clearErrorState();
    setAssistantBusy(true);
    setAssistantMessages((current) => [...current, { role: "user", content: prompt }]);
    try {
      const revision = await persistDraftIfNeeded();
      if (!revision) throw new Error("Save some draft text before asking the writing coach.");
      const result = await api<AssistResponse>(`/api/writer/documents/${activeDocument.id}/assist`, {
        method: "POST",
        body: JSON.stringify({
          prompt,
          conversation_id: conversationId,
          base_revision_id: revision.id,
          use_llm: coachMode === "local" ? false : undefined
        })
      });
      setConversationId(result.conversation_id);
      setLatestRevision(result.latest_revision);
      setContextArtifacts(result.context_artifacts);
      setAssistantMessages((current) => [
        ...current,
        { role: "assistant", content: result.answer, suggestions: result.suggestions }
      ]);
      await refreshSuggestions(result.document.id);
    } catch (err) {
      showWriterError(err, "Writer coach failed.");
    } finally {
      setAssistantBusy(false);
    }
  }

  async function applySuggestion(suggestion: WriterSuggestion) {
    if (!activeDocument || !latestRevision) return;
    clearErrorState();
    setBusy(true);
    try {
      const result = await api<ApplySuggestionResponse>(`/api/writer/documents/${activeDocument.id}/suggestions/${suggestion.id}/apply`, {
        method: "POST",
        body: JSON.stringify({
          base_revision_id: latestRevision.id,
          resolution_note: "Applied from Writer workspace."
        })
      });
      applyDocumentState(result);
      await Promise.all([refreshDocuments(result.document.id), refreshRevisions(result.document.id), refreshSuggestions(result.document.id)]);
    } catch (err) {
      showWriterError(err, "Could not apply suggestion.");
      await refreshSuggestions();
    } finally {
      setBusy(false);
    }
  }

  async function rejectSuggestion(suggestion: WriterSuggestion) {
    if (!activeDocument) return;
    clearErrorState();
    setBusy(true);
    try {
      await api(`/api/writer/documents/${activeDocument.id}/suggestions/${suggestion.id}/reject`, {
        method: "POST",
        body: JSON.stringify({ resolution_note: "Rejected from Writer workspace." })
      });
      await refreshSuggestions(activeDocument.id);
    } catch (err) {
      showWriterError(err, "Could not reject suggestion.");
    } finally {
      setBusy(false);
    }
  }

  function applyDocumentState(result: DocumentResponse) {
    setActiveDocument(result.document);
    setLatestRevision(result.latest_revision);
    setBlocks(result.blocks);
    setDraftText(result.latest_revision?.full_text ?? "");
    setSelectedRevisionId(result.latest_revision?.id ?? null);
  }

  function clearErrorState() {
    setError("");
    setFailureState(null);
  }

  function showWriterError(err: unknown, fallbackMessage: string) {
    const failure = classifyWriterFailure(err, fallbackMessage);
    setFailureState(failure);
    setError(failure.message);
  }

  const toolbar = (
    <div className="panel-toolbar app-topbar-toolbar writer-topbar-toolbar">
      <div className="panel-book-meta" title={activeDocument?.title ?? "Writer"}>
        <span className="topbar-book-label">Writing</span>
        <strong>{activeDocument?.title ?? "No document selected"}</strong>
      </div>
      <button className="tool-button" onClick={() => editorRef.current?.focus()} disabled={!activeDocument} title="Focus editor">
        <FileText size={16} />
      </button>
      <button className="tool-button" onClick={() => void saveDraft()} disabled={!activeDocument || !hasUnsavedChanges || saving} title="Save revision">
        <Save size={16} />
      </button>
      <button className="tool-button" onClick={() => void refreshContext(true)} disabled={!latestRevision || busy} title="Refresh writer context">
        <RefreshCw size={16} />
      </button>
      <button
        className={`tool-button ${showSuggestions ? "active" : ""}`}
        onClick={() => setShowSuggestions((current) => !current)}
        disabled={!activeDocument}
        title={showSuggestions ? "Hide suggestions" : "Show suggestions"}
      >
        <ListTree size={16} />
      </button>
      <label className="writer-revision-select">
        <History size={14} />
        <select value={selectedRevisionId ?? ""} onChange={(event) => setSelectedRevisionId(event.target.value)} disabled={revisions.length === 0}>
          {revisions.length === 0 && <option value="">No revisions</option>}
          {revisions.map((revision) => (
            <option key={revision.id} value={revision.id}>
              rev {revision.revision_number} · {formatDate(revision.created_at)}
            </option>
          ))}
        </select>
      </label>
      <span className="writer-topbar-stat">{wordTotal} words</span>
      {latestRevision && <span className="writer-topbar-stat">rev {latestRevision.revision_number}</span>}
      {latestContextSummary.map((item) => (
        <span key={item.label} className="writer-topbar-stat">
          {item.label}: {item.value}
        </span>
      ))}
      {contextIsStale && <span className="writer-topbar-stat writer-topbar-warning">Context stale</span>}
      {hasUnsavedChanges && <span className="writer-unsaved">Unsaved</span>}
    </div>
  );

  return (
    <section className="writer-workspace">
      {createPortal(toolbar, document.getElementById("app-topbar-tools") ?? document.body)}
      <aside className="writer-sidebar">
        <div className="writer-sidebar-header">
          <FilePlus2 size={18} />
          <strong>Documents</strong>
        </div>
        <div className="writer-create">
          <input
            value={newDocument.title}
            onChange={(event) => setNewDocument((current) => ({ ...current, title: event.target.value }))}
            placeholder="New draft title"
          />
          <div className="writer-create-row">
            <input
              value={newDocument.genre}
              onChange={(event) => setNewDocument((current) => ({ ...current, genre: event.target.value }))}
              placeholder="Genre"
            />
            <input
              value={newDocument.targetLength}
              onChange={(event) => setNewDocument((current) => ({ ...current, targetLength: event.target.value.replace(/\D/g, "") }))}
              placeholder="Words"
            />
          </div>
          <input
            value={newDocument.audience}
            onChange={(event) => setNewDocument((current) => ({ ...current, audience: event.target.value }))}
            placeholder="Audience"
          />
          <button className="writer-primary-action" onClick={() => void createDocument()} disabled={!newDocument.title.trim() || busy}>
            <FilePlus2 size={16} />
            New
          </button>
        </div>
        <div className="writer-document-list">
          {documents.map((document) => (
            <button
              key={document.id}
              className={activeDocument?.id === document.id ? "writer-document-item active" : "writer-document-item"}
              onClick={() => {
                if (hasUnsavedChanges && !window.confirm("Switch documents and discard unsaved editor text?")) return;
                setActiveDocument(document);
                setAssistantMessages([]);
                setConversationId(null);
              }}
            >
              <strong>{document.title}</strong>
              <span>{document.status} · {formatDate(document.updated_at)}</span>
            </button>
          ))}
          {documents.length === 0 && <p className="writer-muted">Create a draft to start writing.</p>}
        </div>
      </aside>

      <main className="writer-editor-panel">
        {activeDocument ? (
          <>
            <div className="writer-editor-header">
              <div>
                <span className="writer-eyebrow">{activeDocument.genre || "Draft"}</span>
                <h1>{activeDocument.title}</h1>
              </div>
              <div className="writer-editor-metrics">
                <span>{wordTotal} words</span>
                <span>{blocks.length} blocks</span>
                <span>{pendingSuggestions.length} pending</span>
              </div>
            </div>
            {failureState ? (
              <div className={`writer-failure-state ${failureState.kind}`}>
                <AlertTriangle size={18} />
                <div>
                  <strong>{failureState.title}</strong>
                  <span>{failureState.message}</span>
                </div>
                {(failureState.kind === "conflict" || failureState.kind === "context-stale") && (
                  <button onClick={() => activeDocument && void loadDocument(activeDocument.id)}>Refresh</button>
                )}
                {failureState.kind === "invalid-range" && <button onClick={() => editorRef.current?.focus()}>Edit</button>}
                <button className="writer-icon-button" onClick={clearErrorState} title="Dismiss">
                  <X size={15} />
                </button>
              </div>
            ) : error ? (
              <div className="inline-error">{error}</div>
            ) : null}
            <textarea
              ref={editorRef}
              className="writer-editor"
              value={draftText}
              onChange={(event) => setDraftText(event.target.value)}
              spellCheck
              placeholder="Start drafting here..."
            />
            {showSuggestions && (
              <section className="writer-inline-suggestions">
                <div className="writer-inline-suggestions-title">
                  <MessageCircleMore size={16} />
                  <strong>Inline AI suggestions</strong>
                </div>
                {activeSuggestions.length === 0 && <p className="writer-muted">No pending suggestions for this draft.</p>}
                {activeSuggestions.map((suggestion) => (
                  <article key={suggestion.id} className="writer-inline-suggestion">
                    <header>
                      <MessageCircleMore size={14} />
                      <span>{suggestion.suggestion_type}</span>
                      <small>
                        chars {suggestion.target_start}-{suggestion.target_end}
                      </small>
                    </header>
                    <p className="writer-inline-original">{suggestion.original_text || "Remove text"}</p>
                    {suggestion.suggested_text && <p className="writer-inline-replacement">{suggestion.suggested_text}</p>}
                    {suggestion.explanation && <small>{suggestion.explanation}</small>}
                    <div className="writer-suggestion-actions">
                      <button onClick={() => void applySuggestion(suggestion)} disabled={!latestRevision || busy} title="Apply suggestion">
                        <Check size={14} />
                        Apply
                      </button>
                      <button onClick={() => void rejectSuggestion(suggestion)} disabled={busy} title="Reject suggestion">
                        <X size={14} />
                        Reject
                      </button>
                    </div>
                  </article>
                ))}
              </section>
            )}
          </>
        ) : (
          <div className="writer-empty-state">
            <FileText size={34} />
            <h1>No writer document</h1>
            <p>Create a draft in the sidebar to open the editor.</p>
          </div>
        )}
      </main>

      <aside className="writer-inspector">
        <section className="writer-panel writer-coach-panel">
          <div className="writer-panel-title">
            <MessageSquareText size={17} />
            <strong>Coach</strong>
            <div className="writer-segmented" aria-label="Coach mode">
              <button className={coachMode === "auto" ? "active" : ""} onClick={() => setCoachMode("auto")}>AI</button>
              <button className={coachMode === "local" ? "active" : ""} onClick={() => setCoachMode("local")}>Local</button>
            </div>
          </div>
          <div className="writer-coach-thread">
            {assistantMessages.length === 0 && (
              <div className="writer-coach-empty">
                <Sparkles size={22} />
                <span>Ask for feedback after saving a revision.</span>
              </div>
            )}
            {assistantMessages.map((message, index) => (
              <div key={`${message.role}-${index}`} className={`writer-coach-message ${message.role}`}>
                <MarkdownText text={formatCoachMessageContent(message.content)} />
              </div>
            ))}
            {assistantBusy && <div className="writer-coach-message assistant">Reviewing the draft...</div>}
          </div>
          <textarea
            value={assistantPrompt}
            onChange={(event) => setAssistantPrompt(event.target.value)}
            placeholder="Ask for coaching..."
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void askCoach();
              }
            }}
          />
          <button className="writer-primary-action" onClick={() => void askCoach()} disabled={!activeDocument || !assistantPrompt.trim() || assistantBusy}>
            <MessageSquareText size={16} />
            Coach
          </button>
        </section>

        <section className="writer-panel">
          <div className="writer-panel-title">
            <History size={17} />
            <strong>Revision preview</strong>
          </div>
          {selectedRevision ? (
            <div className="writer-revision-preview">
              <strong>rev {selectedRevision.revision_number}</strong>
              <span>{selectedRevision.change_summary || "No summary"}</span>
              <pre>{selectedRevision.full_text.slice(0, 900)}</pre>
            </div>
          ) : (
            <p className="writer-muted">Choose a revision from the top bar.</p>
          )}
        </section>
      </aside>
    </section>
  );
}


function formatCoachMessageContent(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return content;

  const tryExtractAnswer = (value: unknown): string | null => {
    if (!value || typeof value !== "object") return null;
    const answer = (value as { answer?: unknown }).answer;
    return typeof answer === "string" && answer.trim() ? answer.trim() : null;
  };

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const answer = tryExtractAnswer(parsed);
    if (answer) return answer;
    if (typeof parsed === "string") {
      const nested = parsed.trim();
      if (!nested) return content;
      const nestedParsed = JSON.parse(nested) as unknown;
      const nestedAnswer = tryExtractAnswer(nestedParsed);
      if (nestedAnswer) return nestedAnswer;
    }
  } catch {
    return content;
  }

  return content;
}

function buildTextOperations(baseText: string, nextText: string) {
  if (baseText === nextText) return [];

  let start = 0;
  const shortestLength = Math.min(baseText.length, nextText.length);
  while (start < shortestLength && baseText[start] === nextText[start]) start += 1;

  let baseEnd = baseText.length;
  let nextEnd = nextText.length;
  while (baseEnd > start && nextEnd > start && baseText[baseEnd - 1] === nextText[nextEnd - 1]) {
    baseEnd -= 1;
    nextEnd -= 1;
  }

  const insertedText = nextText.slice(start, nextEnd);
  if (start === baseEnd && insertedText) {
    return [{ op_type: "insert", range_start: start, range_end: start, inserted_text: insertedText }];
  }
  if (!insertedText) {
    return [{ op_type: "delete", range_start: start, range_end: baseEnd, inserted_text: "" }];
  }
  return [{ op_type: "replace", range_start: start, range_end: baseEnd, inserted_text: insertedText }];
}

function wordCount(text: string) {
  const matches = text.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function summarizeContextArtifacts(artifacts: WriterContextArtifact[]) {
  const outline = artifacts.find((artifact) => artifact.artifact_type === "document_outline")?.payload;
  const thesis = artifacts.find((artifact) => artifact.artifact_type === "thesis_state")?.payload;
  const changes = artifacts.find((artifact) => artifact.artifact_type === "recent_changes")?.payload;
  const outlineCount = isRecord(outline) && typeof outline.node_count === "number" ? outline.node_count : 0;
  const thesisConfidence = isRecord(thesis) && typeof thesis.confidence === "number" ? Math.round(thesis.confidence * 100) : 0;
  const impactedBlocks = isRecord(changes) && Array.isArray(changes.impacted_blocks) ? changes.impacted_blocks.length : 0;
  return [
    { label: "Outline", value: outlineCount },
    { label: "Thesis", value: `${thesisConfidence}%` },
    { label: "Changed", value: impactedBlocks }
  ];
}

function isContextStale(artifacts: WriterContextArtifact[], latestRevisionId: string | null) {
  if (!latestRevisionId || artifacts.length === 0) return false;
  return artifacts.some((artifact) => {
    if (artifact.source_revision_id !== latestRevisionId) return true;
    return isRecord(artifact.staleness) && artifact.staleness.stale === true;
  });
}

function classifyWriterFailure(err: unknown, fallbackMessage: string): WriterFailureState {
  const message = err instanceof Error ? err.message : fallbackMessage;
  const status = err instanceof ApiError ? err.status : null;
  const normalized = message.toLowerCase();

  if (status === 409 && normalized.includes("base_revision_id")) {
    return {
      kind: "conflict",
      title: "Revision conflict",
      message: "This draft changed since the editor loaded. Refresh the document, review the latest revision, then try again."
    };
  }

  if (
    status === 409 &&
    (normalized.includes("target no longer matches") ||
      normalized.includes("suggestion is already") ||
      normalized.includes("latest revision"))
  ) {
    return {
      kind: "context-stale",
      title: "Suggestion is stale",
      message: "This suggestion was made against older context. Refresh the draft or ask the coach for a fresh pass."
    };
  }

  if (status === 400 && (normalized.includes("range") || normalized.includes("operations["))) {
    return {
      kind: "invalid-range",
      title: "Invalid edit range",
      message: "The edit could not be mapped to the current draft. Check the highlighted text and save again."
    };
  }

  return {
    kind: "error",
    title: "Writer action failed",
    message
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
