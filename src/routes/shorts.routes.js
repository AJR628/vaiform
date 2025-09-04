import { Router } from "express";
import requireAuth from "../middleware/requireAuth.js";
import { createShort } from "../controllers/shorts.controller.js";

const r = Router();

r.post("/create", requireAuth, createShort);

export default r;
