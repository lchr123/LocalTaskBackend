import { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodSchema, ZodError } from 'zod';

/**
 * Factory function that creates an Express middleware for validating
 * request body against a Zod schema.
 *
 * On validation failure, returns 422 with field-level error details:
 * { "error": "validation_error", "message": "...", "fields": { "fieldName": "error description" } }
 *
 * @param schema - A Zod schema to validate req.body against
 * @returns Express middleware RequestHandler
 */
export function validate(schema: ZodSchema): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const result = schema.safeParse(req.body);

      if (!result.success) {
        const zodError = result.error as ZodError;
        const fields: Record<string, string> = {};

        for (const issue of zodError.issues) {
          const path = issue.path.join('.');
          const key = path || '_root';
          // Only keep the first error per field
          if (!fields[key]) {
            fields[key] = issue.message;
          }
        }

        const firstMessage = Object.values(fields)[0] || '入力内容に誤りがあります';

        res.status(422).json({
          error: 'validation_error',
          message: firstMessage,
          fields,
        });
        return;
      }

      // Replace req.body with the parsed (and potentially transformed) data
      req.body = result.data;
      next();
    } catch (err) {
      next(err);
    }
  };
}
