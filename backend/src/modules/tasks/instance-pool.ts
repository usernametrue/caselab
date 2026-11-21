import { TaskTemplate, type TaskTemplateDoc } from '../content/content.model';
import { InstanceVariant, TaskInstance } from './task.model';
import { AiJob, batchEnabled, registerJobHandler, runOrQueue } from '../ai/batch';
import { caseRewritable, caseRewriteRequest, clientStoryRequest, clientStorySchema, generatedCaseSchema, keepsValues, pickValues, substitute, templateRev } from './task.service';
import { addDays, isIsoDate, tashkentToday } from '../legal/engines/dates';
import { pick, type Locale } from '../../utils/localized';
import { env } from '../../config/env';
import { logError, logInfo } from '../../logger';

// Pool of prepared cases: once a day the rewrites for tomorrow go out as one batch (half the price), and a
// student who starts a task takes a ready case without waiting for the LLM. The size follows the last
// 7 days of demand per template and language, so nothing is written for templates nobody opens.

const DEMAND_DAYS = 7;

interface VariantMeta {
    key: string;
    templateId: string;
    templateRev: string;
    kind: 'instance' | 'client_story';
    locale: Locale;
    today: string;
    raw: Record<string, string | number>;
    display: Record<string, string>;
}

async function saveVariant(meta: VariantMeta, caseText: string) {
    if (!keepsValues(caseText, meta.display)) return { skipped: 'lost_value' };
    const v = await InstanceVariant.create({
        templateId: meta.templateId, templateRev: meta.templateRev, kind: meta.kind, locale: meta.locale, today: meta.today,
        raw: meta.raw, display: meta.display, caseText, expiresAt: new Date(`${addDays(meta.today, 2)}T00:00:00Z`)
    });
    return { variantId: String(v._id) };
}

registerJobHandler('instance_variant', { schema: generatedCaseSchema, onResult: (meta: VariantMeta, data) => saveVariant(meta, data.caseText) });
registerJobHandler('client_story_variant', { schema: clientStorySchema, onResult: (meta: VariantMeta, data) => saveVariant(meta, data.story) });

const kindOf = (t: TaskTemplateDoc) => (t.taskType === 'route_and_apply' ? 'client_story' as const : 'instance' as const);

// Templates whose cases the AI rewrites: values to keep verbatim, rewrite allowed, not a track-only stage
const eligible = (t: TaskTemplateDoc) => t.aiRewrite && (t.taskType === 'route_and_apply' || caseRewritable(t));

export async function planPool(days: string[] = [tashkentToday(), addDays(tashkentToday(), 1)]) {
    const max = env().LLM_POOL_SIZE;
    if (!max || !batchEnabled()) return 0;
    const since = new Date(Date.now() - DEMAND_DAYS * 86_400_000);
    const demand = await TaskInstance.aggregate<{ _id: { t: unknown; l: Locale }; n: number }>([
        { $match: { createdAt: { $gte: since }, runId: null } },
        { $group: { _id: { t: '$templateId', l: '$language' }, n: { $sum: 1 } } }
    ]);
    if (!demand.length) return 0;
    const templates = new Map((await TaskTemplate.find({ _id: { $in: demand.map(d => d._id.t) }, status: 'published' })).map(t => [String(t._id), t]));
    let queued = 0;
    for (const d of demand) {
        const template = templates.get(String(d._id.t));
        if (!template || !eligible(template)) continue;
        const target = Math.min(max, Math.ceil((d.n / DEMAND_DAYS) * 1.5));
        // A template with a fixed "today" lives on one date
        const fixed = template.context?.today && isIsoDate(template.context.today) ? template.context.today : null;
        for (const today of fixed ? [fixed] : days) {
            const kind = kindOf(template);
            const key = `${template._id}:${kind}:${d._id.l}:${today}`;
            const [ready, pending] = await Promise.all([
                InstanceVariant.countDocuments({ templateId: template._id, templateRev: templateRev(template), kind, locale: d._id.l, today }),
                AiJob.countDocuments({ kind: `${kind}_variant`, 'meta.key': key, status: { $in: ['queued', 'submitting', 'submitted'] } })
            ]);
            for (let i = ready + pending; i < target; i++) {
                await queueVariant(template, kind, d._id.l, today, key);
                queued++;
            }
        }
    }
    if (queued) logInfo('case pool planned', {}, { queued });
    return queued;
}

async function queueVariant(template: TaskTemplateDoc, kind: 'instance' | 'client_story', locale: Locale, today: string, key: string) {
    const { raw, display } = pickValues(template, today, locale);
    const baseCase = substitute(pick(template.caseText as any, locale), display);
    const { req, promptVersion } = kind === 'client_story'
        ? clientStoryRequest(template, locale, baseCase, display)
        : caseRewriteRequest(template, locale, baseCase, display, []);
    const meta: VariantMeta = { key, templateId: String(template._id), templateRev: templateRev(template), kind, locale, today, raw, display };
    await runOrQueue(`${kind}_variant`, req, { promptVersion, meta });
}

let timer: NodeJS.Timeout | null = null;
let plannedFor = '';

// Checked every hour; planned once per Tashkent date (the counts above keep a restart from doubling it)
export function startPoolPlanner() {
    if (!env().LLM_POOL_SIZE || !batchEnabled()) return;
    const tick = () => {
        const today = tashkentToday();
        if (plannedFor === today) return;
        plannedFor = today;
        planPool().catch(e => {
            plannedFor = '';
            logError(e as Error);
        });
    };
    timer = setInterval(tick, 60 * 60 * 1000);
    setTimeout(tick, 30_000);
}

export function stopPoolPlanner() {
    if (timer) clearInterval(timer);
    timer = null;
}
