import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ActivityEntry } from "./types";

export class ActivityLog {
  private path: string;

  constructor(workspaceRoot: string) {
    const dir = join(workspaceRoot, ".sentinel");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.path = join(dir, "activity.jsonl");
  }

  log(type: ActivityEntry["type"], message: string, metadata?: Record<string, unknown>) {
    const entry: ActivityEntry = {
      type,
      message,
      timestamp: new Date().toISOString(),
      metadata,
    };
    appendFileSync(this.path, JSON.stringify(entry) + "\n");
  }

  read(limit = 20): ActivityEntry[] {
    if (!existsSync(this.path)) return [];
    const lines = readFileSync(this.path, "utf-8").trim().split("\n");
    if (!lines[0]) return [];
    return lines.slice(-limit).map(line => JSON.parse(line));
  }

  tail(sinceIso: string): ActivityEntry[] {
    if (!existsSync(this.path)) return [];
    const lines = readFileSync(this.path, "utf-8").trim().split("\n");
    if (!lines[0]) return [];
    const since = new Date(sinceIso).getTime();
    const all = lines.map(line => JSON.parse(line) as ActivityEntry);
    return all.filter(e => new Date(e.timestamp).getTime() > since);
  }

  clear() {
    if (!existsSync(this.path)) return;
    require("node:fs").writeFileSync(this.path, "");
  }
}
