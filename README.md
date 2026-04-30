# @gsknnft/local-ai-client

Zero-runtime-dependency local AI client for browser, Capacitor, Node, and future
Android native runtimes.

A small backend router for local inference:

```txt
native -> webgpu -> wasm -> remote
```

The caller gets one API while the runtime picks the best available backend.

## Why This Exists

Claw3D, Sigi Shell, Vera surfaces, gotchi loops, and talking-head experiences
need a base model path that does not assume the user already has OpenClaw,
Hermes, Vera Torch, Ollama, or a PC gateway running.

This package gives those apps a clean local inference seam:

- WebGPU when the browser can run `@mlc-ai/web-llm`
- WASM when a broader browser fallback is needed through Transformers.js
- native when a Capacitor/Android/iOS plugin exists
- remote when a local BitNet/Ollama/OpenAI-compatible server is available

## Install

```bash
pnpm add @gsknnft/local-ai-client
```

Install optional backends only when you need them:

```bash
pnpm add @mlc-ai/web-llm
pnpm add @huggingface/transformers
```

No backend package is bundled by default. WebGPU and WASM engines are loaded
with dynamic imports only when selected.

## Basic Usage

```ts
import { LocalAIClient } from "@gsknnft/local-ai-client";

const client = new LocalAIClient({
  remoteBaseUrl: "http://127.0.0.1:7780",
  remoteModel: "bitnet-b1.58-2B-4T",
});

const answer = await client.ask("Write a short task plan.");
console.log(answer);
```

## Availability Report

Use this before showing a model picker or "local AI" connect button:

```ts
const availability = await client.availability();
console.table(availability);

const selected = await client.select();
console.log(selected.backend);
```

Each backend reports:

- `available`
- `reason` when unavailable
- privacy label: `native`, `browser-cache`, `remote`, or `unknown`
- capabilities such as `chat`, `stream`, `tools`, `skills`, `embeddings`, and
  `vision`

## Streaming

```ts
for await (const delta of client.stream({
  messages: [{ role: "user", content: "Say hello from the active backend." }],
  maxTokens: 128,
})) {
  process.stdout.write(delta);
}
```

## Backend Priority

Default priority:

```ts
["native", "webgpu", "wasm", "remote"]
```

Override it per app:

```ts
const client = new LocalAIClient({
  backendPriority: ["remote", "webgpu", "wasm"],
  remoteBaseUrl: "http://127.0.0.1:7780",
  timeoutMs: 30_000,
});
```

## Native Driver

Native drivers implement the same `BackendDriver` contract. This is the seam for
Capacitor plugins, Android JNI runtimes, phone OS AI APIs, or a later BitNet
native runtime.

```ts
import type { BackendDriver } from "@gsknnft/local-ai-client";

const nativeDriver: BackendDriver = {
  name: "native",
  isAvailable: () => true,
  load: async () => {},
  async *stream() {
    yield "Hello from native.";
  },
  complete: async () => ({
    content: "Hello from native.",
    model: "native-default",
    backend: "native",
  }),
};

const client = new LocalAIClient({ nativeDriver });
```

## Model Catalog

Callers use canonical model IDs. Backends map those IDs to their own model
format.

```ts
const models = client.models();
```

Current catalog entries include:

- `smollm2-360m`
- `gemma3-1b`
- `llama3.2-1b`
- `qwen3-0.6b`
- `qwen3-1.7b`
- `llama3.2-3b`

Treat model availability as runtime-dependent. WebGPU, WASM, native, and remote
servers may not support the same identifiers.

Each catalog entry also includes capability metadata:

```ts
client.model("qwen3-0.6b")?.capabilities;
// ["chat", "stream", "tools", "skills"]
```

## Examples

After `pnpm build`:

```bash
node examples/bitnet-server.mjs
```

For browsers, see:

```txt
examples/browser-webgpu.tsx
```

## Intended Claw3D Role

This package should power the planned **On-Device AI** runtime profile:

```txt
Claw3D web/mobile UI
  -> LocalAIClient
  -> native, WebGPU, WASM, or remote BitNet
  -> one local demo agent
```

That lets demo mode become a real local LLM path without requiring a gateway.

## Boundaries

This package does:

- backend detection and selection
- model catalog lookup
- lightweight chat/completion/streaming API
- optional native/backend driver seam

This package does not:

- manage memory or long-term conversation state
- download native Android models
- implement a custom tensor engine
- expose OpenClaw/Hermes gateway semantics
- guarantee every backend supports every model

Memory, persistence, and context compaction should be separate layers that wrap
`LocalAIClient`.
