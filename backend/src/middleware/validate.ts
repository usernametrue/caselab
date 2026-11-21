import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

// Replaces req.body with the parsed value; ZodError goes to the error middleware as 400
export const validateBody = (schema: ZodType): RequestHandler => (req, _res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        next(parsed.error);
        return;
    }
    req.body = parsed.data;
    next();
};
