/**
 * Obtiene el amojo_id de la cuenta Kommo.
 * Requiere ?with=amojo_id y el dominio amocrm.com
 */
async function getAmojoId(subdomain, token) {
  // Kommo usa amocrm.com para la API, no kommo.com
  const domain = subdomain.includes('amocrm.com') ? subdomain : 
                 subdomain.replace('kommo.com', 'amocrm.com');
  
  const res = await fetch(`https://${domain}/api/v4/account?with=amojo_id`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`account info error: ${res.status}`);
  const data = await res.json();
  const amojoId = data?.amojo_id;
  if (!amojoId) throw new Error('amojo_id no encontrado');
  return amojoId;
}

/**
 * Envía mensaje de respuesta vía Kommo Chat API.
 * POST https://amojo.kommo.com/v1/chats/{amojo_id}/{chat_id}/messages
 */
export async function sendKommoReply(message, chatId, env) {
  const token = env.KOMMO_ACCESS_TOKEN;
  const rawSubdomain = env.KOMMO_SUBDOMAIN;

  if (!token || !rawSubdomain || !chatId) {
    console.warn('[kommo] Faltan variables o chatId.');
    return { ok: false, error: 'Configuración incompleta' };
  }

  const subdomain = rawSubdomain
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');

  try {
    const amojoId = await getAmojoId(subdomain, token);
    console.log(`[kommo] amojo_id: ${amojoId}, chatId: ${chatId}`);

    const url = `https://amojo.kommo.com/v1/chats/${amojoId}/${chatId}/messages`;
    console.log(`[kommo] URL: ${url}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Token': token,
      },
      body: JSON.stringify({ text: message, type: 'text' }),
    });

    const responseText = await response.text();
    console.log(`[kommo] status: ${response.status}, body: ${responseText}`);

    if (!response.ok) {
      return { ok: false, status: response.status, details: responseText };
    }

    return { ok: true };
  } catch (error) {
    console.error('[kommo] Fallo:', error);
    return { ok: false, error: String(error) };
  }
}
