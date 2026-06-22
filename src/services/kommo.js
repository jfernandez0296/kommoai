/**
 * Obtiene el amojo_id de la cuenta Kommo (ID del servicio de chats).
 * Este valor es estático por cuenta, pero lo fetchemamos en runtime
 * para no hardcodearlo.
 */
async function getAmojoId(subdomain, token) {
  const res = await fetch(`https://${subdomain}/api/v4/account`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`No se pudo obtener account info: ${res.status}`);
  }
  const data = await res.json();
  const amojoId = data?.amojo_id;
  if (!amojoId) throw new Error('amojo_id no encontrado en la respuesta de /api/v4/account');
  return amojoId;
}

/**
 * Envía un mensaje de respuesta al chat de WhatsApp vía Kommo Chat API.
 * Endpoint: POST https://amojo.kommo.com/v1/chats/{amojo_id}/{chat_id}/messages
 */
export async function sendKommoReply(message, chatId, env) {
  const token = env.KOMMO_ACCESS_TOKEN;
  const rawSubdomain = env.KOMMO_SUBDOMAIN;

  if (!token || !rawSubdomain || !chatId) {
    console.warn('[kommo] Faltan variables o chatId. Saltando envío.');
    return { ok: false, error: 'Configuración incompleta o chatId vacío' };
  }

  const subdomain = rawSubdomain
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');

  try {
    // 1) Obtener amojo_id de la cuenta
    const amojoId = await getAmojoId(subdomain, token);
    console.log(`[kommo] amojo_id: ${amojoId}, chatId: ${chatId}`);

    // 2) Enviar mensaje al chat
    const url = `https://amojo.kommo.com/v1/chats/${amojoId}/${chatId}/messages`;
    console.log(`[kommo] URL: ${url}`);

    const body = JSON.stringify({
      text: message,
      type: 'text',
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Token': token,
      },
      body,
    });

    const responseText = await response.text();
    console.log(`[kommo] status: ${response.status}, body: ${responseText}`);

    if (!response.ok) {
      console.error(`[kommo] Error al enviar (${response.status}):`, responseText);
      return { ok: false, status: response.status, details: responseText };
    }

    return { ok: true };
  } catch (error) {
    console.error('[kommo] Fallo:', error);
    return { ok: false, error: String(error) };
  }
}
