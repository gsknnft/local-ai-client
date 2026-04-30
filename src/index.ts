export { LocalAIClient, WebLLMClient } from "./client.js";
export { detectRuntime, isNativeCapacitor, isWebGPUSupported } from "./detect.js";
export { MODELS, DEFAULT_MODEL_ID, getModel, resolveBackendModelId } from "./catalog.js";
export { WebGPUBackend } from "./backends/webgpu.js";
export { WasmBackend } from "./backends/wasm.js";
export { RemoteBackend } from "./backends/remote.js";
export { inspectBackends, selectBackend, selectBackendWithReport } from "./selector.js";
export type {
  BackendAvailability,
  BackendDriver,
  BackendName,
  BackendSelection,
  ChatMessage,
  ChatRole,
  GenerateRequest,
  GenerateResult,
  LoadProgress,
  LocalAIClientOptions,
  ModelCapability,
  ModelEntry,
  ModelBackends,
  RuntimeEnvironment,
  // compat
  WebLLMClientOptions,
} from "./types.js";
