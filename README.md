# Kommo AI Chatbot - Cloudflare Worker

Este repositorio contiene el código fuente de un chatbot inteligente implementado como un **Cloudflare Worker**. El bot está diseñado para integrarse con **Kommo CRM** (anteriormente AmoCRM) para automatizar la atención al cliente de un servicio de cocineras a domicilio.

## 🏗 Arquitectura del Proyecto

El proyecto sigue una estructura modular para facilitar el mantenimiento y la extensibilidad:

- `src/index.js`: Punto de entrada (Fetch Handler). Gestiona el enrutamiento inicial, CORS, sanitización de entrada y endpoints de diagnóstico.
- `src/router.js`: Cerebro del flujo de mensajes. Decide si una consulta debe ser manejada por el sistema (imágenes, derivación humana) o por la IA.
- `src/ai/`: Capa de integración con modelos de lenguaje.
  - `aiProvider.js`: Orquestador con lógica de fallback (OpenAI -> OpenRouter).
  - `openai.js`: Integración directa con la API de OpenAI.
  - `openrouter.js`: Fallback que utiliza OpenRouter.
  - `systemPrompt.js`: Generación dinámica del prompt del sistema inyectando datos del negocio.
- `src/services/kommo.js`: Cliente para la API de Canales Propios de Kommo. Incluye lógica de firmas HMAC-SHA1 y hashing MD5.
- `src/constants/businessData.js`: Configuración estática y dinámica del negocio (marca, horarios, cobertura, imágenes).
- `src/utils/helpers.js`: Utilidades para normalización de texto, remoción de acentos y sanitización.
- `src/config.js`: Mapeo centralizado de variables de entorno y constantes de configuración.

## 🚀 Endpoints Principales

### `POST /chat`
Endpoint principal del chatbot.
- **Entrada**: JSON con `{ "message": "...", "conversation_id": "..." }`.
- **Lógica**:
  1. Sanitiza el mensaje.
  2. Verifica intención de derivación humana (`shouldHandoff`).
  3. Verifica si el usuario pide imágenes de planes.
  4. Si no aplica lo anterior, consulta a la IA.
  5. Envía la respuesta de vuelta a Kommo de forma asíncrona (`ctx.waitUntil`).

### `GET /debug`
Devuelve el estado de las credenciales de Kommo (presencia y longitud del token) sin exponer valores sensibles.

### `GET /kommo-test`
Prueba de conectividad real con la API de Kommo solicitando información de la cuenta.

### `POST /webhook-test`
Endpoint de diagnóstico que registra (`console.log`) y devuelve el cuerpo recibido, almacenándolo en una variable temporal `LAST_WEBHOOK`.

### `GET /last-webhook`
Recupera el último payload recibido por `/webhook-test`.

## 🤖 Lógica de Negocio y IA

- **Proveedor Principal**: OpenAI (Modelo por defecto: `gpt-4o-mini`).
- **Fallback**: OpenRouter (si OpenAI falla).
- **Derivación Humana**: Sistema determinístico basado en palabras clave (asesor, humano, ayuda, queja, etc.) procesadas con normalización de acentos.
- **Imágenes**: Respuestas automáticas para palabras clave como "plan", "catálogo" o "foto", enviando una URL estática de los planes.

## ⚙️ Configuración (Variables de Entorno)

El Worker espera las siguientes variables (Secrets en Cloudflare):

- `OPENAI_API_KEY`: Clave de API de OpenAI.
- `OPENROUTER_API_KEY`: Clave de API de OpenRouter (fallback).
- `KOMMO_SUBDOMAIN`: Subdominio de la cuenta de Kommo (ej: `empresa` o `empresa.kommo.com`).
- `KOMMO_ACCESS_TOKEN`: Token de acceso de larga duración.
- `KOMMO_INTEGRATION_ID`: ID del canal de chat propio.
- `KOMMO_CLIENT_SECRET`: Secreto de la integración para firmas digitales.

## 🛠 Desarrollo y Pruebas

- **Local**: Utilizar `wrangler dev` con un archivo `.dev.vars`.
- **Tests**: Ejecutar `npm test`. Utiliza **Vitest** con el pool de Cloudflare Workers para simular el entorno de ejecución real.
- **Sanitización**: Los mensajes de entrada se limitan a 1000 caracteres y se limpian de etiquetas HTML.

## 🔐 Seguridad y CORS

- Implementa cabeceras CORS (`Access-Control-Allow-Origin: *`) en todos los endpoints.
- Valida la existencia de firmas y claves antes de procesar peticiones críticas.
- Uso riguroso de `env` object en lugar de `process.env`.
