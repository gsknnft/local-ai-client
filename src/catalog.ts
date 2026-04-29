import type { ModelEntry } from "./types.js";

/**
 * Prebuilt models available across backends.
 *
 * webgpu IDs  → @mlc-ai/web-llm prebuilt list (CreateMLCEngine)
 * wasm IDs    → HuggingFace repos compatible with @huggingface/transformers
 */
export const MODELS: ModelEntry[] = [
  {
    id: "smollm2-360m",
    label: "SmolLM2 360M",
    description: "Ultra-light demo — fastest first load",
    sizeMb: { webgpu: 376, wasm: 420 },
    backends: {
      webgpu: "SmolLM2-360M-Instruct-q4f16_1-MLC",
      wasm: "HuggingFaceTB/SmolLM2-360M-Instruct",
    },
    link: "https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct",
  },
  {
    id: "gemma3-1b",
    label: "Gemma 3 1B",
    description: "Google Gemma 3 compact",
    sizeMb: { webgpu: 711 },
    backends: {
      webgpu: "gemma3-1b-it-q4f16_1-MLC",
    },
    link: "https://huggingface.co/mlc-ai/gemma3-1b-it-q4f16_1-MLC",
  },
  {
    id: "llama3.2-1b",
    label: "Llama 3.2 1B",
    description: "Meta Llama 3.2 compact",
    sizeMb: { webgpu: 879, wasm: 950 },
    backends: {
      webgpu: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
      wasm: "meta-llama/Llama-3.2-1B-Instruct",
    },
    link: "https://huggingface.co/meta-llama/Llama-3.2-1B-Instruct",
  },
  {
    id: "qwen3-0.6b",
    label: "Qwen3 0.6B",
    description: "Qwen3 tiny — good reasoning for its size",
    sizeMb: { webgpu: 1400, wasm: 1500 },
    backends: {
      webgpu: "Qwen3-0.6B-q4f16_1-MLC",
      wasm: "Qwen/Qwen3-0.6B-Instruct",
    },
    link: "https://huggingface.co/Qwen/Qwen3-0.6B-Instruct",
  },
  {
    id: "qwen3-1.7b",
    label: "Qwen3 1.7B",
    description: "Qwen3 balanced — good quality",
    sizeMb: { webgpu: 2000, wasm: 2100 },
    backends: {
      webgpu: "Qwen3-1.7B-q4f16_1-MLC",
      wasm: "Qwen/Qwen3-1.7B-Instruct",
    },
    link: "https://huggingface.co/Qwen/Qwen3-1.7B-Instruct",
  },
  {
    id: "llama3.2-3b",
    label: "Llama 3.2 3B",
    description: "Best compact quality — ~2.3 GB",
    sizeMb: { webgpu: 2300, wasm: 2400 },
    backends: {
      webgpu: "Llama-3.2-3B-Instruct-q4f16_1-MLC",
      wasm: "meta-llama/Llama-3.2-3B-Instruct",
    },
    link: "https://huggingface.co/meta-llama/Llama-3.2-3B-Instruct",
  },
];

export const DEFAULT_MODEL_ID = MODELS[0].id;

export function getModel(id: string): ModelEntry | undefined {
  return MODELS.find((m) => m.id === id);
}

/** Resolve the backend-specific model ID from a canonical model ID. */
export function resolveBackendModelId(
  canonicalId: string,
  backend: "webgpu" | "wasm"
): string | undefined {
  return getModel(canonicalId)?.backends[backend];
}
