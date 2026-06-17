import { routeRequest, processUserMessage } from './router.js';
import { saveConversationTurn } from './memory/conversationMemory.js';
import { normalizeText, sanitizeInput } from './utils/helpers.js';
import { sendKommoReply } from './services/kommo.js';

export default {
  async fetch(request, env, ctx) {

    return Response.json({
      success: true,
      method: request.method,
      url: request.url,
      timestamp: new Date().toISOString()
    });

  }
}
