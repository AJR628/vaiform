// src/middleware/reqId.js
import { randomUUID } from "crypto";

export default function reqId(req, res, next) {
  const id =
    req.headers["x-request-id"] ||
    req.headers["X-Request-Id"] ||
    randomUUID();
  req.id = id;
  res.setHeader("X-Request-Id", id);
  next();
}