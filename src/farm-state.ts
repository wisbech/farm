import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const STATE_DIR = join(homedir(), ".sentinel");
const STATE_FILE = join(STATE_DIR, "farm-state.json");

export interface FarmPersona {
  name: string;
  role: string;
  traits: string;
}

export interface FarmState {
  personas: FarmPersona[];
  history: string[];
  running: number;
  transport: string;
  model: string;
  backend?: string;
}

const DEFAULTS: FarmState = {
  personas: [
    { name: "Intel Analyst", role: "Research & source collection", traits: "thorough, curious, skeptical" },
    { name: "Data Analyst", role: "Quantitative analysis & metrics", traits: "precise, systematic, data-driven" },
    { name: "Strategist", role: "Strategic frameworks & GTM", traits: "bold, creative, pattern-aware" },
    { name: "Content Strategist", role: "Writing & narrative structure", traits: "clear, bold, audience-aware" },
  ],
  history: [],
  running: 0,
  transport: "claude",
  model: "claude-sonnet-4-20250514",
};

export function loadState(): FarmState {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });

  try {
    const raw = readFileSync(STATE_FILE, "utf-8");
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    saveState(DEFAULTS);
    return { ...DEFAULTS };
  }
}

export function saveState(state: FarmState) {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export function addToHistory(state: FarmState, entry: string) {
  state.history.push(`${new Date().toISOString().slice(11, 19)} ${entry}`);
  if (state.history.length > 200) state.history = state.history.slice(-200);
  saveState(state);
}

export function findPersona(name: string, personas: FarmPersona[]): FarmPersona | null {
  const n = name.toLowerCase();
  return personas.find(p => p.name.toLowerCase().includes(n)) || null;
}
