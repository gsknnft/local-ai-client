import { detectRuntime, isWebGPUSupported } from "./detect.js";
import { DEFAULT_MODEL_ID, MODELS, getModel } from "./catalog.js";
import { selectBackend } from "./selector.js";
import type {
  BackendDriver,
  BackendName,
  ChatMessage,
  GenerateRequest,
  GenerateResult,
  LoadProgress,
  LocalAIClientOptions,
  ModelEntry,
  RuntimeEnvironment,
} from "./types.js";

export class LocalAIClient {
  private readonly _defaultModelId: string;
  private readonly _onProgress: ((p: LoadProgress) => void) | undefined;
  private readonly _options: LocalAIClientOptions;

  private _driver: BackendDriver | null = null;
  private _driverPromise: Promise<BackendDriver> | null = null;

  constructor(options: LocalAIClientOptions = {}) {
    this._defaultModelId = options.defaultModelId ?? DEFAULT_MODEL_ID;
    this._onProgress = options.onProgress;
    this._options = options;
  }

  // ── Environment ─────────────────────────────────────────────────────────────

  runtime(): RuntimeEnvironment {
    return detectRuntime();
  }

  static isWebGPUSupported(): boolean {
    return isWebGPUSupported();
  }

  static isWasmSupported(): boolean {
    return typeof WebAssembly !== "undefined";
  }

  // ── Model catalog ────────────────────────────────────────────────────────────

  models(): ModelEntry[] {
    return MODELS;
  }

  model(id: string): ModelEntry | undefined {
    return getModel(id);
  }

  get defaultModelId(): string {
    return this._defaultModelId;
  }

  // ── Backend ──────────────────────────────────────────────────────────────────

  /**
   * Returns the name of the currently selected backend, or null if not yet
   * resolved. Call `load()` first to guarantee a value.
   */
  get activeBackend(): BackendName | null {
    return this._driver?.name ?? null;
  }

  /**
   * Resolves the best available backend and pre-warms the model.
   * Safe to call multiple times — reuses the resolved driver.
   */
  async load(modelId?: string, onProgress?: (p: LoadProgress) => void): Promise<BackendName> {
    const driver = await this._resolveDriver();
    const id = modelId ?? this._defaultModelId;
    await driver.load(id, onProgress ?? this._onProgress);
    return driver.name;
  }

  /** Releases GPU/memory resources held by the active backend. */
  async unload(): Promise<void> {
    await this._driver?.unload?.();
  }

  // ── Generation ───────────────────────────────────────────────────────────────

  /**
   * Streaming generation. Yields text deltas as they arrive.
   *
   * ```ts
   * for await (const delta of client.stream({ messages })) process.stdout.write(delta);
   * ```
   */
  async *stream(request: GenerateRequest): AsyncGenerator<string> {
    const driver = await this._resolveDriver();
    const resolved: GenerateRequest = {
      ...request,
      model: request.model ?? (driver.name === "remote" ? undefined : this._defaultModelId),
    };
    yield* driver.stream(resolved);
  }

  /**
   * Non-streaming completion.
   */
  async complete(request: GenerateRequest): Promise<GenerateResult> {
    const driver = await this._resolveDriver();
    const resolved: GenerateRequest = {
      ...request,
      model: request.model ?? (driver.name === "remote" ? undefined : this._defaultModelId),
    };
    return driver.complete(resolved);
  }

  /**
   * Single user turn. Returns the assistant reply text.
   *
   * ```ts
   * const reply = await client.ask("What is the capital of France?");
   * ```
   */
  async ask(
    userMessage: string,
    options?: Partial<Omit<GenerateRequest, "messages">>
  ): Promise<string> {
    const result = await this.complete({
      messages: [{ role: "user", content: userMessage }],
      maxTokens: 512,
      temperature: 0.6,
      ...options,
    });
    return result.content;
  }

  /**
   * Multi-turn chat. Returns the assistant reply text.
   *
   * ```ts
   * const reply = await client.chat([
   *   { role: "system", content: "You are a helpful assistant." },
   *   { role: "user",   content: "Hello!" },
   * ]);
   * ```
   */
  async chat(
    messages: ChatMessage[],
    options?: Partial<Omit<GenerateRequest, "messages">>
  ): Promise<string> {
    const result = await this.complete({ messages, ...options });
    return result.content;
  }

  // ── Internal ─────────────────────────────────────────────────────────────────

  private async _resolveDriver(): Promise<BackendDriver> {
    if (this._driver) return this._driver;
    if (this._driverPromise) return this._driverPromise;

    this._driverPromise = selectBackend({
      priority: this._options.backendPriority,
      remoteBaseUrl: this._options.remoteBaseUrl,
      remoteToken: this._options.remoteToken,
      remoteModel: this._options.remoteModel,
      nativeDriver: this._options.nativeDriver,
    }).then((driver) => {
      this._driver = driver;
      return driver;
    });

    return this._driverPromise;
  }
}

/** @deprecated Use LocalAIClient */
export const WebLLMClient = LocalAIClient;
