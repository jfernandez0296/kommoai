import { BUSINESS_DATA, BUSINESS } from './constants/businessData.js';
import { chatWithFallback } from './ai/aiProvider.js';

export function shouldHandoff(text) {
  const keywords = [
    'asesor',
    'humano',
    'persona',
    'agente',
    'llamar',
    'contactar',
    'quiero comprar',
    'quiero contratar',
    'hablar con alguien',
  ];

  const matched = keywords.some((kw) => text.includes(kw));

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

export async function processUserMessage(message, env) {
  const text = String(message || '').trim().toLowerCase();

  // 1. Verificamos intención de derivación (Reglas estrictas)
  const handoffCheck = shouldHandoff(text);
  if (handoffCheck.handoff) {
    return {
      reply: 'Perfecto, te voy a derivar con un asesor para ayudarte.',
      handoff: true,
      imageUrl: null,
      provider: 'system',
    };
  }

  // Si el usuario pide una imagen, devolvemos la respuesta visual sin llamar a la IA.
  if (
    text.includes("plan") ||
    text.includes("imagen") ||
    text.includes("foto") ||
    text.includes("catálogo") ||
    text.includes("muestrame") ||
    text.includes("muéstrame")
  ) {
    return {
      reply: "Te comparto la imagen de nuestros planes.",
      handoff: false,
      imageUrl: BUSINESS.images.planGeneral,
      provider: "system"
    };
  }

  // En cualquier otro caso, delegamos al proveedor IA con fallback.
  return chatWithFallback(text, env);
}
