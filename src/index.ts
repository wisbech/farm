import { loadConfig, saveConfig, defaultsFor, allTransports, listOllamaModels, formatSize, type SentinelConfig } from "./config";
import type { OllamaModel } from "./config";
import type { TransportType } from "./types";
import { loadState, findPersona } from "./farm-state";
import { createSerf, serfSessionName, listSerfs, killSerf, killAllSerfs, attachSerf, sendToSerf, capturePane, waitForSerfIdle } from "./farm-session";
import { harness } from "./harness";
import type { Org, Task } from "./types";

const ARGS = process.argv.slice(2);
const ROOT = process.cwd();

async function main() {
  const cmd = ARGS[0];
  const cmdArgs = ARGS.slice(1);

  switch (cmd) {
    case "launch":   await handleLaunch(cmdArgs); return;
    case "serf":     await handleSerf(cmdArgs); return;
    case "list":     await handleList(); return;
    case "spawn":    await handleSpawn(cmdArgs); return;
    case "harvest":  await handleHarvest(cmdArgs); return;
    case "kill":     await handleKill(cmdArgs); return;
    case "evolve":   await handleEvolve(cmdArgs); return;
    case "distill":  console.log("farm distill coming soon — use harvest first"); return;
    case "bench":    console.log("farm bench coming soon — use harvest first"); return;
    case "assembly": console.log("farm assembly coming soon — use harvest first"); return;
    case "tools":    console.log("farm tools coming soon — use harvest first"); return;
    case "machines": console.log("farm machines coming soon — use harvest first"); return;
    case "help":
    case "--help":
    case "-h":
    default:         printHelp(); return;
  }
}

// ── LAUNCH ──

async function handleLaunch(args: string[]) {
  const { transport: explicitTransport, options } = parseLaunchArgs(args);
  let config: SentinelConfig | null = null;

  if (explicitTransport) {
    const defaults = defaultsFor(explicitTransport);
    let model = options.model || defaults.model;
    let baseUrl = options.baseUrl;

    if (options.backend === "ollama") {
      const models = await listOllamaModels();
      if (models.length === 0) {
        console.log("Ollama not reachable or no models found.\nStart Ollama and pull a model: ollama pull llama3.1");
        process.exit(1);
      }

      if (options.model) {
        model = options.model;
      } else {
        model = await pickOllamaModelInteractive(models);
        if (!model) { console.log("No model selected."); process.exit(1); }
      }
      if (!baseUrl) baseUrl = "http://localhost:11434";
    }

    config = {
      transport: explicitTransport,
      backend: options.backend,
      model,
      apiKey: options.apiKey,
      baseUrl,
      updated: new Date().toISOString(),
    };
  } else {
    const existing = await loadConfig();
    console.log(existing
      ? `Saved config: ${existing.transport}${existing.backend ? ` (backend: ${existing.backend})` : ""} (${existing.model})\n`
      : "No saved configuration.\n");

    const transport = await pickTransport();
    if (!transport) {
      console.log("No transport selected. Exiting.");
      process.exit(0);
    }

    const defaults = defaultsFor(transport);
    console.log("");
    const model = await askWithDefault("Model", defaults.model);
    let apiKey: string | undefined;
    let baseUrl: string | undefined;

    config = { transport, model, apiKey, baseUrl, updated: new Date().toISOString() };
  }

  await saveConfig(config);
  console.log(`\nConfiguration saved:`);
  console.log(`  Transport: ${config.transport}${config.backend ? ` (backend: ${config.backend})` : ""}`);
  console.log(`  Model:     ${config.model}`);
  if (config.apiKey) console.log(`  API Key:   [set]`);
  if (config.baseUrl) console.log(`  Base URL:  ${config.baseUrl}`);

  // Launch serfs
  const state = loadState();
  const detach = args.includes("--detach");

  if (detach) {
    console.log(`\nStarting ${state.personas.length} serfs in detached mode...`);
  } else {
    console.log(`\nStarting ${state.personas.length} serfs...`);
  }

  const sessions: string[] = [];
  for (const persona of state.personas) {
    const result = createSerf(persona, config.transport, config.model, config.backend);
    if (result.ok) {
      sessions.push(result.session);
      console.log(`  ✓ ${persona.name} → ${result.session}`);
    } else {
      console.log(`  ✗ ${persona.name}: ${result.error}`);
    }
  }

  if (detach) {
    console.log(`\nSerfs running in background. Use 'farm serf' to attach, 'farm list' to view.`);
    console.log(`  Ctrl+B D to detach, 'farm kill --all' to stop.`);
    process.exit(0);
  }

  console.log(`\nSerfs are working.`);
  const choice = await ask(`[1] Attach to a serf  [2] Leave detached  [Q] Quit`);
  if (choice === "1") {
    if (sessions.length === 1) {
      attachSerf(sessions[0]);
    } else {
      // Let user pick which serf to attach to
      console.log("\nSerfs:");
      sessions.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
      const pick = await ask(`Attach to [1-${sessions.length}]`);
      const idx = parseInt(pick) - 1;
      if (idx >= 0 && idx < sessions.length) {
        attachSerf(sessions[idx]);
      }
    }
  } else {
    console.log("\nSerfs running in background.");
    console.log("  farm serf         — attach to a serf");
    console.log("  farm list         — view all serfs");
    console.log("  farm spawn <serf> <task>  — send task to serf");
    console.log("  farm kill --all   — stop all serfs");
    process.exit(0);
  }
}

// ── SERF ──

async function handleSerf(args: string[]) {
  if (args.length > 0) {
    const slug = args[0];
    const session = `farm-${slug}`;
    const serfs = listSerfs();
    const found = serfs.find(s => s.session === session);
    if (found && found.status === "running") {
      attachSerf(session);
    } else {
      console.log(`Serf "${slug}" not found or not running.\nUse 'farm list' to see active serfs.`);
      process.exit(1);
    }
    return;
  }

  const serfs = listSerfs();
  if (serfs.every(s => s.status === "dead")) {
    console.log("No serfs running. Run 'farm launch pi' to start.");
    process.exit(1);
  }

  await pickSerfInteractive(serfs.filter(s => s.status === "running"));
}

// ── LIST ──

function handleList() {
  const serfs = listSerfs();
  console.log("\n  Farm Serfs — Sentinel Farm\n");
  for (const s of serfs) {
    const status = s.status === "running" ? "\x1b[32m●\x1b[0m" : "\x1b[31m○\x1b[0m";
    const lineInfo = s.lines > 0 ? ` · ${s.lines} lines` : "";
    console.log(`  ${status} ${s.name}  (${s.session})${lineInfo}`);
  }
  if (serfs.every(s => s.status === "dead")) {
    console.log("\n  No serfs running. Run 'farm launch pi' to start.");
  } else {
    console.log(`\n  farm serf          attach to a serf`);
    console.log(`  farm spawn <serf> <task>  send work to serf`);
    console.log(`  farm harvest <task>       distribute work across serfs`);
    console.log(`  farm kill --all           stop all serfs`);
  }
  console.log("");
}

// ── SPAWN ──

function handleSpawn(args: string[]) {
  if (args.length < 2) {
    console.log("Usage: farm spawn <serf-name> <task>");
    process.exit(1);
  }

  const serfName = args[0];
  const task = args.slice(1).join(" ");
  const session = serfSessionName(serfName);

  const serfs = listSerfs();
  const found = serfs.find(s => s.session === session);

  if (!found || found.status !== "running") {
    console.log(`Serf "${serfName}" not running.`);
    console.log("Running serfs:", serfs.filter(s => s.status === "running").map(s => s.name).join(", ") || "none");
    process.exit(1);
  }

  sendToSerf(session, task);
  console.log(`Sent to ${serfName}: ${task}`);
}

// ── HARVEST ──

async function handleHarvest(args: string[]) {
  if (args.length === 0) {
    console.log("Usage: farm harvest <task description>");
    process.exit(1);
  }

  const taskDesc = args.join(" ");
  const config = await loadConfig();
  if (!config) {
    console.log("No config. Run 'farm launch' first.");
    process.exit(1);
  }

  const serfs = listSerfs();
  const running = serfs.filter(s => s.status === "running");
  if (running.length === 0) {
    console.log("No serfs running. Run 'farm launch pi --detach' first.");
    process.exit(1);
  }

  // Build a synthetic Org from running serfs
  const org = await buildOrgFromSerfs(running, config);

  console.log(`\n  ▶ ${taskDesc}\n`);
  console.log(`  Harnessing ${running.length} serfs...\n`);

  const task: Task = {
    id: `task-${Date.now()}`,
    description: taskDesc,
    division: "intelligence",
    complexity: "composite",
    status: "pending",
  };

  try {
    const invoke = createInvoke(config);
    const result = await harness(task, org, invoke);
    console.log(`\n━━━ Harvest Complete ━━━`);
    console.log(formatResult(result.content));
  } catch (err) {
    console.error(`\n  Error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── KILL ──

function handleKill(args: string[]) {
  if (args.includes("--all")) {
    const killed = killAllSerfs();
    console.log(`Killed ${killed} serfs.`);
    return;
  }

  if (args.length === 0) {
    console.log("Usage: farm kill <serf-name>  or  farm kill --all");
    process.exit(1);
  }

  const slug = args[0];
  const session = `farm-${slug}`;
  if (killSerf(session)) {
    console.log(`Killed ${session}.`);
  } else {
    console.log(`Serf "${slug}" not found or could not be killed.`);
  }
}

// ── EVOLVE (placeholder) ──

async function handleEvolve(args: string[]) {
  console.log("farm evolve uses the serf sessions for mutation and verification.\nComing soon — use farm harvest first to get results flow working.");
  process.exit(0);
}

// ── SHARED HELPERS ──

function parseLaunchArgs(args: string[]) {
  const known = allTransports().map(t => t.key);
  let transport: TransportType | null = null;
  const options: any = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (known.includes(arg as TransportType)) transport = arg as TransportType;
    else if (arg === "--model" || arg === "-m") options.model = args[++i];
    else if (arg === "--backend" || arg === "-b" || arg === "--back") options.backend = args[++i] || "ollama";
    else if (arg === "--api-key" || arg === "-k") options.apiKey = args[++i];
    else if (arg === "--base-url" || arg === "--url") options.baseUrl = args[++i];
  }
  return { transport, options };
}

async function pickOllamaModelInteractive(models: OllamaModel[]): Promise<string | null> {
  const MAX_DISPLAY = 10;
  let selectedIdx = 0;
  let visible = Math.min(MAX_DISPLAY, models.length);

  function render() {
    process.stdout.write("\x1b[H\x1b[J");
    const lines: string[] = [];
    lines.push("  Ollama models — ↑↓ to select, Enter to confirm, Esc to quit\n");

    for (let i = 0; i < visible; i++) {
      const m = models[i];
      const cursor = i === selectedIdx ? "▶" : " ";
      const label = i === 0 ? "(latest)" : "";
      const size = formatSize(m.size);
      const tag = m.isLocal ? "local" : "cloud";
      const isSelected = i === selectedIdx;
      const prefix = isSelected ? "\x1b[1;37m\x1b[44m" : "";
      const suffix = isSelected ? "\x1b[0m" : "";
      const num = String(i + 1).padStart(2, " ");
      lines.push(`${prefix}  ${cursor} ${num}. ${m.name} ${label}${suffix}`);
      if (m.parameterSize)
        lines.push(`${prefix}       ${m.parameterSize}, ${size}, ${tag}${suffix}`);
      else
        lines.push(`${prefix}       ${size}, ${tag}${suffix}`);
    }

    const hidden = models.length - visible;
    if (hidden > 0) {
      lines.push(selectedIdx === visible - 1
        ? `\n  ▼ Enter to show ${hidden} more`
        : `\n  … ${hidden} more (arrow to last)`);
    }

    process.stdout.write(lines.join("\n"));
  }

  const { stdin, stdout } = process;
  stdout.write("\x1b[?25l\x1b[?1049h");
  stdin.setRawMode(true);
  stdin.resume();
  render();

  return new Promise((resolve) => {
    function done(value: string | null) {
      stdout.write("\x1b[?1049l\x1b[?25h\x1b[0m");
      stdin.setRawMode(false);
      stdin.removeAllListeners("data");
      setTimeout(() => resolve(value), 50);
    }

    stdin.on("data", (buf: Buffer) => {
      const k = buf.toString();
      if (k === "\x1b[A") { selectedIdx = Math.max(0, selectedIdx - 1); render(); return; }
      if (k === "\x1b[B") {
        if (selectedIdx === visible - 1 && models.length > visible)
          visible = Math.min(visible + MAX_DISPLAY, models.length);
        selectedIdx = Math.min(visible - 1, selectedIdx + 1);
        render(); return;
      }
      if (k === "\r" || k === "\n") {
        if (selectedIdx === visible - 1 && models.length > visible) {
          visible = Math.min(visible + MAX_DISPLAY, models.length);
          selectedIdx = visible - MAX_DISPLAY;
          render(); return;
        }
        done(models[selectedIdx].name);
        return;
      }
      if (k === "\x1b" || k === "\u0003") { done(null); return; }
      const n = parseInt(k);
      if (n >= 1 && n <= Math.min(9, models.length)) { done(models[n - 1].name); return; }
    });
  });
}

async function pickSerfInteractive(serfs: ReturnType<typeof listSerfs>) {
  let selectedIdx = 0;

  function render() {
    process.stdout.write("\x1b[H\x1b[J");
    const lines: string[] = [];
    lines.push("  Farm Serfs — ↑↓ to select, Enter to attach, Esc/Ctrl+C to quit\n");

    for (let i = 0; i < serfs.length; i++) {
      const s = serfs[i];
      const cursor = i === selectedIdx ? "▶" : " ";
      const isSelected = i === selectedIdx;
      const prefix = isSelected ? "\x1b[1;37m\x1b[44m" : "";
      const suffix = isSelected ? "\x1b[0m" : "";

      lines.push(`${prefix}  ${cursor} ${s.name.padEnd(22)} (${s.session})${suffix}`);
    }

    process.stdout.write(lines.join("\n"));
  }

  const { stdin, stdout } = process;
  stdout.write("\x1b[?25l\x1b[?1049h");
  stdin.setRawMode(true);
  stdin.resume();
  render();

  return new Promise<void>((resolve) => {
    function done() {
      stdout.write("\x1b[?1049l\x1b[?25h\x1b[0m");
      stdin.setRawMode(false);
      stdin.removeAllListeners("data");
      setTimeout(() => resolve(), 50);
    }

    stdin.on("data", (buf: Buffer) => {
      const k = buf.toString();
      if (k === "\x1b[A") { selectedIdx = Math.max(0, selectedIdx - 1); render(); return; }
      if (k === "\x1b[B") { selectedIdx = Math.min(serfs.length - 1, selectedIdx + 1); render(); return; }
      if (k === "\r" || k === "\n") {
        done();
        attachSerf(serfs[selectedIdx].session);
        return;
      }
      if (k === "\x1b" || k === "\u0003") { done(); return; }
    });
  });
}

// Transport picker (standalone, non-interactive)
async function pickTransport(): Promise<TransportType | null> {
  const all = allTransports();
  console.log("Available transports:");
  all.forEach((t, i) => console.log(`  ${i + 1}. ${t.label} — ${t.description}`));
  console.log("  0. Quit");

  const choice = await ask(`Select transport [1-${all.length}]`);
  const idx = parseInt(choice);
  if (isNaN(idx) || idx === 0) return null;
  if (idx < 1 || idx > all.length) { console.log("Invalid selection."); return null; }
  return all[idx - 1].key;
}

function createInvoke(config: SentinelConfig) {
  const { createTransport } = require("./transport");
  const transport = createTransport(config.transport, config.apiKey, config.baseUrl, config.model);
  return transport.invoke.bind(transport);
}

async function buildOrgFromSerfs(serfs: ReturnType<typeof listSerfs>, config: SentinelConfig) {
  const { detect } = require("./scanner");
  const { create, inferBlueprint } = require("./bootstrap");

  // Build a synthetic org from running serfs
  let org = await detect(ROOT);
  if (!org) {
    const invoke = createInvoke(config);
    const blueprint = await inferBlueprint("an AI-powered knowledge work company");
    await create(ROOT, blueprint);
    org = await detect(ROOT);
  }

  // Update personas to match serfs
  if (org) {
    org.personas = serfs.map(s => ({
      name: s.persona.name,
      division: "intelligence",
      identity: `${s.persona.name} — ${s.persona.role}`,
      mission: s.persona.role,
      boundaries: "Operates within the intelligence division",
      traits: s.persona.traits.split(", "),
      path: `intelligence/agents/${s.slug}.md`,
    }));
  }

  return org || { root: ROOT, divisions: ["intelligence"], personas: [], claudeMd: "", agentsMd: "", routingTable: new Map(), protocol: "" };
}

function printHelp() {
  console.log(`
SENTINEL FARM — my-org bootstrap + serf orchestration + directed evolution

USAGE:
  farm launch [transport] [--backend ollama] [--model <model>] [--detach]
    Configure and launch serf sessions.
    --backend ollama  Use ollama as model backend
    --detach           Start serfs in background, don't attach

    farm launch pi --backend ollama
    farm launch pi --backend ollama --detach
    farm launch claude

  farm serf [serf-name]
    Attach to a serf session. No name = interactive picker.

    farm serf
    farm serf intel-analyst

  farm list
    List all active serfs and their status.

  farm spawn <serf-name> <task>
    Send a task into a running serf session.

    farm spawn "Intel Analyst" "research competitor X"

  farm harvest <task>
    Decompose a task, spawn across serfs, synthesize results.

    farm harvest "build a market analysis of Y"

  farm kill <serf-name>
  farm kill --all
    Kill a specific serf or all serfs.

  farm evolve <tool-path>
    Directed evolution of personas and protocols (coming soon).

AVAILABLE TRANSPORTS:
  pi        Pi coding agent
  claude    Claude Code
  opencode  OpenCode CLI
  codex     OpenAI Codex
  openai    OpenAI CLI
  copilot   GitHub Copilot CLI
  hermes    Hermes AI agent
  bun       Direct API (zero deps)

BACKENDS:
  --backend ollama    Use Ollama for models (requires ollama running)
`);
}

function formatResult(text: string): string {
  return text.split("\n").map(l => `  ${l}`).join("\n");
}

async function ask(q: string): Promise<string> {
  const rl = (await import("node:readline")).createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(r => rl.question(`${q}: `, (a: string) => { rl.close(); r(a.trim()); }));
}

async function askWithDefault(q: string, def: string): Promise<string> {
  const rl = (await import("node:readline")).createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(r => rl.question(`${q} [${def}]: `, (a: string) => { rl.close(); r(a.trim() || def); }));
}

main().catch(err => {
  console.error("Farm error:", err.message);
  process.exit(1);
});
