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

  it("parses OpenAI-compatible streaming SSE chunks", async () => {
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

    await expect(
      backend.complete({ messages: [{ role: "user", content: "hi" }] }),
    ).resolves.toEqual({
      content: "hello",
      model: "bitnet-default",
      backend: "remote",
    });

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

  it("passes abort signals through generation requests", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(
      async () =>
        new Response(streamFrom(["data: [DONE]\n\n"]), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const backend = new RemoteBackend("http://localhost:7780", "", "default", {
      timeoutMs: 1000,
    });
    await backend.complete({
      messages: [{ role: "user", content: "hi" }],
      signal: controller.signal,
    });

    const firstCall = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(firstCall[1].signal).toBeInstanceOf(AbortSignal);
  });
});
