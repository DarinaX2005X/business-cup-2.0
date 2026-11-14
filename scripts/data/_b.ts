import { loadEnv } from '../ai/load-env';
loadEnv();
(async () => { const { getBudgetStatus } = await import('@/server/ai/budget'); console.log(JSON.stringify(await getBudgetStatus())); })();
