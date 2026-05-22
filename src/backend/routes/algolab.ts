import { Router } from "express";
import { getProvider, isProviderId, normalizeModel, type ProviderId } from "../services/llm";
import { getApiKey, getAppSettings } from "./settings";

const router = Router();

type ChatMode = "no_context_fast" | "pdf_fast" | "pdf_thinking";

type InstrumentationResponse = {
  instrumentedCode: string;
  summary: string;
  warnings: string[];
};

router.post("/instrument", async (req, res, next) => {
  try {
    const source = normalizeSource(req.body.source);
    if (!source) {
      res.status(400).json({ error: "source is required." });
      return;
    }
    const language = typeof req.body.language === "string" && req.body.language.trim() ? req.body.language.trim().slice(0, 40) : "auto";
    const settings = getAppSettings();
    const choice =
      settings.modelMode === "detailed"
        ? settings.chatModels.no_context_fast
        : { provider: settings.defaultProvider, model: settings.providers[settings.defaultProvider].model };
    const providerId = normalizeProvider(choice.provider);
    const model = normalizeModel(providerId, choice.model);
    const apiKey = getApiKey(providerId);
    if (!apiKey) {
      res.status(400).json({ error: `Missing ${providerId} API key. Add it in Settings before instrumenting code.` });
      return;
    }

    const provider = getProvider(providerId);
    const answer = await provider.chat(
      {
        model,
        temperature: 0.1,
        maxTokens: 2200,
        messages: [
          { role: "system", content: instrumentationSystemPrompt() },
          { role: "user", content: instrumentationUserPrompt(source, language) }
        ]
      },
      apiKey
    );

    const parsed = parseInstrumentationResponse(answer.content);
    res.json({
      ...parsed,
      provider: providerId,
      model
    });
  } catch (error) {
    next(error);
  }
});

function instrumentationSystemPrompt() {
  return `You are an algorithm instrumentation compiler for an educational visualization tool.

Your job: rewrite learner code as JavaScript that generates a trace locally when it is executed with the provided visual API.

Return JSON only, with this exact shape:
{
  "instrumentedCode": "function run(input, visual) { ... }",
  "summary": "one short sentence",
  "warnings": ["short limitation or assumption, if any"]
}

Rules:
- Do not generate a trace, trace events, example output, or sample input.
- Do not include Markdown fences.
- instrumentedCode must define exactly one top-level function named run(input, visual).
- run must be synchronous JavaScript and must return the final array values.
- Convert non-JavaScript input into equivalent JavaScript when needed, while preserving the learner's algorithmic structure.
- Use visual.array(input) as the working array. Do not mutate input directly.
- Use visual.swap(a, i, j, message) for swaps; do not perform manual swap assignments.
- Use visual.compare(a, i, j, message), visual.less(a, i, j, message), or visual.lessOrEqual(a, i, j, message) for comparisons between array positions.
- Use visual.pointer, visual.range, visual.loop, visual.endLoop, visual.enterCall, visual.exitCall, visual.markSorted, visual.clearPointer, visual.clearRange, visual.explain, and visual.done where they clarify execution.
- Do not call fetch, XMLHttpRequest, WebSocket, importScripts, eval, Function, document, window, localStorage, or external libraries.

Available visual API:
- const a = visual.array(input)
- visual.value(a, index)
- visual.values(a)
- visual.compare(a, leftIndex, rightIndex, message?)
- visual.less(a, leftIndex, rightIndex, message?)
- visual.lessOrEqual(a, leftIndex, rightIndex, message?)
- visual.swap(a, leftIndex, rightIndex, message?)
- visual.pointer(name, index, label?, color?, message?)
- visual.clearPointer(name, message?)
- visual.range(name, start, end, label?, color?, message?)
- visual.clearRange(name, message?)
- visual.loop(id, label, current, total, detail?, message?)
- visual.endLoop(id, message?)
- const callId = visual.enterCall(label, detail?, range?)
- visual.exitCall(callId?, message?)
- visual.markSorted(a, start?, end?, message?)
- visual.done(a, message?)
- visual.explain(message?)`;
}

function instrumentationUserPrompt(source: string, language: string) {
  return `Learner code language: ${language}

Rewrite this code into instrumented JavaScript for the visual API. Remember: output JSON only.

${source}`;
}

function normalizeSource(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 12000);
}

function normalizeProvider(value: unknown): ProviderId {
  return isProviderId(value) ? value : "openai";
}

function parseInstrumentationResponse(content: string): InstrumentationResponse {
  const raw = extractJson(content);
  const parsed = JSON.parse(raw) as Partial<InstrumentationResponse>;
  const instrumentedCode = typeof parsed.instrumentedCode === "string" ? stripCodeFence(parsed.instrumentedCode).trim() : "";
  if (!instrumentedCode.includes("function run")) {
    throw new Error("The model did not return a valid run(input, visual) function.");
  }
  const summary = typeof parsed.summary === "string" ? parsed.summary.trim().slice(0, 240) : "Instrumented learner code.";
  const warnings = Array.isArray(parsed.warnings)
    ? parsed.warnings.filter((warning): warning is string => typeof warning === "string").map((warning) => warning.trim()).filter(Boolean).slice(0, 4)
    : [];
  return { instrumentedCode, summary, warnings };
}

function extractJson(content: string) {
  const trimmed = content.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  throw new Error("The model response was not valid JSON.");
}

function stripCodeFence(code: string) {
  const trimmed = code.trim();
  const fenced = trimmed.match(/^```(?:javascript|js)?\s*([\s\S]*?)```$/i);
  return fenced?.[1] ?? trimmed;
}

export default router;
