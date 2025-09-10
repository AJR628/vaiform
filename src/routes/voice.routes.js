import { Router } from "express";
import requireAuth from "../middleware/requireAuth.js";
import { getVoices, previewVoice } from "../controllers/voice.controller.js";

const r = Router();

r.get("/voices", requireAuth, getVoices);
r.post("/preview", requireAuth, previewVoice);

export default r;
