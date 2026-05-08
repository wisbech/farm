import { detect } from "./scanner";
import { create, inferBlueprint } from "./bootstrap";
import { harness } from "./harness";
import { createTransport } from "./transport";
import {
  loadConfig, saveConfig, defaultsFor, allTransports,
  detectAvailable, listOllamaModels, formatSize,
  type SentinelConfig,
} from "./config";
import type { OllamaModel } from "./config";
import { bus } from "./bus";
import type { Org, Task, TransportType } from "./types";

import { evolve } from "./farm-evolve";
import { distill } from "./farm-distiller";
import { generateBenchmark, runBenchmark } from "./farm-bench";
import { inventTool } from "./farm-toolsmith";
import { createAssemblyLine, autoEvolveLoop } from "./farm-assembly";
import { getDB } from "./farm-db";
import { tuiEntry } from "./farm-tui";

const ARGS = process.argv.slice(2);
const ROOT = process.cwd();

async function main() {
  const cmd = ARGS[0];
  const cmdArgs = ARGS.slice(1);

  switch (cmd) {
    case "launch":
      await handleLaunch(cmdArgs);
      return;
    case "evolve":
      await handleEvolve(cmdArgs);
      return;
    case "distill":
      await handleDistill(cmdArgs);
      return;
    case "bench":
      await handleBench(cmdArgs);
      return;
    case "assembly":
    case "farm":
      await handleAssembly(cmdArgs);
      return;
    case "tools":
      await handleTools(cmdArgs);
      return;
    case "machines":
      await handleMachinesList();
      return;
    case "--bootstrap":
    case "-b":
      await handleBootstrap(cmdArgs.join(" "));
      return;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return;
  }

  await handleDefault(cmdArgs);
}

// ── FARM COMMANDS ──────────────────────────────────────────

async function handleEvolve(args: string[]) {
  const [target, ...rest] = args;
  if (!target) { console.log("Usage: farm evolve <tool-path> [--generations N] [--budget M]"); process.exit(1); }

  const config = await configOrExit();
  const org = await orgOrExit();
  const invoke = createInvoke(config);

  const opts = parseEvolveOpts(rest);
  const result = await evolve(target, opts, org, invoke);

  console.log(`\n━━━ Evolution Complete ━━━`);
  console.log(`  Best:   ${result.bestVariant.metric.toFixed(3)}`);
  console.log(`  Generations: ${result.history.filter(g => g.shadowPassed).length}/${result.history.length} passed shadow`);
  const improved = result.history.filter(g => g.shadowPassed && g.metric > result.history[0]?.metric);
  console.log(`  Improved: ${improved.length}`);
  console.log(`  Time:    ${(result.elapsed / 1000).toFixed(1)}s`);
}

function parseEvolveOpts(args: string[]) {
  const opts: any = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--generations" || args[i] === "-g") opts.generations = parseInt(args[++i]) || 10;
    else if (args[i] === "--budget" || args[i] === "-b") opts.budget = parseFloat(args[++i]) || 0;
    else if (args[i] === "--metric" || args[i] === "-m") opts.metric = args[++i];
  }
  return opts;
}

async function handleDistill(args: string[]) {
  const [target] = args;
  if (!target) { console.log("Usage: farm distill <tool-path>"); process.exit(1); }

  const config = await configOrExit();
  const org = await orgOrExit();
  const invoke = createInvoke(config);

  const result = await distill(target, org, invoke);
  if (!result) process.exit(1);

  console.log(`\n━━━ Distilled State Machine: ${target} ━━━`);
  for (const s of result.states) {
    console.log(`\n  ${s.name}:`);
    console.log(`    Triggers: ${s.triggers.join(", ")}`);
    console.log(`    Actions:  ${s.actions.join(", ")}`);
    console.log(`    Exits:    ${s.exits.map(e => `${e.trigger} \u2192 ${e.to}`).join(", ")}`);
  }
  console.log(`\n  Metric: ${result.metric.toFixed(3)}`);
}

async function handleBench(args: string[]) {
  const sub = args[0];
  const rest = args.slice(1);
  const config = await configOrExit();
  const org = await orgOrExit();
  const invoke = createInvoke(config);

  if (sub === "generate" || sub === "gen") {
    const [researchPath] = rest;
    if (!researchPath) { console.log("Usage: farm bench generate <research-path>"); process.exit(1); }
    const bench = await generateBenchmark(researchPath, org, invoke);
    console.log(`\n━━━ Benchmark Generated ━━━`);
    console.log(`  ID:  ${bench.id}`);
    const t1 = bench.questions.filter(q => q.tier === 1).length;
    const t2 = bench.questions.filter(q => q.tier === 2).length;
    const t3 = bench.questions.filter(q => q.tier === 3).length;
    console.log(`  Qs:  ${bench.questions.length} (T1:${t1}, T2:${t2}, T3:${t3})`);
  } else if (sub === "run") {
    const [benchId, toolPath] = rest;
    if (!benchId || !toolPath) { console.log("Usage: farm bench run <bench-id> <tool-path>"); process.exit(1); }
    const result = await runBenchmark(benchId, toolPath, org, invoke);
    if (!result) process.exit(1);
    console.log(`\n━━━ Benchmark Result ━━━`);
    console.log(`  Accuracy: ${(result.accuracy * 100).toFixed(1)}%`);
    console.log(`  T1: ${(result.perTier[0]?.accuracy * 100).toFixed(0)}%  T2: ${(result.perTier[1]?.accuracy * 100).toFixed(0)}%  T3: ${(result.perTier[2]?.accuracy * 100).toFixed(0)}%`);
  } else if (sub === "list") {
    const db = getDB(org.root);
    const { getBenchmarks } = await import("./farm-db");
    const benches = getBenchmarks(db);
    console.log(`\n━━━ Benchmarks ━━━`);
    for (const b of benches) console.log(`  ${b.id} \u2014 ${b.domain} (${b.questions.length} questions)`);
    if (benches.length === 0) console.log("  No benchmarks yet. Run 'farm bench generate <path>' to create.");
  } else {
    console.log("Usage: farm bench [generate|run|list]");
  }
}

async function handleAssembly(args: string[]) {
  const [division, ...rest] = args;
  const config = await configOrExit();
  const org = await orgOrExit();
  const invoke = createInvoke(config);

  const autoEvolve = rest.includes("--auto-evolve");
  let interval = 60;
  const intIdx = rest.indexOf("--interval");
  if (intIdx >= 0) interval = parseInt(rest[intIdx + 1]) || 60;

  if (division && ["strategy", "intelligence", "engineering", "commercial"].includes(division)) {
    const line = await createAssemblyLine(division as any, { autoEvolve, evolutionInterval: interval }, org);
    console.log(`\n━━━ Assembly: ${division}/ ━━━`);
    console.log(`  Tools:  ${line.machineTools.length}`);
    console.log(`  Gates:  ${line.qualityGates.map(g => g.name).join(", ")}`);
    console.log(`  Auto:   ${line.autoEvolve ? `every ${line.evolutionInterval}m` : "off"}`);

    if (line.autoEvolve) await autoEvolveLoop(line, org, invoke);
  } else {
    console.log("Usage: farm assembly <division> [--auto-evolve] [--interval N]");
  }
}

async function handleTools(args: string[]) {
  const [domain, ...rest] = args;
  if (!domain) { console.log("Usage: farm tools <domain> [constraints...]"); process.exit(1); }

  const config = await configOrExit();
  const org = await orgOrExit();
  const invoke = createInvoke(config);

  const tool = await inventTool(domain, rest.join(" ") || "General purpose", org, invoke);
  if (!tool) process.exit(1);

  console.log(`\n━━━ Tool Invented ━━━`);
  console.log(`  Name: ${tool.name}`);
  console.log(`  Lang: ${tool.language}`);
  console.log(`  Path: ${tool.path}`);
  console.log(`  Desc: ${tool.description}`);
}

async function handleMachinesList() {
  const org = await orgOrExit();
  const { readdirSync, existsSync, readFileSync } = require("node:fs");
  const { join } = require("node:path");
  const dir = join(org.root, ".sentinel", "machines");
  console.log(`\n━━━ Distilled Machines ━━━`);
  if (existsSync(dir)) {
    const files = readdirSync(dir).filter((f: string) => f.endsWith(".json"));
    if (files.length === 0) {
      console.log("  No machines distilled yet. Run 'farm distill <tool>' to create one.");
      return;
    }
    for (const f of files) {
      const content = JSON.parse(readFileSync(join(dir, f), "utf-8"));
      console.log(`  ${f.replace(".json", "")} \u2014 ${content.states?.length || 0} states`);
    }
  } else {
    console.log("  No machines distilled yet. Run 'farm distill <tool>' to create one.");
  }
}

async function configOrExit(): Promise<any> {
  const config = await loadConfig();
  if (!config) { console.log("No config. Run 'farm launch' first."); process.exit(1); }
  return config;
}

async function orgOrExit(): Promise<Org> {
  const org = await detect(ROOT);
  if (!org) { console.log("No my-org structure. Run 'farm --bootstrap' first."); process.exit(1); }
  return org;
}

// ── LAUNCH COMMAND ─────────────────────────────────────────────

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

    if (transport === "bun") {
      const key = await askOptional("API key (leave empty to use env var)");
      if (key) apiKey = key;
    }

    config = { transport, model, apiKey, baseUrl, updated: new Date().toISOString() };
  }

  await saveConfig(config);
  console.log(`\nConfiguration saved:`);
  console.log(`  Transport: ${config.transport}${config.backend ? ` (backend: ${config.backend})` : ""}`);
  console.log(`  Model:     ${config.model}`);
  if (config.apiKey) console.log(`  API Key:   [set]`);
  if (config.baseUrl) console.log(`  Base URL:  ${config.baseUrl}`);
  console.log();

  await tuiEntry();
}

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
    // Move cursor to top-left and clear
    process.stdout.write("\x1b[H\x1b[J");

    const lines: string[] = [];
    lines.push("  Ollama models \u2014 \u2191\u2193 to select, Enter to confirm, Esc to quit\n");

    for (let i = 0; i < visible; i++) {
      const m = models[i];
      const cursor = i === selectedIdx ? "\u25B6" : " ";
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
      const msg = selectedIdx === visible - 1
        ? `\n  \u25BC Enter to show ${hidden} more`
        : `\n  \u2026 ${hidden} more (arrow to last)`;
      lines.push(msg);
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
      // Yield to let terminal settle before the next readline
      setTimeout(() => resolve(value), 50);
    }

    stdin.on("data", (buf: Buffer) => {
      const k = buf.toString();

      if (k === "\x1b[A") {
        selectedIdx = Math.max(0, selectedIdx - 1);
        render(); return;
      }
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
      if (n >= 1 && n <= Math.min(9, models.length)) {
        done(models[n - 1].name); return;
      }
    });
  });
}

async function pickTransport(): Promise<TransportType | null> {
  const all = allTransports();
  const available = await detectAvailable();
  console.log("Available transports:");
  all.forEach((t, i) => {
    const marker = available.includes(t.key) ? " " : "✗";
    console.log(`  ${i + 1}. ${marker} ${t.label} — ${t.description}`);
  });
  console.log("  0. Quit");

  const choice = await ask(`Select transport [1-${all.length}]`);
  const idx = parseInt(choice);
  if (isNaN(idx) || idx === 0) return null;
  if (idx < 1 || idx > all.length) { console.log("Invalid selection."); return null; }
  return all[idx - 1].key;
}

// ── BOOTSTRAP COMMAND ──────────────────────────────────────────

async function handleBootstrap(args: string) {
  const config = await loadConfig();
  if (!config) {
    console.log("No configuration found. Run 'farm launch' first.");
    process.exit(1);
  }

  console.log(`Analyzing: "${args}"...`);
  const invoke = createInvoke(config);
  const blueprint = await inferBlueprint(args);

  console.log(`\nBlueprint for "${blueprint.name}":`);
  console.log(`  ${blueprint.description}\n`);
  for (const div of blueprint.divisions) {
    console.log(`  ${div.name}/ (${div.purpose})`);
    for (const agent of div.agents) console.log(`    - ${agent.name}: ${agent.role}`);
  }

  console.log(`\nBootstrapping ${blueprint.name} in ${ROOT}...`);
  await create(ROOT, blueprint);
  console.log("Done. Run 'farm' to start.\n");
}

// ── DEFAULT COMMAND ────────────────────────────────────────────

async function handleDefault(args: string[]) {
  const config = await loadConfig();
  if (!config) {
    console.log("No configuration found.\n");
    console.log("Run:  farm launch claude|pi|opencode|codex|openai|hermes|bun [--backend ollama]");
    console.log("  or: farm launch  (interactive picker)\n");
    process.exit(1);
  }

  const org = await detect(ROOT);
  if (!org) {
    console.log("No my-org structure detected.");
    console.log("Run: farm --bootstrap \"Describe what you're building\"");
    process.exit(1);
  }

  const invoke = createInvoke(config);
  const taskDesc = args.join(" ").trim();
  if (taskDesc) {
    console.log(`\n  \u25B6 ${taskDesc}\n`);
    const division = routeToDivision(taskDesc, org);
    const task: Task = { id: generateId(), description: taskDesc, division, complexity: "composite", status: "pending" };
    try {
      const result = await harness(task, org, invoke);
      console.log(`\n━━━ Result ━━━`);
      console.log(formatResult(result.content));
    } catch (err) {
      console.error(`\n  Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    await enter(org, invoke, config);
  }
}

// ── SHARED ─────────────────────────────────────────────────────

async function detectOrBootstrap(config: SentinelConfig): Promise<Org> {
  let org = await detect(ROOT);
  if (org) return org;

  // No workspace — silently create one
  const invoke = createInvoke(config);
  const blueprint = await inferBlueprint("an AI-powered knowledge work company");
  // Don't log during silent bootstrap
  await create(ROOT, blueprint);
  org = await detect(ROOT);
  if (!org) throw new Error("Bootstrap failed — could not detect created structure");
  return org;
}

function createInvoke(config: SentinelConfig) {
  const transport = createTransport(config.transport, config.apiKey, config.baseUrl, config.model);
  return transport.invoke.bind(transport);
}

async function enter(org: Org, invoke: (p: string) => Promise<string>, config: SentinelConfig) {
  const readline = await import("node:readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  bus.subscribe("log", (msg) => console.log(`  [${msg.from.replace("harness:", "")}] ${msg.content}`));
  const prompt = (): Promise<string> => new Promise(r => rl.question("\n> ", (a: string) => r(a.trim())));

  console.log(`\nSentinel Farm — ${org.divisions.length} divisions, ${org.personas.length} personas active`);
  console.log(`Transport: ${config.transport} | Model: ${config.model}`);
  console.log("Type your task or 'farm evolve <tool>' to start evolution.\n");

  while (true) {
    const input = await prompt();
    if (!input) continue;
    if (input === "quit" || input === "exit" || input === "q") break;
    if (input === "help" || input === "?") {
      console.log("\nCommands:");
      console.log("  <task>              Execute through harness");
      console.log("  personas             List all personas");
      console.log("  divisions            List all divisions");
      console.log("  config               Show configuration");
      console.log("  help                 This help");
      console.log("  quit                 Exit");
      continue;
    }
    if (input === "personas") { org.personas.forEach(p => console.log(`  ${p.name} [${p.division}]`)); continue; }
    if (input === "divisions") { org.divisions.forEach(d => console.log(`  ${d}/ (${org.personas.filter(p => p.division === d).length} agents)`)); continue; }
    if (input === "config") {
      console.log(`\n  Transport: ${config.transport}`);
      console.log(`  Model:     ${config.model}`);
      if (config.apiKey) console.log("  API Key:   [set]");
      if (config.baseUrl) console.log(`  Base URL:  ${config.baseUrl}`);
      continue;
    }

    console.log(`\n  \u25B6 ${input}\n`);
    const division = routeToDivision(input, org);
    const task: Task = { id: generateId(), description: input, division, complexity: "composite", status: "pending" };
    try {
      const result = await harness(task, org, invoke);
      console.log(`\n━━━ Result ━━━`);
      console.log(formatResult(result.content));
    } catch (err) {
      console.error(`\n  Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  rl.close();
  process.exit(0);
}

async function ask(q: string): Promise<string> {
  const rl = (await import("node:readline")).createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(r => rl.question(`${q}: `, (a: string) => { rl.close(); r(a.trim()); }));
}

async function askOptional(q: string): Promise<string> {
  const rl = (await import("node:readline")).createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(r => rl.question(`${q}: `, (a: string) => { rl.close(); r(a.trim()); }));
}

async function askWithDefault(q: string, def: string): Promise<string> {
  const rl = (await import("node:readline")).createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(r => rl.question(`${q} [${def}]: `, (a: string) => { rl.close(); r(a.trim() || def); }));
}

function printHelp() {
  console.log(`
SENTINEL FARM — my-org bootstrap + recursive orchestration + directed evolution

USAGE:
  farm launch [transport] [--backend ollama] [--model <model>] [--api-key <key>]
    Configure and launch with a specific transport.
    --backend ollama  Use ollama as model backend (auto-discovers available models)

    farm launch pi --backend ollama
    farm launch opencode --backend ollama --model llama3.1
    farm launch claude

  farm evolve <tool-path> [--generations N] [--budget M]
    Directed evolution: mutate persona/protocol, verify, keep improvements.

  farm distill <tool-path>
    Distill evolved agent description into formal state machine.

  farm bench generate <research-path>
    Generate ARFBench-style benchmark from research artifacts.
  farm bench run <bench-id> <tool-path>
    Run benchmark against a machine tool.
  farm bench list

  farm assembly <division> [--auto-evolve] [--interval N]
    Create and manage division assembly line.

  farm tools <domain> [constraints...]
    Invent a new command-line tool for a domain.

  farm machines
    List all distilled state machines.

  farm [--bootstrap "description"] ["task"]
    Run harness in my-org workspace. Bootstraps if needed.

AVAILABLE TRANSPORTS:
  claude    Claude Code
  pi        Pi coding agent
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

function routeToDivision(desc: string, org: Org): Task["division"] {
  const d = desc.toLowerCase();
  for (const [pattern, { division }] of org.routingTable) if (d.includes(pattern)) return division;
  return "intelligence";
}

function formatResult(text: string): string {
  return text.split("\n").map(l => `  ${l}`).join("\n");
}

function generateId(): string {
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

main().catch(err => {
  console.error("Farm error:", err.message);
  process.exit(1);
});
