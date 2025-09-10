import { Router } from "express";
import requireAuth from "../middleware/requireAuth.js";
import { validate } from "../middleware/validate.middleware.js";
import { planGuard } from "../middleware/planGuard.js";
import { GenerateQuoteSchema, RemixQuoteSchema } from "../schemas/quotes.schema.js";
import { generateQuote, remixQuote } from "../controllers/quotes.controller.js";

const r = Router();

r.post("/generate-quote", requireAuth, validate(GenerateQuoteSchema), generateQuote);
r.post("/remix", requireAuth, planGuard('pro'), validate(RemixQuoteSchema), remixQuote);

export default r;


