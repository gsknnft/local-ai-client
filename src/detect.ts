import type { RuntimeEnvironment } from "./types.js";

export function detectRuntime(): RuntimeEnvironment {
  if (typeof window === "undefined") return "node";
  const cap = (window as unknown as Record<string, unknown>).Capacitor;
  if (cap && typeof cap === "object") return "capacitor";
  return "browser";
}

export function isNativeCapacitor(): boolean {
  return detectRuntime() === "capacitor";
}

/** True when the current environment exposes a WebGPU adapter. */
export function isWebGPUSupported(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}
