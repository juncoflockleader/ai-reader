export type Book = {
  id: string;
  title: string | null;
  author: string | null;
  file_name: string;
  file_hash: string;
  page_count: number;
  ingestion_status: string;
  created_at: string;
  updated_at: string;
};

export type Highlight = {
  id: string;
  book_id: string;
  page_number: number;
  selected_text: string;
  color: string;
  note: string | null;
  anchor?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  attachments?: ChatAttachment[];
  citations?: Array<{ page: number; chunk_id?: string; quote: string }>;
  context?: unknown;
};

export type Conversation = {
  id: string;
  book_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
};

export type ChatAttachment = {
  id: string;
  type: "image";
  dataUrl: string;
  mimeType: string;
  page: number;
  label: string;
};

export type ProviderId = "openai" | "anthropic" | "deepseek" | "doubao";
export type ChatMode = "no_context_fast" | "pdf_fast" | "pdf_thinking";

export type ModelChoice = {
  provider: ProviderId;
  model: string;
};

export type AppSettings = {
  defaultProvider: ProviderId;
  providers: Record<ProviderId, { model: string; hasKey: boolean; apiKey?: string }>;
  modelMode: "single" | "detailed";
  chatModels: Record<ChatMode, ModelChoice>;
  privacyAcknowledged: boolean;
  keyStorageWarning: string;
  models: Record<ProviderId, string[]>;
};

export type AlgorithmInstrumentationResponse = {
  instrumentedCode: string;
  summary: string;
  warnings: string[];
  provider: ProviderId;
  model: string;
};

export type WriterDocument = {
  id: string;
  title: string;
  genre: string | null;
  audience: string | null;
  target_length: number | null;
  status: "draft" | "review" | "final" | "archived";
  latest_revision_id: string | null;
  created_at: string;
  updated_at: string;
};

export type WriterRevision = {
  id: string;
  document_id: string;
  revision_number: number;
  full_text: string;
  outline_json: string | null;
  thesis_json: string | null;
  change_summary: string | null;
  parent_revision_id: string | null;
  created_at: string;
};

export type WriterBlock = {
  id: string;
  document_id: string;
  block_index: number;
  block_type: "heading" | "paragraph" | "list_item" | "quote" | "code";
  text: string;
  start_offset: number;
  end_offset: number;
  created_at: string;
  updated_at: string;
};

export type WriterSuggestion = {
  id: string;
  document_id: string;
  conversation_id: string | null;
  message_id: string | null;
  suggestion_type: "clarity" | "grammar" | "tone" | "structure" | "argument";
  target_start: number;
  target_end: number;
  original_text: string;
  suggested_text: string;
  explanation: string | null;
  status: "pending" | "accepted" | "rejected";
  resolution_note: string | null;
  created_at: string;
  resolved_at: string | null;
};

export type WriterContextArtifact = {
  id: string;
  document_id: string;
  artifact_type: "recent_changes" | "document_outline" | "thesis_state";
  payload: unknown;
  source_revision_id: string;
  computed_at: string;
  stale_after_edit_count: number;
  stale_after_seconds: number;
  refresh_reason: string | null;
  staleness: unknown;
};

/**
 * Whether a provider/model is *known* to be text-only. Mirrors the backend
 * `modelIsKnownTextOnly` (src/backend/services/llm/index.ts) so the composer can
 * warn before sending a screenshot a model can't read. High-confidence denylist
 * that fails open — the backend (pre-flight + runtime backstop) remains
 * authoritative; this is a proactive UX hint only.
 */
export function modelIsKnownTextOnly(provider: ProviderId, model: string): boolean {
  const m = model.toLowerCase();
  if (/vision|multimodal|omni|(^|[-_])vl(\d|[-_]|$)/.test(m)) return false;
  switch (provider) {
    case "openai":
      return /gpt-3\.5|text-|davinci|babbage|ada|whisper|embedding/.test(m);
    case "anthropic":
      return /claude-2|claude-instant/.test(m);
    case "deepseek":
      return true;
    case "doubao":
      return false;
    default:
      return false;
  }
}

export class ApiError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: options?.body instanceof FormData ? options.headers : { "Content-Type": "application/json", ...options?.headers }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = isRecord(data) && typeof data.error === "string" ? data.error : "Request failed.";
    throw new ApiError(message, response.status, data);
  }
  return data as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
