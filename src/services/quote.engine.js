import curated from "../data/quotes.curated.json" with { type: "json" };

const PROFANITY = ["damn","shit","fuck"]; // tiny blocklist

function sanitizeText(s) {
  if (!s) return "";
  let t = String(s).trim().replace(/\s+/g, " ");
  // strip surrounding quotes
  t = t.replace(/^"+|"+$/g, "").replace(/^'+|'+$/g, "");
  // length bound
  if (t.length < 2) t = t.padEnd(2, ".");
  if (t.length > 280) t = t.slice(0, 280);
  // simple profanity mask
  const l = t.toLowerCase();
  for (const w of PROFANITY) {
    const re = new RegExp(`\\b${w}\\b`, "ig");
    t = t.replace(re, "—");
  }
  return t;
}

function tagsForFeeling(feeling) {
  const t = (feeling || "").toLowerCase();
  const set = new Set();
  if (/calm|peace|soft|breathe|still/.test(t)) { set.add("calm"); set.add("presence"); }
  if (/anxious|worry|fear|stress/.test(t)) { set.add("resilience"); set.add("calm"); }
  if (/tired|stuck|blocked/.test(t)) { set.add("perseverance"); set.add("hope"); }
  if (/hopeless|sad|down/.test(t)) { set.add("hope"); set.add("resilience"); }
  if (/angry|mad|rage/.test(t)) { set.add("calm"); set.add("patience"); }
  if (/brave|bold|risk|try/.test(t)) { set.add("courage"); set.add("perseverance"); }
  if (/present|now|mindful|focus/.test(t)) { set.add("presence"); set.add("calm"); }
  return Array.from(set);
}

function scoreQuote(q, wantedTags, template) {
  let score = 0;
  const tags = q.tags || [];
  const tbias = q.templateBias || [];
  for (const t of wantedTags) {
    if (tags.includes(t)) score += 3;
  }
  if (template && tbias.includes(template)) score += 2;
  if (q.publicDomain) score += 2;
  if (q.verified) score += 1;
  // prefer shorter quotes for shorts readability
  if (q.length <= 140) score += 2;
  if (q.length <= 90) score += 1;
  return score;
}

function pickCurated(feeling, template) {
  const wanted = tagsForFeeling(feeling);
  let best = null;
  let bestScore = -Infinity;
  for (const q of curated) {
    if (!q.publicDomain || !q.verified) continue;
    if (q.length > 140) continue;
    const s = scoreQuote(q, wanted, template);
    if (s > bestScore) { bestScore = s; best = q; }
  }
  return best;
}

async function generateAphorism(feeling) {
  const f = (feeling || "").trim();
  // Minimal heuristic phrases without external providers
  const seeds = [
    `Breathe. ${f ? f.charAt(0).toUpperCase() + f.slice(1) + " " : ""}passes like weather.`,
    "One steady breath, one honest step.",
    "Small courage, repeated, becomes strength.",
    "Be here. Be kind. Begin again.",
    "You are allowed to go slowly.",
    "Noisy mind, quiet heart, chosen action.",
    "Hold on to the thread of the present.",
  ];
  const pick = seeds[Math.floor(Math.random() * seeds.length)];
  return pick.length > 140 ? pick.slice(0, 140) : pick;
}

export async function getQuote({ mode, text, template }) {
  if (mode === "quote") {
    const t = sanitizeText(text);
    return { text: t, author: null, attributed: false, isParaphrase: false };
  }
  // feeling → try curated match first
  const curatedPick = pickCurated(text, template);
  if (curatedPick) {
    return {
      text: sanitizeText(curatedPick.text),
      author: curatedPick.author || null,
      attributed: true,
      isParaphrase: false,
    };
  }
  // fallback: minimal aphorism
  const aph = await generateAphorism(text);
  return { text: sanitizeText(aph), author: null, attributed: false, isParaphrase: true };
}

export default { getQuote };


