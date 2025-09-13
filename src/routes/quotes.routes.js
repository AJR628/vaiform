import { Router } from "express";
import requireAuth from "../middleware/requireAuth.js";
import { validate } from "../middleware/validate.middleware.js";
import { planGuard } from "../middleware/planGuard.js";
import { GenerateQuoteSchema, RemixQuoteSchema, SaveQuoteSchema } from "../schemas/quotes.schema.js";
import { generateQuote, remixQuote, saveQuote } from "../controllers/quotes.controller.js";

const r = Router();

r.post("/generate-quote", requireAuth, validate(GenerateQuoteSchema), generateQuote);
r.post("/remix", requireAuth, validate(RemixQuoteSchema), remixQuote);
r.post("/save", requireAuth, validate(SaveQuoteSchema), saveQuote);

export default r;


