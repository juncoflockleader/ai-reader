import { Router } from "express";
import { assembleContext, citationCandidates } from "../services/context/assembleContext";
import { getProvider, normalizeModel } from "../services/llm";
import { getDb, id, json, nowIso, parseJson } from "../services/storage/db";
import { getApiKey, getAppSettings } from "./settings";

const router = Router();
type ProviderId = "openai" | "anthropic";
type ChatMode = "no_context_fast" | "pdf_fast" | "pdf_thinking";
type ImageAttachment = {
  type: "image";
  dataUrl: string;
  mimeType: string;
};

router.post("/", async (req, res, next) => {
  try {
    const bookId = req.body.book_id;
    const question = req.body.question;
    if (!bookId || !question) {
      res.status(400).json({ error: "book_id and question are required." });
      return;
    }

    const settings = getAppSettings();
    const attachments = normalizeAttachments(req.body.attachments);
    const chatMode = normalizeChatMode(req.body.chat_mode);
    const configuredChoice =
      settings.modelMode === "detailed"
        ? settings.chatModels[chatMode]
        : { provider: settings.defaultProvider, model: settings.providers[settings.defaultProvider].model };
    const providerId = normalizeProvider(configuredChoice.provider);
    const model = normalizeModel(providerId, configuredChoice.model);
    const apiKey = getApiKey(providerId);
    if (!apiKey) {
      res.status(400).json({ error: `Missing ${providerId} API key. Add it in Settings before asking AI questions.` });
      return;
    }

    const context = assembleContext({
      bookId,
      userQuestion: question,
      currentPage: req.body.current_page,
      selectedText: req.body.selected_text,
      conversationId: req.body.conversation_id,
      chatMode,
      followUpMessage: typeof req.body.follow_up_message === "string" ? req.body.follow_up_message : undefined,
      attachmentCount: attachments.length
    });
    const provider = getProvider(providerId);
    const conversationId = req.body.conversation_id ?? createConversation(bookId, question);
    saveMessage(conversationId, "user", question, null, null);

    const answer = await provider.chat(
      {
        model,
        temperature: 0.2,
        maxTokens: chatMode === "pdf_thinking" ? 2200 : 900,
        messages: [
          { role: "system", content: context.systemInstruction },
          { role: "user", content: context.userPrompt, attachments }
        ]
      },
      apiKey
    );

    const citations = context.contextDebug.pdfContextIncluded ? citationCandidates(context.sources) : [];
    const messageId = saveMessage(conversationId, "assistant", answer.content, context.contextDebug, citations);
    res.json({
      conversation_id: conversationId,
      message_id: messageId,
      answer: answer.content,
      citations,
      context_used: context.contextDebug,
      sources: context.sources
    });
  } catch (error) {
    next(error);
  }
});

function normalizeChatMode(value: unknown): ChatMode {
  return value === "no_context_fast" || value === "pdf_thinking" ? value : "pdf_fast";
}

function normalizeProvider(value: unknown): ProviderId {
  return value === "anthropic" ? "anthropic" : "openai";
}

function normalizeAttachments(value: unknown): ImageAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((attachment) => {
    if (!attachment || typeof attachment !== "object") return [];
    const candidate = attachment as Record<string, unknown>;
    if (candidate.type !== "image" || typeof candidate.dataUrl !== "string") return [];
    const mimeType = typeof candidate.mimeType === "string" ? candidate.mimeType : "image/png";
    if (!candidate.dataUrl.startsWith(`data:${mimeType};base64,`)) return [];
    return [{ type: "image" as const, dataUrl: candidate.dataUrl, mimeType }];
  });
}

router.get("/books/:bookId/conversations", (req, res) => {
  const conversations = getDb()
    .prepare("SELECT * FROM conversations WHERE book_id = ? ORDER BY updated_at DESC")
    .all(req.params.bookId);
  res.json({ conversations });
});

router.delete("/books/:bookId/conversations", (req, res) => {
  const result = getDb().prepare("DELETE FROM conversations WHERE book_id = ?").run(req.params.bookId);
  res.json({ ok: true, deleted: result.changes });
});

router.get("/conversations/:conversationId/messages", (req, res) => {
  const messages = getDb()
    .prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC")
    .all(req.params.conversationId) as Array<{ role: string; content: string; citations_json: string | null; context_json: string | null }>;
  res.json({
    messages: messages
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map((message) => ({
        role: message.role,
        content: message.content,
        citations: parseJson(message.citations_json, []),
        context: parseJson(message.context_json, null)
      }))
  });
});

function createConversation(bookId: string, question: string) {
  const conversationId = id("conv");
  const createdAt = nowIso();
  getDb()
    .prepare("INSERT INTO conversations (id, book_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run(conversationId, bookId, question.slice(0, 80), createdAt, createdAt);
  return conversationId;
}

function saveMessage(
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  context: unknown,
  citations: unknown
) {
  const messageId = id("msg");
  const createdAt = nowIso();
  getDb()
    .prepare(
      "INSERT INTO messages (id, conversation_id, role, content, context_json, citations_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .run(messageId, conversationId, role, content, context ? json(context) : null, citations ? json(citations) : null, createdAt);
  getDb().prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(createdAt, conversationId);
  return messageId;
}

export default router;
