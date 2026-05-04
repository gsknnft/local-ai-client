/**
 * WebGLManager unit tests — run in node pool with mocked deps.
 *
 * We test logic (dedup, error recovery, lifecycle, guards) without needing a
 * real browser. @tensorflow/tfjs and @mlc-ai/web-llm are fully mocked.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// ── Module mocks (hoisted before imports) ─────────────────────────────────────

vi.mock("@tensorflow/tfjs", () => ({
  memory: vi.fn(() => ({ numBytes: 0 })),
  engine: vi.fn(() => ({
    endScope: vi.fn(),
    startScope: vi.fn(),
  })),
  tidy: vi.fn((fn: () => void) => fn()),
  setBackend: vi.fn(() => Promise.resolve(true)),
  ready: vi.fn(() => Promise.resolve()),
  getBackend: vi.fn(() => "webgl"),
  backend: vi.fn(),
  ENV: { set: vi.fn(), get: vi.fn(() => 2) },
}));

// Mock @mlc-ai/web-llm dynamic import used inside _doLoad
const mockEngineUnload = vi.fn(() => Promise.resolve());
const mockEngineReload = vi.fn(() => Promise.resolve());
const mockInterruptGenerate = vi.fn(() => Promise.resolve());
const mockSetInitProgressCallback = vi.fn();

// Must be a proper constructor function (arrow functions are not newable)
type MockEngine = {
  unload: typeof mockEngineUnload;
  reload: typeof mockEngineReload;
  interruptGenerate: typeof mockInterruptGenerate;
  setInitProgressCallback: typeof mockSetInitProgressCallback;
};

function MockMLCEngine(this: MockEngine) {
  this.unload = mockEngineUnload;
  this.reload = mockEngineReload;
  this.interruptGenerate = mockInterruptGenerate;
  this.setInitProgressCallback = mockSetInitProgressCallback;
}
const MockMLCEngineSpy = vi.fn(
  MockMLCEngine as unknown as new () => MockEngine,
);

vi.mock("@mlc-ai/web-llm", () => ({
  MLCEngine: MockMLCEngineSpy,
}));

// ── Subject under test ────────────────────────────────────────────────────────

// Import AFTER mocks are registered
import WebGLManager, {
  checkWebGLCompatibility,
  webGLContextManager,
  type ThreeRendererLike,
} from "../src/WebGLManager.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Stub GL context — node/jsdom has no real WebGL; we only need a non-null object. */
const STUB_GL = {} as WebGLRenderingContext;

function makeRenderer(): ThreeRendererLike {
  return {
    domElement: document.createElement("canvas"),
    getContext: () => STUB_GL,
    dispose: vi.fn(),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("checkWebGLCompatibility", () => {
  it("returns true when canvas reports webgl support", () => {
    // node/jsdom has no real WebGL — mock createElement to return a fake canvas
    const fakeCanvas = {
      getContext: vi.fn(() => STUB_GL),
    } as unknown as HTMLCanvasElement;
    const spy = vi
      .spyOn(document, "createElement")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockReturnValueOnce(fakeCanvas as any);
    expect(checkWebGLCompatibility()).toBe(true);
    spy.mockRestore();
  });

  it("returns false when getContext returns null", () => {
    const fakeCanvas = {
      getContext: vi.fn(() => null),
    } as unknown as HTMLCanvasElement;
    const spy = vi
      .spyOn(document, "createElement")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockReturnValueOnce(fakeCanvas as any);
    expect(checkWebGLCompatibility()).toBe(false);
    spy.mockRestore();
  });

  it("returns false when document is undefined", () => {
    const orig = globalThis.document;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).document;
    expect(checkWebGLCompatibility()).toBe(false);
    globalThis.document = orig;
  });
});

describe("WebGLManager singleton", () => {
  it("webGLContextManager is the singleton instance", () => {
    expect(webGLContextManager).toBe(WebGLManager.getInstance());
  });

  it("getInstance() always returns the same object", () => {
    expect(WebGLManager.getInstance()).toBe(WebGLManager.getInstance());
  });
});

describe("WebGLManager.loadWebLLMModel", () => {
  afterEach(async () => {
    // Reset so each test starts with a clean singleton
    await WebGLManager._reset();
    vi.clearAllMocks();
  });

  it("loads a model and returns the engine", async () => {
    const mgr = WebGLManager.getInstance();
    const engine = await mgr.loadWebLLMModel("test-model");
    expect(mockEngineReload).toHaveBeenCalledWith("test-model");
    expect(engine).toBeDefined();
  });

  it("returns cached engine on second call without re-loading", async () => {
    const mgr = WebGLManager.getInstance();
    const e1 = await mgr.loadWebLLMModel("test-model");
    const e2 = await mgr.loadWebLLMModel("test-model");
    expect(e1).toBe(e2);
    expect(mockEngineReload).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent load calls for the same model", async () => {
    const mgr = WebGLManager.getInstance();
    const [e1, e2, e3] = await Promise.all([
      mgr.loadWebLLMModel("model-x"),
      mgr.loadWebLLMModel("model-x"),
      mgr.loadWebLLMModel("model-x"),
    ]);
    expect(e1).toBe(e2);
    expect(e2).toBe(e3);
    // Only one MLCEngine should have been created
    expect(MockMLCEngineSpy).toHaveBeenCalledTimes(1);
    expect(mockEngineReload).toHaveBeenCalledTimes(1);
  });

  it("cleans up the entry when reload throws, allowing retry", async () => {
    mockEngineReload.mockRejectedValueOnce(new Error("load failed"));

    const mgr = WebGLManager.getInstance();
    await expect(mgr.loadWebLLMModel("bad-model")).rejects.toThrow(
      "load failed",
    );

    // Entry should be gone so the next call tries fresh
    expect(mgr.getWebLLMEngine("bad-model")).toBeNull();
    expect(mgr.getWebLLMProgress("bad-model")).toBeNull();

    // Retry succeeds
    mockEngineReload.mockResolvedValueOnce(undefined);
    const engine = await mgr.loadWebLLMModel("bad-model");
    expect(engine).toBeDefined();
  });

  it("rejects immediately when the abort signal is already triggered", async () => {
    const controller = new AbortController();
    controller.abort();
    const mgr = WebGLManager.getInstance();
    await expect(
      mgr.loadWebLLMModel("never-loaded", { signal: controller.signal }),
    ).rejects.toThrow("Aborted");
    expect(mockEngineReload).not.toHaveBeenCalled();
  });

  it("forwards progress callbacks during load", async () => {
    const onProgress = vi.fn();
    // Simulate progress during reload
    mockEngineReload.mockImplementationOnce(async function () {
      // The callback was registered via setInitProgressCallback
      const cb = mockSetInitProgressCallback.mock.calls.at(-1)?.[0];
      cb?.({ progress: 0.5, text: "loading..." });
      cb?.({ progress: 1.0, text: "done" });
    });

    const mgr = WebGLManager.getInstance();
    await mgr.loadWebLLMModel("prog-model", { onProgress });
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress.mock.calls[0][0].progress).toBe(0.5);
    expect(mgr.getWebLLMProgress("prog-model")).toBe(1);
  });
});

describe("WebGLManager engine accessors", () => {
  afterEach(async () => {
    await WebGLManager._reset();
    vi.clearAllMocks();
  });

  it("getWebLLMEngine returns null before load", () => {
    expect(WebGLManager.getInstance().getWebLLMEngine("x")).toBeNull();
  });

  it("getWebLLMProgress returns null before load", () => {
    expect(WebGLManager.getInstance().getWebLLMProgress("x")).toBeNull();
  });

  it("isWebLLMLoading is false when no load is in flight", () => {
    expect(WebGLManager.getInstance().isWebLLMLoading("x")).toBe(false);
  });

  it("isWebLLMLoading is true while load is pending", async () => {
    // Pre-create the deferred so resolveLoad is available before the mock fires
    let resolveLoad!: () => void;
    const deferred = new Promise<void>((res) => {
      resolveLoad = res;
    });
    mockEngineReload.mockImplementationOnce(() => deferred);

    const mgr = WebGLManager.getInstance();
    const pending = mgr.loadWebLLMModel("slow-model");
    expect(mgr.isWebLLMLoading("slow-model")).toBe(true);
    resolveLoad();
    await pending;
    expect(mgr.isWebLLMLoading("slow-model")).toBe(false);
  });
});

describe("WebGLManager.unloadWebLLMModel", () => {
  afterEach(async () => {
    await WebGLManager._reset();
    vi.clearAllMocks();
  });

  it("unloads a loaded model and removes it from tracking", async () => {
    const mgr = WebGLManager.getInstance();
    await mgr.loadWebLLMModel("to-unload");
    expect(mgr.getWebLLMEngine("to-unload")).not.toBeNull();

    await mgr.unloadWebLLMModel("to-unload");
    expect(mgr.getWebLLMEngine("to-unload")).toBeNull();
    expect(mockEngineUnload).toHaveBeenCalledTimes(1);
  });

  it("is a no-op for an unknown model", async () => {
    await expect(
      WebGLManager.getInstance().unloadWebLLMModel("ghost"),
    ).resolves.toBeUndefined();
    expect(mockEngineUnload).not.toHaveBeenCalled();
  });

  it("does not double-free when unload throws", async () => {
    mockEngineUnload.mockRejectedValueOnce(new Error("gpu gone"));
    const mgr = WebGLManager.getInstance();
    await mgr.loadWebLLMModel("flaky");
    // Should not throw — logged as warning
    await expect(mgr.unloadWebLLMModel("flaky")).resolves.toBeUndefined();
    // Already removed before the throw
    expect(mgr.getWebLLMEngine("flaky")).toBeNull();
  });
});

describe("WebGLManager Three.js renderer", () => {
  afterEach(async () => {
    await WebGLManager._reset();
    vi.clearAllMocks();
  });

  it("registers and retrieves a renderer", () => {
    const mgr = WebGLManager.getInstance();
    const r = makeRenderer();
    mgr.registerThreeRenderer("scene", r);
    expect(mgr.getThreeRenderer("scene")).toBe(r);
  });

  it("getThreeRenderer returns null for unknown id", () => {
    expect(WebGLManager.getInstance().getThreeRenderer("unknown")).toBeNull();
  });

  it("disposeThreeRenderer calls dispose and removes the entry", () => {
    const mgr = WebGLManager.getInstance();
    const r = makeRenderer();
    mgr.registerThreeRenderer("avatar", r);
    mgr.disposeThreeRenderer("avatar");
    expect(r.dispose).toHaveBeenCalledTimes(1);
    expect(mgr.getThreeRenderer("avatar")).toBeNull();
  });

  it('rejects registration under the reserved id "tensorflow"', () => {
    const mgr = WebGLManager.getInstance();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mgr.registerThreeRenderer("tensorflow", makeRenderer());
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("reserved"));
    expect(mgr.getThreeRenderer("tensorflow")).toBeNull();
    warnSpy.mockRestore();
  });

  it("warns and skips when id conflicts with an existing non-three context", () => {
    // Manually inject a tensorflow context to simulate the conflict
    const mgr = WebGLManager.getInstance();
    // Access private map via cast for test purposes
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mgr as any).contexts.set("conflict", {
      gl: {},
      type: "tensorflow",
      lastUsed: Date.now(),
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mgr.registerThreeRenderer("conflict", makeRenderer());
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("tensorflow"));
    warnSpy.mockRestore();
  });
});

describe("WebGLManager.destroy", () => {
  afterEach(async () => {
    await WebGLManager._reset();
    vi.clearAllMocks();
  });

  it("unloads models and clears all contexts on destroy()", async () => {
    const mgr = WebGLManager.getInstance();
    await mgr.loadWebLLMModel("model-a");
    const r = makeRenderer();
    mgr.registerThreeRenderer("scene", r);

    await mgr.destroy();

    expect(mockEngineUnload).toHaveBeenCalledTimes(1);
    expect(r.dispose).toHaveBeenCalledTimes(1);
    expect(mgr.getWebLLMEngine("model-a")).toBeNull();
    expect(mgr.getThreeRenderer("scene")).toBeNull();
  });

  it("_reset() creates a fresh singleton after destroy", async () => {
    const before = WebGLManager.getInstance();
    await WebGLManager._reset();
    const after = WebGLManager.getInstance();
    expect(after).not.toBe(before);
  });
});
