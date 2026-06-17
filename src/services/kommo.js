/**
 * Implementación de MD5 en JavaScript puro (requerido porque crypto.subtle.digest('MD5') no está disponible en Cloudflare Workers).
 * Basado en: https://gist.github.com/jbt/2401340
 */
function getMD5(text) {
  var k = [], i = 0;
  for (; i < 64;) k[i] = 0 | Math.abs(Math.sin(++i)) * 4294967296;

  var b, c, d, j,
    x = [],
    str = unescape(encodeURIComponent(text)),
    n = str.length,
    h = [b = 0x67452301, c = 0xefcdab89, ~b, ~c],
    words = [];

  for (i = 0; i <= n; i++) words[i >> 2] |= (str.charCodeAt(i) || 128) << ((i % 4) << 3);
  words[(((n + 8) >> 6) << 4) + 14] = n * 8;

  for (i = 0; i < words.length; i += 16) {
    var a = h;
    for (j = 0; j < 64; j++) {
      a = [
        d = a[3],
        (b = a[1] | 0) + (
          (d = a[0] + [
            b & (c = a[2]) | ~b & d,
            d & b | ~d & c,
            b ^ c ^ d,
            c ^ (b | ~d)
          ][j >> 4] + k[j] + (words[i + [
            j,
            5 * j + 1,
            3 * j + 5,
            7 * j
          ][j >> 4] & 15] | 0)) << (j = [
            7, 12, 17, 22,
            5, 9, 14, 20,
            4, 11, 16, 23,
            6, 10, 15, 21
          ][4 * (j >> 4) + (j & 3)]) | d >>> (32 - j)),
        b,
        c
      ];
    }
    for (j = 0; j < 4; j++) h[j] = h[j] + a[j];
  }

  for (i = 0; i < 4; i++) {
    for (j = 0; j < 4; j++) {
      x.push((h[i] >> (j * 8)) & 255);
    }
  }
  return x.map(function (b) { return ("00" + b.toString(16)).slice(-2); }).join("");
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
  const secret = env.KOMMO_CLIENT_SECRET;
  const subdomain = env.KOMMO_SUBDOMAIN;
  const integrationId = env.KOMMO_INTEGRATION_ID;

  console.log(`KOMMO_CLIENT_SECRET presente: ${Boolean(secret)}`);
  console.log(`KOMMO_SUBDOMAIN presente: ${Boolean(subdomain)}`);
  console.log(`KOMMO_INTEGRATION_ID presente: ${Boolean(integrationId)}`);

  if (!secret || !subdomain || !integrationId) {
    console.warn('[kommo] Faltan variables de entorno para Kommo. Saltando envío.');
    return { ok: false, error: 'Configuración incompleta' };
  }

  const url = `https://${subdomain}.kommo.com/v2/origin/custom/${integrationId}`;
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
  const contentMD5 = getMD5(bodyStr);

  // El path para la firma debe ser relativo: /v2/origin/custom/{scope_id}
  const path = `/v2/origin/custom/${integrationId}`;
  const stringToSign = [method, contentMD5, contentType, date, path].join('\n');
  const signature = await getHMACSHA1(secret, stringToSign);

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
