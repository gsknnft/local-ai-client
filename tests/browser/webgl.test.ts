/**
 * WebGL browser tests — run in a real Chromium context via @vitest/browser.
 * These verify that the environment assumptions used by the backend selector
 * (WebGPU/WebGL presence, canvas support) behave correctly in a browser runtime.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteBackend } from "../../src/backends/remote.js";

// ── WebGL environment ───────────────────────────────────────────────────────

describe("WebGL environment", () => {
  it("exposes a WebGL rendering context on canvas", () => {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    expect(gl).not.toBeNull();
  });

  it("reports WebGL vendor and renderer strings", () => {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") ??
      canvas.getContext("webgl")) as WebGLRenderingContext | null;
    expect(gl).not.toBeNull();
    const debugInfo = gl!.getExtension("WEBGL_debug_renderer_info");
    // May be null in headless — that's fine, just assert no throw
    if (debugInfo) {
      const vendor = gl!.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
      const renderer = gl!.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
      expect(typeof vendor).toBe("string");
      expect(typeof renderer).toBe("string");
    }
  });

  it("can create and compile a minimal vertex shader", () => {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") ??
      canvas.getContext("webgl")) as WebGLRenderingContext | null;
    expect(gl).not.toBeNull();

    const shader = gl!.createShader(gl!.VERTEX_SHADER)!;
    gl!.shaderSource(
      shader,
      `attribute vec4 position; void main() { gl_Position = position; }`,
    );
    gl!.compileShader(shader);
    expect(gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)).toBe(true);
    gl!.deleteShader(shader);
  });
});

// ── RemoteBackend in browser context ───────────────────────────────────────

describe("RemoteBackend (browser)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("complete() works with a mocked fetch in browser context", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [{ message: { content: "browser-ok" } }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    const backend = new RemoteBackend(
      "http://localhost:7780",
      "",
      "test-model",
    );
    const result = await backend.complete({
      messages: [{ role: "user", content: "ping" }],
    });

    expect(result.content).toBe("browser-ok");
    expect(result.backend).toBe("remote");
  });

  it("stream() yields SSE chunks correctly in browser context", async () => {
    const encoder = new TextEncoder();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                for (const line of [
                  'data: {"choices":[{"delta":{"content":"one "}}]}\n\n',
                  'data: {"choices":[{"delta":{"content":"two"}}]}\n\n',
                  "data: [DONE]\n\n",
                ]) {
                  controller.enqueue(encoder.encode(line));
                }
                controller.close();
              },
            }),
            { status: 200 },
          ),
      ),
    );

    const backend = new RemoteBackend(
      "http://localhost:7780",
      "",
      "test-model",
    );
    const chunks: string[] = [];
    for await (const chunk of backend.stream({
      messages: [{ role: "user", content: "hi" }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks.join("")).toBe("one two");
  });

  it("isAvailable() returns false when fetch throws in browser context", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    const backend = new RemoteBackend("http://localhost:7780");
    await expect(backend.isAvailable()).resolves.toBe(false);
  });
});
