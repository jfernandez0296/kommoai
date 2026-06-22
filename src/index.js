import { routeRequest, processUserMessage } from './router.js';
import { saveConversationTurn } from './memory/conversationMemory.js';
import { normalizeText, sanitizeInput } from './utils/helpers.js';
import { sendKommoReply } from './services/kommo.js';

let LAST_WEBHOOK = null;

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

    // ── Debug: GET /last-webhook ───────────────────────────────────────────
    if (request.method === 'GET' && url.pathname === '/last-webhook') {
      return Response.json({ lastWebhook: LAST_WEBHOOK }, { headers: corsHeaders });
    }

    // ── Test conexión Kommo: GET /kommo-test ───────────────────────────────
    if (request.method === 'GET' && url.pathname === '/kommo-test') {
      const rawSubdomain = env.KOMMO_SUBDOMAIN;
      const token = env.KOMMO_ACCESS_TOKEN;
      const subdomain = rawSubdomain?.includes('.') ? rawSubdomain : `${rawSubdomain}.kommo.com`;
      try {
        const res = await fetch(`https://${subdomain}/api/v4/account`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = res.ok ? await res.json() : await res.text();
        return Response.json({ success: res.ok, status: res.status, data }, { headers: corsHeaders });
      } catch (error) {
        return Response.json({ success: false, error: String(error) }, { status: 500, headers: corsHeaders });
      }
    }

    // ── WEBHOOK de Kommo: POST / o POST /webhook ───────────────────────────
    // FIX: antes este path era rechazado con 405. Ahora lo procesamos.
    if (request.method === 'POST' && (url.pathname === '/' || url.pathname === '/webhook')) {
      let body;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: 'Invalid JSON' }, { status: 400, headers: corsHeaders });
      }

      LAST_WEBHOOK = body;
      console.log('WEBHOOK RECIBIDO:', JSON.stringify(body, null, 2));

      // FIX: parsear correctamente el payload de Kommo
      // Kommo envía: { event_type, payload: { conversation_id, message: { text } } }
      const eventType = body?.event_type;

      // Solo procesamos mensajes entrantes del usuario
      if (eventType !== 'new_message') {
        return Response.json({ ok: true, skipped: true, reason: `event_type '${eventType}' ignorado` }, { headers: corsHeaders });
      }

      const conversationId = body?.payload?.conversation_id;
      const rawMessage = normalizeText(
        body?.payload?.message?.text ?? body?.payload?.message ?? ''
      );
      const message = sanitizeInput(rawMessage);

      console.log(`conversationId: ${conversationId}, message: "${message}"`);

      if (!message) {
        return Response.json({ ok: true, skipped: true, reason: 'Mensaje vacío' }, { headers: corsHeaders });
      }

      if (!conversationId) {
        console.warn('[webhook] No se encontró conversation_id en el payload');
        return Response.json({ ok: false, error: 'conversation_id no encontrado en el payload' }, { status: 400, headers: corsHeaders });
      }

      try {
        const result = await processUserMessage(message, env, ctx);
        saveConversationTurn(message, result.reply, { route: 'webhook', handoff: result.handoff });

        // Enviamos la respuesta a Kommo de forma asíncrona
        ctx.waitUntil(sendKommoReply(result.reply, conversationId, env));

        return Response.json({ ok: true, reply: result.reply }, { headers: corsHeaders });
      } catch (error) {
        console.error('[webhook] Error procesando mensaje:', error);
        return Response.json(
          { error: error instanceof Error ? error.message : 'Error procesando mensaje' },
          { status: 502, headers: corsHeaders }
        );
      }
    }

    // ── Chat directo (para pruebas): POST /chat ────────────────────────────
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
          ctx.waitUntil(sendKommoReply(result.reply, conversationId, env));
        }

        return Response.json(result, { status: 200, headers: corsHeaders });
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : 'Chat processing failed' },
          { status: 502, headers: corsHeaders }
        );
      }
    }

    // ── Fallback ───────────────────────────────────────────────────────────
    return Response.json({ error: 'Endpoint no encontrado' }, { status: 404, headers: corsHeaders });
  },
};
