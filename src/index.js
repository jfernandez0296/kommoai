import { processUserMessage } from './router.js';
import { normalizeText, sanitizeInput, resolveKommoSubdomain } from './utils/helpers.js';
import { sendKommoReply, isBotDisabled } from './services/kommo.js';
import { exchangeCodeForTokens, getValidAccessToken } from './services/kommoAuth.js';

let LAST_WEBHOOK = null;

function requireAdmin(request, env) {
  const secret = env.ADMIN_SECRET;
  if (!secret) return null; // no configurado → acceso libre (backwards compatible)
  const auth = request.headers.get('Authorization') || '';
  if (auth === `Bearer ${secret}`) return null;
  return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });
}

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
      const denied = requireAdmin(request, env);
      if (denied) return denied;
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
    if (request.method === 'GET' && url.pathname === '/oauth/start') {
      const state = crypto.randomUUID();
      const authorizeUrl = `https://www.kommo.com/oauth?client_id=${encodeURIComponent(env.KOMMO_INTEGRATION_ID)}&state=${state}&mode=post_message`;
      return Response.redirect(authorizeUrl, 302);
    }

    // ── Callback OAuth de Kommo: GET /oauth/callback ───────────────────────
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
      const denied = requireAdmin(request, env);
      if (denied) return denied;
      try {
        const body = await request.json();
        const { conversationId, message } = body;
        const result = await sendKommoReply(message, conversationId, env);
        return Response.json(result, { headers: corsHeaders });
      } catch (error) {
        return Response.json({ success: false, error: String(error) }, { status: 400, headers: corsHeaders });
      }
    }

    // ── Diagnóstico temporal: GET /kommo-fields-test ───────────────────────
    if (request.method === 'GET' && url.pathname === '/kommo-fields-test') {
      try {
        const subdomain = resolveKommoSubdomain(env);
        const token = await getValidAccessToken(env);

        const [leadsRes, contactsRes] = await Promise.all([
          fetch(`https://${subdomain}/api/v4/leads/custom_fields?limit=250`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`https://${subdomain}/api/v4/contacts/custom_fields?limit=250`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);

        const leadsBody = leadsRes.ok ? await leadsRes.json() : await leadsRes.text();
        const contactsBody = contactsRes.ok ? await contactsRes.json() : await contactsRes.text();

        const simplify = (body) => body?._embedded?.custom_fields?.map(f => ({ id: f.id, name: f.name, type: f.type })) || body;

        return Response.json({
          leads: { status: leadsRes.status, fields: simplify(leadsBody) },
          contacts: { status: contactsRes.status, fields: simplify(contactsBody) },
        }, { headers: corsHeaders });
      } catch (error) {
        return Response.json({ success: false, error: String(error) }, { status: 500, headers: corsHeaders });
      }
    }

    // ── Test conexión Kommo: GET /kommo-test ───────────────────────────────
    if (request.method === 'GET' && url.pathname === '/kommo-test') {
      try {
        const subdomain = resolveKommoSubdomain(env);
        const token = await getValidAccessToken(env);
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
    if (request.method === 'POST' && (url.pathname === '/' || url.pathname === '/webhook')) {
      // Validación de token secreto en la URL si está configurado
      const webhookSecret = env.WEBHOOK_SECRET;
      if (webhookSecret && url.searchParams.get('token') !== webhookSecret) {
        return new Response('Forbidden', { status: 403 });
      }

      let params;
      try {
        const text = await request.text();
        params = new URLSearchParams(text);
        console.log('WEBHOOK RAW:', text.substring(0, 3000));
      } catch (e) {
        return Response.json({ error: 'Error leyendo body' }, { status: 400, headers: corsHeaders });
      }

      const messageText = params.get('message[add][0][text]') ||
                          params.get('message[0][text]') || '';
      const leadId = params.get('message[add][0][entity_id]') ||
                     params.get('message[add][0][element_id]') || '';
      const direction = params.get('message[add][0][type]') || '';

      console.log(`messageText: "${messageText}", leadId: "${leadId}", direction: "${direction}"`);
      console.log('Todos los params:', [...params.entries()].map(([k, v]) => `${k}=${v}`).join(' | '));

      // Ignorar mensajes salientes para evitar loop
      if (direction === '2') {
        return Response.json({ ok: true, skipped: true, reason: 'Mensaje saliente ignorado' }, { headers: corsHeaders });
      }

      const message = sanitizeInput(normalizeText(messageText));
      if (!message) {
        return Response.json({ ok: true, skipped: true, reason: 'Mensaje vacío' }, { headers: corsHeaders });
      }

      if (!leadId) {
        console.warn('[webhook] No se encontró leadId (entity_id) en el payload');
        return Response.json({ ok: false, error: 'leadId no encontrado', hint: 'Revisar logs para ver params recibidos' }, { headers: corsHeaders });
      }

      // Responder 200 a Kommo inmediatamente y procesar en background
      ctx.waitUntil((async () => {
        try {
          if (await isBotDisabled(leadId, env)) {
            console.log(`[webhook] botactivo=NO para lead ${leadId}, ignorando`);
            return;
          }
          const result = await processUserMessage(message, env, ctx);
          await sendKommoReply(result.reply, leadId, env);
        } catch (err) {
          console.error('[webhook] Error en procesamiento background:', err);
        }
      })());

      return Response.json({ ok: true }, { headers: corsHeaders });
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
