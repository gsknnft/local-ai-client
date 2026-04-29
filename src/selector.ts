import type { BackendDriver, BackendName } from "./types.js";
import { WebGPUBackend } from "./backends/webgpu.js";
import { WasmBackend } from "./backends/wasm.js";
import { RemoteBackend } from "./backends/remote.js";

export type SelectorOptions = {
  priority?: BackendName[];
  remoteBaseUrl?: string;
  remoteToken?: string;
  remoteModel?: string;
  nativeDriver?: BackendDriver;
};

const DEFAULT_PRIORITY: BackendName[] = ["native", "webgpu", "wasm", "remote"];

/**
 * Returns the highest-priority available backend driver.
 * Probe order follows `priority` (defaults to native→webgpu→wasm→remote).
 */
export async function selectBackend(options: SelectorOptions = {}): Promise<BackendDriver> {
  const priority = options.priority ?? DEFAULT_PRIORITY;
  const candidates = buildCandidates(options);

  for (const name of priority) {
    const driver = candidates.get(name);
    if (!driver) continue;
    if (await driver.isAvailable()) return driver;
  }

  throw new Error(
    "LocalAI: no backend is available. " +
      "Provide a remoteBaseUrl for a remote fallback, or use Chrome/Edge for WebGPU."
  );
}

function buildCandidates(options: SelectorOptions): Map<BackendName, BackendDriver> {
  const map = new Map<BackendName, BackendDriver>();

  if (options.nativeDriver) {
    map.set("native", options.nativeDriver);
  }
  map.set("webgpu", new WebGPUBackend());
  map.set("wasm", new WasmBackend());
  if (options.remoteBaseUrl) {
    map.set("remote", new RemoteBackend(options.remoteBaseUrl, options.remoteToken, options.remoteModel));
  }

  return map;
}
