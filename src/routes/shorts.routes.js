import { Router } from "express";
import requireAuth from "../middleware/requireAuth.js";
import { createShort, getShortById } from "../controllers/shorts.controller.js";

const r = Router();

r.post("/create", requireAuth, createShort);
r.get("/:jobId", requireAuth, getShortById);

export default r;
