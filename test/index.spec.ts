import {
	env,
	createExecutionContext,
	waitOnExecutionContext,
	SELF,
} from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { askGemini } from "../src/ai/gemini.js";
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

	it("reports missing Gemini secret configuration clearly", async () => {
		await expect(askGemini("hola", {} as any)).rejects.toThrow(
			/Falta configurar GEMINI_API_KEY/i,
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

	it("returns a chatbot response from Gemini for valid JSON POST requests", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				candidates: [{ content: { parts: [{ text: "Respuesta de Gemini" }] } }],
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
			{ ...env, GEMINI_API_KEY: "gemini-key" },
			ctx,
		);
		await waitOnExecutionContext(ctx);

		expect(await response.json()).toMatchObject({
			reply: "Respuesta de Gemini",
			handoff: false,
			imageUrl: null,
			provider: "gemini",
		});
	});

	it("falls back to OpenRouter when Gemini fails", async () => {
		globalThis.fetch = vi
			.fn()
			.mockResolvedValueOnce({
				ok: false,
				status: 500,
				text: async () => "Gemini failed",
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
			{ ...env, GEMINI_API_KEY: "gemini-key", OPENROUTER_API_KEY: "openrouter-key" },
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

	it("returns the image plan reply when the user asks for an image", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				candidates: [{ content: { parts: [{ text: "Respuesta de Gemini" }] } }],
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
			{ ...env, GEMINI_API_KEY: "gemini-key" },
			ctx,
		);
		await waitOnExecutionContext(ctx);

		expect(await response.json()).toMatchObject({
			reply: "Te comparto la imagen del plan.",
			handoff: false,
			imageUrl:
				"https://pub-bc555ff3adc049a0afda1bac19d846ea.r2.dev/Gemini_Generated_Image_5u2ryk5u2ryk5u2r%20(1).png",
		});
	});

	it("uses OpenRouter when Gemini is not configured", async () => {
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
