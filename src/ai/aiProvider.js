import { askOpenAI } from './openai.js';
import { askOpenRouter } from './openrouter.js';

export async function chatWithFallback(prompt, env) {
  try {
    const reply = await askOpenAI(prompt, env);
    return { reply, handoff: false, imageUrl: null, provider: 'openai' };
  } catch (openAIError) {
    try {
      const reply = await askOpenRouter(prompt, env);
      return { reply, handoff: false, imageUrl: null, provider: 'openrouter' };
    } catch (openRouterError) {
      const error = new Error('All providers failed');
      error.details = [String(openAIError), String(openRouterError)];
      throw error;
    }
  }
}
