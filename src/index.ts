export { LocalAIClient, WebLLMClient } from "./client.js";
export { detectRuntime, isNativeCapacitor, isWebGPUSupported } from "./detect.js";
export { MODELS, DEFAULT_MODEL_ID, getModel, resolveBackendModelId } from "./catalog.js";
export { WebGPUBackend } from "./backends/webgpu.js";
export { WasmBackend } from "./backends/wasm.js";
export { RemoteBackend } from "./backends/remote.js";
export { selectBackend } from "./selector.js";
export type {
  BackendDriver,
  BackendName,
  ChatMessage,
  ChatRole,
  GenerateRequest,
  GenerateResult,
  LoadProgress,
  LocalAIClientOptions,
  ModelEntry,
  ModelBackends,
  RuntimeEnvironment,
  // compat
  WebLLMClientOptions,
} from "./types.js";
