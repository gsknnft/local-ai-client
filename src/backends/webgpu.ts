import type { BackendAvailability, BackendDriver, GenerateRequest, GenerateResult, LoadProgress } from "../types.js";
import { resolveBackendModelId } from "../catalog.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MLCEngine = any;

let _engine: MLCEngine | null = null;
let _loadedId: string | null = null;
let _loadPromise: Promise<MLCEngine> | null = null;

export class WebGPUBackend implements BackendDriver {
  readonly name = "webgpu" as const;

  async isAvailable(): Promise<boolean> {
    const gpu = typeof navigator !== "undefined"
      ? (navigator as Navigator & { gpu?: { requestAdapter?: () => Promise<unknown> } }).gpu
      : undefined;
    if (!gpu?.requestAdapter) return false;
    try {
      return Boolean(await gpu.requestAdapter());
    } catch {
      return false;
    }
  }

  async availability(): Promise<BackendAvailability> {
    const available = await this.isAvailable();
    return {
      name: "webgpu",
      available,
      reason: available ? undefined : "WebGPU adapter is not available",
      local: true,
      privacy: "browser-cache",
      capabilities: available ? ["chat", "stream"] : [],
    };
  }

  async load(canonicalId: string, onProgress?: (p: LoadProgress) => void, signal?: AbortSignal): Promise<void> {
    const mlcId = resolveBackendModelId(canonicalId, "webgpu");
    if (!mlcId) throw new Error(`WebGPU backend: no MLC model ID for "${canonicalId}"`);
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    await this._ensureEngine(mlcId, onProgress);
  }

  async *stream(request: GenerateRequest): AsyncGenerator<string> {
    const mlcId = this._resolveId(request.model);
    const engine = await this._ensureEngine(mlcId);
    const iter = await engine.chat.completions.create({
      messages: request.messages,
      stream: true,
      temperature: request.temperature ?? 0.6,
      max_tokens: request.maxTokens ?? 512,
      top_p: request.topP ?? 1,
    });
    for await (const chunk of iter) {
      const delta: string | undefined = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
  }

  async complete(request: GenerateRequest): Promise<GenerateResult> {
    const chunks: string[] = [];
    for await (const delta of this.stream(request)) chunks.push(delta);
    return {
      content: chunks.join(""),
      model: request.model ?? "unknown",
      backend: "webgpu",
    };
  }

  async unload(): Promise<void> {
    if (_engine) {
      try { await _engine.unload?.(); } catch {}
      _engine = null;
      _loadedId = null;
      _loadPromise = null;
    }
  }

  private _resolveId(canonicalId?: string): string {
    const id = canonicalId ?? "smollm2-360m";
    const mlcId = resolveBackendModelId(id, "webgpu");
    if (!mlcId) throw new Error(`WebGPU backend: no MLC model ID for "${id}"`);
    return mlcId;
  }

  private async _ensureEngine(mlcId: string, onProgress?: (p: LoadProgress) => void): Promise<MLCEngine> {
    if (_engine && _loadedId === mlcId) return _engine;
    if (_loadPromise && _loadedId === mlcId) return _loadPromise;

    if (_engine) {
      try { await _engine.unload?.(); } catch {}
      _engine = null;
    }

    _loadedId = mlcId;
    _loadPromise = import("@mlc-ai/web-llm").then(({ CreateMLCEngine }) =>
      CreateMLCEngine(mlcId, {
        initProgressCallback: (info: { text: string; progress: number }) => {
          onProgress?.({ progress: info.progress, text: info.text, backend: "webgpu" });
        },
      })
    ).then((engine) => {
      _engine = engine;
      return engine;
    }).catch((err) => {
      _loadPromise = null;
      _loadedId = null;
      throw err;
    });

    return _loadPromise;
  }
}
