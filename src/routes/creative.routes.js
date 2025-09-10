import { Router } from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const r = Router();

// Serve the Creative Page HTML
r.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../../public/creative.html"));
});

export default r;
