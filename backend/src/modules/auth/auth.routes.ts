import { Router, type Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env';
import { asyncHandler, HttpError } from '../../utils/http';
import { validateBody } from '../../middleware/validate';
import { requireAuth, signAccessToken } from '../../middleware/auth';
import { Group, Organization, User, toPublicUser, type UserDoc } from '../users/user.model';

const router = Router();

const REFRESH_COOKIE = 'lh_refresh';
const BCRYPT_COST = 12;

// AUTH-5: 5 failed logins per email and IP -> 15 minutes lock
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => `${req.ip}|${String(req.body?.email || '').toLowerCase()}`,
    message: { error: { code: 'too_many_attempts', message: 'Too many failed logins, try again in 15 minutes' } }
});

const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false });

const cookieOptions = () => ({
    httpOnly: true,
    secure: env().NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/api/v1/auth',
    maxAge: env().JWT_REFRESH_TTL_DAYS * 24 * 3600 * 1000
});

async function issueTokens(res: Response, user: UserDoc) {
    const refresh = jwt.sign(
        { sub: String(user._id), v: user.tokenVersion },
        env().JWT_REFRESH_SECRET,
        { expiresIn: `${env().JWT_REFRESH_TTL_DAYS}d` }
    );
    res.cookie(REFRESH_COOKIE, refresh, cookieOptions());
    return signAccessToken({ id: String(user._id), role: user.role as any, organizationId: String(user.organizationId) });
}

const passwordSchema = z.string().min(8, 'Password must have at least 8 characters').max(128);

const registerSchema = z.object({
    fullName: z.string().trim().min(3).max(120),
    email: z.email().max(160),
    password: passwordSchema,
    course: z.coerce.number().int().min(1).max(6),
    locale: z.enum(['ru', 'uz']).default('ru'),
    inviteCode: z.string().trim().max(20).optional().or(z.literal(''))
});

// AUTH-1: student self-registration, optionally joining a group by invite code
router.post('/register', registerLimiter, validateBody(registerSchema), asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof registerSchema>;
    const email = body.email.toLowerCase();
    if (await User.exists({ email })) throw new HttpError(409, 'email_taken', 'This email is already registered');

    let group = null;
    if (body.inviteCode) {
        group = await Group.findOne({ inviteCode: body.inviteCode.toUpperCase() });
        if (!group) throw new HttpError(400, 'bad_invite_code', 'Invite code not found');
    }
    const organizationId = group?.organizationId ?? (await Organization.findOne().sort({ createdAt: 1 }))?._id;
    if (!organizationId) throw new HttpError(503, 'not_initialized', 'Platform is not initialized, run the seed script');

    const user = await User.create({
        organizationId,
        role: 'student',
        email,
        passwordHash: await bcrypt.hash(body.password, BCRYPT_COST),
        fullName: body.fullName,
        course: body.course,
        locale: body.locale
    });
    if (group) await Group.updateOne({ _id: group._id }, { $addToSet: { studentIds: user._id } });

    const accessToken = await issueTokens(res, user);
    res.status(201).json({ accessToken, user: toPublicUser(user) });
}));

const loginSchema = z.object({ email: z.email(), password: z.string().min(1).max(128) });

// AUTH-2
router.post('/login', loginLimiter, validateBody(loginSchema), asyncHandler(async (req, res) => {
    const { email, password } = req.body as z.infer<typeof loginSchema>;
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
        throw new HttpError(401, 'bad_credentials', 'Wrong email or password');
    }
    if (user.isBlocked) throw new HttpError(403, 'blocked', 'Account is blocked');
    const accessToken = await issueTokens(res, user);
    res.json({ accessToken, user: toPublicUser(user) });
}));

// AUTH-3: new access token from the httpOnly refresh cookie
router.post('/refresh', asyncHandler(async (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) throw new HttpError(401, 'no_refresh', 'Refresh token missing');
    let payload: jwt.JwtPayload;
    try {
        payload = jwt.verify(token, env().JWT_REFRESH_SECRET) as jwt.JwtPayload;
    } catch {
        throw new HttpError(401, 'bad_refresh', 'Refresh token invalid or expired');
    }
    const user = await User.findById(payload.sub);
    if (!user || user.isBlocked || user.tokenVersion !== payload.v) {
        res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
        throw new HttpError(401, 'bad_refresh', 'Session ended');
    }
    const accessToken = await issueTokens(res, user);
    res.json({ accessToken, user: toPublicUser(user) });
}));

router.post('/logout', asyncHandler(async (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (token) {
        try {
            const payload = jwt.verify(token, env().JWT_REFRESH_SECRET) as jwt.JwtPayload;
            await User.updateOne({ _id: payload.sub }, { $inc: { tokenVersion: 1 } });
        } catch {
            // expired or forged cookie - nothing to revoke
        }
    }
    res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
    res.status(204).end();
}));

const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema });

// AUTH-6: required after an admin reset (mustChangePassword)
router.post('/change-password', requireAuth, validateBody(changePasswordSchema), asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body as z.infer<typeof changePasswordSchema>;
    const user = await User.findById(req.user!.id);
    if (!user) throw new HttpError(404, 'not_found', 'User not found');
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
        throw new HttpError(400, 'bad_password', 'Current password is wrong');
    }
    user.passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
    user.mustChangePassword = false;
    user.tokenVersion += 1;
    await user.save();
    const accessToken = await issueTokens(res, user);
    res.json({ accessToken, user: toPublicUser(user) });
}));

export default router;
export { BCRYPT_COST };
