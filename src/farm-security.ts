import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FarmConfig, TransportType, Org } from "./types";

const CONFIG_PATH = "farm.json";

export function loadFarmConfig(workspaceRoot: string): FarmConfig {
  const path = join(workspaceRoot, ".sentinel", CONFIG_PATH);
  if (!existsSync(path)) {
    return { security: { addPaths: [], availableTransports: ["claude"] } };
  }
  const raw = readFileSync(path, "utf-8");
  const parsed = JSON.parse(raw);
  return {
    security: {
      addPaths: parsed.security?.addPaths || [],
      availableTransports: parsed.security?.availableTransports || ["claude"],
    },
  };
}

export function deriveAllowedPaths(workspaceRoot: string, config: FarmConfig): string[] {
  const { readdirSync, statSync } = require("node:fs");
  const exclude = new Set(["node_modules", ".git", "dist", ".env", "bun.lock"]);
  let entries: string[] = [];
  try {
    entries = readdirSync(workspaceRoot);
  } catch { return []; }

  const autoDirs = entries.filter((e: string) => {
    if (exclude.has(e)) return false;
    try { return statSync(join(workspaceRoot, e)).isDirectory(); }
    catch { return false; }
  });

  const merged = [...new Set([...autoDirs, ...config.security.addPaths])];
  return merged.map(p => p.endsWith("/") ? p : p + "/");
}

export function validatePath(inputPath: string, workspaceRoot: string, allowedPaths: string[]): boolean {
  const { resolve, sep } = require("node:path");
  const resolved = resolve(inputPath);
  const root = resolve(workspaceRoot);
  if (!resolved.startsWith(root)) return false;
  const relative = resolved.slice(root.length).replace(/\\/g, "/");
  if (relative === "" || relative === "/") return true;
  const firstSegment = relative.split("/")[0] + "/";
  return allowedPaths.includes(firstSegment);
}

export function writeSteering(workspaceRoot: string, message: string) {
  const path = join(workspaceRoot, ".sentinel", "steering.jsonl");
  writeFileSync(path, JSON.stringify({ message, timestamp: new Date().toISOString() }) + "\n", { flag: "a" });
}

export function drainSteering(workspaceRoot: string): string[] {
  const path = join(workspaceRoot, ".sentinel", "steering.jsonl");
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf-8").trim().split("\n");
  writeFileSync(path, "");
  return lines.filter(Boolean).map(l => JSON.parse(l).message);
}
