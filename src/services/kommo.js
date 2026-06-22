/**
 * Genera firma HMAC-SHA1 para amojo.kommo.com
 */
async function hmacSHA1(secret, message) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Obtiene amojo_id de la cuenta via /api/v4/account
 */
async function getAmojoId(subdomain, token) {
  const domain = subdomain.includes('amocrm.com') ? subdomain :
                 subdomain.replace('kommo.com', 'amocrm.com');
  const res = await fetch(`https://${domain}/api/v4/account?with=amojo_id`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`account info error: ${res.status}`);
  const data = await res.json();
  if (!data?.amojo_id) throw new Error('amojo_id no encontrado');
  return data.amojo_id;
}

/**
 * Envía mensaje de respuesta vía Kommo Custom Channel API (amojo).
 * 
 * scope_id = {integration_id}_{amojo_id}
 * Autenticación: X-Signature (HMAC-SHA1 del body con client_secret)
 * Fecha: RFC 2822 con +0000
 */
export async function sendKommoReply(message, conversationId, env) {
  const token = env.KOMMO_ACCESS_TOKEN;
  const rawSubdomain = env.KOMMO_SUBDOMAIN;
  const integrationId = env.KOMMO_INTEGRATION_ID;   // ID de la integración (KOMMO WORKER)
  const clientSecret = env.KOMMO_CLIENT_SECRET;      // Clave secreta de la integración

  if (!token || !rawSubdomain || !integrationId || !clientSecret || !conversationId) {
    console.warn('[kommo] Faltan variables de entorno o conversationId.');
    return { ok: false, error: 'Configuración incompleta' };
  }

  const subdomain = rawSubdomain.replace(/^https?:\/\//, '').replace(/\/$/, '');

  try {
    // 1) Obtener amojo_id
    const amojoId = await getAmojoId(subdomain, token);
    console.log(`[kommo] amojo_id: ${amojoId}`);

    // 2) Construir scope_id y body
    const scopeId = `${integrationId}_${amojoId}`;
    const bodyObj = {
      event_type: 'new_message',
      payload: {
        timestamp: Math.floor(Date.now() / 1000),
        msgid: crypto.randomUUID(),
        conversation_id: conversationId,
        sender: { id: 'bot', name: 'Asistente AI' },
        message: { type: 'text', text: message },
      },
    };
    const bodyStr = JSON.stringify(bodyObj);

    // 3) Headers con firma
    const date = new Date().toUTCString().replace('GMT', '+0000');
    const contentType = 'application/json';
    const path = `/v2/origin/custom/${scopeId}`;
    const stringToSign = ['POST', '', contentType, date, path].join('\n');
    const signature = await hmacSHA1(clientSecret, stringToSign);

    const url = `https://amojo.kommo.com${path}`;
    console.log(`[kommo] URL: ${url}`);
    console.log(`[kommo] stringToSign: ${JSON.stringify(stringToSign)}`);

    // 4) Enviar
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        'Date': date,
        'X-Signature': signature,
      },
      body: bodyStr,
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
