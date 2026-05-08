import { spawnSync } from "node:child_process";
import { loadState, type FarmPersona, type FarmState } from "./farm-state";

export type SerfStatus = "running" | "idle" | "dead";

export interface SerfInfo {
  name: string;
  slug: string;
  session: string;
  status: SerfStatus;
  lines: number;
  persona: FarmPersona;
}

function tmux(args: string[]): { stdout: string; stderr: string; status: number } {
  const r = spawnSync("tmux", args, { encoding: "utf-8", timeout: 10_000 });
  return { stdout: (r.stdout || "").trimEnd(), stderr: (r.stderr || "").trimEnd(), status: r.status ?? 0 };
}

export function serfSessionName(personaName: string): string {
  return "farm-" + personaName.toLowerCase().replace(/\s+/g, "-");
}

export function createSerf(
  persona: FarmPersona,
  transport: string,
  model: string,
  backend?: string,
): { ok: boolean; session: string; error?: string } {
  const session = serfSessionName(persona.name);
  const existing = tmux(["has-session", "-t", session]);
  if (existing.status === 0) {
    tmux(["kill-session", "-t", session]);
  }

  const env: Record<string, string> = {};
  // If using ollama backend, route through OPENAI_BASE_URL or similar
  // For now, just pass through — the transport handles its own backend

  let cmd: string;
  let args: string[];

  switch (transport) {
    case "pi":
      cmd = "pi";
      args = ["--model", model, "--no-skills", "--no-extensions", "--no-context-files"];
      break;
    case "claude":
      cmd = "claude";
      args = ["--model", model];
      break;
    case "opencode":
      cmd = "opencode";
      args = ["--model", model];
      break;
    case "codex":
      cmd = "codex";
      args = ["exec", "--model", model];
      break;
    case "openai":
      cmd = "openai";
      args = ["--model", model];
      break;
    default:
      cmd = transport;
      args = ["--model", model];
  }

  const r = tmux([
    "new-session", "-d", "-s", session,
    cmd, ...args,
  ]);

  if (r.status !== 0) {
    return { ok: false, session, error: r.stderr || "Failed to create session" };
  }

  // Inject persona identity as first message
  const identity = `[AS: ${persona.name} — ${persona.traits}]
You are the ${persona.name} serf on Sentinal Farm. Your role: ${persona.role}.
Respond directly. No preamble. No "Here is". Just the work.`;

  tmux(["send-keys", "-t", session, identity]);
  tmux(["send-keys", "-t", session, "Enter"]);

  return { ok: true, session };
}

export function attachSerf(session: string): void {
  // Exec replaces current process with tmux attach
  const { spawn } = require("node:child_process");
  const child = spawn("tmux", ["attach-session", "-t", session], {
    stdio: "inherit",
  });
  child.on("exit", () => process.exit(0));
}

export function sendToSerf(session: string, message: string): void {
  // Escape special characters for tmux send-keys
  const escaped = message.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  tmux(["send-keys", "-t", session, escaped]);
  tmux(["send-keys", "-t", session, "Enter"]);
}

export function capturePane(session: string): string {
  const r = tmux(["capture-pane", "-p", "-t", session, "-S", "-"]);
  return r.stdout;
}

export function listSerfs(): SerfInfo[] {
  const state = loadState();
  const sessions = tmux(["list-sessions", "-F", "#{session_name}"]);
  const farmSessions = sessions.stdout
    .split("\n")
    .filter(s => s.startsWith("farm-"))
    .map(s => s.trim())
    .filter(Boolean);

  return state.personas.map(p => {
    const session = serfSessionName(p.name);
    const exists = farmSessions.includes(session);
    let lines = 0;

    if (exists) {
      const pane = tmux(["capture-pane", "-p", "-t", session, "-S", "-"]);
      lines = pane.stdout.split("\n").length;
    }

    return {
      name: p.name,
      slug: p.name.toLowerCase().replace(/\s+/g, "-"),
      session,
      status: exists ? "running" : "dead",
      lines,
      persona: p,
    };
  });
}

export function killSerf(session: string): boolean {
  const r = tmux(["kill-session", "-t", session]);
  return r.status === 0;
}

export function killAllSerfs(): number {
  const serfs = listSerfs();
  let killed = 0;
  for (const s of serfs) {
    if (s.status === "running") {
      killSerf(s.session);
      killed++;
    }
  }
  return killed;
}

export function serfResponded(session: string, marker: string, timeoutMs = 60_000): boolean {
  const start = Date.now();
  const pollInterval = 500;

  while (Date.now() - start < timeoutMs) {
    const content = capturePane(session);
    if (content.includes(marker)) return true;
    Bun.sleepSync(pollInterval);
  }
  return false;
}

export function waitForSerfIdle(session: string, timeoutMs = 120_000): string {
  const start = Date.now();
  let lastContent = "";
  let stableCounter = 0;
  const stableThreshold = 4; // 4 polls of stability = done

  while (Date.now() - start < timeoutMs) {
    const content = capturePane(session);
    if (content === lastContent) {
      stableCounter++;
      if (stableCounter >= stableThreshold) return content;
    } else {
      stableCounter = 0;
      lastContent = content;
    }
    Bun.sleepSync(800);
  }

  return capturePane(session);
}
