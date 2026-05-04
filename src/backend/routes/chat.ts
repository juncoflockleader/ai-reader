import { Router } from "express";
import { assembleContext, citationCandidates } from "../services/context/assembleContext";
import { getProvider, normalizeModel } from "../services/llm";
import { getDb, id, json, nowIso } from "../services/storage/db";
import { getApiKey, getSetting } from "./settings";

const router = Router();
type ProviderId = "openai" | "anthropic";
type ChatSettings = {
  defaultProvider: ProviderId;
  providers: Record<ProviderId, { model: string }>;
};

router.post("/", async (req, res, next) => {
  try {
    const bookId = req.body.book_id;
    const question = req.body.question;
    if (!bookId || !question) {
      res.status(400).json({ error: "book_id and question are required." });
      return;
    }

    const settings = getSetting<ChatSettings>("app.settings", {
      defaultProvider: "openai",
      providers: {
        openai: { model: "gpt-4.1-mini" },
        anthropic: { model: "claude-sonnet-4-20250514" }
      }
    });
    const providerId = (req.body.provider ?? settings.defaultProvider) as ProviderId;
    const model = normalizeModel(providerId, req.body.model ?? settings.providers[providerId].model);
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
      mode: req.body.mode
    });
    const provider = getProvider(providerId);
    const conversationId = req.body.conversation_id ?? createConversation(bookId, question);
    saveMessage(conversationId, "user", question, null, null);

    const answer = await provider.chat(
      {
        model,
        temperature: 0.2,
        maxTokens: 1400,
        messages: [
          { role: "system", content: context.systemInstruction },
          { role: "user", content: context.userPrompt }
        ]
      },
      apiKey
    );

    const citations = citationCandidates(context.sources);
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

router.get("/books/:bookId/conversations", (req, res) => {
  const conversations = getDb()
    .prepare("SELECT * FROM conversations WHERE book_id = ? ORDER BY updated_at DESC")
    .all(req.params.bookId);
  res.json({ conversations });
});

router.get("/conversations/:conversationId/messages", (req, res) => {
  const messages = getDb()
    .prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC")
    .all(req.params.conversationId);
  res.json({ messages });
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
