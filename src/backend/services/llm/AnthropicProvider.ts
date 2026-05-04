import Anthropic from "@anthropic-ai/sdk";
import type { ChatRequest, ChatResponse, LLMProvider } from "./LLMProvider";

export class AnthropicProvider implements LLMProvider {
  id = "anthropic";
  displayName = "Anthropic Claude";

  async chat(request: ChatRequest, apiKey: string): Promise<ChatResponse> {
    const client = new Anthropic({ apiKey });
    const system = request.messages.find((message) => message.role === "system")?.content;
    const messages = request.messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? "assistant" as const : "user" as const,
        content: message.content
      }));

    const response = await client.messages.create({
      model: request.model,
      system,
      messages,
      temperature: request.temperature ?? 0.2,
      max_tokens: request.maxTokens ?? 1200
    });
    return {
      provider: this.id,
      model: request.model,
      content: response.content.map((block) => (block.type === "text" ? block.text : "")).join("\n"),
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens
      }
    };
  }
}
