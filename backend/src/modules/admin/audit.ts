import type { NextFunction, Request, Response } from 'express';
import { Schema, model } from 'mongoose';
import { logError } from '../../logger';

// ADM-9: log of admin actions. Every changing request (not GET) made by an admin is written after the response,
// with the status, the ids in the path and the body with secrets removed. Kept one year.
const auditLogSchema = new Schema({
    actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    method: { type: String, required: true },
    path: { type: String, required: true },
    // The path with ids replaced by :id, groups the same action together
    action: { type: String, required: true, index: true },
    targetIds: [{ type: String }],
    status: { type: Number, required: true },
    body: { type: String, default: '' },
    createdAt: { type: Date, default: () => new Date(), expires: 60 * 60 * 24 * 365 }
});
auditLogSchema.index({ createdAt: -1 });
export const AuditLog = model('AuditLog', auditLogSchema, 'auditLogs');

const ID = /\b[a-f0-9]{24}\b/g;
const SECRET = /password|secret|token|apikey|api_key/i;
const MAX_BODY = 4000;

// Secrets never reach the log; long values (imported files in base64) are cut
function redact(v: unknown, depth = 0): unknown {
    if (depth > 6) return '[...]';
    if (Array.isArray(v)) return v.slice(0, 50).map(x => redact(x, depth + 1));
    if (v && typeof v === 'object') {
        return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, SECRET.test(k) ? '[hidden]' : redact(x, depth + 1)]));
    }
    if (typeof v === 'string' && v.length > 500) return `${v.slice(0, 500)}... [${v.length}]`;
    return v;
}

export function auditAdminActions(req: Request, res: Response, next: NextFunction) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        next();
        return;
    }
    res.on('finish', () => {
        // req.user is set by requireAuth inside the routers, so it is known only after the response
        if (req.user?.role !== 'admin') return;
        const path = req.originalUrl.split('?')[0];
        const body = req.body && Object.keys(req.body).length ? JSON.stringify(redact(req.body)) : '';
        AuditLog.create({
            actorId: req.user.id,
            method: req.method,
            path,
            action: `${req.method} ${path.replace(ID, ':id')}`,
            targetIds: path.match(ID) ?? [],
            status: res.statusCode,
            body: body.length > MAX_BODY ? `${body.slice(0, MAX_BODY)}...` : body
        }).catch(e => logError(e, {}, { audit: path }));
    });
    next();
}
