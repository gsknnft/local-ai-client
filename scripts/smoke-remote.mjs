import { LocalAIClient } from "../dist/index.js";

const baseUrl = process.env.LOCAL_AI_REMOTE_URL ?? process.env.BITNET_BASE_URL;
const configuredModel = process.env.LOCAL_AI_REMOTE_MODEL ?? process.env.BITNET_MODEL;
const token = process.env.LOCAL_AI_REMOTE_TOKEN ?? "";
const stop = [
  "\nUSER:",
  "\nUser:",
  "\nHuman:",
  "\nASSISTANT:",
  "\nAssistant:",
  "\nAI:",
  "\nBitnet:",
  "\nBITNETAssistant:",
];

if (!baseUrl) {
  console.error("Remote smoke requires LOCAL_AI_REMOTE_URL or BITNET_BASE_URL.");
  console.error("Example: LOCAL_AI_REMOTE_URL=http://127.0.0.1:7780 pnpm smoke:remote");
  process.exit(1);
}

async function run() {
  console.log(`Starting remote smoke against ${baseUrl}`);

  const model = configuredModel ?? await discoverDefaultModel(baseUrl, token);
  console.log(`Using model: ${model}`);

  const client = new LocalAIClient({
    backendPriority: ["remote"],
    remoteBaseUrl: baseUrl,
    remoteModel: model,
    remoteToken: token,
    timeoutMs: 30_000,
  });

  console.log("Checking remote availability...");
  const availability = await client.availability();
  console.table(availability);

  console.log("Selecting backend...");
  const selected = await client.select();
  console.log(`Selected backend: ${selected.backend}`);

  console.log("Sending chat completion request...");
  const answer = await client.ask("Reply in one short sentence: local AI remote smoke is ready.", {
    maxTokens: 64,
    temperature: 0.2,
    stop,
  });
  console.log("Remote response:");
  console.log(answer);
}

run().catch((err) => {
  console.error("Remote smoke failed:", err);
  process.exit(1);
});

async function discoverDefaultModel(baseUrl, token) {
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/v1/models`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    const first = payload?.data?.[0]?.id;
    if (typeof first === "string" && first.length > 0) return first;
  } catch (err) {
    console.warn(
      `Could not discover /v1/models (${err instanceof Error ? err.message : String(err)}); using default alias.`,
    );
  }
  return "bitnet-b1.58-2B-4T";
}
