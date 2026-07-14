import { getValidAccessToken } from './kommoAuth.js';
import { resolveKommoSubdomain } from '../utils/helpers.js';

const REPLY_FIELD_ID = 1462622;
const BOT_ACTIVE_FIELD_ID = 1463180;
const SALESBOT_ID = 17570;

/**
 * Consulta el campo "botactivo" del lead.
 * Devuelve { active, subdomain, token } para reutilizar el auth en llamadas siguientes.
 */
export async function isBotActive(leadId, env) {
  if (!leadId) return { active: false };
  try {
    const subdomain = resolveKommoSubdomain(env);
    const token = await getValidAccessToken(env);
    const res = await fetch(`https://${subdomain}/api/v4/leads/${leadId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      console.warn(`[kommo] isBotActive: GET lead ${leadId} devolvió ${res.status}`);
      return { active: false };
    }
    const data = await res.json();
    const fields = data.custom_fields_values || [];
    const botField = fields.find(f => f.field_id === BOT_ACTIVE_FIELD_ID);
    const val = botField?.values?.[0]?.value || '';
    return { active: val.toUpperCase() === 'SI', subdomain, token };
  } catch (err) {
    console.error('[kommo] isBotActive error:', err);
    return { active: false };
  }
}

/**
 * Pone botactivo = NO para que el worker deje de responder a este lead.
 * Acepta auth pre-resuelto para evitar un segundo fetch de token.
 */
export async function setBotInactive(leadId, env, auth = {}) {
  if (!leadId) return;
  try {
    const subdomain = auth.subdomain || resolveKommoSubdomain(env);
    const token = auth.token || await getValidAccessToken(env);
    const res = await fetch(`https://${subdomain}/api/v4/leads/${leadId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        custom_fields_values: [
          { field_id: BOT_ACTIVE_FIELD_ID, values: [{ value: 'NO' }] },
        ],
      }),
    });
    if (!res.ok) throw new Error(`set botactivo error: ${res.status}`);
    console.log(`[kommo] botactivo → NO para lead ${leadId}`);
  } catch (error) {
    console.error('[kommo] Error al desactivar bot:', error);
  }
}

async function setReplyField(subdomain, token, leadId, message) {
  const res = await fetch(`https://${subdomain}/api/v4/leads/${leadId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      custom_fields_values: [
        { field_id: REPLY_FIELD_ID, values: [{ value: message }] },
      ],
    }),
  });
  if (!res.ok) throw new Error(`set field error: ${res.status}`);
}

async function runSalesbot(subdomain, token, leadId) {
  const res = await fetch(`https://${subdomain}/api/v4/bots/${SALESBOT_ID}/run`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ entity_id: Number(leadId), entity_type: 'leads' }),
  });
  if (!res.ok) throw new Error(`salesbot run error: ${res.status}`);
}

/**
 * Escribe la respuesta en kommon8n y dispara el Salesbot.
 * Acepta auth pre-resuelto para evitar un segundo fetch de token.
 */
export async function sendKommoReply(message, leadId, env, auth = {}) {
  if (!leadId) {
    console.warn('[kommo] Falta leadId. Saltando envío.');
    return { ok: false, error: 'leadId vacío' };
  }

  try {
    const subdomain = auth.subdomain || resolveKommoSubdomain(env);
    const token = auth.token || await getValidAccessToken(env);

    await setReplyField(subdomain, token, leadId, message);
    await runSalesbot(subdomain, token, leadId);

    console.log(`[kommo] Salesbot ${SALESBOT_ID} lanzado para lead ${leadId}`);
    return { ok: true };
  } catch (error) {
    console.error('[kommo] Fallo:', error);
    return { ok: false, error: String(error) };
  }
}
