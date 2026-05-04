import type { InitProgressReport, MLCEngine } from "@mlc-ai/web-llm";
import * as tf from "@tensorflow/tfjs";

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * Structural interface for a Three.js WebGLRenderer.
 * Avoids a hard dependency on `three` — any renderer satisfying this shape
 * (including `THREE.WebGLRenderer`) is accepted.
 */
export interface ThreeRendererLike {
  domElement: HTMLCanvasElement;
  getContext(): WebGLRenderingContext | WebGL2RenderingContext;
  dispose(): void;
}

export interface WebLLMLoadOptions {
  /** Called with each InitProgressReport during model load. */
  onProgress?: (report: InitProgressReport) => void;
  /** Abort signal — rejects the load promise with an AbortError when triggered. */
  signal?: AbortSignal;
}

// ── Private types ─────────────────────────────────────────────────────────────

interface GLContext {
  gl: WebGLRenderingContext | WebGL2RenderingContext;
  type: "tensorflow" | "three";
  lastUsed: number;
  renderer?: ThreeRendererLike;
}

interface WebLLMEntry {
  engine: MLCEngine;
  modelId: string;
  loadedAt: number;
  lastUsed: number;
  /** 0–1 load progress; 1 = fully loaded. */
  progress: number;
}

// ── Utility ───────────────────────────────────────────────────────────────────

/** Returns false in SSR or when the device has no WebGL support. */
export const checkWebGLCompatibility = (): boolean => {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return (
      canvas.getContext("webgl2") !== null ||
      canvas.getContext("webgl") !== null
    );
  } catch {
    return false;
  }
};

// ── Manager ───────────────────────────────────────────────────────────────────

class WebGLManager {
  private static instance: WebGLManager;

  private readonly contexts = new Map<string, GLContext>();
  private readonly webllmEngines = new Map<string, WebLLMEntry>();
  /** In-flight load promises — deduplicate concurrent loads of the same model. */
  private readonly loadingPromises = new Map<string, Promise<MLCEngine>>();

  private readonly MAX_MEMORY_MB = 1024;
  private memoryMonitorInterval: ReturnType<typeof setInterval> | undefined;

  private constructor() {
    // Don't start the monitor in SSR / Node — tf.memory() would error
    if (typeof window !== "undefined") {
      this.startMemoryMonitor();
    }
  }

  static getInstance(): WebGLManager {
    if (!WebGLManager.instance) {
      WebGLManager.instance = new WebGLManager();
    }
    return WebGLManager.instance;
  }

  /**
   * Reset the singleton — only call this in tests or during HMR teardown.
   * Calls destroy() first so resources are freed before clearing the reference.
   */
  static async _reset(): Promise<void> {
    if (WebGLManager.instance) {
      await WebGLManager.instance.destroy();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (WebGLManager as any).instance = undefined;
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Release all resources: stop the memory monitor, unload every WebLLM model,
   * dispose all Three renderers, and drop the TF GL context.
   * Essential for tests and HMR.
   */
  async destroy(): Promise<void> {
    if (this.memoryMonitorInterval !== undefined) {
      clearInterval(this.memoryMonitorInterval);
      this.memoryMonitorInterval = undefined;
    }
    await this.unloadAllWebLLMModels();
    for (const id of [...this.contexts.keys()]) {
      this.releaseContext(id);
    }
  }

  // ── Memory management ─────────────────────────────────────────────────────

  private startMemoryMonitor(): void {
    this.memoryMonitorInterval = setInterval(() => {
      const memory = tf.memory();
      const memoryMB = memory.numBytes / (1024 * 1024);
      if (memoryMB > this.MAX_MEMORY_MB) {
        console.warn(
          `🚨 High memory: ${memoryMB.toFixed(1)} MB — running cleanup`,
        );
        void this.cleanupMemory();
      }
    }, 5_000);
  }

  private async cleanupMemory(): Promise<void> {
    // 1. Release the LRU Three/TF GL context
    this.releaseOldestContext();

    // 2. Unload the LRU WebLLM model
    let lru: WebLLMEntry | null = null;
    for (const entry of this.webllmEngines.values()) {
      if (!lru || entry.lastUsed < lru.lastUsed) lru = entry;
    }
    if (lru) {
      try {
        await this.unloadWebLLMModel(lru.modelId);
      } catch {
        // best-effort; already logged in unloadWebLLMModel
      }
    }

    // 3. Reclaim TF tensor memory
    try {
      tf.engine().endScope();
      tf.engine().startScope();
      tf.tidy(() => {});
    } catch {
      // TF may not be initialised yet
    }
  }

  // ── TensorFlow ────────────────────────────────────────────────────────────

  /**
   * Ensure the TF WebGL backend is ready and return the underlying GL context.
   * Subsequent calls return the cached context immediately.
   */
  async getTensorFlowContext(): Promise<
    WebGLRenderingContext | WebGL2RenderingContext | null
  > {
    try {
      const existing = this.contexts.get("tensorflow");
      if (existing) {
        existing.lastUsed = Date.now();
        return existing.gl;
      }

      const context = this.createWebGLContext("tensorflow");
      if (!context) return null;

      this.contexts.set("tensorflow", context);
      await this.initializeTensorFlow();
      return context.gl;
    } catch (err) {
      console.error("❌ Failed to get TensorFlow WebGL context:", err);
      this.contexts.delete("tensorflow");
      return null;
    }
  }

  // ── WebLLM ────────────────────────────────────────────────────────────────

  /**
   * Load a model into a managed MLCEngine.
   *
   * - If the model is already loaded, returns the cached engine immediately.
   * - If a load is already in flight for this modelId, the same promise is
   *   returned to all concurrent callers (no duplicate engines).
   * - If the load fails, the entry is cleaned up so the next call can retry.
   */
  async loadWebLLMModel(
    modelId: string,
    options: WebLLMLoadOptions = {},
  ): Promise<MLCEngine> {
    const existing = this.webllmEngines.get(modelId);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing.engine;
    }

    const inflight = this.loadingPromises.get(modelId);
    if (inflight) return inflight;

    const promise = this._doLoad(modelId, options);
    this.loadingPromises.set(modelId, promise);
    try {
      return await promise;
    } finally {
      this.loadingPromises.delete(modelId);
    }
  }

  private async _doLoad(
    modelId: string,
    { onProgress, signal }: WebLLMLoadOptions,
  ): Promise<MLCEngine> {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const { MLCEngine } = await import("@mlc-ai/web-llm");
    const engine = new MLCEngine();

    const entry: WebLLMEntry = {
      engine,
      modelId,
      loadedAt: Date.now(),
      lastUsed: Date.now(),
      progress: 0,
    };
    // Register now so callers can poll progress even before reload resolves
    this.webllmEngines.set(modelId, entry);

    engine.setInitProgressCallback((report: InitProgressReport) => {
      entry.progress = report.progress;
      onProgress?.(report);
    });

    // Wire abort signal into the reload
    const abortListener = signal
      ? () => {
          void engine.interruptGenerate();
        }
      : undefined;
    if (signal && abortListener)
      signal.addEventListener("abort", abortListener);

    try {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      await engine.reload(modelId);
      entry.progress = 1;
      console.log(`✅ WebLLM model loaded: "${modelId}"`);
      return engine;
    } catch (err) {
      // Clean up so the next call can attempt a fresh load
      this.webllmEngines.delete(modelId);
      try {
        await engine.unload();
      } catch {
        /* best-effort */
      }
      throw err;
    } finally {
      if (signal && abortListener)
        signal.removeEventListener("abort", abortListener);
    }
  }

  /**
   * Retrieve a loaded engine without triggering a load.
   * Returns `null` if the model is not loaded (or still loading).
   */
  getWebLLMEngine(modelId: string): MLCEngine | null {
    const entry = this.webllmEngines.get(modelId);
    if (!entry) return null;
    entry.lastUsed = Date.now();
    return entry.engine;
  }

  /** 0–1 load progress for a model, or `null` if not tracked. */
  getWebLLMProgress(modelId: string): number | null {
    return this.webllmEngines.get(modelId)?.progress ?? null;
  }

  /** `true` while the model is being fetched / initialised. */
  isWebLLMLoading(modelId: string): boolean {
    return this.loadingPromises.has(modelId);
  }

  /**
   * Interrupt any in-flight generation for the given model.
   * Swallows errors — the engine may already be idle.
   */
  async interruptWebLLM(modelId: string): Promise<void> {
    const entry = this.webllmEngines.get(modelId);
    if (entry) {
      try {
        await entry.engine.interruptGenerate();
      } catch {
        /* best-effort */
      }
    }
  }

  /**
   * Unload a model and free its GPU memory.
   * No-op if the model is not loaded.
   */
  async unloadWebLLMModel(modelId: string): Promise<void> {
    const entry = this.webllmEngines.get(modelId);
    if (!entry) return;
    this.webllmEngines.delete(modelId); // remove before async unload to prevent double-free
    try {
      await entry.engine.unload();
      console.log(`🗑️  WebLLM model unloaded: "${modelId}"`);
    } catch (err) {
      console.warn(`⚠️  Error unloading WebLLM model "${modelId}":`, err);
    }
  }

  /** Unload all WebLLM models. Uses allSettled so one failure doesn't block others. */
  async unloadAllWebLLMModels(): Promise<void> {
    await Promise.allSettled(
      [...this.webllmEngines.keys()].map((id) => this.unloadWebLLMModel(id)),
    );
  }

  // ── Three.js ──────────────────────────────────────────────────────────────

  /**
   * Register an existing Three.js WebGLRenderer with the manager so its
   * lifetime is tracked alongside the TF context for memory pressure cleanup.
   *
   * @param id       Unique name for this renderer (e.g. `"scene"`, `"avatar"`).
   * @param renderer A `THREE.WebGLRenderer` or any `ThreeRendererLike`.
   */
  registerThreeRenderer(id: string, renderer: ThreeRendererLike): void {
    if (id === "tensorflow") {
      console.warn(
        `⚠️  id "tensorflow" is reserved — choose a different name.`,
      );
      return;
    }
    const existing = this.contexts.get(id);
    if (existing) {
      if (existing.type !== "three") {
        console.warn(
          `⚠️  Context "${id}" already exists as type "${existing.type}". Skipping registration.`,
        );
        return;
      }
      existing.lastUsed = Date.now();
      return;
    }
    const gl = renderer.getContext();
    this.contexts.set(id, {
      gl,
      type: "three",
      lastUsed: Date.now(),
      renderer,
    });
    console.log(`✅ Three.js renderer registered: "${id}"`);
  }

  /**
   * Retrieve a registered Three.js renderer by id.
   * Returns `null` if not found or if the id belongs to a different context type.
   */
  getThreeRenderer(id: string): ThreeRendererLike | null {
    const ctx = this.contexts.get(id);
    if (ctx?.type === "three" && ctx.renderer) {
      ctx.lastUsed = Date.now();
      return ctx.renderer;
    }
    return null;
  }

  /** Dispose a Three.js renderer and remove it from the manager. */
  disposeThreeRenderer(id: string): void {
    const ctx = this.contexts.get(id);
    if (ctx?.type === "three") {
      try {
        ctx.renderer?.dispose();
      } catch {
        /* best-effort */
      }
      this.contexts.delete(id);
      console.log(`🗑️  Three.js renderer disposed: "${id}"`);
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private createWebGLContext(type: "tensorflow" | "three"): GLContext | null {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    const gl: WebGLRenderingContext | WebGL2RenderingContext | null =
      canvas.getContext("webgl2") ??
      (canvas.getContext("webgl") as WebGLRenderingContext | null);
    if (!gl) {
      console.error("❌ WebGL is not supported on this device.");
      return null;
    }
    return { gl, type, lastUsed: Date.now() };
  }

  private async initializeTensorFlow(): Promise<void> {
    try {
      await tf.setBackend("webgl");
      await tf.ready();
      if (tf.getBackend() !== "webgl") throw new Error("Backend mismatch");

      tf.ENV.set("WEBGL_VERSION", 2);
      tf.ENV.set("WEBGL_FORCE_F16_TEXTURES", false);
      tf.ENV.set("WEBGL_RENDER_FLOAT32_ENABLED", true);
      tf.ENV.set("WEBGL_PACK", false);
      await tf.ready();

      console.log("✅ TensorFlow WebGL backend ready:", {
        backend: tf.getBackend(),
        webgl_version: tf.ENV.get("WEBGL_VERSION"),
        float32: tf.ENV.get("WEBGL_RENDER_FLOAT32_ENABLED"),
      });
    } catch (err) {
      console.error("❌ TensorFlow WebGL init failed:", err);
      throw new Error("TensorFlow WebGL initialisation failed");
    }
  }

  private releaseOldestContext(): void {
    let oldest: [string, GLContext] | null = null;
    for (const [id, ctx] of this.contexts) {
      if (!oldest || ctx.lastUsed < oldest[1].lastUsed) oldest = [id, ctx];
    }
    if (oldest) this.releaseContext(oldest[0]);
  }

  private releaseContext(id: string): void {
    const ctx = this.contexts.get(id);
    if (!ctx) return;
    if (ctx.type === "three") {
      try {
        ctx.renderer?.dispose();
      } catch {
        /* best-effort */
      }
    }
    this.contexts.delete(id);
  }
}

export const webGLContextManager = WebGLManager.getInstance();
export default WebGLManager;
