// ESM required: ensure "type": "module" in package.json
import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";

const MODEL = "gpt-4o";
const TASKS_DIR = ".ai-tasks";
const GUIDELINES_FILE = ".ai-rules/repo_guidelines.md";

function listTaskFiles() {
  if (!fs.existsSync(TASKS_DIR)) return [];
  return fs.readdirSync(TASKS_DIR)
    .filter(f => f.endsWith(".md"))
    .map(f => path.join(TASKS_DIR, f));
}

function readGuidelines() {
  return fs.existsSync(GUIDELINES_FILE)
    ? fs.readFileSync(GUIDELINES_FILE, "utf8")
    : "";
}

function snapshotRepo() {
  const roots = [
    "server.js",
    "src/routes",
    "src/controllers",
    "src/services",
    "src/adapters",
    "src/config",
    "src/utils"
  ];

  const files = [];
  for (const r of roots) {
    if (!fs.existsSync(r)) continue;
    const stat = fs.statSync(r);
    if (stat.isFile()) files.push(r);
    else {
      for (const name of fs.readdirSync(r)) {
        const p = path.join(r, name);
        if (fs.statSync(p).isFile()) files.push(p);
      }
    }
  }

  const allowed = new Set([".js", ".mjs", ".cjs", ".ts", ".json", ".md"]);
  const map = {};
  for (const f of files) {
    if (f !== "server.js" && !allowed.has(path.extname(f))) continue;
    try {
      const content = fs.readFileSync(f, "utf8");
      map[f] = content.length > 45000 ? content.slice(0, 45000) + "\n/* ...truncated... */" : content;
    } catch { /* ignore */ }
  }
  return map;
}

function writeFileSafe(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
  console.log("wrote", filePath);
}

async function main() {
  const tasks = listTaskFiles();
  if (tasks.length === 0) {
    console.log("No .ai-tasks/*.md files found — nothing to do.");
    return;
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error("Missing OPENAI_API_KEY");
    process.exit(1);
  }

  const guidelines = readGuidelines();
  const repo = snapshotRepo();
  const taskBundle = tasks.map(f => `## ${path.basename(f)}\n${fs.readFileSync(f, "utf8")}`).join("\n\n---\n\n");

  const schemaHint = `
Return ONLY a compact JSON object with this shape (no prose, no markdown):

{
  "edits": [
    { "path": "repo/relative/file", "contents": "FULL FILE CONTENTS", "rationale": "short optional note" }
  ],
  "commit_message": "brief commit line"
}
`;

  const system = [
    "You are a senior Node/Express engineer working on the Vaiform codebase.",
    "Keep changes minimal and modular.",
    "When adding a route: create controller and (if needed) service, a *.routes.js file, and ensure it can be mounted via src/routes/index.js.",
    "Write FULL file contents (not patches).",
    "Return ONLY valid JSON. Do NOT include any extra text."
  ].join(" ");

  const user = [
    "# Repository Guidelines",
    guidelines || "(none provided)",
    "",
    "# Tasks",
    taskBundle,
    "",
    "# Repo Snapshot (selected files)",
    ...Object.entries(repo).map(([f, c]) => `--- FILE: ${f} ---\n${c}`),
    "",
    "# Output Format",
    schemaHint
  ].join("\n");

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const resp = await openai.responses.create({
    model: MODEL,
    input: [
      { role: "system", content: system },
      { role: "user", content: user }
    ]
  });

  const txt = resp.output_text || "";
  if (!txt) {
    console.error("Model returned no output.");
    process.exit(1);
  }

  let plan;
  try {
    plan = JSON.parse(txt);
  } catch (e) {
    console.error("Model did not return valid JSON:", e);
    console.error("Raw text:", txt.slice(0, 1200));
    process.exit(1);
  }

  if (!plan.edits || !Array.isArray(plan.edits) || plan.edits.length === 0) {
    console.log("No edits proposed.");
    return;
  }

  for (const edit of plan.edits) {
    if (!edit.path || typeof edit.contents !== "string") continue;
    writeFileSafe(edit.path, edit.contents);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
