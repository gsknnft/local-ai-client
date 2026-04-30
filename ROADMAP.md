# @gsknnft/local-ai-client Roadmap

## Current Scope

`@gsknnft/local-ai-client` is the local inference router for the stack.

It should stay:

- zero runtime dependency
- backend-agnostic
- small enough to embed in web/mobile apps
- honest about device support
- usable by Claw3D, Sigi Shell, Vera surfaces, talking-head, and gotchi loops

## v0.1 Hardening

- Keep `@mlc-ai/web-llm` and `@huggingface/transformers` optional peer
  integrations.
- Keep backend imports lazy.
- Verify typecheck and CJS/ESM output.
- Add a minimal smoke example for:
  - remote BitNet server (`examples/bitnet-server.mjs`)
  - browser WebGPU/WASM (`examples/browser-webgpu.tsx`)
  - forced backend priority
  - custom native driver
- Add structured backend availability reporting.
- Add timeout / abort signal support for remote requests.
- Add model capability metadata for chat, stream, tools, skills, embeddings,
  and vision expansion.
- Add CI with:
  - install
  - typecheck
  - build
  - pack dry run
  - package size check
- Add package README and audit notes.

## v0.2 Candidates

- Backend capability reporting:

```ts
client.capabilities()
```

Should return support for:

- streaming
- local-only/private status
- model list
- estimated model size
- expected backend
- reason unavailable

- Selection result object:

```ts
await client.select()
```

Implemented as `client.availability()` and `client.select()`. Keep improving
the UX copy and model/backend compatibility details.

- Better model compatibility:
  - choose backend by requested model, not just backend availability
  - fall through to the next backend when the selected backend cannot load the
    requested model
  - support remote model aliases

- Browser UX helpers:
  - estimate download size
  - consent prompt data
  - cache/status hints
  - WebGPU support reason

## v0.3 Candidates

- Native driver examples:
  - Capacitor plugin shape
  - Android OS AI adapter placeholder
  - BitNet native adapter placeholder

- Remote adapter improvements:
  - health endpoint customization
  - OpenAI-compatible `/models` discovery
  - CORS/proxy recipe for browser apps
  - streaming fallback when a proxy cannot stream

- Cancellation:
  - `AbortSignal` on `load`, `stream`, and `complete`
  - user-facing cancel during long model load
  - cleanup for failed model compilation

## v0.4 Candidates

- Memory wrapper package or companion package:

```txt
@gsknnft/agent-memory
  -> stores turns
  -> compacts context
  -> injects summary prefix
  -> calls LocalAIClient
```

- Shared runtime profile integration:
  - Claw3D `webllm` runtime profile
  - Sigi Shell local demo agent
  - talking-head local reply mode
  - agent-gotchi local behavior tick

## Optimization Notes

- Do not build a custom WebGPU inference engine now. WebLLM/MLC already owns the
  hard tensor/runtime work.
- Optimize the abstraction first:
  - lazy backend import
  - one active loaded model
  - explicit unload
  - backend selection reasons
  - model-size-aware UX
- Keep models out of the package tarball.
- Keep model downloads user-consented.
- Prefer tiny default models for first-run demos.

## Production Hardening

- Document privacy labels:
  - `local-only`
  - `browser-cache`
  - `vendor-managed`
  - `remote`
  - `unknown`
- Add supply-chain notes for optional backend packages.
- Add a compatibility matrix:
  - desktop Chrome/Edge
  - Android Chrome/WebView
  - iOS Safari/WebView
  - Node
  - Capacitor native
- Add failure copy suitable for UI:
  - WebGPU unsupported
  - optional backend not installed
  - model unavailable for backend
  - remote server offline
