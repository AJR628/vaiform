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

  const schema = {
    type: "object",
    properties: {
      edits: {
        type: "array",
        items: {
          type: "object",
          properties: {
            path: { type: "string" },
            contents: { type: "string" },
            rationale: { type: "string" }
          },
          required: ["path", "contents"]
        }
      },
      commit_message: { type: "string" }
    },
    required: ["edits"]
  };

  const system = [
    "You are a senior Node/Express engineer working on the Vaiform codebase.",
    "Keep changes minimal and modular.",
    "When adding a route: create controller and (if needed) service, a *.routes.js file, and ensure it can be mounted via src/routes/index.js.",
    "Write full file contents; do not output patches."
  ].join(" ");

  const user = [
    "# Repository Guidelines",
    guidelines || "(none provided)",
    "",
    "# Tasks",
    taskBundle,
    "",
    "# Repo Snapshot (selected files)",
    ...Object.entries(repo).map(([f, c]) => `--- FILE: ${f} ---\n${c}`)
  ].join("\n");

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const resp = await openai.responses.create({
    model: MODEL,
    reasoning: { effort: "medium" },
    input: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    // NOTE: response_format moved to text.format in the Responses API
    text: {
      format: "json_schema",
      schema,
      name: "repo_edits",
      strict: true
    }
  });

  // Preferred: use structured output directly
  let plan = resp.output_parsed;

  // Fallback: try to parse any text the model returned
  if (!plan) {
    const txt = resp.output_text || "";
    if (!txt) {
      console.log("Model returned no output, skipping.");
      return;
    }
    try {
      plan = JSON.parse(txt);
    } catch (e) {
      console.error("Structured output was not valid JSON:", e);
      process.exit(1);
    }
  }

  if (!plan.edits || plan.edits.length === 0) {
    console.log("No edits proposed.");
    return;
  }

  for (const edit of plan.edits) {
    writeFileSafe(edit.path, edit.contents);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
