import { describe, expect, it } from "vitest";
import { LocalAIClient } from "../src/client.js";
import type {
  BackendDriver,
  GenerateRequest,
  GenerateResult,
  LoadProgress,
} from "../src/types.js";

const createNativeDriver = () => {
  const calls: { loaded: string[]; completed: GenerateRequest[] } = {
    loaded: [],
    completed: [],
  };
  const driver: BackendDriver = {
    name: "native",
    isAvailable: () => true,
    load: async (modelId: string, onProgress?: (p: LoadProgress) => void) => {
      calls.loaded.push(modelId);
      onProgress?.({ backend: "native", progress: 1, text: "ready" });
    },
    stream: async function* (request: GenerateRequest) {
      yield request.messages[request.messages.length - 1]?.content ?? "";
    },
    complete: async (request: GenerateRequest): Promise<GenerateResult> => {
      calls.completed.push(request);
      return {
        content: `reply:${request.messages[request.messages.length - 1]?.content ?? ""}`,
        model: request.model ?? "missing-model",
        backend: "native",
      };
    },
  };
  return { driver, calls };
};

describe("LocalAIClient", () => {
  it("loads the default model through the selected backend", async () => {
    const { driver, calls } = createNativeDriver();
    const progress: LoadProgress[] = [];
    const client = new LocalAIClient({
      nativeDriver: driver,
      defaultModelId: "smollm2-360m",
      onProgress: (entry) => progress.push(entry),
    });

    await expect(client.load()).resolves.toBe("native");

    expect(client.activeBackend).toBe("native");
    expect(calls.loaded).toEqual(["smollm2-360m"]);
    expect(progress).toEqual([
      { backend: "native", progress: 1, text: "ready" },
    ]);
  });

  it("injects the default canonical model for non-remote completions", async () => {
    const { driver, calls } = createNativeDriver();
    const client = new LocalAIClient({
      nativeDriver: driver,
      defaultModelId: "qwen3-0.6b",
    });

    await expect(client.ask("hello")).resolves.toBe("reply:hello");

    expect(calls.completed).toHaveLength(1);
    expect(calls.completed[0]?.model).toBe("qwen3-0.6b");
  });

  it("passes explicit generation options through chat", async () => {
    const { driver, calls } = createNativeDriver();
    const client = new LocalAIClient({ nativeDriver: driver });

    await client.chat(
      [
        { role: "system", content: "brief" },
        { role: "user", content: "status" },
      ],
      { model: "custom-model", maxTokens: 32, temperature: 0.1, topP: 0.8 },
    );

    expect(calls.completed[0]).toMatchObject({
      model: "custom-model",
      maxTokens: 32,
      temperature: 0.1,
      topP: 0.8,
    });
  });

  it("exposes backend availability and selection details", async () => {
    const { driver } = createNativeDriver();
    const client = new LocalAIClient({ nativeDriver: driver });

    await expect(client.availability()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "native",
          available: true,
        }),
      ]),
    );
    await expect(client.select()).resolves.toMatchObject({
      backend: "native",
      availability: [expect.objectContaining({ name: "native", available: true })],
    });
    expect(client.activeBackend).toBe("native");
  });

  it("exposes model capability metadata", () => {
    const client = new LocalAIClient();

    expect(client.model("smollm2-360m")?.capabilities).toEqual([
      "chat",
      "stream",
    ]);
  });
});
