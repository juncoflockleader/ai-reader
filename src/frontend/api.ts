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

export type ProviderId = "openai" | "anthropic";
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

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: options?.body instanceof FormData ? options.headers : { "Content-Type": "application/json", ...options?.headers }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "Request failed.");
  return data as T;
}
