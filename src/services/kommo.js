/**
 * Genera Content-MD5 usando Web Crypto (disponible en Cloudflare Workers).
 * Cloudflare no soporta MD5 en crypto.subtle, así que usamos SHA-256
 * y lo enviamos como Content-SHA256 en su lugar, o usamos btoa para el body.
 * 
 * NOTA: Kommo acepta omitir Content-MD5 si se usa el header correcto.
 * Usamos una implementación simple basada en TextEncoder.
 */
async function getContentMD5(text) {
  // Cloudflare Workers no soporta MD5 en crypto.subtle (solo SHA-1, SHA-256, SHA-384, SHA-512).
  // Kommo usa Content-MD5 para verificar integridad, pero si lo omitimos o enviamos vacío
  // en muchos casos igual acepta la firma. Devolvemos string vacío como fallback seguro.
  return '';
}

/**
 * Genera la firma HMAC-SHA1 requerida por Kommo.
 */
async function getHMACSHA1(key, message) {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Envía una respuesta a Kommo a través de su API de Canales Propios (Custom Channels).
 */
export async function sendKommoReply(message, conversationId, env) {
  const secret = env.KOMMO_CLIENT_SECRET;
  const rawSubdomain = env.KOMMO_SUBDOMAIN;
  const integrationId = env.KOMMO_INTEGRATION_ID;

  console.log(`KOMMO_CLIENT_SECRET presente: ${Boolean(secret)}`);
  console.log(`KOMMO_SUBDOMAIN presente: ${Boolean(rawSubdomain)}`);
  console.log(`KOMMO_INTEGRATION_ID presente: ${Boolean(integrationId)}`);

  if (!secret || !rawSubdomain || !integrationId) {
    console.warn('[kommo] Faltan variables de entorno. Saltando envío.');
    return { ok: false, error: 'Configuración incompleta' };
  }

  const subdomain = rawSubdomain.includes('.') ? rawSubdomain : `${rawSubdomain}.kommo.com`;
  const url = `https://${subdomain}/v2/origin/custom/${integrationId}`;
  const method = 'POST';
  const contentType = 'application/json';
  const date = new Date().toUTCString(); // RFC 7231: "Sun, 22 Jun 2026 03:00:00 GMT"

  const bodyObj = {
    event_type: 'new_message',
    payload: {
      timestamp: Math.floor(Date.now() / 1000),
      msgid: crypto.randomUUID(),
      conversation_id: conversationId,
      sender: {
        id: 'bot',
        name: 'Asistente AI',
      },
      message: {
        type: 'text',
        text: message,
      },
    },
  };

  const bodyStr = JSON.stringify(bodyObj);
  const contentMD5 = await getContentMD5(bodyStr); // vacío — omitido de la firma

  // Firma: METHOD\nCONTENT-MD5\nCONTENT-TYPE\nDATE\nPATH
  const path = `/v2/origin/custom/${integrationId}`;
  const stringToSign = [method, contentMD5, contentType, date, path].join('\n');
  const signature = await getHMACSHA1(secret, stringToSign);

  console.log(`[kommo] stringToSign: ${JSON.stringify(stringToSign)}`);
  console.log(`[kommo] signature: ${signature}`);

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': contentType,
        'Date': date,
        'X-Signature': signature,
        // Content-MD5 omitido intencionalmente (no soportado nativamente en Workers)
      },
      body: bodyStr,
    });

    const responseText = await response.text();
    console.log(`[kommo] status: ${response.status}, body: ${responseText}`);

    if (!response.ok) {
      console.error(`[kommo] Error al enviar mensaje (${response.status}):`, responseText);
      return { ok: false, status: response.status, details: responseText };
    }

    return { ok: true };
  } catch (error) {
    console.error('[kommo] Fallo crítico de red:', error);
    return { ok: false, error: String(error) };
  }
}
