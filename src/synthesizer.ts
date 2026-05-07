import type { Task, AgentResult, Org } from "./types";

export async function synthesize(task: Task, results: AgentResult[], org: Org, invoke: (prompt: string) => Promise<string>): Promise<AgentResult> {
  if (results.length === 1) return results[0];

  const summaries = results.map((r, i) =>
    `[${i + 1}] ${r.agent}: ${r.content.slice(0, 400)}`
  ).join("\n\n");

  try {
    const prompt = `Synthesize these sub-task results into a single unified output.

ORIGINAL TASK: ${task.description}

SUB-TASK RESULTS:
${summaries}

Produce a synthesized result that:
1. Resolves any contradictions between sub-results
2. Combines findings into one coherent narrative
3. Preserves the most important data points
4. Is structured for a decision-maker

Respond with only the synthesized result. No preamble.`;

    const content = await invoke(prompt);
    return { taskId: task.id, agent: "synthesizer", content, artifacts: results.flatMap(r => r.artifacts) };
  } catch {
    // Fallback: concatenate
    const content = results.map(r => `### ${r.agent}\n${r.content}`).join("\n\n");
    return { taskId: task.id, agent: "synthesizer", content, artifacts: results.flatMap(r => r.artifacts) };
  }
}
