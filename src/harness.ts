import type { Org, Task, AgentResult, DecompositionResult } from "./types";
import { decompose } from "./decomposer";
import { spawnAgent } from "./spawner";
import { synthesize } from "./synthesizer";
import { bus } from "./bus";

export async function harness(task: Task, org: Org, invoke: (prompt: string) => Promise<string>): Promise<AgentResult> {
  bus.log(`harness:${task.id}`, `Starting task: ${task.description}`);

  if (task.complexity === "leaf") {
    const persona = findPersona(org, task.assignee);
    if (!persona) {
      const fallback = findBestPersona(org, task.division);
      task.assignee = fallback?.name || "general-agent";
    }

    bus.log(`harness:${task.id}`, `Spawning agent: ${task.assignee}`);
    const result = await spawnAgent(task, org, invoke);
    task.status = "done";
    task.result = result;
    return result;
  }

  // Composite — decompose
  bus.log(`harness:${task.id}`, "Decomposing task...");
  const decomposed = await decompose(task, org, invoke);
  task.children = decomposed.subTasks;
  task.status = "running";

  bus.log(`harness:${task.id}`, `${decomposed.subTasks.length} sub-tasks created: ${decomposed.reasoning}`);

  // Process children
  // Sequential if dependent (same division, ordered), parallel if independent
  const independent = areIndependent(decomposed);
  let results: AgentResult[];

  if (independent) {
    results = await Promise.all(decomposed.subTasks.map(st => {
      st.status = "running";
      return harness(st, org, invoke);  // RECURSION
    }));
  } else {
    results = [];
    for (const st of decomposed.subTasks) {
      st.status = "running";
      results.push(await harness(st, org, invoke));  // RECURSION
    }
  }

  bus.log(`harness:${task.id}`, "Synthesizing results...");
  const final = await synthesize(task, results, org, invoke);

  task.status = "done";
  task.result = final;
  return final;
}

function findPersona(org: Org, name?: string) {
  if (!name) return null;
  return org.personas.find(p =>
    p.name.toLowerCase() === name.toLowerCase() ||
    p.name.toLowerCase().includes(name.toLowerCase())
  ) || null;
}

function findBestPersona(org: Org, division: string) {
  const candidates = org.personas.filter(p => p.division === division);
  return candidates[0] || org.personas[0] || null;
}

function areIndependent(decomposed: DecompositionResult): boolean {
  // Independent if sub-tasks span different divisions or have no ordering
  const divisions = new Set(decomposed.subTasks.map(t => t.division));
  return divisions.size === decomposed.subTasks.length;
}
