import { ZodError } from 'zod';
import { fail } from '../http/respond.js';

function fieldsFromZodIssues(issues) {
  const fields = {};
  for (const i of issues) {
    const key = i.path?.length ? i.path.join('.') : '_root';
    fields[key] = i.message;
  }
  return fields;
}

export function validate(schema, location = 'body') {
  return (req, res, next) => {
    try {
      const parsed = schema.parse(req[location] ?? {});
      req.valid = parsed;
      return next();
    } catch (err) {
      if (err instanceof ZodError) {
        const fields = fieldsFromZodIssues(err.issues);
        return fail(req, res, 400, 'VALIDATION_FAILED', 'Invalid request', fields);
      }
      return fail(req, res, 400, 'BAD_REQUEST', String(err?.message || err));
    }
  };
}
