import { askGemini } from './gemini.js';
import { askOpenRouter } from './openrouter.js';
import { buildPlanPrompt } from './systemPrompt.js';

export async function chatWithFallback(prompt, env) {
  try {
    // 1) Gemini es el proveedor principal y recibe el prompt mejorado del sistema.
    const reply = await askGemini(buildPlanPrompt(prompt), env);
    return { reply, handoff: false, imageUrl: null, provider: 'gemini' };
  } catch (geminiError) {
    try {
      // 2) OpenRouter actúa como fallback si Gemini falla o devuelve un error.
      const reply = await askOpenRouter(buildPlanPrompt(prompt), env);
      return { reply, handoff: true, imageUrl: null, provider: 'openrouter' };
    } catch (openRouterError) {
      // 3) Si ambos fallan, devolvemos un error claro para la capa HTTP.
      throw {
        error: 'Both providers failed',
        details: [String(geminiError), String(openRouterError)],
      };
    }
  }
}
