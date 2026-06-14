import { BUSINESS_DATA } from './constants/businessData.js';
import { chatWithFallback } from './ai/aiProvider.js';

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
  const text = String(message || '').trim();

  // Si el usuario pide una imagen, devolvemos la respuesta visual sin llamar a la IA.
  if (/imagen/i.test(text)) {
    return {
      reply: 'Te comparto la imagen del plan.',
      handoff: false,
      imageUrl: BUSINESS_DATA.plansImageUrl,
    };
  }

  // En cualquier otro caso, delegamos al proveedor IA con fallback.
  return chatWithFallback(text, env);
}
