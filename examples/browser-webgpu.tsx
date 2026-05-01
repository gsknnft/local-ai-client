import { LocalAIClient } from "../src/client.js";

const output = document.querySelector<HTMLPreElement>("#output");
const button = document.querySelector<HTMLButtonElement>("#run");

const write = (line: string) => {
  if (!output) return;
  output.textContent += `${line}\n`;
};

const client = new LocalAIClient({
  backendPriority: ["webgpu", "wasm"],
  defaultModelId: "smollm2-360m",
  onProgress: (p) => write(`[${p.backend}] ${Math.round(p.progress * 100)}% ${p.text}`),
});

button?.addEventListener("click", async () => {
  button.disabled = true;
  output!.textContent = "";

  try {
    write("Availability:");
    write(JSON.stringify(await client.availability(), null, 2));

    const backend = await client.load();
    write(`Selected: ${backend}`);
    write("");

    for await (const delta of client.stream({
      messages: [{ role: "user", content: "Say hello from the browser model." }],
      maxTokens: 64,
    })) {
      output!.textContent += delta;
    }
  } catch (err) {
    write(err instanceof Error ? err.message : String(err));
  } finally {
    button.disabled = false;
  }
});
