import { Router } from "express";
import CheckoutRouter from "./checkout.routes.js";
import CreditsRouter from "./credits.routes.js";
import Diag.headersRouter from "./diag.headers.routes.js";
import DiagRouter from "./diag.routes.js";
import EnhanceRouter from "./enhance.routes.js";
import GenerateRouter from "./generate.routes.js";
import HealthRouter from "./health.routes.js";
import ShortsRouter from "./shorts.routes.js";
import WebhookRouter from "./webhook.routes.js";
import WhoamiRouter from "./whoami.routes.js";

const router = Router();

router.use("/checkout", CheckoutRouter);
router.use("/credits", CreditsRouter);
router.use("/diag.headers", Diag.headersRouter);
router.use("/diag", DiagRouter);
router.use("/enhance", EnhanceRouter);
router.use("/generate", GenerateRouter);
router.use("/health", HealthRouter);
router.use("/shorts", ShortsRouter);
router.use("/webhook", WebhookRouter);
router.use("/whoami", WhoamiRouter);

export default router;
