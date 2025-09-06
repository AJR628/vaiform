import { randomUUID } from 'crypto';

const OPENAI_BASE = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

export async function llmQuotesByFeeling({ feeling, count }) {
  const url = `${OPENAI_BASE}/chat/completions`;
  const body = {
    model: OPENAI_MODEL,
    temperature: 0.9,
    messages: [
      { role: 'system', content:
        'You write short, attribution-safe aphorisms. Favor timeless phrasing (Stoics, Emerson-like). If output resembles a modern quote, paraphrase and set isParaphrase=true. Return ONLY JSON: {"items":[{"text":"...","author":"Seneca","attributed":true,"isParaphrase":false}, ...] }'
      },
      { role: 'user', content:
        `Generate ${count} unique quotes that evoke the feeling: "${feeling}". Each single-line, 8–18 words, clean ASCII, no emojis.`
      }
    ]
  };

  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!r.ok) throw new Error(`LLM_HTTP_${r.status}`);

  const data = await r.json();
  const content = data?.choices?.[0]?.message?.content || '';
  let items = [];

  try {
    // Accept either a json object or fenced json
    const jsonTextMatch = content.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonTextMatch ? jsonTextMatch[0] : content);
    items = parsed.items || parsed || [];
  } catch {
    items = [];
  }

  // Map + validate
  const out = [];
  for (const it of items) {
    const text = String(it?.text || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (text.split(' ').length < 8 || text.split(' ').length > 18) continue;
    const author = it?.author ? String(it.author).trim() : null;
    out.push({
      id: `q-${randomUUID()}`,
      text,
      author: author || null,
      attributed: !!author,
      isParaphrase: !!it?.isParaphrase
    });
  }
  return out;
}


