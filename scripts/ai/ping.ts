import { loadEnv } from './load-env';

loadEnv();

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];

interface KeyInfo {
  data?: { usage?: number; limit_remaining?: number | null };
}

async function main() {
  const { callModel, getModelId, isAiError } = await import('@/server/ai/client');
  const { getBudgetStatus } = await import('@/server/ai/budget');
  const { pingSchema, pingPrompt } = await import('@/server/ai/prompts/ping');
  const { getStore } = await import('@/server/store');

  const reasoning = arg('reasoning') as 'off' | 'minimal' | 'low' | undefined;
  const store = getStore();
  console.log(
    `model ${getModelId()}, store ${store.driver} (${store.prefix || 'no prefix'}), reasoning ${reasoning ?? process.env.AI_REASONING_EFFORT ?? 'minimal (default)'}`,
  );

  try {
    const res = await callModel({
      op: 'ping',
      schema: pingSchema,
      system: pingPrompt.system,
      user: pingPrompt.user,
      locale: 'en',
      maxTokens: 400,
      temperature: 0,
      reasoning,
    });
    const u = res.usage;
    console.log('answer', JSON.stringify(res.data));
    console.log(`tokens: prompt ${u.promptTokens}, completion ${u.completionTokens} (of which reasoning ${u.reasoningTokens})`);
    console.log(`cost: $${u.costUsd.toFixed(6)}`);
    const b = await getBudgetStatus();
    console.log(`budget: today $${b.dayUsd.toFixed(5)} of $${b.dayLimitUsd}, total $${b.totalUsd.toFixed(5)} of $${b.totalLimitUsd}`);

    const key = (await fetch('https://openrouter.ai/api/v1/key', {
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)) as KeyInfo | null;
    if (key?.data) {
      console.log(`OpenRouter key: used $${(key.data.usage ?? 0).toFixed(4)}, remaining ${key.data.limit_remaining ?? 'no key limit'}`);
    }

    if (u.costUsd >= 0.001) {
      console.error(`FAIL: ping cost $${u.costUsd.toFixed(6)} is not below $0.001`);
      process.exit(1);
    }
    console.log('OK');
  } catch (err) {
    if (isAiError(err)) {
      console.error(`FAIL: ${err.code}: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}

main();
