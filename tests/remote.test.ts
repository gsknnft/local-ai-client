import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteBackend } from "../src/backends/remote.js";

const encoder = new TextEncoder();

const streamFrom = (chunks: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

describe("RemoteBackend", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("checks health with bearer auth when a token is configured", async () => {
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const backend = new RemoteBackend("http://localhost:7780/", "token-123");

    await expect(backend.isAvailable()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:7780/health",
      expect.objectContaining({
        headers: { Authorization: "Bearer token-123" },
      }),
    );
  });

  it("reports structured availability for OpenAI-compatible endpoints", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ok", { status: 200 })),
    );

    const backend = new RemoteBackend("http://localhost:7780");

    await expect(backend.availability()).resolves.toEqual({
      name: "remote",
      available: true,
      local: false,
      privacy: "remote",
      capabilities: ["chat", "stream"],
    });
  });

  it("returns false when the health request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );

    const backend = new RemoteBackend("http://localhost:7780");

    await expect(backend.isAvailable()).resolves.toBe(false);
  });

  it("parses OpenAI-compatible streaming SSE chunks via stream()", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          streamFrom([
            'data: {"choices":[{"delta":{"content":"hel"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
            "data: [DONE]\n\n",
          ]),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const backend = new RemoteBackend(
      "http://localhost:7780",
      "",
      "bitnet-default",
    );

    // Test stream() directly — it always uses stream:true
    const chunks: string[] = [];
    for await (const chunk of backend.stream({
      messages: [{ role: "user", content: "hi" }],
    })) {
      chunks.push(chunk);
    }
    expect(chunks.join("")).toBe("hello");

    const firstCall = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(firstCall[1].body))).toMatchObject({
      model: "bitnet-default",
      stream: true,
      max_tokens: 512,
      temperature: 0.6,
      top_p: 1,
    });
  });

  it("honors an explicit request model over the remote default model", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          streamFrom([
            'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
            "data: [DONE]\n\n",
          ]),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const backend = new RemoteBackend("http://localhost:7780", "", "default");

    await backend.complete({
      model: "explicit",
      messages: [{ role: "user", content: "hi" }],
    });

    const firstCall = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(firstCall[1].body)).model).toBe("explicit");
  });

  it("passes stop sequences to OpenAI-compatible endpoints", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          streamFrom([
            'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
            "data: [DONE]\n\n",
          ]),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const backend = new RemoteBackend("http://localhost:7780", "", "default");

    await backend.complete({
      messages: [{ role: "user", content: "hi" }],
      stop: ["\nUser:", "\nAI:"],
      topP: 0.9,
    });

    const firstCall = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(firstCall[1].body))).toMatchObject({
      stop: ["\nUser:", "\nAI:"],
      top_p: 0.9,
    });
  });

  it("passes abort signals through generation requests via stream()", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(
      async () =>
        new Response(
          streamFrom([
            'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
            "data: [DONE]\n\n",
          ]),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const backend = new RemoteBackend("http://localhost:7780", "", "default", {
      timeoutMs: 1000,
    });
    // Use stream() directly — abort signals are forwarded through the timeout wrapper
    const chunks: string[] = [];
    for await (const chunk of backend.stream({
      messages: [{ role: "user", content: "hi" }],
      signal: controller.signal,
    })) {
      chunks.push(chunk);
    }
    expect(chunks.join("")).toBe("ok");

    const firstCall = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(firstCall[1].signal).toBeInstanceOf(AbortSignal);
  });

  // ── complete() — stream:false first path ───────────────────────────────────

  it("complete() uses stream:false first and returns JSON response directly", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "hello from non-stream" } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const backend = new RemoteBackend("http://localhost:7780", "", "model-x");
    const result = await backend.complete({
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.content).toBe("hello from non-stream");
    expect(result.model).toBe("model-x");

    // Should only be called once (the stream:false probe)
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body)).stream).toBe(
      false,
    );
  });

  it("complete() falls back to SSE stream when stream:false returns 405", async () => {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call++;
      if (call === 1) {
        // First call: stream:false → 405 Not Allowed
        return new Response("", { status: 405 });
      }
      // Second call: stream:true → SSE
      return new Response(
        streamFrom([
          'data: {"choices":[{"delta":{"content":"fallback"}}]}\n\n',
          "data: [DONE]\n\n",
        ]),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const backend = new RemoteBackend("http://localhost:7780", "", "model-x");
    const result = await backend.complete({
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.content).toBe("fallback");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]!.body)).stream).toBe(
      true,
    );
  });

  it("complete() throws immediately when stream:false returns a gateway error JSON", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "upstream model offline" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const backend = new RemoteBackend("http://localhost:7780", "", "model-x");
    await expect(
      backend.complete({ messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow("upstream model offline");
  });

  it("complete() throws on non-recoverable HTTP errors from stream:false", async () => {
    const fetchMock = vi.fn(
      async () => new Response("Internal Server Error", { status: 500 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const backend = new RemoteBackend("http://localhost:7780", "", "model-x");
    await expect(
      backend.complete({ messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow("HTTP 500");
  });

  // ── stream() — JSON content-type and bare error detection ─────────────────

  it("stream() yields content when server returns JSON instead of SSE", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "json-stream-reply" } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const backend = new RemoteBackend("http://localhost:7780", "", "model-x");
    const chunks: string[] = [];
    for await (const chunk of backend.stream({
      messages: [{ role: "user", content: "hi" }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks.join("")).toBe("json-stream-reply");
  });

  it("stream() throws when body starts with a bare JSON error object", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          streamFrom(['{"error":"Failed after 2 retries: upstream hung"}\n']),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const backend = new RemoteBackend("http://localhost:7780", "", "model-x");
    const gen = backend.stream({
      messages: [{ role: "user", content: "hi" }],
    });

    await expect(gen.next()).rejects.toThrow("Failed after 2 retries");
  });

  it("stream() throws on non-200 HTTP status", async () => {
    const fetchMock = vi.fn(
      async () => new Response("Bad Gateway", { status: 502 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const backend = new RemoteBackend("http://localhost:7780", "", "model-x");
    const gen = backend.stream({
      messages: [{ role: "user", content: "hi" }],
    });

    await expect(gen.next()).rejects.toThrow("HTTP 502");
  });
});
