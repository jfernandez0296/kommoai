import {
	env,
	createExecutionContext,
	waitOnExecutionContext,
	SELF,
} from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { askOpenAI } from "../src/ai/openai.js";
import { askOpenRouter } from "../src/ai/openrouter.js";
import { getValidAccessToken } from "../src/services/kommoAuth.js";
import { shouldHandoff, processUserMessage } from "../src/router.js";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

const originalFetch = globalThis.fetch;

const VALID_KV_TOKEN = JSON.stringify({
	access_token: "oauth-access-token",
	refresh_token: "oauth-refresh-token",
	expires_at: Date.now() + 3_600_000,
});

describe("Worker chatbot endpoint", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	// ── AI provider error handling ──────────────────────────────────────────

	it("reports missing OpenAI secret configuration clearly", async () => {
		await expect(askOpenAI("hola", {} as any)).rejects.toThrow(
			/Falta configurar OPENAI_API_KEY/i,
		);
	});

	it("reports missing OpenRouter secret configuration clearly", async () => {
		await expect(askOpenRouter("hola", {} as any)).rejects.toThrow(
			/Falta configurar OPENROUTER_API_KEY/i,
		);
	});

	// ── shouldHandoff unit tests ────────────────────────────────────────────

	it("detects handoff intent from common keywords", () => {
		expect(shouldHandoff("quiero hablar con un asesor").handoff).toBe(true);
		expect(shouldHandoff("necesito contratar").handoff).toBe(true);
		expect(shouldHandoff("cuanto cuesta").handoff).toBe(true);
	});

	it("does not trigger handoff for normal messages", () => {
		expect(shouldHandoff("hola").handoff).toBe(false);
		expect(shouldHandoff("¿cuál es el horario?").handoff).toBe(false);
		expect(shouldHandoff("me interesa un plan").handoff).toBe(false);
	});

	// ── FAQ rule tests ──────────────────────────────────────────────────────

	it("answers horario question without calling AI", async () => {
		const result = await processUserMessage("¿cuál es el horario de atención?", env, {} as any);
		expect(result.provider).toBe("faq");
		expect(result.reply).toContain("8:00 a.m.");
		expect(result.handoff).toBe(false);
	});

	it("answers como funciona question without calling AI", async () => {
		const result = await processUserMessage("¿cómo funciona el servicio?", env, {} as any);
		expect(result.provider).toBe("faq");
		expect(result.reply).toContain("cocinera");
	});

	it("answers queja question without calling AI", async () => {
		const result = await processUserMessage("quiero poner una queja", env, {} as any);
		expect(result.provider).toBe("faq");
		expect(result.reply).toContain("WhatsApp");
	});

	it("matches FAQ keywords without accents (catalogo, reclamo)", async () => {
		const horario = await processUserMessage("cuando atienden", env, {} as any);
		expect(horario.provider).toBe("faq");

		const reclamo = await processUserMessage("quiero hacer un reclamo", env, {} as any);
		expect(reclamo.provider).toBe("faq");
	});

	// ── Plan keyword detection ──────────────────────────────────────────────

	it("returns reply=plan when user mentions plan keyword", async () => {
		const result = await processUserMessage("me interesa ver los planes", env, {} as any);
		expect(result.reply).toBe("plan");
		expect(result.provider).toBe("system");
	});

	it("matches plan keyword without accent (catalogo)", async () => {
		const result = await processUserMessage("muéstrame el catalogo", env, {} as any);
		expect(result.reply).toBe("plan");
	});

	// ── /debug endpoint ─────────────────────────────────────────────────────

	it("returns Kommo credential status when /debug is accessed", async () => {
		const request = new IncomingRequest("http://example.com/debug", {
			method: "GET"
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
		const data = await response.json();
		expect(data).toHaveProperty("kommo");
		expect(data.kommo).toHaveProperty("hasToken");
		expect(data.kommo).toHaveProperty("tokenLength");
		expect(data.kommo).toHaveProperty("hasIntegrationId");
		expect(data.kommo).toHaveProperty("hasSecret");
	});

	it("blocks /debug when ADMIN_SECRET is set and header is missing", async () => {
		const request = new IncomingRequest("http://example.com/debug", { method: "GET" });
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, { ...env, ADMIN_SECRET: "secret123" }, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(401);
	});

	it("allows /debug when ADMIN_SECRET is set and correct header is sent", async () => {
		const request = new IncomingRequest("http://example.com/debug", {
			method: "GET",
			headers: { Authorization: "Bearer secret123" },
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, { ...env, ADMIN_SECRET: "secret123" }, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
	});

	// ── OAuth endpoints ─────────────────────────────────────────────────────

	it("rejects /oauth/callback without a code", async () => {
		const request = new IncomingRequest("http://example.com/oauth/callback", {
			method: "GET"
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(400);
	});

	it("exchanges the code for tokens and stores them on /oauth/callback", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				access_token: "new-access-token",
				refresh_token: "new-refresh-token",
				expires_in: 86400,
			}),
		}) as unknown as typeof fetch;

		const request = new IncomingRequest("http://example.com/oauth/callback?code=abc123", {
			method: "GET"
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(
			request,
			{ ...env, KOMMO_SUBDOMAIN: "test", KOMMO_INTEGRATION_ID: "i", KOMMO_CLIENT_SECRET: "s" },
			ctx,
		);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		const stored = await env.KOMMO_OAUTH.get("kommo_oauth_tokens");
		expect(JSON.parse(stored!)).toMatchObject({
			access_token: "new-access-token",
			refresh_token: "new-refresh-token",
		});
	});

	// ── getValidAccessToken: token refresh path ─────────────────────────────

	it("refreshes an expired token using the refresh_token", async () => {
		await env.KOMMO_OAUTH.put("kommo_oauth_tokens", JSON.stringify({
			access_token: "expired-token",
			refresh_token: "valid-refresh-token",
			expires_at: Date.now() - 1000, // already expired
		}));

		globalThis.fetch = vi.fn().mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				access_token: "fresh-access-token",
				refresh_token: "new-refresh-token",
				expires_in: 86400,
			}),
		}) as unknown as typeof fetch;

		const token = await getValidAccessToken({
			...env,
			KOMMO_SUBDOMAIN: "test",
			KOMMO_INTEGRATION_ID: "i",
			KOMMO_CLIENT_SECRET: "s",
		});

		expect(token).toBe("fresh-access-token");
		const stored = await env.KOMMO_OAUTH.get("kommo_oauth_tokens");
		expect(JSON.parse(stored!).access_token).toBe("fresh-access-token");
	});

	it("throws a clear error when KV token is corrupted JSON", async () => {
		await env.KOMMO_OAUTH.put("kommo_oauth_tokens", "NOT_VALID_JSON");
		await expect(getValidAccessToken(env)).rejects.toThrow(/corrupto/i);
	});

	// ── /kommo-test endpoint ────────────────────────────────────────────────

	it("returns success on /kommo-test and handles subdomain", async () => {
		await env.KOMMO_OAUTH.put("kommo_oauth_tokens", VALID_KV_TOKEN);

		globalThis.fetch = vi.fn().mockImplementation((url: string) => {
			if (url === "https://test.kommo.com/api/v4/account") {
				return Promise.resolve({
					ok: true,
					json: async () => ({ id: 123, name: "Test Account" }),
				});
			}
			return Promise.reject(new Error("Unexpected URL: " + url));
		}) as unknown as typeof fetch;

		const request = new IncomingRequest("http://example.com/kommo-test", { method: "GET" });
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, { ...env, KOMMO_SUBDOMAIN: "test" }, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data).toMatchObject({ success: true, account: { id: 123, name: "Test Account" } });
	});

	it("returns error on /kommo-test when Kommo API fails", async () => {
		await env.KOMMO_OAUTH.put("kommo_oauth_tokens", VALID_KV_TOKEN);

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 401,
			text: async () => "Unauthorized",
		}) as unknown as typeof fetch;

		const request = new IncomingRequest("http://example.com/kommo-test", { method: "GET" });
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, { ...env, KOMMO_SUBDOMAIN: "test.kommo.com" }, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data).toMatchObject({ success: false, status: 401, error: "Unauthorized" });
	});

	// ── /kommo-send-test endpoint ───────────────────────────────────────────

	it("returns success on /kommo-send-test", async () => {
		await env.KOMMO_OAUTH.put("kommo_oauth_tokens", VALID_KV_TOKEN);

		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, text: async () => "{}" })
			.mockResolvedValueOnce({ ok: true, text: async () => "Accepted" });
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const payload = { conversationId: "12345", message: "hello" };
		const request = new IncomingRequest("http://example.com/kommo-send-test", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(payload)
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, { ...env, KOMMO_SUBDOMAIN: "d" }, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ ok: true });

		const [fieldUrl, fieldInit] = fetchMock.mock.calls[0];
		expect(fieldUrl).toBe("https://d.kommo.com/api/v4/leads/12345");
		expect(fieldInit.method).toBe("PATCH");

		const [botUrl, botInit] = fetchMock.mock.calls[1];
		expect(botUrl).toBe("https://d.kommo.com/api/v4/bots/17570/run");
		expect(JSON.parse(botInit.body)).toMatchObject({ entity_id: 12345, entity_type: "leads" });
	});

	// ── /webhook-test echo endpoint ─────────────────────────────────────────

	it("echoes the body on /webhook-test and saves it to /last-webhook", async () => {
		const payload = { test: "data", foo: "bar" };
		const request = new IncomingRequest("http://example.com/webhook-test", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(payload)
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data).toMatchObject({ success: true, received: payload });
		expect(data.timestamp).toBeDefined();

		const requestLast = new IncomingRequest("http://example.com/last-webhook", { method: "GET" });
		const responseLast = await worker.fetch(requestLast, env, ctx);
		expect(await responseLast.json()).toMatchObject({ lastWebhook: payload });
	});

	// ── Main webhook flow ───────────────────────────────────────────────────

	it("skips outgoing messages to avoid loop", async () => {
		const body = "message[add][0][text]=Hola&message[add][0][entity_id]=99&message[add][0][type]=2";
		const request = new IncomingRequest("http://example.com/webhook", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body,
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ ok: true, skipped: true, reason: "Mensaje saliente ignorado" });
	});

	it("skips processing when botactivo is NO", async () => {
		await env.KOMMO_OAUTH.put("kommo_oauth_tokens", VALID_KV_TOKEN);

		globalThis.fetch = vi.fn().mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				custom_fields_values: [{ field_id: 650774, values: [{ value: "NO" }] }],
			}),
		}) as unknown as typeof fetch;

		const body = "message[add][0][text]=Hola&message[add][0][entity_id]=99&message[add][0][type]=1";
		const request = new IncomingRequest("http://example.com/webhook", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body,
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, { ...env, KOMMO_SUBDOMAIN: "test" }, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ ok: true, skipped: true, reason: "Bot inactivo" });
	});

	it("processes incoming message when botactivo is SI and calls Salesbot", async () => {
		await env.KOMMO_OAUTH.put("kommo_oauth_tokens", VALID_KV_TOKEN);

		const fetchMock = vi.fn()
			// 1. GET lead → botactivo = SI
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					custom_fields_values: [{ field_id: 650774, values: [{ value: "SI" }] }],
				}),
			})
			// 2. OpenAI → AI response
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ choices: [{ message: { content: "Respuesta IA" } }] }),
			})
			// 3. PATCH lead → set kommon8n field
			.mockResolvedValueOnce({ ok: true, text: async () => "{}" })
			// 4. POST bots/run → trigger Salesbot
			.mockResolvedValueOnce({ ok: true, text: async () => "Accepted" });
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const body = "message%5Badd%5D%5B0%5D%5Btext%5D=Hola&message%5Badd%5D%5B0%5D%5Bentity_id%5D=99&message%5Badd%5D%5B0%5D%5Btype%5D=1";
		const request = new IncomingRequest("http://example.com/webhook", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body,
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(
			request,
			{ ...env, KOMMO_SUBDOMAIN: "test", OPENAI_API_KEY: "key" },
			ctx,
		);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ ok: true });
		expect(fetchMock).toHaveBeenCalledTimes(4);

		// Verify call sequence
		expect(fetchMock.mock.calls[0][0]).toContain("/api/v4/leads/99");   // botactivo check
		expect(fetchMock.mock.calls[1][0]).toContain("openai.com");          // AI call
		expect(fetchMock.mock.calls[2][0]).toContain("/api/v4/leads/99");   // set kommon8n
		expect(fetchMock.mock.calls[2][1].method).toBe("PATCH");
		expect(fetchMock.mock.calls[3][0]).toContain("/api/v4/bots/17570/run"); // Salesbot
	});

	it("sets botactivo=NO after handoff intent is detected", async () => {
		await env.KOMMO_OAUTH.put("kommo_oauth_tokens", VALID_KV_TOKEN);

		const fetchMock = vi.fn()
			// 1. GET lead → botactivo = SI
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					custom_fields_values: [{ field_id: 650774, values: [{ value: "SI" }] }],
				}),
			})
			// 2. PATCH lead → set kommon8n (handoff message)
			.mockResolvedValueOnce({ ok: true, text: async () => "{}" })
			// 3. POST bots/run → trigger Salesbot
			.mockResolvedValueOnce({ ok: true, text: async () => "Accepted" })
			// 4. PATCH lead → set botactivo = NO
			.mockResolvedValueOnce({ ok: true, text: async () => "{}" });
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const body = "message%5Badd%5D%5B0%5D%5Btext%5D=quiero+hablar+con+un+asesor&message%5Badd%5D%5B0%5D%5Bentity_id%5D=99&message%5Badd%5D%5B0%5D%5Btype%5D=1";
		const request = new IncomingRequest("http://example.com/webhook", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body,
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(
			request,
			{ ...env, KOMMO_SUBDOMAIN: "test" },
			ctx,
		);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(4);

		// Last call must PATCH botactivo = NO
		const lastCall = fetchMock.mock.calls[3];
		expect(lastCall[0]).toContain("/api/v4/leads/99");
		expect(lastCall[1].method).toBe("PATCH");
		const body4 = JSON.parse(lastCall[1].body);
		expect(body4.custom_fields_values[0]).toMatchObject({
			field_id: 650774,
			values: [{ value: "NO" }],
		});
	});

	// ── /chat endpoint ──────────────────────────────────────────────────────

	it("rejects non-POST requests to the chat endpoint", async () => {
		const request = new IncomingRequest("http://example.com/chat");
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(405);
		expect(await response.json()).toMatchObject({ error: "Only POST /chat is supported" });
	});

	it("returns a chatbot response from OpenAI for valid JSON POST requests", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				choices: [{ message: { content: "Respuesta de OpenAI" } }],
			}),
		}) as unknown as typeof fetch;

		const request = new IncomingRequest("http://example.com/chat", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ message: "hola" }),
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(
			request,
			{ ...env, OPENAI_API_KEY: "openai-key" },
			ctx,
		);
		await waitOnExecutionContext(ctx);

		expect(await response.json()).toMatchObject({
			reply: "Respuesta de OpenAI",
			handoff: false,
			imageUrl: null,
			provider: "openai",
		});
	});

	it("falls back to OpenRouter when OpenAI fails", async () => {
		globalThis.fetch = vi
			.fn()
			.mockResolvedValueOnce({
				ok: false,
				status: 500,
				text: async () => "OpenAI failed",
			})
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					choices: [{ message: { content: "Respuesta de OpenRouter" } }],
				}),
			}) as unknown as typeof fetch;

		const request = new IncomingRequest("http://example.com/chat", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ message: "hola" }),
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(
			request,
			{ ...env, OPENAI_API_KEY: "openai-key", OPENROUTER_API_KEY: "openrouter-key" },
			ctx,
		);
		await waitOnExecutionContext(ctx);

		expect(await response.json()).toMatchObject({
			reply: "Respuesta de OpenRouter",
			handoff: false,
			imageUrl: null,
			provider: "openrouter",
		});
	});

	it("returns a system handoff response when keywords are detected", async () => {
		const request = new IncomingRequest("http://example.com/chat", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ message: "quiero hablar con un asesor" }),
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(await response.json()).toMatchObject({
			reply: "Entendido. Te estoy conectando con un asesor humano para brindarte una atención personalizada. Por favor, aguarda un momento.",
			handoff: true,
			imageUrl: null,
			provider: "system",
		});
	});

	it("returns reply=plan when the user asks for the image/plan", async () => {
		const request = new IncomingRequest("http://example.com/chat", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ message: "muéstrame la imagen" }),
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, { ...env, OPENAI_API_KEY: "openai-key" }, ctx);
		await waitOnExecutionContext(ctx);

		expect(await response.json()).toMatchObject({
			reply: "plan",
			handoff: false,
			imageUrl:
				"https://pub-bc555ff3adc049a0afda1bac19d846ea.r2.dev/Gemini_Generated_Image_5u2ryk5u2ryk5u2r%20(1).png",
			provider: "system"
		});
	});

	it("uses OpenRouter when OpenAI is not configured", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				choices: [{ message: { content: "Respuesta de OpenRouter" } }],
			}),
		}) as unknown as typeof fetch;

		const request = new IncomingRequest("http://example.com/chat", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ message: "hola" }),
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(
			request,
			{ ...env, OPENROUTER_API_KEY: "openrouter-key" },
			ctx,
		);
		await waitOnExecutionContext(ctx);

		expect(await response.json()).toMatchObject({
			reply: "Respuesta de OpenRouter",
			handoff: false,
			imageUrl: null,
			provider: "openrouter",
		});
	});
});
