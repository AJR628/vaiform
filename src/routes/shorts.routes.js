import { Router } from "express";
import requireAuth from "../middleware/requireAuth.js";
import { createShort, getShortById, getMyShorts, deleteShort } from "../controllers/shorts.controller.js";

const r = Router();

r.post("/create", requireAuth, createShort);
r.get("/mine", requireAuth, getMyShorts);
r.get("/:jobId", requireAuth, getShortById);
r.delete("/:jobId", requireAuth, deleteShort);

export default r;
