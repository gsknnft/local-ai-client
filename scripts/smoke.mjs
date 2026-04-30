import { LocalAIClient } from "../dist/index.js";

const nativeDriver = {
  name: "native",
  isAvailable: () => true,
  load: async (_modelId, onProgress) => {
    onProgress?.({ backend: "native", progress: 1, text: "mock native ready" });
  },
  async *stream(request) {
    const last = request.messages.at(-1)?.content ?? "";
    yield `mock-native:${last}`;
  },
  complete: async (request) => ({
    content: `mock-native:${request.messages.at(-1)?.content ?? ""}`,
    model: request.model ?? "native-default",
    backend: "native",
  }),
  availability: () => ({
    name: "native",
    available: true,
    local: true,
    privacy: "native",
    capabilities: ["chat", "stream"],
  }),
};

async function run() {
  console.log("Starting contract smoke test with mock native driver.");
  console.log("This verifies the package API and backend selector without downloading a model.");

  const progress = [];
  const client = new LocalAIClient({
    nativeDriver,
    onProgress: (entry) => progress.push(entry),
  });

  const availability = await client.availability();
  console.table(availability);

  const selected = await client.select();
  console.log(`Selected backend: ${selected.backend}`);

  const loaded = await client.load();
  console.log(`Loaded backend: ${loaded}`);
  console.table(progress);

  const answer = await client.ask("hello");
  console.log(answer);

  const chunks = [];
  for await (const delta of client.stream({
    messages: [{ role: "user", content: "stream" }],
    maxTokens: 32,
  })) {
    chunks.push(delta);
  }
  console.log(chunks.join(""));
}

run().catch((err) => {
  console.error("Contract smoke failed:", err);
  process.exit(1);
});
