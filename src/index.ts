export { RemoteBackend } from "./backends/remote.js";
export { WasmBackend } from "./backends/wasm.js";
export { WebGPUBackend } from "./backends/webgpu.js";
export {
  DEFAULT_MODEL_ID,
  getModel,
  MODELS,
  resolveBackendModelId,
} from "./catalog.js";
export { LocalAIClient, WebLLMClient } from "./client.js";
export {
  detectRuntime,
  isNativeCapacitor,
  isWebGPUSupported,
} from "./detect.js";
export {
  inspectBackends,
  selectBackend,
  selectBackendWithReport,
} from "./selector.js";
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
  ModelBackends,
  ModelCapability,
  ModelEntry,
  RuntimeEnvironment,
  // compat
  WebLLMClientOptions,
} from "./types.js";
export {
  checkWebGLCompatibility,
  webGLContextManager,
  default as WebGLManager,
} from "./WebGLManager.js";
export type { ThreeRendererLike, WebLLMLoadOptions } from "./WebGLManager.js";
