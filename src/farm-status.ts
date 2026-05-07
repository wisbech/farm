import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { FarmStatus } from "./types";

const INITIAL: FarmStatus = {
  pid: null,
  running: [],
  queued: [],
  completed: [],
  lastActivity: new Date().toISOString(),
  uptime: 0,
};

export class StatusManager {
  private path: string;
  private state: FarmStatus;
  private startedAt: number;

  constructor(workspaceRoot: string, pid: number) {
    const dir = join(workspaceRoot, ".sentinel");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.path = join(dir, "status.json");
    this.startedAt = Date.now();
    this.state = { ...INITIAL, pid };
    this.save();
  }

  addRunning(id: string, task: string, agent: string) {
    this.state.running.push({ task, agent, started: new Date().toISOString(), id });
    this.state.queued = this.state.queued.filter(q => q.id !== id);
    this.touch();
  }

  addQueued(id: string, task: string) {
    this.state.queued.push({ task, id });
    this.touch();
  }

  completeRunning(id: string, result: string) {
    const r = this.state.running.find(t => t.id === id);
    if (r) {
      this.state.running = this.state.running.filter(t => t.id !== id);
      this.state.completed.push({ task: r.task, result, time: new Date().toISOString() });
    }
    if (this.state.completed.length > 100) {
      this.state.completed = this.state.completed.slice(-100);
    }
    this.touch();
  }

  failRunning(id: string, error: string) {
    this.completeRunning(id, `FAILED: ${error}`);
  }

  touch() {
    this.state.lastActivity = new Date().toISOString();
    this.state.uptime = Math.floor((Date.now() - this.startedAt) / 1000);
    this.save();
  }

  snapshot(): FarmStatus {
    this.state.uptime = Math.floor((Date.now() - this.startedAt) / 1000);
    return { ...this.state };
  }

  private save() {
    writeFileSync(this.path, JSON.stringify(this.state, null, 2));
  }
}

export function readStatus(workspaceRoot: string): FarmStatus | null {
  const path = join(workspaceRoot, ".sentinel", "status.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8"));
}
