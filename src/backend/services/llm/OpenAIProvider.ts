import OpenAI from "openai";
import type { ChatRequest, ChatResponse, LLMProvider } from "./LLMProvider";

export class OpenAIProvider implements LLMProvider {
  id = "openai";
  displayName = "OpenAI";

  async chat(request: ChatRequest, apiKey: string): Promise<ChatResponse> {
    const client = new OpenAI({ apiKey });
    const response = await client.chat.completions.create({
      model: request.model,
      messages: request.messages,
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
