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

async function getMD5(str) {
  // Implementación MD5 pura en JS
  function safeAdd(x,y){const l=(x&0xffff)+(y&0xffff);return((x>>16)+(y>>16)+(l>>16))<<16|l&0xffff}
  function rol(n,c){return n<<c|n>>>32-c}
  function cmn(q,a,b,x,s,t){return safeAdd(rol(safeAdd(safeAdd(a,q),safeAdd(x,t)),s),b)}
  function ff(a,b,c,d,x,s,t){return cmn(b&c|~b&d,a,b,x,s,t)}
  function gg(a,b,c,d,x,s,t){return cmn(b&d|c&~d,a,b,x,s,t)}
  function hh(a,b,c,d,x,s,t){return cmn(b^c^d,a,b,x,s,t)}
  function ii(a,b,c,d,x,s,t){return cmn(c^(b|~d),a,b,x,s,t)}
  function rhex(n){let s='';for(let j=0;j<4;j++)s+='0123456789abcdef'[n>>j*8+4&0xf]+'0123456789abcdef'[n>>j*8&0xf];return s}

  const utf8 = unescape(encodeURIComponent(str));
  const n = utf8.length;
  const state = new Array(Math.ceil((n+8)/64)*16+2).fill(0);
  for(let i=0;i<n;i++) state[i>>2]|=utf8.charCodeAt(i)<<(i%4)*8;
  state[n>>2]|=0x80<<(n%4)*8;
  state[state.length-2]=n*8;

  let a=1732584193,b=-271733879,c=-1732584194,d=271733878;
  for(let i=0;i<state.length-1;i+=16){
    const [oa,ob,oc,od]=[a,b,c,d];
    a=ff(a,b,c,d,state[i+0],7,-680876936);d=ff(d,a,b,c,state[i+1],12,-389564586);c=ff(c,d,a,b,state[i+2],17,606105819);b=ff(b,c,d,a,state[i+3],22,-1044525330);
    a=ff(a,b,c,d,state[i+4],7,-176418897);d=ff(d,a,b,c,state[i+5],12,1200080426);c=ff(c,d,a,b,state[i+6],17,-1473231341);b=ff(b,c,d,a,state[i+7],22,-45705983);
    a=ff(a,b,c,d,state[i+8],7,1770035416);d=ff(d,a,b,c,state[i+9],12,-1958414417);c=ff(c,d,a,b,state[i+10],17,-42063);b=ff(b,c,d,a,state[i+11],22,-1990404162);
    a=ff(a,b,c,d,state[i+12],7,1804603682);d=ff(d,a,b,c,state[i+13],12,-40341101);c=ff(c,d,a,b,state[i+14],17,-1502002290);b=ff(b,c,d,a,state[i+15],22,1236535329);
    a=gg(a,b,c,d,state[i+1],5,-165796510);d=gg(d,a,b,c,state[i+6],9,-1069501632);c=gg(c,d,a,b,state[i+11],14,643717713);b=gg(b,c,d,a,state[i+0],20,-373897302);
    a=gg(a,b,c,d,state[i+5],5,-701558691);d=gg(d,a,b,c,state[i+10],9,38016083);c=gg(c,d,a,b,state[i+15],14,-660478335);b=gg(b,c,d,a,state[i+4],20,-405537848);
    a=gg(a,b,c,d,state[i+9],5,568446438);d=gg(d,a,b,c,state[i+14],9,-1019803690);c=gg(c,d,a,b,state[i+3],14,-187363961);b=gg(b,c,d,a,state[i+8],20,1163531501);
    a=gg(a,b,c,d,state[i+13],5,-1444681467);d=gg(d,a,b,c,state[i+2],9,-51403784);c=gg(c,d,a,b,state[i+7],14,1735328473);b=gg(b,c,d,a,state[i+12],20,-1926607734);
    a=hh(a,b,c,d,state[i+5],4,-378558);d=hh(d,a,b,c,state[i+8],11,-2022574463);c=hh(c,d,a,b,state[i+11],16,1839030562);b=hh(b,c,d,a,state[i+14],23,-35309556);
    a=hh(a,b,c,d,state[i+1],4,-1530992060);d=hh(d,a,b,c,state[i+4],11,1272893353);c=hh(c,d,a,b,state[i+7],16,-155497632);b=hh(b,c,d,a,state[i+10],23,-1094730640);
    a=hh(a,b,c,d,state[i+13],4,681279174);d=hh(d,a,b,c,state[i+0],11,-358537222);c=hh(c,d,a,b,state[i+3],16,-722521979);b=hh(b,c,d,a,state[i+6],23,76029189);
    a=hh(a,b,c,d,state[i+9],4,-640364487);d=hh(d,a,b,c,state[i+12],11,-421815835);c=hh(c,d,a,b,state[i+15],16,530742520);b=hh(b,c,d,a,state[i+2],23,-995338651);
    a=ii(a,b,c,d,state[i+0],6,-198630844);d=ii(d,a,b,c,state[i+7],10,1126891415);c=ii(c,d,a,b,state[i+14],15,-1416354905);b=ii(b,c,d,a,state[i+5],21,-57434055);
    a=ii(a,b,c,d,state[i+12],6,1700485571);d=ii(d,a,b,c,state[i+3],10,-1894986606);c=ii(c,d,a,b,state[i+10],15,-1051523);b=ii(b,c,d,a,state[i+1],21,-2054922799);
    a=ii(a,b,c,d,state[i+8],6,1873313359);d=ii(d,a,b,c,state[i+15],10,-30611744);c=ii(c,d,a,b,state[i+6],15,-1560198380);b=ii(b,c,d,a,state[i+13],21,1309151649);
    a=ii(a,b,c,d,state[i+4],6,-145523070);d=ii(d,a,b,c,state[i+11],10,-1120210379);c=ii(c,d,a,b,state[i+2],15,718787259);b=ii(b,c,d,a,state[i+9],21,-343485551);
    a=safeAdd(a,oa);b=safeAdd(b,ob);c=safeAdd(c,oc);d=safeAdd(d,od);
  }
  return rhex(a)+rhex(b)+rhex(c)+rhex(d);
}

/**
 * Envía mensaje a Kommo via Custom Channel API (v2/origin/custom).
 * Autenticación: HMAC-SHA1 firmado con client_secret.
 * scope_id = integration_id + "_" + amojo_id
 */
export async function sendKommoReply(message, chatId, env) {
  const token = env.KOMMO_ACCESS_TOKEN;
  const clientSecret = env.KOMMO_CLIENT_SECRET;
  const integrationId = env.KOMMO_INTEGRATION_ID;
  const rawSubdomain = env.KOMMO_SUBDOMAIN;

  if (!token || !rawSubdomain || !chatId || !clientSecret || !integrationId) {
    console.warn('[kommo] Faltan variables. Saltando envío.');
    return { ok: false, error: 'Configuración incompleta' };
  }

  const subdomain = rawSubdomain.replace(/^https?:\/\//, '').replace(/\/$/, '');

  try {
    // 1) Obtener amojo_id
    const accountRes = await fetch(`https://${subdomain}/api/v4/account?with=amojo_id`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!accountRes.ok) throw new Error(`account info: ${accountRes.status}`);
    const accountData = await accountRes.json();
    const amojoId = accountData?.amojo_id;
    if (!amojoId) throw new Error('amojo_id no encontrado');

    // 2) scope_id = integration_id + "_" + amojo_id
    const scopeId = `${integrationId}_${amojoId}`;
    console.log(`[kommo] scopeId: ${scopeId}`);

    // 3) Construir body
    const bodyObj = {
      event_type: 'new_message',
      payload: {
        timestamp: Math.floor(Date.now() / 1000),
        msgid: crypto.randomUUID(),
        conversation_id: chatId,
        sender: { id: 'bot', name: 'Asistente AI' },
        message: { type: 'text', text: message },
      },
    };
    const bodyStr = JSON.stringify(bodyObj);

    // 4) Headers requeridos por Kommo
    const date = new Date().toUTCString();
    const contentType = 'application/json';
    const contentMD5 = await getMD5(bodyStr);

    // 5) HMAC-SHA1: METHOD\nCONTENT-MD5\nCONTENT-TYPE\nDATE\nPATH
    const path = `/v2/origin/custom/${scopeId}`;
    const stringToSign = ['POST', contentMD5, contentType, date, path].join('\n');
    const signature = await getHMACSHA1(clientSecret, stringToSign);

    console.log(`[kommo] path: ${path}`);
    console.log(`[kommo] contentMD5: ${contentMD5}`);
    console.log(`[kommo] signature: ${signature}`);

    const url = `https://amojo.kommo.com${path}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        'Date': date,
        'Content-MD5': contentMD5,
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
