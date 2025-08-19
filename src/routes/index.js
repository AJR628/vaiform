import { Router } from "express";
import CheckoutRouter from "./checkout.routes.js";
import CreditsRouter from "./credits.routes.js";
import DiagRouter from "./diag.routes.js";
import EnhanceRouter from "./enhance.routes.js";
import GenerateRouter from "./generate.routes.js";
import HealthRouter from "./health.routes.js";
import WebhookRouter from "./webhook.routes.js";

const router = Router();

router.use("/checkout", CheckoutRouter);
router.use("/credits", CreditsRouter);
router.use("/diag", DiagRouter);
router.use("/enhance", EnhanceRouter);
router.use("/generate", GenerateRouter);
router.use("/health", HealthRouter);
router.use("/webhook", WebhookRouter);

export default router;
