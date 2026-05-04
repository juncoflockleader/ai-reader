export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
  attachments?: ChatAttachment[];
};

export type ChatAttachment = {
  type: "image";
  dataUrl: string;
  mimeType: string;
};

export type ChatRequest = {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
};

export type ChatResponse = {
  provider: string;
  model: string;
  content: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
};

export interface LLMProvider {
  id: "openai" | "anthropic" | string;
  displayName: string;
  chat(request: ChatRequest, apiKey: string): Promise<ChatResponse>;
}
