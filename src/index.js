import { routeRequest, processUserMessage } from './router.js';
import { saveConversationTurn } from './memory/conversationMemory.js';
import { normalizeText, sanitizeInput } from './utils/helpers.js';
import { sendKommoReply } from './services/kommo.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // ── Debug: GET /debug ──────────────────────────────────────────────────
    if (request.method === 'GET' && url.pathname === '/debug') {
      return Response.json({
        kommo: {
          subdomain: env.KOMMO_SUBDOMAIN,
          hasToken: !!env.KOMMO_ACCESS_TOKEN,
          tokenLength: env.KOMMO_ACCESS_TOKEN?.length || 0,
          hasIntegrationId: !!env.KOMMO_INTEGRATION_ID,
          hasSecret: !!env.KOMMO_CLIENT_SECRET,
        },
      }, { headers: corsHeaders });
    }

    // ── Test conexión Kommo: GET /kommo-test ───────────────────────────────
    if (request.method === 'GET' && url.pathname === '/kommo-test') {
      const rawSubdomain = env.KOMMO_SUBDOMAIN;
      const token = env.KOMMO_ACCESS_TOKEN;
      const subdomain = rawSubdomain?.includes('.') ? rawSubdomain : `${rawSubdomain}.kommo.com`;
      try {
        const res = await fetch(`https://${subdomain}/api/v4/account?with=amojo_id`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = res.ok ? await res.json() : await res.text();
        return Response.json({ success: res.ok, status: res.status, data }, { headers: corsHeaders });
      } catch (error) {
        return Response.json({ success: false, error: String(error) }, { status: 500, headers: corsHeaders });
      }
    }

    // ── WEBHOOK de Kommo: POST /webhook ────────────────────────────────────
    // Kommo envía application/x-www-form-urlencoded, NO JSON
    if (request.method === 'POST' && (url.pathname === '/' || url.pathname === '/webhook')) {
      let params;
      try {
        const text = await request.text();
        params = new URLSearchParams(text);
        console.log('WEBHOOK RAW:', text.substring(0, 500));
      } catch (e) {
        return Response.json({ error: 'Error leyendo body' }, { status: 400, headers: corsHeaders });
      }

      // Kommo envía los mensajes entrantes en message[add][0][*]
      // y los mensajes salientes en message[add][0][*] también pero con flag
      // Extraemos el texto y el conversation_id (chat_id en Kommo)
      const messageText = params.get('message[add][0][text]') || 
                          params.get('message[0][text]') || '';
      
      // chat_id UUID necesario para la Chat API de amojo.kommo.com
      const conversationId = params.get('message[add][0][chat_id]') ||
                             params.get('chat_id') || '';

      // Tipo de mensaje: 1=entrante (del cliente), 2=saliente (del agente)
      const direction = params.get('message[add][0][type]') || '';

      // Parámetros extra del webhook para enriquecer el mensaje en Kommo
      const webhookParams = {
        entity_id: params.get('message[add][0][entity_id]') || params.get('message[add][0][element_id]'),
        element_type: params.get('message[add][0][element_type]'),
        author_id: params.get('message[add][0][author][id]') || params.get('message[add][0][author_id]'),
        talk_id: params.get('message[add][0][talk_id]'),
        contact_id: params.get('message[add][0][contact_id]'),
        account_id: params.get('account[id]'),
      };

      console.log(`messageText: "${messageText}", conversationId: "${conversationId}", direction: "${direction}"`);
      console.log('Todos los params:', [...params.entries()].map(([k,v]) => `${k}=${v}`).join(' | '));

      // Si es mensaje saliente (enviado por un agente/bot), ignoramos para evitar loop
      if (direction === '2') {
        return Response.json({ ok: true, skipped: true, reason: 'Mensaje saliente ignorado' }, { headers: corsHeaders });
      }

      const message = sanitizeInput(normalizeText(messageText));

      if (!message) {
        return Response.json({ ok: true, skipped: true, reason: 'Mensaje vacío' }, { headers: corsHeaders });
      }

      if (!conversationId) {
        console.warn('[webhook] No se encontró conversation_id/talk_id en el payload');
        // Respondemos 200 para que Kommo no reintente, pero logueamos el problema
        return Response.json({ ok: false, error: 'conversation_id no encontrado', hint: 'Revisar logs para ver params recibidos' }, { headers: corsHeaders });
      }

      try {
        const result = await processUserMessage(message, env, ctx);
        saveConversationTurn(message, result.reply, { route: 'webhook', handoff: result.handoff });
        ctx.waitUntil(sendKommoReply(result.reply, conversationId, env, params));
        return Response.json({ ok: true, reply: result.reply }, { headers: corsHeaders });
      } catch (error) {
        console.error('[webhook] Error procesando mensaje:', error);
        return Response.json(
          { error: error instanceof Error ? error.message : 'Error procesando mensaje' },
          { status: 502, headers: corsHeaders }
        );
      }
    }

    // ── Chat directo (para pruebas con JSON): POST /chat ──────────────────
    if (request.method === 'POST' && url.pathname === '/chat') {
      try {
        const body = await request.json().catch(() => ({}));
        const rawMessage = normalizeText(body?.message?.text ?? body?.message ?? '');
        const conversationId = body?.conversation_id ?? body?.payload?.conversation_id;
        const message = sanitizeInput(rawMessage);

        if (!message) {
          return Response.json({ error: 'Missing message in JSON body' }, { status: 400, headers: corsHeaders });
        }

        const result = await processUserMessage(message, env, ctx);
        saveConversationTurn(message, result.reply, { route: 'chat', handoff: result.handoff });

        if (conversationId) {
          ctx.waitUntil(sendKommoReply(result.reply, conversationId, env, params));
        }

        return Response.json(result, { status: 200, headers: corsHeaders });
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : 'Chat processing failed' },
          { status: 502, headers: corsHeaders }
        );
      }
    }

    return Response.json({ error: 'Endpoint no encontrado' }, { status: 404, headers: corsHeaders });
  },
};
