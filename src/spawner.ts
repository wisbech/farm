import type { Org, Task, AgentResult, Persona } from "./types";

export async function spawnAgent(task: Task, org: Org, invoke: (prompt: string) => Promise<string>): Promise<AgentResult> {
  const persona = findPersona(org, task.assignee || "");
  if (!persona) {
    return {
      taskId: task.id,
      agent: "system",
      content: `No agent found for "${task.assignee}". Task: ${task.description}`,
      artifacts: [],
    };
  }

  const systemPrompt = buildSystemPrompt(persona, org.protocol);

  try {
    const content = await invoke(`${systemPrompt}\n\nEXECUTE THIS TASK:\n${task.description}\n\nRespond only with the result. No preamble or explanation.`);
    return { taskId: task.id, agent: persona.name, content, artifacts: [] };
  } catch (err) {
    return {
      taskId: task.id,
      agent: persona.name,
      content: `Agent execution failed: ${err instanceof Error ? err.message : String(err)}`,
      artifacts: [],
    };
  }
}

function findPersona(org: Org, name: string): Persona | undefined {
  return org.personas.find(p =>
    p.name.toLowerCase() === name.toLowerCase() ||
    p.path.toLowerCase().includes(name.toLowerCase().replace(/\s+/g, "-"))
  );
}

function buildSystemPrompt(persona: Persona, protocol: string): string {
  return `YOU ARE: ${persona.name}

IDENTITY:
${persona.identity}

MISSION:
${persona.mission}

BOUNDARIES:
${persona.boundaries}

TRAITS: ${persona.traits.join(", ")}

${protocol ? `ORGANIZATION PROTOCOL:\n${protocol.slice(0, 2000)}` : ""}`;
}
