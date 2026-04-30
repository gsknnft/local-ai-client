import type { BackendAvailability, BackendDriver, GenerateRequest, GenerateResult, LoadProgress } from "../types.js";

export type RemoteBackendOptions = {
  timeoutMs?: number;
  healthPath?: string;
};

/**
 * Remote backend — proxies to any OpenAI-compatible HTTP endpoint.
 * Works everywhere: browser, Capacitor, Node.js.
 * Useful as the last-resort fallback (e.g. BitNet server on LAN/Tailscale).
 */
export class RemoteBackend implements BackendDriver {
  readonly name = "remote" as const;

  private readonly _baseUrl: string;
  private readonly _token: string;
  private readonly _defaultModel: string;
  private readonly _timeoutMs: number;
  private readonly _healthPath: string;

  constructor(
    baseUrl: string,
    token = "",
    defaultModel = "bitnet-b1.58-2B-4T",
    options: RemoteBackendOptions = {},
  ) {
    this._baseUrl = baseUrl.replace(/\/+$/, "");
    this._token = token;
    this._defaultModel = defaultModel;
    this._timeoutMs = options.timeoutMs ?? 30_000;
    this._healthPath = options.healthPath ?? "/health";
  }

  async availability(): Promise<BackendAvailability> {
    const available = await this.isAvailable();
    return {
      name: "remote",
      available,
      reason: available ? undefined : "remote endpoint did not respond to health check",
      local: false,
      privacy: "remote",
      capabilities: ["chat", "stream"],
    };
  }

  async isAvailable(): Promise<boolean> {
    if (!this._baseUrl) return false;
    try {
      const res = await fetch(`${this._baseUrl}${this._healthPath}`, {
        signal: timeoutSignal(3000),
        headers: this._headers(),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async load(_modelId: string, _onProgress?: (p: LoadProgress) => void): Promise<void> {
    // Remote server manages its own model lifecycle.
  }

  async *stream(request: GenerateRequest): AsyncGenerator<string> {
    const res = await fetch(`${this._baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { ...this._headers(), "Content-Type": "application/json" },
      signal: timeoutSignal(this._timeoutMs, request.signal),
      body: JSON.stringify({
        model: request.model ?? this._defaultModel,
        messages: request.messages,
        stream: true,
        max_tokens: request.maxTokens ?? 512,
        temperature: request.temperature ?? 0.6,
      }),
    });

    if (!res.ok || !res.body) {
      throw new Error(`Remote backend: HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const data = t.slice(5).trim();
        if (data === "[DONE]") return;
        try {
          const chunk = JSON.parse(data) as { choices: Array<{ delta: { content?: string } }> };
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) yield delta;
        } catch {}
      }
    }
  }

  async complete(request: GenerateRequest): Promise<GenerateResult> {
    const chunks: string[] = [];
    for await (const delta of this.stream(request)) chunks.push(delta);
    return {
      content: chunks.join(""),
      model: request.model ?? this._defaultModel,
      backend: "remote",
    };
  }

  private _headers(): Record<string, string> {
    return this._token ? { Authorization: `Bearer ${this._token}` } : {};
  }
}

function timeoutSignal(timeoutMs: number, parent?: AbortSignal): AbortSignal {
  if (parent?.aborted) return parent;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort(parent?.reason);
  parent?.addEventListener("abort", abort, { once: true });
  controller.signal.addEventListener("abort", () => {
    clearTimeout(timeout);
    parent?.removeEventListener("abort", abort);
  }, { once: true });
  return controller.signal;
}
