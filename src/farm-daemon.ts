import { detect } from "./scanner";
import { harness } from "./harness";
import { loadConfig } from "./config";
import { createTransport } from "./transport";
import { loadFarmConfig, deriveAllowedPaths, drainSteering } from "./farm-security";
import { ActivityLog } from "./farm-activity";
import { StatusManager } from "./farm-status";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Org, Task } from "./types";

const PID_FILE = ".sentinel/farm.pid";

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

  const SCAN_INTERVAL = 30_000;

  while (true) {
    try {
      for (const msg of drainSteering(workspaceRoot)) {
        activity.log("steer", msg);
      }

      const pending = findPendingWork(workspaceRoot, org, status, activity);
      if (pending) {
        await executeWork(pending, org, status, activity, invoke);
      }

      status.touch();
    } catch (err) {
      activity.log("system", `Error: ${err instanceof Error ? err.message : String(err)}`);
    }

    await new Promise(r => setTimeout(r, SCAN_INTERVAL));
  }
}

function findPendingWork(
  workspaceRoot: string,
  org: Org,
  status: StatusManager,
  activity: ActivityLog
): null | { project: string; desc: string; id: string; path: string } {
  const researchDir = join(workspaceRoot, "intelligence", "research");
  if (!existsSync(researchDir)) return null;

  const projects = readdirSync(researchDir);

  for (const project of projects) {
    const rPath = join(researchDir, project, "RESEARCH.md");
    const fPath = join(researchDir, project, "findings.md");
    if (!existsSync(rPath)) continue;

    const findingsContent = existsSync(fPath) ? readFileSync(fPath, "utf-8") : "";
    if (findingsContent.length > 300) continue;

    const desc = readFileSync(rPath, "utf-8").split("\n")[0].replace(/^#\s*/, "").slice(0, 80);
    const id = `research-${project}`;

    const snapshot = status.snapshot();
    if (snapshot.running.some(r => r.id === id)) return null;
    if (snapshot.completed.some(c => c.task.includes(project))) return null;

    return { project, desc, id, path: researchDir + "/" + project };
  }

  return null;
}

async function executeWork(
  work: { project: string; desc: string; id: string },
  org: Org,
  status: StatusManager,
  activity: ActivityLog,
  invoke: (p: string) => Promise<string>
) {
  status.addRunning(work.id, work.desc, "Intel Analyst");
  activity.log("task_start", work.desc, { project: work.project });

  const task: Task = {
    id: work.id,
    description: work.desc,
    division: "intelligence",
    complexity: "composite",
    status: "pending",
  };

  try {
    const result = await harness(task, org, invoke);
    status.completeRunning(work.id, result.content.slice(0, 80));
    activity.log("task_end", `Done: ${result.content.slice(0, 120)}`, { agent: result.agent });
  } catch (err) {
    status.failRunning(work.id, err instanceof Error ? err.message : String(err));
    activity.log("task_end", `Failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function writePid(workspaceRoot: string): number {
  const pid = process.pid;
  writeFileSync(join(workspaceRoot, PID_FILE), String(pid));
  return pid;
}
