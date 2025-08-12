import fs from "node:fs";
import path from "node:path";

const ROUTES_DIR = "src/routes";
const INDEX_FILE = path.join(ROUTES_DIR, "index.js");

// Try to infer a prefix from the existing index.js (e.g., "/api")
function detectPrefix() {
  if (!fs.existsSync(INDEX_FILE)) return "";
  const txt = fs.readFileSync(INDEX_FILE, "utf8");
  return /\/api\//.test(txt) ? "/api" : "";
}

function pascalCase(name) {
  return name
    .replace(/[-_]+/g, " ")
    .replace(/\s+(.)(\w*)/g, (_, a, b) => a.toUpperCase() + b)
    .replace(/^(.)/, (_, a) => a.toUpperCase());
}

function main() {
  if (!fs.existsSync(ROUTES_DIR)) {
    console.log("No src/routes directory found. Skipping autowire.");
    return;
  }

  const files = fs.readdirSync(ROUTES_DIR)
    .filter(f => f.endsWith(".routes.js"));

  const prefix = detectPrefix(); // "" or "/api"
  const imports = [];
  const mounts = [];

  for (const file of files) {
    const base = file.replace(".routes.js", "");              // e.g., "generate"
    const importName = pascalCase(base) + "Router";           // e.g., "GenerateRouter"
    const routePath = `${prefix}/${base}`.replace(/\/+/g, "/"); // "/api/generate" or "/generate"
    imports.push(`import ${importName} from "./${file}";`);
    mounts.push(`router.use("${routePath}", ${importName});`);
  }

  const content = `import { Router } from "express";
${imports.join("\n")}

const router = Router();

${mounts.join("\n")}

export default router;
`;

  fs.mkdirSync(ROUTES_DIR, { recursive: true });
  fs.writeFileSync(INDEX_FILE, content);
  console.log(`Auto-generated ${INDEX_FILE} with ${files.length} routes (prefix="${prefix || "/"}")`);
}

main();
