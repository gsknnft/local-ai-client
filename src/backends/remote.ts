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
    const timeout = createTimeoutSignal(3000);
    try {
      const res = await fetch(`${this._baseUrl}${this._healthPath}`, {
        signal: timeout.signal,
        headers: this._headers(),
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      timeout.cleanup();
    }
  }

  async load(_modelId: string, _onProgress?: (p: LoadProgress) => void): Promise<void> {
    // Remote server manages its own model lifecycle.
  }

  async *stream(request: GenerateRequest): AsyncGenerator<string> {
    const timeout = createTimeoutSignal(this._timeoutMs, request.signal);
    try {
      const res = await fetch(`${this._baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { ...this._headers(), "Content-Type": "application/json" },
        signal: timeout.signal,
        body: JSON.stringify(this._payload(request, true)),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Remote backend: HTTP ${res.status}${body ? ` - ${body.slice(0, 240)}` : ""}`);
      }

      if (!res.body) {
        throw new Error("Remote backend: HTTP 200 but missing response body");
      }

      // If the server sent back JSON instead of SSE (some gateways do this even
      // when stream:true is requested), handle it as a one-shot completion.
      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        const json = await res.json() as Record<string, unknown>;
        const content = this._extractCompletionText(json); // throws on error keys
        if (content) yield content;
        return;
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let yieldedAny = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const t = line.trim();
          // Detect a JSON error that arrived without the SSE "data:" wrapper
          if (!yieldedAny && t.startsWith("{") && t.includes('"error"')) {
            try {
              const json = JSON.parse(t) as Record<string, unknown>;
              this._extractCompletionText(json); // will throw with the error message
            } catch (e) {
              throw e;
            }
          }
          if (!t.startsWith("data:")) continue;
          const data = t.slice(5).trim();
          if (data === "[DONE]") return;
          try {
            const chunk = JSON.parse(data) as { choices: Array<{ delta: { content?: string } }> };
            const delta = chunk.choices[0]?.delta?.content;
            if (delta) { yield delta; yieldedAny = true; }
          } catch {}
        }
      }
    } finally {
      timeout.cleanup();
    }
  }

  async complete(request: GenerateRequest): Promise<GenerateResult> {
    const model = request.model ?? this._defaultModel;

    // Try non-streaming (stream:false) first — some gateways only support JSON responses.
    // Use a shorter timeout for the probe so we fall back quickly if the endpoint hangs.
    const probeTimeoutMs = Math.min(this._timeoutMs, 60_000);
    const probeTimeout = createTimeoutSignal(probeTimeoutMs, request.signal);
    try {
      const res = await fetch(`${this._baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { ...this._headers(), "Content-Type": "application/json" },
        signal: probeTimeout.signal,
        body: JSON.stringify(this._payload(request, false)),
      });
      if (res.ok) {
        const json = await res.json() as Record<string, unknown>;
        const content = this._extractCompletionText(json);
        if (content !== null) {
          return { content, model, backend: "remote" };
        }
        // Non-null but no usable content — fall through to stream
      } else if (res.status !== 501 && res.status !== 405) {
        // A real HTTP error (not "not implemented") — propagate it
        const body = await res.text().catch(() => "");
        throw new Error(`Remote backend: HTTP ${res.status}${body ? ` - ${body.slice(0, 240)}` : ""}`);
      }
    } catch (err) {
      if ((err as Error)?.name === "AbortError") throw err;
      // Ignore other probe failures and fall back to SSE stream
    } finally {
      probeTimeout.cleanup();
    }

    // Fall back: accumulate SSE stream
    const chunks: string[] = [];
    for await (const delta of this.stream(request)) chunks.push(delta);
    const content = chunks.join("");
    if (!content) throw new Error("Remote backend: empty response from model");
    return { content, model, backend: "remote" };
  }

  private _extractCompletionText(json: Record<string, unknown>): string | null {
    // Detect gateway error responses
    if (typeof json["error"] === "string" || (json["error"] && typeof json["error"] === "object")) {
      const msg = typeof json["error"] === "string" ? json["error"] : JSON.stringify(json["error"]);
      throw new Error(`Remote backend: ${msg}`);
    }
    const choices = json["choices"] as Array<Record<string, unknown>> | undefined;
    if (choices?.[0]) {
      const msg = choices[0]["message"] as Record<string, unknown> | undefined;
      if (typeof msg?.["content"] === "string") return msg["content"] as string;
      if (typeof choices[0]["text"] === "string") return choices[0]["text"] as string;
    }
    if (typeof json["text"] === "string") return json["text"] as string;
    if (typeof json["content"] === "string") return json["content"] as string;
    return null;
  }


  private _payload(request: GenerateRequest, stream: boolean): Record<string, unknown> {
    return {
      model: request.model ?? this._defaultModel,
      messages: request.messages,
      stream,
      max_tokens: request.maxTokens ?? 512,
      temperature: request.temperature ?? 0.6,
      top_p: request.topP ?? 1,
      ...(request.stop?.length ? { stop: request.stop } : {}),
    };
  }

  private _headers(): Record<string, string> {
    return this._token ? { Authorization: `Bearer ${this._token}` } : {};
  }
}

function createTimeoutSignal(
  timeoutMs: number,
  parent?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
  if (parent?.aborted) return { signal: parent, cleanup: () => {} };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort(parent?.reason);
  parent?.addEventListener("abort", abort, { once: true });
  const cleanup = () => {
    clearTimeout(timeout);
    parent?.removeEventListener("abort", abort);
  };
  controller.signal.addEventListener("abort", cleanup, { once: true });
  return { signal: controller.signal, cleanup };
}
