/**
 * SSOT response helpers for the API contract.
 * Success: { success: true, data, requestId }
 * Failure: { success: false, error, detail, fields?, requestId }
 * @see docs/API_CONTRACT.md
 */

/**
 * Send a success response (200).
 * @param {import('express').Request} req - request (req.id used for requestId)
 * @param {import('express').Response} res - response
 * @param {unknown} data - payload
 */
export function ok(req, res, data) {
  const requestId = req?.id ?? null;
  res.status(200).json({ success: true, data, requestId });
}

/**
 * Send a failure response with contract envelope.
 * @param {import('express').Request} req - request (req.id used for requestId)
 * @param {import('express').Response} res - response
 * @param {number} status - HTTP status code
 * @param {string} error - error code (e.g. VALIDATION_FAILED, UNAUTHENTICATED)
 * @param {string} detail - human-readable detail
 * @param {Record<string, string> | undefined} [fields] - optional validation field errors (path -> message)
 */
export function fail(req, res, status, error, detail, fields) {
  const requestId = req?.id ?? null;
  const payload = { success: false, error, detail, requestId };
  if (fields != null && typeof fields === 'object' && Object.keys(fields).length > 0) {
    payload.fields = fields;
  }
  res.status(status).json(payload);
}
