import type { NextFunction, Request, RequestHandler, Response } from 'express';

// Error with an HTTP status and a stable code; serialized as { error: { code, message } }
export class HttpError extends Error {
    status: number;
    code: string;
    details?: unknown;

    constructor(status: number, code: string, message: string, details?: unknown) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

export const notFound = (what = 'Resource') => new HttpError(404, 'not_found', `${what} not found`);
export const forbidden = () => new HttpError(403, 'forbidden', 'Not allowed');

// Express 4 does not catch rejected promises - this wrapper forwards them to the error middleware
export const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
    (req, res, next) => {
        fn(req, res, next).catch(next);
    };
