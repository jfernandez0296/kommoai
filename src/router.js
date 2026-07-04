import { BUSINESS_DATA, BUSINESS } from './constants/businessData.js';
import { chatWithFallback } from './ai/aiProvider.js';
import { removeAccents } from './utils/helpers.js';

export function shouldHandoff(text) {
  // Normalizamos el texto: minúsculas y sin acentos.
  const normalized = removeAccents(text.toLowerCase());

  const keywords = [
    'asesor',
    'humano',
    'persona',
    'agente',
    'llamar',
    'contactar',
    'comprar',
    'contratar',
    'hablar con alguien',
    'ayuda',
    'soporte',
    'asistencia',
    'reclamacion',
    'queja',
    'costo',
    'precio',
    'cuanto cuesta',
    'informacion',
  ];

  const matched = keywords.some((kw) => normalized.includes(removeAccents(kw)));

  if (matched) {
    return { handoff: true, reason: 'intent_handoff' };
  }

  return { handoff: false, reason: null };
}

export function routeRequest(pathname, request = {}) {
  const contentType = request?.headers?.get?.('content-type') || '';

  // Ruta de webhook no usada por el chatbot principal, pero se mantiene por compatibilidad.
  if (pathname.startsWith('/webhook')) {
    return { handler: 'webhook', reason: 'Kommo webhook' };
  }

  // Si el cliente manda una imagen, se identifica aquí para no pasarla a la IA.
  if (contentType.includes('image/')) {
    return { handler: 'image', reason: 'Image input' };
  }

  // Endpoint principal del chatbot.
  if (pathname.startsWith('/chat')) {
    return { handler: 'chat', reason: 'Chatbot request' };
  }

  return { handler: 'default', reason: 'Fallback response' };
}

export async function processUserMessage(message, env, ctx) {
  const text = String(message || '').trim();

  // 1. Verificamos intención de derivación (Reglas estrictas)
  const handoffCheck = shouldHandoff(text);
  if (handoffCheck.handoff) {
    return {
      reply: 'Entendido. Te estoy conectando con un asesor humano para brindarte una atención personalizada. Por favor, aguarda un momento.',
      handoff: true,
      imageUrl: null,
      provider: 'system',
    };
  }

  // Si el usuario pregunta por los planes, escribimos "plan" en el campo de Kommo
  // para que el Salesbot procese y envíe la información de planes al chat.
  const lowerText = text.toLowerCase();
  if (
    lowerText.includes("plan") ||
    lowerText.includes("imagen") ||
    lowerText.includes("foto") ||
    lowerText.includes("catálogo") ||
    lowerText.includes("muestrame") ||
    lowerText.includes("muéstrame")
  ) {
    return {
      reply: "plan",
      handoff: false,
      imageUrl: BUSINESS.images.planGeneral,
      provider: "system"
    };
  }

  // En cualquier otro caso, delegamos al proveedor IA con fallback.
  return chatWithFallback(text, env);
}
