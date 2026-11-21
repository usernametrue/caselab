import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import mongoSanitize from 'express-mongo-sanitize';
import rateLimit from 'express-rate-limit';
import { env, isLlmConfigured } from './config/env';
import { stream } from './logger';
import { healthCheck } from './db';
import { errorHandler, notFoundHandler } from './middleware/error';
import authRoutes from './modules/auth/auth.routes';
import meRoutes from './modules/users/me.routes';
import taskRoutes from './modules/tasks/task.routes';
import attemptRoutes from './modules/attempts/attempt.routes';
import adminRoutes from './modules/admin/admin.routes';
import teacherRoutes from './modules/teacher/teacher.routes';
import teacherContentRoutes from './modules/teacher/content.routes';
import { calendarRouter, courtsRouter } from './modules/legal/legal.routes';
import { legalRouter, normsRouter } from './modules/legal/legal.routes';
import { bodiesRouter, simRouter, tasksInteractiveRouter } from './modules/tasks/interactive.routes';
import leaderboardRoutes from './modules/gamification/leaderboard.routes';
import { runsRouter, tracksRouter } from './modules/tracks/track.routes';
import { auditAdminActions } from './modules/admin/audit';
import { hearingRouter } from './modules/hearing/hearing.routes';

export function createApp() {
    const app = express();
    app.set('trust proxy', 1);

    app.use(helmet());
    app.use(cors({
        origin: env().CORS_ORIGIN.split(',').map(s => s.trim()),
        credentials: true
    }));
    app.use(compression());
    // Content import (JSON and DOCX in base64) gets a bigger body limit than the rest of the API
    const jsonSmall = express.json({ limit: '1mb' });
    const jsonLarge = express.json({ limit: '15mb' });
    app.use((req, res, next) => (req.path.startsWith('/api/v1/admin/import') || req.path === '/api/v1/teacher/content/import' ? jsonLarge : jsonSmall)(req, res, next));
    app.use(cookieParser());
    app.use(mongoSanitize());
    if (env().NODE_ENV !== 'test') app.use(morgan('tiny', { stream }));

    // Health for docker healthcheck and nginx; reports the database status of this process
    const health: express.RequestHandler = async (_req, res) => {
        const database = await healthCheck();
        res.status(database.status === 'healthy' ? 200 : 503).json({ status: database.status === 'healthy' ? 'ok' : 'degraded', database, llm: isLlmConfigured() ? 'configured' : 'not_configured' });
    };
    app.get('/health', health);
    app.get('/api/v1/health', health);

    const api = express.Router();
    // Generic limit for the API; AI-heavy endpoints below get a stricter one
    api.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false }));
    // Off in tests: one test run creates more tasks per minute than a student does
    const aiLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, skip: () => env().NODE_ENV === 'test' });
    // ADM-9: changing requests of admins on any route (admin panel, moderation, groups)
    api.use(auditAdminActions);

    api.use('/auth', authRoutes);
    api.post('/me/daily/:index/start', aiLimiter);
    api.use('/me', meRoutes);
    api.use('/tasks/next', aiLimiter);
    api.use('/tasks/from-template', aiLimiter);
    // Mounted before the tasks router, otherwise the router answers first and the limiter never runs
    api.use('/tasks/from-assignment', aiLimiter);
    api.post('/tasks/instances/:id/ask-client', aiLimiter);
    api.use('/tasks', tasksInteractiveRouter);
    api.use('/tasks', taskRoutes);
    api.post('/attempts', aiLimiter);
    api.use('/attempts', attemptRoutes);
    api.use('/legal', legalRouter);
    api.use('/norms', normsRouter);
    api.use('/admin', adminRoutes);
    api.use('/teacher/content', teacherContentRoutes);
    api.use('/teacher', teacherRoutes);
    api.use('/courts', courtsRouter);
    api.use('/calendar', calendarRouter);
    api.use('/bodies', bodiesRouter);
    api.use('/sim', simRouter);
    // Hearing replies are short and frequent: their own limit, apart from the task starts
    api.post('/hearing/:id/say', rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false, skip: () => env().NODE_ENV === 'test' }));
    api.use('/hearing', hearingRouter);
    api.use('/leaderboard', leaderboardRoutes);
    api.post('/tracks/:id/start', aiLimiter);
    api.use('/tracks', tracksRouter);
    api.use('/runs', runsRouter);

    app.use('/api/v1', api);
    app.use(notFoundHandler);
    app.use(errorHandler);
    return app;
}
