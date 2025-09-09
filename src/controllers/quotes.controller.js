import { GenerateQuoteSchema } from "../schemas/quotes.schema.js";
import { llmSingleQuoteFromText } from "../services/llmQuotes.service.js";
import { getQuote as localQuote } from "../services/quote.engine.js";

export async function generateQuote(req, res) {
  try {
    const parsed = GenerateQuoteSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ ok: false, reason: "BAD_REQUEST", detail: parsed.error.flatten() });
    }
    const { text, tone = 'default', maxChars = 120 } = parsed.data;

    let item = null;
    try {
      item = await llmSingleQuoteFromText({ text, tone, maxChars });
    } catch (e) {
      // fall through to curated/local
    }
    if (!item || !item.text) {
      const q = await localQuote({ mode: "feeling", text, template: undefined });
      item = { id: item?.id || q?.id || undefined, text: q.text, author: q.author || null, attributed: !!q.attributed, toneTag: tone };
    }

    return res.json({ ok: true, data: { quote: item } });
  } catch (e) {
    return res.status(500).json({ ok: false, reason: "SERVER_ERROR", detail: e?.message || "quote generation failed" });
  }
}


