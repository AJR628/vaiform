import {
  GenerateQuoteSchema,
  RemixQuoteSchema,
  SaveQuoteSchema,
} from '../schemas/quotes.schema.js';
import admin from '../config/firebase.js';
import { llmSingleQuoteFromText } from '../services/llmQuotes.service.js';
import { getQuote as localQuote } from '../services/quote.engine.js';

export async function generateQuote(req, res) {
  try {
    const parsed = GenerateQuoteSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res
        .status(400)
        .json({ ok: false, reason: 'BAD_REQUEST', detail: parsed.error.flatten() });
    }
    const { text, tone = 'default', maxChars = 120 } = parsed.data;

    let item = null;
    try {
      item = await llmSingleQuoteFromText({ text, tone, maxChars });
    } catch (e) {
      // fall through to curated/local
    }
    if (!item || !item.text) {
      const q = await localQuote({ mode: 'feeling', text, template: undefined });
      item = {
        id: item?.id || q?.id || undefined,
        text: q.text,
        author: q.author || null,
        attributed: !!q.attributed,
        toneTag: tone,
      };
    }

    return res.json({ ok: true, data: { quote: item } });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, reason: 'SERVER_ERROR', detail: e?.message || 'quote generation failed' });
  }
}

export async function remixQuote(req, res) {
  try {
    const parsed = RemixQuoteSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res
        .status(400)
        .json({ ok: false, reason: 'BAD_REQUEST', detail: parsed.error.flatten() });
    }
    const { originalText, mode, targetTone, maxChars = 120 } = parsed.data;

    let item = null;
    let inputText = originalText;
    let tone = targetTone || 'default';

    // Adjust input based on remix mode
    if (mode === 'rephrase') {
      inputText = `Rephrase this quote: "${originalText}"`;
    } else if (mode === 'tone_shift') {
      inputText = `Rewrite this quote in a ${tone} tone: "${originalText}"`;
      tone = targetTone || 'default';
    } else if (mode === 'regenerate') {
      inputText = `Generate a new quote similar to: "${originalText}"`;
    }

    try {
      item = await llmSingleQuoteFromText({ text: inputText, tone, maxChars });
    } catch (e) {
      // fall through to curated/local
    }
    if (!item || !item.text) {
      const q = await localQuote({ mode: 'feeling', text: originalText, template: undefined });
      item = {
        id: item?.id || q?.id || undefined,
        text: q.text,
        author: q.author || null,
        attributed: !!q.attributed,
        toneTag: tone,
      };
    }

    return res.json({ ok: true, data: { quote: item, mode } });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, reason: 'SERVER_ERROR', detail: e?.message || 'quote remix failed' });
  }
}

export async function saveQuote(req, res) {
  try {
    const parsed = SaveQuoteSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res
        .status(400)
        .json({ ok: false, reason: 'BAD_REQUEST', detail: parsed.error.flatten() });
    }
    const { text, author = null, toneTag = null } = parsed.data;
    const uid = req.user?.uid || null;
    if (!uid) return res.status(401).json({ ok: false, reason: 'UNAUTHENTICATED' });

    const db = admin.firestore();
    const coll = db.collection('users').doc(uid).collection('quotes');
    const now = admin.firestore.FieldValue.serverTimestamp();
    const docRef = await coll.add({ text, author, toneTag, createdAt: now, updatedAt: now });
    const id = docRef.id;
    return res.json({ ok: true, data: { id, text, author, toneTag } });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, reason: 'SERVER_ERROR', detail: e?.message || 'quote save failed' });
  }
}
