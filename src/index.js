import { routeRequest, processUserMessage } from './router.js';
import { saveConversationTurn } from './memory/conversationMemory.js';
import { normalizeText, sanitizeInput } from './utils/helpers.js';
import { sendKommoReply } from './services/kommo.js';

let LAST_WEBHOOK = null;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Manejo de CORS
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // 0) Endpoint de depuración (GET /debug)
    if (request.method === 'GET' && url.pathname === '/debug') {
      return Response.json({
        kommo: {
          subdomain: env.KOMMO_SUBDOMAIN,
          hasToken: !!env.KOMMO_ACCESS_TOKEN,
          tokenLength: env.KOMMO_ACCESS_TOKEN?.length || 0,
          hasIntegrationId: !!env.KOMMO_INTEGRATION_ID,
          hasSecret: !!env.KOMMO_CLIENT_SECRET
        }
      }, { headers: corsHeaders });
    }

    // 0.1) Endpoint de diagnóstico de webhooks (POST /webhook-test)
    if (request.method === 'POST' && url.pathname === '/webhook-test') {
      try {
        const body = await request.json();
        LAST_WEBHOOK = body;

        console.log('WEBHOOK RECEIVED');
        console.log(JSON.stringify(body, null, 2));

        return Response.json({
          success: true,
          timestamp: new Date().toISOString(),
          received: body
        }, { headers: corsHeaders });
      } catch (error) {
        return Response.json({
          success: false,
          error: 'Invalid JSON body'
        }, { status: 400, headers: corsHeaders });
      }
    }

    // 0.1.1) Endpoint para ver el último webhook recibido (GET /last-webhook)
    if (request.method === 'GET' && url.pathname === '/last-webhook') {
      return Response.json({
        lastWebhook: LAST_WEBHOOK
      }, { headers: corsHeaders });
    }

    // 0.2) Prueba de conexión a Kommo (GET /kommo-test)
    if (request.method === 'GET' && url.pathname === '/kommo-test') {
      const rawSubdomain = env.KOMMO_SUBDOMAIN;
      const token = env.KOMMO_ACCESS_TOKEN;

      const subdomain = rawSubdomain.includes('.') ? rawSubdomain : `${rawSubdomain}.kommo.com`;

      try {
        const response = await fetch(`https://${subdomain}/api/v4/account`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (!response.ok) {
          const responseText = await response.text();
          return Response.json({
            success: false,
            status: response.status,
            error: responseText
          }, { headers: corsHeaders });
        }

        const data = await response.json();
        return Response.json({
          success: true,
          account: data
        }, { headers: corsHeaders });
      } catch (error) {
        return Response.json({
          success: false,
          error: String(error)
        }, { status: 500, headers: corsHeaders });
      }
    }


    // 1) Validamos la ruta y el método para que el worker sea un endpoint de chatbot real.
    const route = routeRequest(url.pathname, request);

    if (request.method !== 'POST' || route.handler !== 'chat') {
      return Response.json({ error: 'Only POST /chat is supported' }, { status: 405, headers: corsHeaders });
    }

    try {
      // 2) Leemos el cuerpo JSON enviado por el cliente.
      const body = await request.json().catch(() => ({}));

      // Extraemos el mensaje y el conversation_id (si viene de un webhook de Kommo)
      const rawMessage = normalizeText(body?.message?.text ?? body?.message ?? '');
      const conversationId = body?.conversation_id ?? body?.payload?.conversation_id;

      const message = sanitizeInput(rawMessage);

      if (!message) {
        return Response.json({ error: 'Missing message in JSON body' }, { status: 400, headers: corsHeaders });
      }

      // 3) Procesamos el mensaje con el router y el proveedor IA.
      const result = await processUserMessage(message, env, ctx);

      // 4) Guardamos el turno en memoria para trazabilidad.
      saveConversationTurn(message, result.reply, { route: route.reason, handoff: result.handoff });

      // 5) Si tenemos conversationId, enviamos la respuesta de vuelta a Kommo de forma asíncrona.
      if (conversationId) {
        ctx.waitUntil(sendKommoReply(result.reply, conversationId, env));
      }

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
