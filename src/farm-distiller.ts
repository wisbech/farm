import type { Org, SMState } from "./types";
import { getDB, getGenerations, insertMachine, getMachine } from "./farm-db";
import { bus } from "./bus";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export async function distill(
  toolPath: string,
  org: Org,
  invoke: (prompt: string) => Promise<string>
): Promise<{ states: SMState[]; metric: number } | null> {
  const db = getDB(org.root);
  const history = getGenerations(db, toolPath);

  if (history.length < 3) {
    bus.log("farm", `Need at least 3 variants to distill. Found ${history.length}.`);
    return null;
  }

  const successful = history.filter(v => v.shadowPassed);
  if (successful.length < 2) {
    bus.log("farm", `Need at least 2 successful variants. Found ${successful.length}.`);
    return null;
  }

  bus.log("farm", `Distilling ${toolPath} from ${history.length} variants`);

  const bestVariant = successful.toSorted((a, b) => b.metric - a.metric)[0];
  const patterns = extractPatterns(successful);

  const prompt = `You are distilling an AI agent's behavior into a formal state machine.
After multiple generations of evolution, the agent's behavior has stabilized into predictable patterns.

SUCCESSFUL VARIANTS AND THEIR PATTERNS:
${patterns}

BEST VARIANT OUTPUT PATTERN:
${bestVariant.diff.slice(0, 500)}

Analyze these patterns and identify:
1. What STATES does this agent go through?
2. What TRIGGERS cause state transitions?
3. What ACTIONS happen in each state?

Output ONLY a JSON object:

{
  "states": [
    {
      "name": "state_name",
      "description": "what happens here",
      "triggers": ["trigger_1", "trigger_2"],
      "actions": ["action_1", "action_2"],
      "exits": [{ "to": "next_state", "trigger": "event_name" }]
    }
  ]
}

Use 3-5 states. Names should be verbs or gerunds. Make triggers specific, not generic.
Include an "idle" state as the starting point.`;

  try {
    const text = await invoke(prompt);
    const json = extractJson(text);
    const states = (json.states || []) as SMState[];

    const id = insertMachine(db, toolPath, states, bestVariant.id, bestVariant.metric);

    // Also save as JSON file in .sentinel/machines/
    const machineDir = join(org.root, ".sentinel", "machines");
    if (!existsSync(machineDir)) mkdirSync(machineDir, { recursive: true });
    const machineName = toolPath.split("/").pop()?.replace(".md", "") || "unknown";
    writeFileSync(join(machineDir, `${machineName}.json`), JSON.stringify({
      name: machineName,
      source: toolPath,
      distilledFrom: bestVariant.id,
      metric: bestVariant.metric,
      states,
      timestamp: new Date().toISOString(),
    }, null, 2));

    bus.log("farm", `Distilled ${states.length} states. Saved as ${id}.`);
    return { states, metric: bestVariant.metric };
  } catch (err) {
    bus.log("farm", `Distillation failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function extractPatterns(variants: import("./types").Variant[]): string {
  const sorted = variants.toSorted((a, b) => b.metric - a.metric);
  const top3 = sorted.slice(0, 3);

  return top3.map((v, i) =>
    `\nVARIANT ${i + 1} (gen ${v.generation}, score ${v.metric.toFixed(2)}) [${v.mutationType}]:
  Key changes: ${v.diff.slice(0, 200)}`
  ).join("\n");
}

function extractJson(text: string): any {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const json = text.slice(start, end + 1);
    return JSON.parse(json);
  }
  throw new Error("No JSON found");
}

export async function showMachine(
  toolPath: string,
  org: Org
): Promise<SMState[] | null> {
  const db = getDB(org.root);
  const machine = getMachine(db, toolPath);
  return machine?.states || null;
}
