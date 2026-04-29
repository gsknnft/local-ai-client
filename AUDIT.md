# @gsknnft/local-ai-client Audit Notes

## Summary

The package is correctly shaped as a small backend router instead of a custom
inference engine. That is the right tradeoff for Claw3D and the wider stack.

Current posture:

- zero runtime dependencies
- optional backend packages only
- dynamic imports for heavy engines
- backend driver contract is small and portable
- remote backend can target BitNet/Ollama/OpenAI-compatible servers

## Current Strengths

- The caller does not need to know whether inference is native, WebGPU, WASM, or
  remote.
- WebLLM is used as a backend, not as the platform boundary.
- The native driver seam keeps Android/Capacitor work from leaking into web
  callers.
- `remoteModel` lets BitNet/Ollama use their real server-side model names
  instead of local canonical model IDs.

## Main Risks

### Backend Selection Is Availability-First

Current selection chooses the first available backend. It does not yet account
for whether the requested model can be loaded by that backend.

Needed:

- `supportsModel(modelId)` on backend drivers, or
- model-aware selection inside `LocalAIClient`

### Optional Backends Can Be Missing

If `webgpu` or `wasm` wins selection but the optional package is not installed,
dynamic import will fail during load.

Needed:

- preflight helper that reports missing optional packages cleanly
- UI-friendly error messages

### WASM Streaming Is Best-Effort

Transformers.js streaming behavior varies by model and task pipeline. The
current driver falls back to full-result emission when token streaming is not
available.

Needed:

- fixture/manual smoke test per supported WASM model
- mark `streaming: "native" | "simulated" | "unsupported"` in capabilities

### WebGPU Support Is Runtime-Specific

`navigator.gpu` is not enough. Adapter request may fail. Model load may fail
after adapter selection due to device limits.

Current code now requests an adapter during availability check.

Needed:

- capture and expose unavailable reasons
- check memory/model-size fit before offering large models when possible

### Remote Privacy Depends On User Configuration

Remote fallback can be local LAN/Tailscale/private, or it can be internet
hosted. The package cannot infer that safely from URL alone.

Needed:

- explicit privacy label in options
- UI recipe: do not call remote "on-device" unless the host marks it local

## Recommended Next Implementation

1. Add `BackendCapabilities`.
2. Add `supportsModel(modelId)` to `BackendDriver`.
3. Make selection model-aware.
4. Add a small `examples/remote-bitnet.mjs`.
5. Add CI build/pack dry run.

These are higher value than adding more catalog entries.
