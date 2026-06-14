export async function askOpenRouter(prompt, env) {
  const hasOpenRouterKey = Boolean(env?.OPENROUTER_API_KEY);
  console.log('[env] OPENROUTER_API_KEY:', hasOpenRouterKey ? 'configurada' : 'no configurada');

  if (!hasOpenRouterKey) {
    throw new Error('Falta configurar el Secret OPENROUTER_API_KEY en Wrangler o en .dev.vars.');
  }

  const model = env?.OPENROUTER_MODEL ?? 'openai/gpt-4o-mini';
  const workerUrl = env?.WORKER_URL || 'https://kommo-ai.jfernandezc.workers.dev';
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env?.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': workerUrl,
      'X-Title': 'Kommo AI Worker',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter request failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? 'No response from OpenRouter.';
}
