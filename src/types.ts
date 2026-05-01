// ── Runtime environment ──────────────────────────────────────────────────────

export type RuntimeEnvironment = "browser" | "capacitor" | "node";

// ── Backend ──────────────────────────────────────────────────────────────────

/**
 * Priority order the client uses when auto-selecting a backend.
 *
 * native  → Capacitor plugin / system AI (Android/iOS future)
 * webgpu  → @mlc-ai/web-llm via WebGPU (Chrome/Edge, fast)
 * wasm    → @huggingface/transformers via ONNX/WASM (broader device support)
 * remote  → OpenAI-compatible HTTP endpoint (BitNet, Ollama, etc.)
 */
export type BackendName = "native" | "webgpu" | "wasm" | "remote";

export type ModelCapability =
  | "chat"
  | "stream"
  | "embeddings"
  | "tools"
  | "skills"
  | "vision";

export type BackendAvailability = {
  name: BackendName;
  available: boolean;
  reason?: string;
  local: boolean;
  privacy: "local-only" | "browser-cache" | "native" | "remote" | "unknown";
  capabilities: ModelCapability[];
};

export type BackendSelection = {
  backend: BackendName;
  driver: BackendDriver;
  availability: BackendAvailability[];
};

export type LoadProgress = {
  /** 0–1 */
  progress: number;
  text: string;
  backend: BackendName;
};

// ── Model catalog ────────────────────────────────────────────────────────────

/**
 * Per-backend model identifiers for a single logical model.
 * A model may be available on one or more backends.
 */
export type ModelBackends = {
  /** MLC model ID used by @mlc-ai/web-llm */
  webgpu?: string;
  /** HuggingFace repo ID used by @huggingface/transformers */
  wasm?: string;
};

export type ModelEntry = {
  /** Canonical ID used in client calls. */
  id: string;
  label: string;
  description: string;
  sizeMb: {
    webgpu?: number;
    wasm?: number;
  };
  capabilities: ModelCapability[];
  backends: ModelBackends;
  link?: string;
};

// ── Chat types ───────────────────────────────────────────────────────────────

export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type GenerateRequest = {
  messages: ChatMessage[];
  /** Canonical model ID. Falls back to client default when omitted. */
  model?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  /**
   * Backend stop sequences. Useful for llama.cpp/OpenAI-compatible servers
   * whose chat template may otherwise continue into the next speaker turn.
   */
  stop?: string[];
  signal?: AbortSignal;
};

export type GenerateResult = {
  content: string;
  model: string;
  backend: BackendName;
  /** Tokens per second, when the backend exposes it. */
  tokensPerSecond?: number;
};

// ── Backend driver interface ─────────────────────────────────────────────────

/**
 * Implement this interface to add a new local-AI backend.
 * The client auto-selects the highest-priority available driver.
 */
export interface BackendDriver {
  readonly name: BackendName;
  /** Synchronous quick check — may also return a Promise for async probes. */
  isAvailable(): boolean | Promise<boolean>;
  /** Load (or warm) a model. Called lazily before the first generate. */
  load(modelId: string, onProgress?: (p: LoadProgress) => void, signal?: AbortSignal): Promise<void>;
  stream(request: GenerateRequest): AsyncGenerator<string>;
  complete(request: GenerateRequest): Promise<GenerateResult>;
  availability?(): BackendAvailability | Promise<BackendAvailability>;
  /** Optional: release GPU/memory resources. */
  unload?(): Promise<void>;
}

// ── Client options ────────────────────────────────────────────────────────────

export type LocalAIClientOptions = {
  /**
   * Default canonical model ID.
   * Defaults to the smallest available model in the catalog.
   */
  defaultModelId?: string;
  /** Called while a model is loading/compiling. */
  onProgress?: (p: LoadProgress) => void;
  /**
   * Backend priority override. Defaults to ["native","webgpu","wasm","remote"].
   * Skip a backend entirely by omitting it.
   */
  backendPriority?: BackendName[];
  /**
   * Remote OpenAI-compatible endpoint for the "remote" backend fallback.
   * e.g. "http://localhost:7780" for a local BitNet server.
   */
  remoteBaseUrl?: string;
  /** Bearer token for the remote endpoint. */
  remoteToken?: string;
  /**
   * Model name to send to the remote OpenAI-compatible endpoint when the
   * caller does not explicitly pass one.
   */
  remoteModel?: string;
  /** Default timeout for remote health/generation calls. Defaults to 30 seconds. */
  timeoutMs?: number;
  /**
   * Plug in a Capacitor plugin or system AI shim here for the "native" backend.
   * The driver must implement BackendDriver.
   */
  nativeDriver?: BackendDriver;
};

// ── Compat re-export ─────────────────────────────────────────────────────────

/** @deprecated Use LocalAIClientOptions */
export type WebLLMClientOptions = LocalAIClientOptions;
