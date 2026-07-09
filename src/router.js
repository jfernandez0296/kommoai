import { BUSINESS_DATA } from './constants/businessData.js';
import { chatWithFallback } from './ai/aiProvider.js';
import { removeAccents } from './utils/helpers.js';

export function shouldHandoff(text) {
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
    'costo',
    'precio',
    'cuanto cuesta',
    'informacion',
  ];

  const matched = keywords.some((kw) => normalized.includes(removeAccents(kw)));
  if (matched) return { handoff: true, reason: 'intent_handoff' };
  return { handoff: false, reason: null };
}

const FAQ_RULES = [
  {
    keywords: ['horario', 'hora de atencion', 'atienden', 'abren', 'cierran', 'cuando atienden'],
    reply: 'Nuestro horario de atención es de 8:00 a.m. a 8:00 p.m. Si nos escribes fuera de ese horario, déjanos tu mensaje y te respondemos en cuanto estemos disponibles.',
  },
  {
    keywords: ['como funciona', 'como trabajan', 'forma de trabajar', 'como trabaja', 'proceso', 'funcionamiento', 'como es el servicio'],
    reply: 'Es muy sencillo: coordinamos contigo el día y el horario, y te enviamos a una cocinera profesional a tu domicilio para que prepare tus comidas según el plan que elegiste, en la comodidad de tu hogar.',
  },
  {
    keywords: ['queja', 'reclamo', 'quejarme', 'reclamar', 'inconveniente', 'insatisfecho', 'problema con el servicio'],
    reply: 'Si tienes alguna queja o reclamo, escríbenos directamente aquí por WhatsApp y un asesor te atenderá a la brevedad para resolver tu situación.',
  },
];

function checkFAQ(text) {
  const normalized = removeAccents(text.toLowerCase());
  for (const rule of FAQ_RULES) {
    if (rule.keywords.some((kw) => normalized.includes(removeAccents(kw)))) {
      return { reply: rule.reply, handoff: false, imageUrl: null, provider: 'faq' };
    }
  }
  return null;
}

const PLAN_KEYWORDS = ['plan', 'imagen', 'foto', 'catalogo', 'muestrame'];

export async function processUserMessage(message, env, ctx) {
  const text = String(message || '').trim();

  // 1. Preguntas frecuentes: respuesta fija sin llamar a la IA
  const faqMatch = checkFAQ(text);
  if (faqMatch) return faqMatch;

  // 2. Intención de derivación a humano
  const handoffCheck = shouldHandoff(text);
  if (handoffCheck.handoff) {
    return {
      reply: 'Entendido. Te estoy conectando con un asesor humano para brindarte una atención personalizada. Por favor, aguarda un momento.',
      handoff: true,
      imageUrl: null,
      provider: 'system',
    };
  }

  // 3. Pregunta por planes: escribimos "plan" en el campo de Kommo
  const normalized = removeAccents(text.toLowerCase());
  if (PLAN_KEYWORDS.some((kw) => normalized.includes(kw))) {
    return {
      reply: 'plan',
      handoff: false,
      imageUrl: BUSINESS_DATA.images.planGeneral,
      provider: 'system',
    };
  }

  // 4. Llamada a la IA
  return chatWithFallback(text, env);
}
