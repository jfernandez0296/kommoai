import { askOpenAI } from './openai.js';
import { askOpenRouter } from './openrouter.js';
import { buildPlanPrompt } from './systemPrompt.js';

export async function chatWithFallback(prompt, env) {
  try {
    // 1) OpenAI es el proveedor principal.
    const reply = await askOpenAI(buildPlanPrompt(prompt), env);
    return { reply, handoff: false, imageUrl: null, provider: 'openai' };
  } catch (openAIError) {
    try {
      // 2) OpenRouter actúa como fallback.
      const reply = await askOpenRouter(buildPlanPrompt(prompt), env);
      return { reply, handoff: true, imageUrl: null, provider: 'openrouter' };
    } catch (openRouterError) {
      // 3) Si todos fallan, devolvemos un error claro.
      throw {
        error: 'All providers failed',
        details: [String(openAIError), String(openRouterError)],
      };
    }
  }
}
