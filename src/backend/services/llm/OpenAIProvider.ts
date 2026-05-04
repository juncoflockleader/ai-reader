import OpenAI from "openai";
import type { ChatRequest, ChatResponse, LLMProvider } from "./LLMProvider";

export class OpenAIProvider implements LLMProvider {
  id = "openai";
  displayName = "OpenAI";

  async chat(request: ChatRequest, apiKey: string): Promise<ChatResponse> {
    const client = new OpenAI({ apiKey });
    const response = await client.chat.completions.create({
      model: request.model,
      messages: request.messages.map(toOpenAIMessage),
      temperature: request.temperature ?? 0.2,
      max_tokens: request.maxTokens ?? 1200
    });
    return {
      provider: this.id,
      model: request.model,
      content: response.choices[0]?.message.content ?? "",
      usage: {
        inputTokens: response.usage?.prompt_tokens,
        outputTokens: response.usage?.completion_tokens
      }
    };
  }
}

function toOpenAIMessage(message: ChatRequest["messages"][number]): OpenAI.Chat.Completions.ChatCompletionMessageParam {
  if (message.role === "system") return { role: "system", content: message.content };
  if (message.role === "assistant") return { role: "assistant", content: message.content };
  return {
    role: "user",
    content: message.attachments?.length
      ? [
          { type: "text", text: message.content },
          ...message.attachments.map((attachment) => ({
            type: "image_url" as const,
            image_url: { url: attachment.dataUrl }
          }))
        ]
      : message.content
  };
}
