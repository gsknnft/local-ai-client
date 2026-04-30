import type { BackendAvailability, BackendDriver, BackendName, BackendSelection } from "./types.js";
import { WebGPUBackend } from "./backends/webgpu.js";
import { WasmBackend } from "./backends/wasm.js";
import { RemoteBackend } from "./backends/remote.js";

export type SelectorOptions = {
  priority?: BackendName[];
  remoteBaseUrl?: string;
  remoteToken?: string;
  remoteModel?: string;
  timeoutMs?: number;
  nativeDriver?: BackendDriver;
};

const DEFAULT_PRIORITY: BackendName[] = ["native", "webgpu", "wasm", "remote"];

/**
 * Returns the highest-priority available backend driver.
 * Probe order follows `priority` (defaults to native→webgpu→wasm→remote).
 */
export async function selectBackend(options: SelectorOptions = {}): Promise<BackendDriver> {
  return (await selectBackendWithReport(options)).driver;
}

export async function selectBackendWithReport(options: SelectorOptions = {}): Promise<BackendSelection> {
  const priority = options.priority ?? DEFAULT_PRIORITY;
  const candidates = buildCandidates(options);
  const availability: BackendAvailability[] = [];

  for (const name of priority) {
    const driver = candidates.get(name);
    if (!driver) {
      availability.push(unavailable(name, "backend is not configured"));
      continue;
    }
    const status = await probeBackend(driver);
    availability.push(status);
    if (status.available) {
      return { backend: driver.name, driver, availability };
    }
  }

  throw new Error(
    "LocalAI: no backend is available. " +
      "Provide a remoteBaseUrl for a remote fallback, or use Chrome/Edge for WebGPU."
  );
}

export async function inspectBackends(options: SelectorOptions = {}): Promise<BackendAvailability[]> {
  const priority = options.priority ?? DEFAULT_PRIORITY;
  const candidates = buildCandidates(options);
  const availability: BackendAvailability[] = [];
  for (const name of priority) {
    const driver = candidates.get(name);
    availability.push(driver ? await probeBackend(driver) : unavailable(name, "backend is not configured"));
  }
  return availability;
}

function buildCandidates(options: SelectorOptions): Map<BackendName, BackendDriver> {
  const map = new Map<BackendName, BackendDriver>();

  if (options.nativeDriver) {
    map.set("native", options.nativeDriver);
  }
  map.set("webgpu", new WebGPUBackend());
  map.set("wasm", new WasmBackend());
  if (options.remoteBaseUrl) {
    map.set("remote", new RemoteBackend(options.remoteBaseUrl, options.remoteToken, options.remoteModel, {
      timeoutMs: options.timeoutMs,
    }));
  }

  return map;
}

async function probeBackend(driver: BackendDriver): Promise<BackendAvailability> {
  if (driver.availability) return driver.availability();
  try {
    const available = await driver.isAvailable();
    return {
      name: driver.name,
      available,
      reason: available ? undefined : "backend reported unavailable",
      local: driver.name !== "remote",
      privacy: driver.name === "remote" ? "remote" : "unknown",
      capabilities: ["chat", "stream"],
    };
  } catch (err) {
    return unavailable(driver.name, err instanceof Error ? err.message : String(err));
  }
}

function unavailable(name: BackendName, reason: string): BackendAvailability {
  return {
    name,
    available: false,
    reason,
    local: name !== "remote",
    privacy: name === "remote" ? "remote" : name === "native" ? "native" : "unknown",
    capabilities: [],
  };
}
