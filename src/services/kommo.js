import { getValidAccessToken } from './kommoAuth.js';

// Campo personalizado del lead "kommon8n" donde el Salesbot lee la respuesta a enviar.
const REPLY_FIELD_ID = 648586;
// ID del Salesbot (Configuración → Salesbot en Kommo) que envía el mensaje al chat
// leyendo el campo de arriba.
const SALESBOT_ID = 17570;

function resolveSubdomain(env) {
  const rawSubdomain = env.KOMMO_SUBDOMAIN;
  if (!rawSubdomain) throw new Error('Falta configurar KOMMO_SUBDOMAIN');
  return rawSubdomain.includes('.') ? rawSubdomain : `${rawSubdomain}.kommo.com`;
}

/**
 * Escribe la respuesta de la IA en el campo personalizado del lead que el
 * Salesbot usa como fuente del mensaje a enviar.
 */
async function setReplyField(subdomain, token, leadId, message) {
  const url = `https://${subdomain}/api/v4/leads/${leadId}`;
  const res = await fetch(url, {
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

  if (!res.ok) throw new Error(`set field error: ${res.status} ${await res.text()}`);
}

/**
 * Lanza el Salesbot para el lead: POST /api/v4/bots/{id}/run.
 * El Salesbot, ya configurado en Kommo, lee REPLY_FIELD_ID y manda el mensaje
 * al chat usando sus propios permisos internos (no requiere que nuestra
 * integración tenga acceso directo a la Chats API).
 */
async function runSalesbot(subdomain, token, leadId) {
  const url = `https://${subdomain}/api/v4/bots/${SALESBOT_ID}/run`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ entity_id: Number(leadId), entity_type: 'leads' }),
  });

  if (!res.ok) throw new Error(`salesbot run error: ${res.status} ${await res.text()}`);
}

/**
 * Envía la respuesta de la IA al chat de Kommo vía Salesbot:
 * 1. PATCH /api/v4/leads/{leadId} → escribe el mensaje en el campo kommon8n
 * 2. POST /api/v4/bots/{SALESBOT_ID}/run → dispara el Salesbot que lee ese
 *    campo y manda el mensaje al chat.
 *
 * `leadId` es el `entity_id` del lead que Kommo manda en cada webhook
 * (message[add][0][entity_id]).
 */
export async function sendKommoReply(message, leadId, env) {
  if (!leadId) {
    console.warn('[kommo] Falta leadId. Saltando envío.');
    return { ok: false, error: 'leadId vacío' };
  }

  try {
    const subdomain = resolveSubdomain(env);
    const token = await getValidAccessToken(env);

    await setReplyField(subdomain, token, leadId, message);
    await runSalesbot(subdomain, token, leadId);

    console.log(`[kommo] Salesbot ${SALESBOT_ID} lanzado para lead ${leadId}`);
    return { ok: true };
  } catch (error) {
    console.error('[kommo] Fallo:', error);
    return { ok: false, error: String(error) };
  }
}
