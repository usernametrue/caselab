import { Router } from 'express';
import { Types } from 'mongoose';
import { asyncHandler, HttpError } from '../../utils/http';
import { requireAuth } from '../../middleware/auth';
import { Group, User } from '../users/user.model';
import { XpEvent } from './gamification.model';
import { addDays, parseIso, tashkentToday } from '../legal/engines/dates';

// GET /leaderboard?scope=group|course|all&period=week|all&groupId= (PRD 7.5, 9.4).
// XP only: exam attempts give no XP, so they never reach the leaderboard. The week starts on Monday 00:00 in Tashkent.
const router = Router();
router.use(requireAuth);

export function weekStart(today = tashkentToday()) {
    const weekday = parseIso(today).getUTCDay();
    const monday = addDays(today, -((weekday + 6) % 7));
    return new Date(`${monday}T00:00:00+05:00`);
}

const LIMIT = 50;

router.get('/', asyncHandler(async (req, res) => {
    const scope = ['group', 'course', 'all'].includes(String(req.query.scope)) ? String(req.query.scope) : 'all';
    const period = req.query.period === 'week' ? 'week' : 'all';
    const me = await User.findById(req.user!.id).lean();
    if (!me) throw new HttpError(404, 'not_found', 'User not found');

    const filter: Record<string, unknown> = { role: 'student', isBlocked: false, organizationId: me.organizationId };
    let groups: { id: string; name: string }[] = [];
    if (scope === 'group') {
        const own = await Group.find(me.role === 'teacher' ? { teacherId: me._id } : me.role === 'admin' ? { organizationId: me.organizationId } : { studentIds: me._id }).select('name studentIds').lean();
        groups = own.map(g => ({ id: String(g._id), name: g.name }));
        const group = own.find(g => String(g._id) === req.query.groupId) ?? own[0];
        if (!group) {
            res.json({ scope, period, groups, groupId: null, rows: [], me: null });
            return;
        }
        filter._id = { $in: group.studentIds };
        (req as any).groupId = String(group._id);
    } else if (scope === 'course') {
        if (!me.course) {
            res.json({ scope, period, groups, rows: [], me: null, noCourse: true });
            return;
        }
        filter.course = me.course;
    } else {
        // The overall leaderboard respects "hide me"
        filter.hideFromLeaderboard = { $ne: true };
    }

    const users = await User.find(filter).select('fullName xp level').lean();
    let xpOf = new Map(users.map(u => [String(u._id), u.xp]));
    if (period === 'week') {
        const sums = await XpEvent.aggregate([
            { $match: { userId: { $in: users.map(u => u._id as Types.ObjectId) }, createdAt: { $gte: weekStart() } } },
            { $group: { _id: '$userId', xp: { $sum: '$amount' } } }
        ]);
        xpOf = new Map(users.map(u => [String(u._id), 0]));
        for (const s of sums) xpOf.set(String(s._id), Math.max(0, s.xp));
    }
    const ranked = users
        .map(u => ({ userId: String(u._id), fullName: u.fullName, level: u.level, xp: xpOf.get(String(u._id)) ?? 0 }))
        .sort((a, b) => b.xp - a.xp || a.fullName.localeCompare(b.fullName));
    // Equal XP share the rank
    let rank = 0;
    let prev = -1;
    const rows = ranked.map((r, i) => {
        if (r.xp !== prev) { rank = i + 1; prev = r.xp; }
        return { ...r, rank, me: r.userId === String(me._id) };
    });
    const mine = rows.find(r => r.me) ?? null;
    res.json({
        scope, period, groups, groupId: (req as any).groupId ?? null,
        rows: rows.slice(0, LIMIT),
        me: mine ? { rank: mine.rank, xp: mine.xp } : null,
        hidden: scope === 'all' && Boolean(me.hideFromLeaderboard)
    });
}));

export default router;
