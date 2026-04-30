import { afterEach, describe, expect, it, vi } from "vitest";
import { inspectBackends, selectBackend, selectBackendWithReport } from "../src/selector.js";
import type {
  BackendDriver,
  GenerateRequest,
  GenerateResult,
} from "../src/types.js";

const createDriver = (
  name: "native",
  available: boolean | Promise<boolean> = true,
): BackendDriver => ({
  name,
  isAvailable: () => available,
  load: async () => {},
  stream: async function* () {},
  complete: async (request: GenerateRequest): Promise<GenerateResult> => ({
    content: request.messages[request.messages.length - 1]?.content ?? "",
    model: request.model ?? "native-model",
    backend: name,
  }),
});

describe("selectBackend", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prefers an available native driver before other fallbacks", async () => {
    const driver = createDriver("native");

    const selected = await selectBackend({
      nativeDriver: driver,
      remoteBaseUrl: "http://localhost:7780",
    });

    expect(selected).toBe(driver);
    expect(selected.name).toBe("native");
  });

  it("returns a selection report with skipped backend availability", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ok", { status: 200 })),
    );

    const selection = await selectBackendWithReport({
      priority: ["native", "remote"],
      nativeDriver: createDriver("native", false),
      remoteBaseUrl: "http://localhost:7780",
    });

    expect(selection.backend).toBe("remote");
    expect(selection.availability).toMatchObject([
      { name: "native", available: false },
      { name: "remote", available: true, capabilities: ["chat", "stream"] },
    ]);
  });

  it("reports unconfigured backends without throwing", async () => {
    const availability = await inspectBackends({
      priority: ["native", "remote"],
    });

    expect(availability).toEqual([
      expect.objectContaining({
        name: "native",
        available: false,
        reason: "backend is not configured",
      }),
      expect.objectContaining({
        name: "remote",
        available: false,
        reason: "backend is not configured",
      }),
    ]);
  });

  it("skips an unavailable native driver and selects the remote fallback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ok", { status: 200 })),
    );

    const selected = await selectBackend({
      priority: ["native", "remote"],
      nativeDriver: createDriver("native", false),
      remoteBaseUrl: "http://localhost:7780",
    });

    expect(selected.name).toBe("remote");
  });

  it("throws when the requested priority has no available candidates", async () => {
    await expect(selectBackend({ priority: ["remote"] })).rejects.toThrow(
      /no backend is available/i,
    );
  });
});
