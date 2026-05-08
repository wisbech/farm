// Sentinel Farm TUI — agent harness with real-time output
//
// Alternate-screen terminal UI:
//   [status bar    ]
//   [agent output  ]
//   [command input ]

import { loadState, saveState, addToHistory, findPersona, type FarmState } from "./farm-state";
import { startAgent, type TransportProcess } from "./farm-runner";
import type { SentinelConfig } from "./config";
import { loadConfig } from "./config";

let state: FarmState;
let config: SentinelConfig | null;
let agent: TransportProcess | null = null;
let outputLines: string[] = [];
let scrollOffset = 0;
let width = 80;
let height = 24;
let running = false;
let promptText = "";
let escBuffer: string | null = null;
let escTimer: ReturnType<typeof setTimeout> | null = null;

type ViewTab = "chat" | "personas" | "history";
let activeTab: ViewTab = "chat";

export async function tuiEntry() {
  config = await loadConfig();
  state = loadState();

  if (config) {
    state.transport = config.transport;
    state.model = config.model;
    if (config.backend) state.backend = config.backend;
  }

  // Enter alternate screen
  process.stdout.write("\x1b[?1049h\x1b[?25l\x1b[2J");

  // Handle terminal resize
  process.stdout.on("resize", () => {
    width = process.stdout.columns || 100;
    height = process.stdout.rows || 30;
    render();
  });

  width = process.stdout.columns || 100;
  height = process.stdout.rows || 30;

  // Set up stdin for keyboard
  const stdin = process.stdin;
  stdin.setRawMode(true);
  stdin.resume();

  render();

  stdin.on("data", (buf: Buffer) => {
    let key = buf.toString();

    // Buffer escape sequences that may arrive split across events
    if (escBuffer !== null) {
      key = escBuffer + key;
      escBuffer = null;
      if (escTimer) { clearTimeout(escTimer); escTimer = null; }
    }

    if (key === "\x03") terminate();      // Ctrl+C → quit
    else if (key === "\x04" && !promptText) terminate(); // Ctrl+D on empty → quit
    else if (key === "\r" || key === "\n") submitCommand();
    else if (key === "\x7f" || key === "\b") { if (promptText) promptText = promptText.slice(0, -1); render(); }
    else if (key === "\x14") { if (agent && running) agent.send("/compact"); addToHistory(state, "[compact]"); promptText = ""; render(); }
    else if (key === "\x01") activeTab = "personas";
    else if (key === "\x02") activeTab = "history";
    else if (key === "\x1b") {
      // Could be lone Esc or start of escape sequence — buffer and wait
      escBuffer = "\x1b";
      escTimer = setTimeout(() => {
        if (escBuffer === "\x1b") { escBuffer = null; activeTab = "chat"; render(); }
        escTimer = null;
      }, 20);
    }
    // Full escape sequences (arrow keys arrive complete)
    else if (key === "\x1b[A") { scrollOffset = Math.min(scrollOffset + 1, Math.max(0, outputLines.length - bodyHeight())); render(); }
    else if (key === "\x1b[B") { scrollOffset = Math.max(0, scrollOffset - 1); render(); }
    // Partial escape seq continuation (e.g., "[A" after buffered \x1b)
    else if (key.startsWith("\x1b[") && key.length >= 3 && key.length <= 4) {
      const code = key.charCodeAt(2);
      if (code === 65) { scrollOffset = Math.min(scrollOffset + 1, Math.max(0, outputLines.length - bodyHeight())); render(); }
      else if (code === 66) { scrollOffset = Math.max(0, scrollOffset - 1); render(); }
      // C/D ignored — not used
    }
    else if (key.length === 1 && key >= " ") { promptText += key; render(); }
  });
}

function bodyHeight() { return Math.max(4, height - 5); }

function render() {
  const statusLine = ` Sentinal Farm · ${state.transport}${state.backend ? " via " + state.backend : ""} · ${state.model} ${running ? " ● running" : ""} ${agent ? " · Ctrl+T compact" : ""} ${" ".repeat(Math.max(0, width - 70))}`;

  const bodyH = bodyHeight();
  const visible = outputLines.slice(-(bodyH + scrollOffset), scrollOffset ? -scrollOffset : undefined);
  const body = visible.map(l => l.length > width - 2 ? l.slice(0, width - 3) : l);

  const inputLine = ` > ${promptText}${running ? "" : " "}`;
  const footer = footerContent();

  // Compose output
  const frame = [
    `\x1b[2J\x1b[H`,                              // clear + home
    `\x1b[1;37;44m${pad(statusLine)}\x1b[0m\n`,   // status bar
    ...body.map(l => ` ${l}\n`),                      // agent output
    `\x1b[1;37m${pad(inputLine)}\x1b[0m\n`,         // input line
    `\x1b[2;37m${pad(footer)}\x1b[0m`,               // footer
  ].join("");

  process.stdout.write(frame);
}

function footerContent(): string {
  const personCount = state.personas.length;
  const histCount = state.history.length;
  const tabs = [
    activeTab === "chat" ? "\x1b[7m Chat \x1b[0m" : " Chat ",
    activeTab === "personas" ? `\x1b[7m Personas(${personCount}) \x1b[0m` : ` Personas(${personCount}) `,
    activeTab === "history" ? `\x1b[7m History \x1b[0m` : " History ",
    width > 60 ? `  running: ${state.running} | out: ${outputLines.length} lines` : "",
  ].join(" ");
  return tabs;
}

function pad(s: string) {
  return s.length >= width ? s : s + " ".repeat(Math.max(0, width - s.length));
}

function submitCommand() {
  const cmd = promptText.trim();
  promptText = "";

  if (!cmd) return;

  if (cmd.startsWith("/")) {
    const parts = cmd.slice(1).split(" ");
    handleSlashCommand(parts);
    return;
  }

  if (!agent) {
    agent = startAgent(
      state.transport,
      state.model,
      state.backend,
      (text: string) => {
        outputLines.push(...text.split("\n"));
        if (outputLines.length > 2000) outputLines = outputLines.slice(-2000);
        render();
      },
      (code: number | null) => {
        running = false;
        state.running = Math.max(0, state.running - 1);
        addToHistory(state, `Agent exited (${code})`);
        agent = null;
        render();
      }
    );
    running = true;
    state.running++;
    addToHistory(state, `Started: ${state.transport} ${state.model}`);
    render();
  }

  // Route to agent
  const persona = findPersona(cmd.split(" ")[0], state.personas);
  const wrapped = persona
    ? `[AS: ${persona.name} — ${persona.traits}]\n\n${cmd}\n\nRespond directly. No preamble.`
    : cmd;

  agent!.send(wrapped);
  addToHistory(state, cmd.slice(0, 120));
  render();
}

function handleSlashCommand(parts: string[]) {
  const cmd = parts[0];

  if (cmd === "persona" || cmd === "p") {
    if (parts.length >= 3) {
      state.personas.push({ name: parts[1], role: parts.slice(2).join(" "), traits: "general" });
      saveState(state);
    } else {
      // List personas
      for (const p of state.personas) outputLines.push(`  ${p.name} — ${p.role} (${p.traits})`);
    }
  } else if (cmd === "compact") {
    if (agent) agent.send("/compact");
    addToHistory(state, "/compact");
  } else if (cmd === "stop" || cmd === "quit") {
    terminate();
  } else {
    outputLines.push(`  Unknown command: /${cmd}`);
  }
  render();
}

function terminate() {
  if (agent) { try { agent.close(); } catch {} }
  process.stdout.write("\x1b[?1049l\x1b[?25h\x1b[0m\n");
  process.exit(0);
}
