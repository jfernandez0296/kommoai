/**
 * Genera el hash MD5 de un texto en minúsculas (requerido por Kommo).
 */
async function getMD5(text) {
  const msgUint8 = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('MD5', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Genera la firma HMAC-SHA1 (requerida por Kommo).
 */
async function getHMACSHA1(key, message) {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(key);
  const messageData = encoder.encode(message);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
  const hashArray = Array.from(new Uint8Array(signature));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Envía una respuesta a Kommo a través de su API de Canales Propios (Custom Channels).
 */
export async function sendKommoReply(message, conversationId, env) {
  const { KOMMO_SECRET, KOMMO_DOMAIN, KOMMO_SCOPE_ID } = env;

  if (!KOMMO_SECRET || !KOMMO_DOMAIN || !KOMMO_SCOPE_ID) {
    console.warn('[kommo] Faltan variables de entorno para Kommo. Saltando envío.');
    return { ok: false, error: 'Configuración incompleta' };
  }

  const url = `https://${KOMMO_DOMAIN}.kommo.com/v2/origin/custom/${KOMMO_SCOPE_ID}`;
  const method = 'POST';
  const contentType = 'application/json';
  const date = new Date().toUTCString().replace('GMT', '+0000'); // Formato RFC2822

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
  const contentMD5 = await getMD5(bodyStr);

  // El path para la firma debe ser relativo: /v2/origin/custom/{scope_id}
  const path = `/v2/origin/custom/${KOMMO_SCOPE_ID}`;
  const stringToSign = [method, contentMD5, contentType, date, path].join('\n');
  const signature = await getHMACSHA1(KOMMO_SECRET, stringToSign);

  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': contentType,
      Date: date,
      'Content-MD5': contentMD5,
      'X-Signature': signature,
    },
    body: bodyStr,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[kommo] Error al enviar mensaje (${response.status}):`, errorText);
    return { ok: false, status: response.status, details: errorText };
  }

  return { ok: true };
}
