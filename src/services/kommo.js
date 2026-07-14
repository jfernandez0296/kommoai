import { getValidAccessToken } from './kommoAuth.js';
import { resolveKommoSubdomain } from '../utils/helpers.js';

const REPLY_FIELD_ID = 1462622;
const BOT_ACTIVE_FIELD_ID = 1463180;
const SALESBOT_ID = 17570;

export async function isBotDisabled(leadId, env) {
  if (!leadId) return false;
  try {
    const subdomain = resolveKommoSubdomain(env);
    const token = await getValidAccessToken(env);
    const res = await fetch(`https://${subdomain}/api/v4/leads/${leadId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return false;
    const data = await res.json();
    const fields = data.custom_fields_values || [];
    const botField = fields.find(f => f.field_id === BOT_ACTIVE_FIELD_ID);
    const val = botField?.values?.[0]?.value || '';
    return val.toUpperCase() === 'NO';
  } catch {
    return false;
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
