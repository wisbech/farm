import { spawn, spawnSync } from "node:child_process";
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

const DASHBOARD = "farm-dashboard";
const NAV_TABLE = "farm-nav";

function tmux(args: string[]): { stdout: string; stderr: string; status: number } {
  const r = spawnSync("tmux", args, { encoding: "utf-8", timeout: 10_000 });
  return { stdout: (r.stdout || "").trimEnd(), stderr: (r.stderr || "").trimEnd(), status: r.status ?? 0 };
}

function tmuxBackground(args: string[]): void {
  spawn("tmux", args, { stdio: "ignore", detached: true }).unref();
}

// ── Serf session name ──

export function serfSessionName(personaName: string): string {
  return "farm-" + personaName.toLowerCase().replace(/\s+/g, "-");
}

// ── Dashboard singleton ──

export function dashboardExists(): boolean {
  return tmux(["has-session", "-t", DASHBOARD]).status === 0;
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

  const r = tmux(["new-session", "-d", "-s", session, cmd, ...args]);

  if (r.status !== 0) {
    return { ok: false, session, error: r.stderr || "Failed to create session" };
  }

  const identity = `[AS: ${persona.name} — ${persona.traits}]
You are the ${persona.name} serf on Sentinal Farm. Your role: ${persona.role}.
Respond directly. No preamble. No "Here is". Just the work.`;

  tmux(["send-keys", "-t", session, identity]);
  tmux(["send-keys", "-t", session, "Enter"]);

  return { ok: true, session };
}

export function ensureDashboard(): string[] {
  const serfs = listSerfs().filter(s => s.status === "running");
  if (serfs.length === 0) return [];

  // Kill existing dashboard if it exists — we rebuild it
  if (dashboardExists()) {
    tmux(["kill-session", "-t", DASHBOARD]);
  }

  // Create fresh dashboard with first serf
  tmux(["new-session", "-d", "-s", DASHBOARD]);
  tmux(["link-window", "-s", serfs[0].session + ":0", "-t", DASHBOARD + ":0", "-k"]);
  tmux(["set-window-option", "-t", DASHBOARD, "allow-rename", "off"]);
  tmux(["rename-window", "-t", DASHBOARD, "serfs"]);

  // Link remaining serfs as new windows, then join them as panes
  let panes = 1;
  for (let i = 1; i < serfs.length; i++) {
    const winIdx = i;
    tmux(["new-window", "-t", DASHBOARD]);
    tmux(["link-window", "-s", serfs[i].session + ":0", "-t", DASHBOARD + ":" + winIdx, "-k"]);
    tmux(["join-pane", "-s", DASHBOARD + ":" + winIdx, "-t", DASHBOARD + ":0"]);
    panes++;
  }

  // Tiled layout
  tmux(["select-layout", "-t", DASHBOARD, "tiled"]);

  // Set up navigation key table
  setupNavKeys();

  // Hook: when a client attaches to dashboard, enter farm-nav key table
  tmux(["set-hook", "-t", DASHBOARD, "client-attached",
    'run-shell "tmux switch-client -c ' + DASHBOARD + ' -T ' + NAV_TABLE + '"', ]);

  return serfs.map(s => s.session);
}

function setupNavKeys(): void {
  // Clear any existing bindings in our nav table
  tmux(["unbind-key", "-T", NAV_TABLE, "Up"]);
  tmux(["unbind-key", "-T", NAV_TABLE, "Down"]);
  tmux(["unbind-key", "-T", NAV_TABLE, "Left"]);
  tmux(["unbind-key", "-T", NAV_TABLE, "Right"]);
  tmux(["unbind-key", "-T", NAV_TABLE, "Enter"]);
  tmux(["unbind-key", "-T", NAV_TABLE, "Escape"]);

  // Arrow navigation between panes
  tmux(["bind-key", "-T", NAV_TABLE, "Up", "select-pane", "-U"]);
  tmux(["bind-key", "-T", NAV_TABLE, "Down", "select-pane", "-D"]);
  tmux(["bind-key", "-T", NAV_TABLE, "Left", "select-pane", "-L"]);
  tmux(["bind-key", "-T", NAV_TABLE, "Right", "select-pane", "-R"]);

  // Enter = zoom into serf, switch to root key table (normal operation)
  tmux(["bind-key", "-T", NAV_TABLE, "Enter",
    'run-shell "tmux resize-pane -Z \\; switch-client -T root"', ]);

  // Escape = stay in dashboard but switch to root table
  tmux(["bind-key", "-T", NAV_TABLE, "Escape", "switch-client", "-T", "root"]);

  // In root table: Ctrl+Space = unzoom + re-enter nav mode
  tmux(["bind-key", "-T", "root", "C-Space",
    'run-shell "tmux resize-pane -Z \\; switch-client -T ' + NAV_TABLE + '"', ]);
}

// ── Attach ──

export function attachDashboard(): void {
  if (!dashboardExists()) {
    ensureDashboard();
  }

  const child = spawn("tmux", ["attach-session", "-t", DASHBOARD], {
    stdio: "inherit",
  });
  child.on("exit", () => process.exit(0));
}

// ── Serf operations ──

export function sendToSerf(session: string, message: string): void {
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
  const farmNames = new Set(
    sessions.stdout
      .split("\n")
      .filter(s => s.startsWith("farm-") && s !== DASHBOARD)
      .map(s => s.trim())
      .filter(Boolean)
  );

  return state.personas.map(p => {
    const session = serfSessionName(p.name);
    const exists = farmNames.has(session);
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
  // Kill dashboard first
  try { tmux(["kill-session", "-t", DASHBOARD]); } catch {}

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
  const stableThreshold = 4;

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

// ── Legacy compat (attach to single serf, no dashboard) ──

export function attachSerf(session: string): void {
  const child = spawn("tmux", ["attach-session", "-t", session], {
    stdio: "inherit",
  });
  child.on("exit", () => process.exit(0));
}
