import { ZodError } from 'zod';
export function validate(schema, location = 'body') {
  return (req, res, next) => {
    try {
      const parsed = schema.parse(req[location] ?? {});
      req.valid = parsed;
      return next();
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({
          success: false,
          code: "BAD_REQUEST",
          message: "Validation failed",
          details: err.issues.map(i => ({
            path: i.path.join("."),
            message: i.message,
            code: i.code,
          })),
        });
      }
      return res.status(400).json({
        success: false,
        code: "BAD_REQUEST",
        message: String(err?.message || err),
      });
    }
  };
}
