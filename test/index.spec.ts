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

	it("returns debug information for any request", async () => {
		const request = new IncomingRequest("http://example.com/chat", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ message: "hola" }),
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data).toMatchObject({
			success: true,
			method: "POST",
			url: "http://example.com/chat"
		});
		expect(data.timestamp).toBeDefined();
	});

	it("returns debug information for GET request", async () => {
		const request = new IncomingRequest("http://example.com/test", {
			method: "GET"
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data).toMatchObject({
			success: true,
			method: "GET",
			url: "http://example.com/test"
		});
	});
});
