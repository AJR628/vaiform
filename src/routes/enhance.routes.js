import { Router } from "express";
import requireAuth from "../middleware/requireAuth.js";
import * as EnhanceController from "../controllers/enhance.controller.js";
const enhance = EnhanceController.enhance ?? EnhanceController.default;

const r = Router();
r.post("/enhance", requireAuth, enhance);
r.post("/", requireAuth, enhance); // legacy alias
export default r;
