import { SYSTEM_PROMPT } from './systemPrompt.js';

export async function askOpenAI(userMessage, env) {
  const hasOpenAIKey = Boolean(env?.OPENAI_API_KEY);
  console.log(`OPENAI_API_KEY presente: ${hasOpenAIKey}`);

  if (!hasOpenAIKey) {
    throw new Error('Falta configurar OPENAI_API_KEY');
  }

  const model = env?.OPENAI_MODEL ?? 'gpt-4o-mini';
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI devolvió respuesta vacía');
  return content;
}
