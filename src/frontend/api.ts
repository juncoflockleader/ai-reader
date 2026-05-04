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
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  citations?: Array<{ page: number; chunk_id?: string; quote: string }>;
  context?: unknown;
};

export type ProviderId = "openai" | "anthropic";

export type AppSettings = {
  defaultProvider: ProviderId;
  providers: Record<ProviderId, { model: string; hasKey: boolean; apiKey?: string }>;
  privacyAcknowledged: boolean;
  keyStorageWarning: string;
  models: Record<ProviderId, string[]>;
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
