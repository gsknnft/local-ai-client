import { LocalAIClient } from "../dist/index.js";

const baseUrl = process.env.BITNET_BASE_URL ?? "http://127.0.0.1:7780";
const model = process.env.BITNET_MODEL ?? "bitnet-b1.58-2B-4T";

const client = new LocalAIClient({
  backendPriority: ["remote"],
  remoteBaseUrl: baseUrl,
  remoteModel: model,
  timeoutMs: 30_000,
});

console.log("Probing local BitNet/OpenAI-compatible endpoint...");
console.table(await client.availability());

const selected = await client.select();
console.log(`Selected backend: ${selected.backend}`);

const answer = await client.ask("Reply in one sentence: local inference is ready.");
console.log(answer);
