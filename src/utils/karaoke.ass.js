import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

function tokenize(text) {
  return String(text || "").trim().split(/\s+/);
}

function msToHMS(ms) {
  const t = Math.max(0, Math.floor(ms));
  const cs = Math.floor((t % 1000) / 10);
  const s  = Math.floor(t/1000) % 60;
  const m  = Math.floor(t/60000) % 60;
  const h  = Math.floor(t/3600000);
  const pad = (n,w=2)=>String(n).padStart(w,"0");
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(cs)}`;
}

export async function buildKaraokeASS({
  text,
  durationMs,
  style = {
    Fontname: "DejaVu Sans",
    Fontsize: 64,
    PrimaryColour: "&H00FFFFFF",
    OutlineColour: "&H80202020",
    BackColour: "&H00000000",
    SecondaryColour: "&H00000000",
    Bold: 0, Italic: 0, Underline: 0, StrikeOut: 0,
    ScaleX: 100, ScaleY: 100, Spacing: 0.5, Angle: 0,
    BorderStyle: 1, Outline: 3, Shadow: 1,
    Alignment: 2,
    MarginL: 40, MarginR: 40, MarginV: 260
  }
}) {
  const tokens = tokenize(text);
  if (!tokens.length) throw new Error("KARAOKE_NO_TOKENS");

  const minSlice = 120; // ms
  const weights = tokens.map(t => Math.pow(Math.max(1, t.replace(/[^\w]/g,"" ).length), 0.9));
  const sumW = weights.reduce((a,b)=>a+b, 0) || 1;
  let alloc = weights.map(w => Math.max(minSlice, Math.floor(durationMs * (w/sumW))));
  // normalize to exactly durationMs
  let total = alloc.reduce((a,b)=>a+b, 0);
  const diff = durationMs - total;
  if (diff !== 0) {
    const step = diff > 0 ? 1 : -1;
    let remaining = Math.abs(diff);
    let i = 0;
    while (remaining > 0 && tokens.length > 0) {
      const idx = i % tokens.length;
      const next = alloc[idx] + step;
      if (next >= minSlice) {
        alloc[idx] = next;
        remaining--;
      }
      i++;
    }
  }

  const parts = [];
  for (let i=0;i<tokens.length;i++) {
    const cs = Math.max(1, Math.round(alloc[i] / 10));
    parts.push(`{\\k${cs}}${tokens[i]}`);
    if (i < tokens.length - 1) parts.push(" ");
  }

  const start = msToHMS(0);
  const end   = msToHMS(durationMs);

  const header =
`[Script Info]
ScriptType: v4.00+
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.601
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: QMain, ${style.Fontname}, ${style.Fontsize}, ${style.PrimaryColour}, ${style.SecondaryColour}, ${style.OutlineColour}, ${style.BackColour}, ${style.Bold}, ${style.Italic}, ${style.Underline}, ${style.StrikeOut}, ${style.ScaleX}, ${style.ScaleY}, ${style.Spacing}, ${style.Angle}, ${style.BorderStyle}, ${style.Outline}, ${style.Shadow}, ${style.Alignment}, ${style.MarginL}, ${style.MarginR}, ${style.MarginV}, 1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const dialogue = `Dialogue: 0,${start},${end},QMain,,0,0,0,,${parts.join("")}\n`;
  const ass = header + dialogue;

  const outPath = join(tmpdir(), `vaiform-${randomUUID()}.ass`);
  await writeFile(outPath, ass, "utf8");
  return outPath;
}

export default { buildKaraokeASS };


