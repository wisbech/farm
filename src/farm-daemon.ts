import { detect } from "./scanner";
import { harness } from "./harness";
import { loadConfig } from "./config";
import { createTransport } from "./transport";
import { loadFarmConfig, deriveAllowedPaths } from "./farm-security";
import { ActivityLog } from "./farm-activity";
import { StatusManager } from "./farm-status";
import { existsSync, readFileSync, writeFileSync, watch } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { Org, Task } from "./types";

const PID_FILE = ".sentinel/farm.pid";
const STEERING_FILE = ".sentinel/steering.jsonl";
const RESEARCH_DIR = "intelligence/research";

export async function startDaemonLoop(workspaceRoot: string) {
  const pid = writePid(workspaceRoot);
  const activity = new ActivityLog(workspaceRoot);
  const status = new StatusManager(workspaceRoot, pid);

  const config = await loadConfig();
  const org = await detect(workspaceRoot);
  if (!org || !config) {
    activity.log("system", "Daemon failed — missing org or config");
    process.exit(1);
  }

  const farmConfig = loadFarmConfig(workspaceRoot);
  const allowedPaths = deriveAllowedPaths(workspaceRoot, farmConfig);

  activity.log("system", `Daemon started — ${org.divisions.length} divisions, ${org.personas.length} personas`);
  activity.log("system", `Allowed: ${allowedPaths.join(", ")}`);
  activity.log("system", `Transports: ${farmConfig.security.availableTransports.join(", ")}`);

  const invoke = createTransport(config.transport, config.apiKey, config.baseUrl, config.model).invoke.bind(
    createTransport(config.transport, config.apiKey, config.baseUrl, config.model)
  );

  const engine = new WorkEngine(workspaceRoot, org, status, activity, invoke);

  const researchPath = join(workspaceRoot, RESEARCH_DIR);
  const steeringPath = join(workspaceRoot, STEERING_FILE);
  const sentinelPath = join(workspaceRoot, ".sentinel");

  // Ensure watched paths exist
  if (!existsSync(researchPath)) require("node:fs").mkdirSync(researchPath, { recursive: true });
  if (!existsSync(sentinelPath)) require("node:fs").mkdirSync(sentinelPath, { recursive: true });

  // Event-driven watchers — no polling
  if (existsSync(researchPath)) {
    watch(researchPath, { recursive: true }, (eventType, filename) => {
      if (!filename || !filename.endsWith(".md")) return;
      const project = filename.split("/")[0];
      if (!project || project === filename) return;
      engine.signalResearchChange(project);
    });
    activity.log("system", "Watching: intelligence/research/");
  }

  // Watch steering file for talk messages
  watch(join(workspaceRoot, ".sentinel"), (eventType, filename) => {
    if (filename === "steering.jsonl") engine.drainSteering();
    if (filename === "farm.json") engine.reloadConfig();
  });

  // Process initial state — catch anything that existed before watching
  engine.signalInitial();
}

class WorkEngine {
  private workspaceRoot: string;
  private org: Org;
  private status: StatusManager;
  private activity: ActivityLog;
  private invoke: (p: string) => Promise<string>;

  private queue: { project: string; desc: string; id: string }[] = [];
  private knownHashes = new Map<string, string>(); // project → research.md hash
  private processing = false;

  constructor(
    workspaceRoot: string, org: Org, status: StatusManager,
    activity: ActivityLog, invoke: (p: string) => Promise<string>
  ) {
    this.workspaceRoot = workspaceRoot;
    this.org = org;
    this.status = status;
    this.activity = activity;
    this.invoke = invoke;
  }

  signalResearchChange(project: string) {
    const rPath = join(this.workspaceRoot, RESEARCH_DIR, project, "RESEARCH.md");
    if (!existsSync(rPath)) return;

    const content = readFileSync(rPath, "utf-8");
    const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);

    const prev = this.knownHashes.get(project);
    if (prev === hash) return; // No change
    this.knownHashes.set(project, hash);

    const fPath = join(this.workspaceRoot, RESEARCH_DIR, project, "findings.md");
    const hasFindings = existsSync(fPath) && readFileSync(fPath, "utf-8").length > 300;
    if (hasFindings) return;

    const desc = content.split("\n")[0].replace(/^#\s*/, "").slice(0, 80);
    const id = `research-${project}`;

    const snapshot = this.status.snapshot();
    if (snapshot.running.some(r => r.id === id)) return;
    if (snapshot.completed.some(c => c.task.includes(project))) return;

    this.queue.push({ project, desc, id });
    this.activity.log("task_start", desc, { project, trigger: "watch" });
    this.tick();
  }

  signalInitial() {
    const researchDir = join(this.workspaceRoot, RESEARCH_DIR);
    if (!existsSync(researchDir)) return;

    const projects = require("node:fs").readdirSync(researchDir);
    for (const project of projects) {
      const rPath = join(researchDir, project, "RESEARCH.md");
      if (!existsSync(rPath)) continue;

      const content = readFileSync(rPath, "utf-8");
      const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
      this.knownHashes.set(project, hash);

      const fPath = join(researchDir, project, "findings.md");
      const hasFindings = existsSync(fPath) && readFileSync(fPath, "utf-8").length > 300;
      if (hasFindings) continue;

      const desc = content.split("\n")[0].replace(/^#\s*/, "").slice(0, 80);
      const id = `research-${project}`;

      const snapshot = this.status.snapshot();
      if (snapshot.running.some(r => r.id === id)) continue;
      if (snapshot.completed.some(c => c.task.includes(project))) continue;

      this.queue.push({ project, desc, id });
      this.activity.log("task_start", desc, { project, trigger: "initial" });
    }
    this.tick();
  }

  drainSteering() {
    const path = join(this.workspaceRoot, STEERING_FILE);
    if (!existsSync(path)) return;
    const lines = readFileSync(path, "utf-8").trim().split("\n");
    writeFileSync(path, "");

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const { message } = JSON.parse(line);
        this.activity.log("steer", message);
      } catch {}
    }
  }

  reloadConfig() {
    const config = loadFarmConfig(this.workspaceRoot);
    this.activity.log("system", `Config reloaded — transports: ${config.security.availableTransports.join(", ")}`);
  }

  private async tick() {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const work = this.queue.shift()!;
      if (!work) break;

      await this.execute(work);
      this.status.touch();
    }

    this.processing = false;
  }

  private async execute(work: { project: string; desc: string; id: string }) {
    this.status.addRunning(work.id, work.desc, "Intel Analyst");

    const task: Task = {
      id: work.id, description: work.desc,
      division: "intelligence", complexity: "composite", status: "pending",
    };

    try {
      const result = await harness(task, this.org, this.invoke);
      this.status.completeRunning(work.id, result.content.slice(0, 80));
      this.activity.log("task_end", `Done: ${result.content.slice(0, 120)}`, { agent: result.agent });

      // After completion, re-check for new work triggered by the output
      this.signalResearchChange(work.project);
    } catch (err) {
      this.status.failRunning(work.id, err instanceof Error ? err.message : String(err));
      this.activity.log("task_end", `Failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

function writePid(workspaceRoot: string): number {
  const pid = process.pid;
  writeFileSync(join(workspaceRoot, PID_FILE), String(pid));
  return pid;
}
