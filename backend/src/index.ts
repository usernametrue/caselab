import 'dotenv/config';
import './logger';
import { env } from './config/env';
import { connect } from './db';
import { createApp } from './app';
import { startEvaluationWorker } from './jobs/evaluate-attempt.job';
import { startAiBatchWorker } from './modules/ai/batch';
import { startPoolPlanner } from './modules/tasks/instance-pool';
import { logInfo } from './logger';

async function main() {
    // Fails fast on a bad configuration (missing JWT secrets etc.)
    const config = env();
    await connect();
    const app = createApp();
    app.listen(config.PORT, () => logInfo(`API listening on port ${config.PORT}`));
    startEvaluationWorker();
    // Background AI work: batches (admin drafts, weekly summaries) and the pool of cases for tomorrow
    startAiBatchWorker();
    startPoolPlanner();
}

main().catch(err => {
    console.error('Startup failed:', err?.message ?? err);
    process.exit(1);
});
