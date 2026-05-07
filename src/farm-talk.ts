import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ActivityLog } from "./farm-activity";
import { readStatus } from "./farm-status";
import { writeSteering } from "./farm-security";
import { bus } from "./bus";

export async function talk(workspaceRoot: string) {
  const status = readStatus(workspaceRoot);
  if (!status || !status.pid) {
    console.log("Farm is not running. Start it with 'farm start'.");
    return;
  }

  const activity = new ActivityLog(workspaceRoot);

  // Check if process is alive
  try { process.kill(status.pid, 0); }
  catch { console.log("Farm process is dead but PID file exists. Try 'farm stop' then 'farm start'."); return; }

  const readline = await import("node:readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const prompt = (): Promise<string> => new Promise(r => rl.question("\n> ", (a: string) => r(a.trim())));

  console.log("\nSentinel Farm — Talk Mode");
  console.log(`Connected to PID ${status.pid}`);
  console.log(`Running: ${status.running.length} | Queued: ${status.queued.length} | Done: ${status.completed.length}`);
  console.log("Type your message, 'status', 'log', or 'quit'.\n");

  let lastRead = new Date().toISOString();

  while (true) {
    const input = await prompt();
    if (!input) continue;
    if (input === "quit" || input === "exit" || input === "q") break;

    if (input === "status" || input === "s") {
      const s = readStatus(workspaceRoot);
      if (!s) { console.log("  Unable to read status."); continue; }
      console.log(`\n  Running: ${s.running.map(r => `${r.agent}: ${r.task}`).join(", ") || "none"}`);
      console.log(`  Queued: ${s.queued.length}`);
      console.log(`  Completed: ${s.completed.length}`);
      console.log(`  Last: ${s.lastActivity}`);
      continue;
    }

    if (input === "log" || input === "l") {
      const entries = activity.read(10);
      for (const e of entries) {
        const time = new Date(e.timestamp).toISOString().slice(11, 19);
        console.log(`  [${time}] [${e.type}] ${e.message}`);
      }
      continue;
    }

    // Send steering message to daemon
    writeSteering(workspaceRoot, input);
    console.log("  [sent]");
  }

  rl.close();
}
