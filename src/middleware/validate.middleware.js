import { ZodError } from "zod";
export function validate(schema, location = "body") {
  return (req, res, next) => {
    try {
      const parsed = schema.parse(req[location] ?? {});
      req[location] = parsed;
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({
          error: "INVALID_REQUEST",
          issues: err.errors.map(e => ({
            path: e.path.join("."),
            message: e.message,
            code: e.code,
          })),
        });
      }
      next(err);
    }
  };
}