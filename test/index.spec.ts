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

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

const originalFetch = globalThis.fetch;

describe("Worker chatbot endpoint", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

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
			handoff: true,
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
			reply: "Perfecto, te voy a derivar con un asesor para ayudarte.",
			handoff: true,
			imageUrl: null,
			provider: "system",
		});
	});

	it("returns the image plan reply when the user asks for an image", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				choices: [{ message: { content: "Respuesta de OpenAI" } }],
			}),
		}) as unknown as typeof fetch;

		const request = new IncomingRequest("http://example.com/chat", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ message: "muéstrame la imagen" }),
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(
			request,
			{ ...env, OPENAI_API_KEY: "openai-key" },
			ctx,
		);
		await waitOnExecutionContext(ctx);

		expect(await response.json()).toMatchObject({
			reply: "Te comparto la imagen de nuestros planes.",
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
			handoff: true,
			imageUrl: null,
			provider: "openrouter",
		});
	});
});
