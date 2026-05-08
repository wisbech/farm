// Sentinel Farm TUI — agent harness with real-time output
// Built on pi-tui for differential rendering + synchronized output

import {
  TUI, ProcessTerminal, Text, TruncatedText, Input,
  type Component, Container,
  Key, matchesKey,
} from "@earendil-works/pi-tui";
import chalk from "chalk";
import { loadState, saveState, addToHistory, findPersona, type FarmState } from "./farm-state";
import { startAgent, type TransportProcess } from "./farm-runner";
import type { SentinelConfig } from "./config";
import { loadConfig } from "./config";

let state: FarmState;
let config: SentinelConfig | null;
let agent: TransportProcess | null = null;
let outputLines: string[] = [];
let running = false;

type ViewTab = "chat" | "personas";
let activeTab: ViewTab = "chat";

// ── Entry ──

export async function tuiEntry() {
  config = await loadConfig();
  state = loadState();

  if (config) {
    state.transport = config.transport;
    state.model = config.model;
    if (config.backend) state.backend = config.backend;
  }

  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal);

  // Status bar
  const statusBar = new TruncatedText(buildStatusLine(), 0, 0);
  tui.addChild(statusBar);

  // Output area
  const outputText = new Text("", 0, 0);
  tui.addChild(outputText);

  // Footer
  const footer = new TruncatedText(buildFooter(), 0, 0);
  tui.addChild(footer);

  // Input
  const input = new Input();
  input.onSubmit = (cmd: string) => handleCommand(cmd, tui, statusBar, outputText, footer, input);
  tui.addChild(input);
  tui.setFocus(input);

  // Global keyboard
  tui.addInputListener((data: string) => {
    if (matchesKey(data, Key.ctrl("c"))) return terminate();
    if (matchesKey(data, Key.ctrl("t"))) { compact(tui, statusBar, footer); return; }
  });

  tui.start();
}

// ── UI Helpers ──

function buildStatusLine(): string {
  const backend = state.backend ? chalk.dim(` via ${state.backend}`) : "";
  const active = running ? chalk.green(" ● running") : "";
  const info = agent ? ` ${chalk.dim("Ctrl+T compact")}` : "";
  return ` ${chalk.white.bgBlue(" Sentinel Farm ")} ${state.transport}${backend} · ${state.model}${active}${info}`;
}

function buildFooter(): string {
  const chatHl = activeTab === "chat" ? chalk.bgWhite.black(" Chat ") : chalk.dim(" Chat ");
  const persHl = activeTab === "personas" ? chalk.bgWhite.black(` Personas(${state.personas.length}) `) : chalk.dim(` Personas(${state.personas.length}) `);
  const stats = chalk.dim(`running: ${state.running} | lines: ${outputLines.length}`);
  return ` ${chatHl} ${persHl}   ${stats}`;
}

function updateUI(tui: TUI, statusBar: TruncatedText, outputText: Text, footer: TruncatedText) {
  statusBar.setText(buildStatusLine());
  const visible = outputLines.slice(-30).join("\n");
  outputText.setText(visible);
  footer.setText(buildFooter());
  tui.requestRender();
}

// ── Command Handling ──

function handleCommand(cmd: string, tui: TUI, statusBar: TruncatedText, outputText: Text, footer: TruncatedText, input: Input) {
  cmd = cmd.trim();
  if (!cmd) return;

  if (cmd.startsWith("/")) {
    const parts = cmd.slice(1).split(" ");
    handleSlashCommand(parts, tui, statusBar, outputText, footer);
    updateUI(tui, statusBar, outputText, footer);
    return;
  }

  if (!agent) {
    agent = startAgent(
      state.transport,
      state.model,
      state.backend,
      (text: string) => {
        outputLines.push(...text.split("\n"));
        if (outputLines.length > 5000) outputLines = outputLines.slice(-5000);
        updateUI(tui, statusBar, outputText, footer);
      },
      (code: number | null) => {
        running = false;
        state.running = Math.max(0, state.running - 1);
        addToHistory(state, `Agent exited (${code ?? "? "})`);
        agent = null;
        updateUI(tui, statusBar, outputText, footer);
      }
    );
    running = true;
    state.running++;
    addToHistory(state, `Started: ${state.transport} ${state.model}`);
  }

  const persona = findPersona(cmd.split(" ")[0], state.personas);
  const wrapped = persona
    ? `[AS: ${persona.name} — ${persona.traits}]\n\n${cmd}\n\nRespond directly. No preamble.`
    : cmd;

  agent!.send(wrapped);
  addToHistory(state, cmd.slice(0, 120));
  outputLines.push(chalk.cyan(`▸ ${wrapped.length > 300 ? wrapped.slice(0, 300) + "..." : wrapped}`));
  updateUI(tui, statusBar, outputText, footer);
}

// ── Slash Commands ──

function handleSlashCommand(parts: string[], tui: TUI, statusBar: TruncatedText, outputText: Text, footer: TruncatedText) {
  const cmd = parts[0];

  if (cmd === "persona" || cmd === "p") {
    if (parts.length >= 3) {
      state.personas.push({ name: parts[1], role: parts.slice(2).join(" "), traits: "general" });
      saveState(state);
      outputLines.push(chalk.green(`  ✓ Registered persona: ${parts[1]}`));
    } else {
      for (const p of state.personas) {
        outputLines.push(chalk.white(`  ${p.name}`) + chalk.dim(` — ${p.role} (${p.traits})`));
      }
    }
  } else if (cmd === "compact") {
    if (agent) agent.send("/compact");
    addToHistory(state, "/compact");
    outputLines.push(chalk.yellow("  ⟳ Compact sent"));
  } else if (cmd === "stop" || cmd === "quit") {
    terminate();
  } else {
    outputLines.push(chalk.red(`  Unknown command: /${cmd}`));
  }
  updateUI(tui, statusBar, outputText, footer);
}

// ── Actions ──

function compact(tui: TUI, statusBar: TruncatedText, footer: TruncatedText) {
  if (agent && running) agent.send("/compact");
  addToHistory(state, "[compact]");
  outputLines.push(chalk.yellow("  ⟳ Compact"));
  updateUI(tui, statusBar, {} as Text, footer);
}

function terminate() {
  if (agent) { try { agent.close(); } catch {} }
  process.exit(0);
}
