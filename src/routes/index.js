import { Router } from "express";
import CreditsRouter from "./credits.routes.js";
import EnhanceRouter from "./enhance.routes.js";
import GenerateRouter from "./generate.routes.js";
import HealthRouter from "./health.routes.js";
import WebhookRouter from "./webhook.routes.js";

const router = Router();

router.use("/credits", CreditsRouter);
router.use("/enhance", EnhanceRouter);
router.use("/generate", GenerateRouter);
router.use("/health", HealthRouter);
router.use("/webhook", WebhookRouter);

export default router;
