import type { BackendDriver, GenerateRequest, GenerateResult, LoadProgress } from "../types.js";
import { resolveBackendModelId } from "../catalog.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Pipeline = any;

const _pipelines = new Map<string, Pipeline>();

export class WasmBackend implements BackendDriver {
  readonly name = "wasm" as const;

  isAvailable(): boolean {
    // WebAssembly is available in all modern browsers and Node.js.
    return typeof WebAssembly !== "undefined";
  }

  async load(canonicalId: string, onProgress?: (p: LoadProgress) => void): Promise<void> {
    const hfId = resolveBackendModelId(canonicalId, "wasm");
    if (!hfId) throw new Error(`WASM backend: no HuggingFace model ID for "${canonicalId}"`);
    await this._ensurePipeline(hfId, onProgress);
  }

  async *stream(request: GenerateRequest): AsyncGenerator<string> {
    const hfId = this._resolveId(request.model);
    const pipeline = await this._ensurePipeline(hfId);

    // @huggingface/transformers text-generation supports a streamer callback.
    const chunks: string[] = [];
    let resolve: () => void;
    let reject: (e: unknown) => void;
    const queue: string[] = [];
    let done = false;
    let waiting: ((v: IteratorResult<string>) => void) | null = null;

    const push = (token: string) => {
      if (waiting) {
        const w = waiting;
        waiting = null;
        w({ value: token, done: false });
      } else {
        queue.push(token);
      }
    };

    const finish = () => {
      done = true;
      if (waiting) {
        const w = waiting;
        waiting = null;
        w({ value: "", done: true });
      }
    };

    // Run generation in background.
    pipeline(
      request.messages.map((m) => ({ role: m.role, content: m.content })),
      {
        max_new_tokens: request.maxTokens ?? 512,
        temperature: request.temperature ?? 0.6,
        top_p: request.topP ?? 1,
        do_sample: true,
        callback_function: (beams: Array<{ output_token_ids: number[] }>) => {
          // Transformers.js streams partial outputs through callback.
          // We yield the latest token text delta.
          void beams;
        },
        // Use the built-in TextStreamer when available.
        streamer: {
          put: (token: string) => push(token),
          end: () => finish(),
        },
      }
    ).then((result: Array<{ generated_text: string }>) => {
      // Fallback: if the streamer never fired, emit the full result at once.
      if (!done) {
        const text = Array.isArray(result) ? result[0]?.generated_text ?? "" : String(result);
        // Strip the prompt from the output.
        const lastUserMsg = request.messages.filter((m) => m.role === "user").pop()?.content ?? "";
        const reply = text.includes(lastUserMsg) ? text.slice(text.lastIndexOf(lastUserMsg) + lastUserMsg.length).trim() : text;
        push(reply);
        finish();
      }
    }).catch((err: unknown) => {
      done = true;
      if (waiting) {
        const w = waiting;
        waiting = null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (w as any)(Promise.reject(err));
      }
    });

    // Yield from the queue as tokens arrive.
    while (true) {
      if (queue.length > 0) {
        yield queue.shift()!;
      } else if (done) {
        break;
      } else {
        yield await new Promise<string>((res, rej) => {
          waiting = (result) => {
            if (result.done) res("");
            else res(result.value);
          };
        });
      }
    }

    void chunks; void resolve! ; void reject!;
  }

  async complete(request: GenerateRequest): Promise<GenerateResult> {
    const chunks: string[] = [];
    for await (const delta of this.stream(request)) {
      if (delta) chunks.push(delta);
    }
    return {
      content: chunks.join(""),
      model: request.model ?? "unknown",
      backend: "wasm",
    };
  }

  private _resolveId(canonicalId?: string): string {
    const id = canonicalId ?? "smollm2-360m";
    const hfId = resolveBackendModelId(id, "wasm");
    if (!hfId) throw new Error(`WASM backend: no HuggingFace model ID for "${id}"`);
    return hfId;
  }

  private async _ensurePipeline(hfId: string, onProgress?: (p: LoadProgress) => void): Promise<Pipeline> {
    if (_pipelines.has(hfId)) return _pipelines.get(hfId)!;

    const { pipeline, env } = await import("@huggingface/transformers");

    // Use WASM/remote weights — disable local model cache on browser.
    env.allowLocalModels = false;

    const pipe = await pipeline("text-generation", hfId, {
      progress_callback: (info: { progress?: number; status?: string; file?: string }) => {
        onProgress?.({
          progress: (info.progress ?? 0) / 100,
          text: info.file ? `Loading ${info.file}…` : (info.status ?? "Loading…"),
          backend: "wasm",
        });
      },
    });

    _pipelines.set(hfId, pipe);
    return pipe;
  }
}
