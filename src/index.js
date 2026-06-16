import { routeRequest, processUserMessage } from './router.js';
import { saveConversationTurn } from './memory/conversationMemory.js';
import { normalizeText, sanitizeInput } from './utils/helpers.js';

export default {
  async fetch(request, env, ctx) {
    // Manejo de CORS
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // 1) Validamos la ruta y el método para que el worker sea un endpoint de chatbot real.
    const url = new URL(request.url);
    const route = routeRequest(url.pathname, request);

    if (request.method !== 'POST' || route.handler !== 'chat') {
      return Response.json({ error: 'Only POST /chat is supported' }, { status: 405, headers: corsHeaders });
    }

    try {
      // 2) Leemos el cuerpo JSON enviado por el cliente.
      const body = await request.json().catch(() => ({}));
      const rawMessage = normalizeText(body?.message ?? '');
      const message = sanitizeInput(rawMessage);

      if (!message) {
        return Response.json({ error: 'Missing message in JSON body' }, { status: 400 });
      }

      // 3) Procesamos el mensaje con el router y el proveedor IA.
      const result = await processUserMessage(message, env, ctx);

      // 4) Guardamos el turno en memoria para trazabilidad.
      saveConversationTurn(message, result.reply, { route: route.reason, handoff: result.handoff });

      return Response.json(result, { status: 200, headers: corsHeaders });
    } catch (error) {
      // 5) Devolvemos un error claro cuando falla la IA o el procesamiento.
      return Response.json(
        {
          error: error instanceof Error ? error.message : 'Chat processing failed',
          details: error,
        },
        { status: 502, headers: corsHeaders },
      );
    }
  },
};
