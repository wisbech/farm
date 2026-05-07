import type { Org, Task, DecompositionResult } from "./types";

const RULE_CACHE = new Map<string, DecompositionResult>();

export async function decompose(task: Task, org: Org, invoke: (prompt: string) => Promise<string>): Promise<DecompositionResult> {
  const key = task.description.toLowerCase().slice(0, 80);
  const cached = RULE_CACHE.get(key);
  if (cached) return cached;

  // Try rules first
  const ruleResult = ruleDecomposition(task, org);
  if (ruleResult) {
    RULE_CACHE.set(key, ruleResult);
    return ruleResult;
  }

  // Fall back to LLM decomposition
  return llmDecomposition(task, org, invoke);
}

function ruleDecomposition(task: Task, org: Org): DecompositionResult | null {
  const desc = task.description.toLowerCase();

  const patterns: { match: (d: string) => boolean; decompose: () => Omit<DecompositionResult, never> }[] = [
    {
      match: (d) => d.includes("research") && (d.includes("adoption") || d.includes("ai") || d.includes("technology")),
      decompose: () => ({
        reasoning: "Research tasks decompose into landscape scan, metrics analysis, and verification",
        subTasks: [
          leafTask(task, "intelligence", "Intel Analyst", `${task.description} — landscape scan and source collection`),
          leafTask(task, "intelligence", "Data Analyst", `${task.description} — quantitative metrics and data analysis`),
          leafTask(task, "intelligence", "Source Validator", `${task.description} — claims verification and confidence scoring`),
        ],
      }),
    },
    {
      match: (d) => d.includes("publish") || d.includes("article") || d.includes("report"),
      decompose: () => ({
        reasoning: "Publication tasks route through content creation then editorial review",
        subTasks: [
          leafTask(task, "commercial", "Content Strategist", `${task.description} — draft the content`),
          leafTask(task, "commercial", "Editor-in-Chief", `${task.description} — review and finalize`),
        ],
      }),
    },
    {
      match: (d) => d.includes("strategy") || d.includes("client") || d.includes("engagement"),
      decompose: () => ({
        reasoning: "Strategy tasks require multi-perspective analysis",
        subTasks: [
          leafTask(task, "strategy", "Strategist", `${task.description} — develop strategic framework`),
          leafTask(task, "strategy", "CEO", `${task.description} — vision alignment and final sign-off`),
        ],
      }),
    },
  ];

  for (const pattern of patterns) {
    if (pattern.match(desc)) {
      return pattern.decompose();
    }
  }

  return null;
}

async function llmDecomposition(task: Task, org: Org, invoke: (prompt: string) => Promise<string>): Promise<DecompositionResult> {
  const personas = org.personas.map(p => `  - ${p.name} (${p.division}): ${p.mission.split(".")[0]}`).join("\n");

  const prompt = `Decompose this task into sub-tasks that can be executed by the available agents.

TASK: ${task.description}
TASK DIVISION: ${task.division}

AVAILABLE AGENTS:
${personas}

Output ONLY a JSON object:
{
  "reasoning": "why you decomposed this way (1 sentence)",
  "subTasks": [
    { "description": "sub-task description", "division": "division-name", "assignee": "agent-name" }
  ]
}

Rules:
- Each sub-task must be independently executable by one agent
- Assign sub-tasks to agents that match the task domain
- 3-5 sub-tasks is the right number
- If the task is simple enough for one agent, output 1 sub-task`;

  const text = await invoke(prompt);
  try {
    const json = JSON.parse(extractJson(text));
    return {
      reasoning: json.reasoning || "LLM-based decomposition",
      subTasks: (json.subTasks || []).map((st: { description: string; division: string; assignee: string }, i: number) =>
        leafTask(task, st.division || task.division, st.assignee, st.description)
      ),
    };
  } catch {
    // Fallback: route to division
    const persona = org.personas.find(p => p.division === task.division) || org.personas[0];
    return {
      reasoning: "Fallback: routed to division default agent",
      subTasks: [leafTask(task, task.division, persona?.name, task.description)],
    };
  }
}

function leafTask(parent: Task, division: string, assignee: string, description: string): Task {
  return {
    id: `${parent.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    description,
    division: division as Task["division"],
    complexity: "leaf",
    parentId: parent.id,
    assignee,
    status: "pending",
  };
}

function extractJson(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  throw new Error("No JSON found in response");
}
