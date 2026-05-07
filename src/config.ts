import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { TransportType } from "./types";

export interface SentinelConfig {
  transport: TransportType;
  backend?: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  updated: string;
}

const CONFIG_DIR = join(homedir(), ".sentinel");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

const DEFAULTS: Record<string, { transport: TransportType; model: string }> = {
  pi: { transport: "pi", model: "anthropic/claude-sonnet-4-20250514" },
  claude: { transport: "claude", model: "claude-sonnet-4-20250514" },
  opencode: { transport: "opencode", model: "claude-sonnet-4-20250514" },
  codex: { transport: "codex", model: "gpt-5" },
  openai: { transport: "openai", model: "gpt-5" },
  copilot: { transport: "copilot", model: "github-copilot" },
  hermes: { transport: "hermes", model: "llama3.1" },
  bun: { transport: "bun", model: "claude-sonnet-4-20250514" },
};

export async function loadConfig(): Promise<SentinelConfig | null> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    return JSON.parse(raw) as SentinelConfig;
  } catch {
    return null;
  }
}

export async function saveConfig(config: SentinelConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  config.updated = new Date().toISOString();
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function defaultsFor(transport: TransportType): { transport: TransportType; model: string } {
  return DEFAULTS[transport] || { transport: "claude", model: "claude-sonnet-4-20250514" };
}

export function allTransports(): { key: TransportType; label: string; description: string }[] {
  return [
    { key: "claude", label: "Claude Code", description: "Anthropic's official CLI (`claude`)" },
    { key: "pi", label: "Pi", description: "Minimal terminal coding harness (`pi`)" },
    { key: "opencode", label: "OpenCode", description: "OpenCode CLI (`opencode`)" },
    { key: "codex", label: "OpenAI Codex", description: "OpenAI's coding agent (`codex`)" },
    { key: "openai", label: "OpenAI CLI", description: "OpenAI's official CLI (`openai`)" },
    { key: "copilot", label: "Copilot CLI", description: "GitHub Copilot CLI (`github-copilot-cli`)" },
    { key: "hermes", label: "Hermes Agent", description: "Hermes AI agent (`hermes`)" },
    { key: "bun", label: "Direct API", description: "Anthropic/OpenAI API via fetch (zero deps)" },
  ];
}

export async function tryExec(cmd: string): Promise<string | null> {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve) => {
    const child = spawn(cmd, ["--version"], { stdio: "ignore" });
    child.on("close", (code) => resolve(code === 0 ? cmd : null));
    child.on("error", () => resolve(null));
  });
}

export async function detectAvailable(): Promise<TransportType[]> {
  const available: TransportType[] = [];
  const checks = [
    { cmd: "claude", key: "claude" as TransportType },
    { cmd: "pi", key: "pi" as TransportType },
    { cmd: "opencode", key: "opencode" as TransportType },
    { cmd: "codex", key: "codex" as TransportType },
    { cmd: "openai", key: "openai" as TransportType },
    { cmd: "github-copilot-cli", key: "copilot" as TransportType },
    { cmd: "hermes", key: "hermes" as TransportType },
  ];

  for (const { cmd, key } of checks) {
    const found = await tryExec(cmd);
    if (found) available.push(key);
  }

  available.push("bun");

  return available;
}

export interface OllamaModel {
  name: string;
  size: number;
  parameterSize: string;
  modifiedAt: string;
  isLocal: boolean;
}

export async function listOllamaModels(baseUrl?: string): Promise<OllamaModel[]> {
  const base = baseUrl || "http://localhost:11434";
  try {
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
    const json = await res.json();
    const models = (json.models || []) as any[];

    return models
      .filter((m: any) => !m.name.includes("embed"))
      .map((m: any) => ({
        name: m.name,
        size: m.size || 0,
        parameterSize: m.details?.parameter_size || "",
        modifiedAt: m.modified_at || "",
        isLocal: !m.remote_model,
      }))
      .sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());
  } catch {
    return [];
  }
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}
