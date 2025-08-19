import { ZodError } from 'zod';
export function validate(schema, location = 'body') {
  return (req, res, next) => {
    const parsed = schema.safeParse(req[location] ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_INPUT',
        detail: parsed.error.flatten(),
      });
    }
    req[location] = parsed.data;
    next();
  };
}
