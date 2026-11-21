import type { ErrorRequestHandler, RequestHandler } from 'express';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { HttpError } from '../utils/http';
import { logError } from '../logger';

export const notFoundHandler: RequestHandler = (req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: `Route ${req.method} ${req.path} not found` } });
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
    if (err instanceof HttpError) {
        res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
        return;
    }
    if (err instanceof ZodError) {
        res.status(400).json({ error: { code: 'validation_error', message: 'Invalid request', details: err.issues } });
        return;
    }
    if (err instanceof mongoose.Error.ValidationError) {
        res.status(400).json({ error: { code: 'validation_error', message: err.message } });
        return;
    }
    if (err instanceof mongoose.Error.CastError) {
        res.status(400).json({ error: { code: 'bad_id', message: `Invalid value for ${err.path}` } });
        return;
    }
    if (err?.code === 11000) {
        res.status(409).json({ error: { code: 'duplicate', message: 'Record already exists', details: err.keyValue } });
        return;
    }
    logError(err, {}, { path: req.path, method: req.method });
    res.status(500).json({ error: { code: 'internal', message: 'Internal server error' } });
};
