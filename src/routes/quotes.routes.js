import { Router } from "express";
import requireAuth from "../middleware/requireAuth.js";
import { validate } from "../middleware/validate.middleware.js";
import { GenerateQuoteSchema } from "../schemas/quotes.schema.js";
import { generateQuote } from "../controllers/quotes.controller.js";

const r = Router();

r.post("/generate-quote", requireAuth, validate(GenerateQuoteSchema), generateQuote);

export default r;


