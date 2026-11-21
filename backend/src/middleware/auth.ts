import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { HttpError } from '../utils/http';
import type { Role } from '../modules/users/user.model';

export interface AuthUser {
    id: string;
    role: Role;
    organizationId: string;
}

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            user?: AuthUser;
        }
    }
}

export const signAccessToken = (u: AuthUser) =>
    jwt.sign({ sub: u.id, role: u.role, org: u.organizationId }, env().JWT_SECRET, { expiresIn: env().JWT_ACCESS_TTL as any });

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) {
        next(new HttpError(401, 'unauthorized', 'Access token required'));
        return;
    }
    try {
        const payload = jwt.verify(token, env().JWT_SECRET) as jwt.JwtPayload;
        req.user = { id: String(payload.sub), role: payload.role, organizationId: payload.org };
        next();
    } catch {
        next(new HttpError(401, 'token_expired', 'Access token invalid or expired'));
    }
}

// Role check on top of requireAuth
export const requireRole = (...roles: Role[]) => (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
        next(new HttpError(403, 'forbidden', 'Not allowed for this role'));
        return;
    }
    next();
};
