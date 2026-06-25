import { routeRequest, processUserMessage } from './router.js';
import { saveConversationTurn } from './memory/conversationMemory.js';
import { normalizeText, sanitizeInput } from './utils/helpers.js';
import { sendKommoReply } from './services/kommo.js';
import { exchangeCodeForTokens } from './services/kommoAuth.js';

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

    // ── Autorización OAuth de Kommo: GET /oauth/start ──────────────────────
    // Paso único y manual: redirige a la pantalla de Kommo para autorizar la integración.
    if (request.method === 'GET' && url.pathname === '/oauth/start') {
      const state = crypto.randomUUID();
      const authorizeUrl = `https://www.kommo.com/oauth?client_id=${encodeURIComponent(env.KOMMO_INTEGRATION_ID)}&state=${state}&mode=post_message`;
      return Response.redirect(authorizeUrl, 302);
    }

    // ── Callback OAuth de Kommo: GET /oauth/callback ───────────────────────
    // Kommo redirige aquí con ?code=... tras la autorización manual.
    if (request.method === 'GET' && url.pathname === '/oauth/callback') {
      const code = url.searchParams.get('code');
      if (!code) {
        return Response.json({ error: 'Falta el parámetro code' }, { status: 400, headers: corsHeaders });
      }
      try {
        const redirectUri = `${url.origin}/oauth/callback`;
        await exchangeCodeForTokens(env, code, redirectUri);
        return new Response('Autorización completada. Ya puedes cerrar esta ventana.', { headers: corsHeaders });
      } catch (error) {
        return Response.json({ error: String(error) }, { status: 500, headers: corsHeaders });
      }
    }

    // ── Diagnóstico de webhooks: POST /webhook-test ────────────────────────
    if (request.method === 'POST' && url.pathname === '/webhook-test') {
      try {
        const body = await request.json();
        LAST_WEBHOOK = body;
        console.log('WEBHOOK-TEST RECIBIDO:', JSON.stringify(body, null, 2));
        return Response.json({
          success: true,
          timestamp: new Date().toISOString(),
          received: body,
        }, { headers: corsHeaders });
      } catch (error) {
        return Response.json({ success: false, error: 'Invalid JSON body' }, { status: 400, headers: corsHeaders });
      }
    }

    // ── Último webhook recibido: GET /last-webhook ─────────────────────────
    if (request.method === 'GET' && url.pathname === '/last-webhook') {
      return Response.json({ lastWebhook: LAST_WEBHOOK }, { headers: corsHeaders });
    }

    // ── Prueba de envío a Kommo: POST /kommo-send-test ─────────────────────
    if (request.method === 'POST' && url.pathname === '/kommo-send-test') {
      try {
        const body = await request.json();
        const { conversationId, message } = body;
        const result = await sendKommoReply(message, conversationId, env);
        return Response.json(result, { headers: corsHeaders });
      } catch (error) {
        return Response.json({ success: false, error: String(error) }, { status: 400, headers: corsHeaders });
      }
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
        if (!res.ok) {
          const errorText = await res.text();
          return Response.json({ success: false, status: res.status, error: errorText }, { headers: corsHeaders });
        }
        const account = await res.json();
        return Response.json({ success: true, account }, { headers: corsHeaders });
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

      // Dominio real de la cuenta (ej. https://miempresa.amocrm.com), lo manda Kommo en cada webhook
      const accountSelfLink = params.get('account[_links][self]') || '';

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
        ctx.waitUntil(sendKommoReply(result.reply, conversationId, env, accountSelfLink));
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
    if (url.pathname === '/chat') {
      if (request.method !== 'POST') {
        return Response.json({ error: 'Only POST /chat is supported' }, { status: 405, headers: corsHeaders });
      }

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

    return Response.json({ error: 'Endpoint no encontrado' }, { status: 404, headers: corsHeaders });
  },
};
