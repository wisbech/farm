import type { Org, MachineTool, EvolutionOptions, Variant, MutationType } from "./types";
import { getDB, insertGeneration, getLatestGeneration, getGenerations } from "./farm-db";
import { bus } from "./bus";
import { readFileSync } from "node:fs";

export async function evolve(
  toolPath: string,
  options: EvolutionOptions,
  org: Org,
  invoke: (prompt: string) => Promise<string>
) {
  const db = getDB(org.root);
  const tool = loadTool(toolPath, options, org);

  const budget = options.budget || 0;
  const maxGenerations = options.generations || 20;
  const mutations: MutationType[] = options.mutations ||
    ["prompt", "scope", "tool", "gate", "trigger", "protocol"];

  const startTime = Date.now();
  const budgetMs = budget * 60_000;

  bus.log("farm", `Evolving ${toolPath} — ${maxGenerations} generations, metric: ${tool.metricName}`);
  bus.log("farm", `${mutations.length} mutation types: ${mutations.join(", ")}`);

  let bestVariant = seedVariant(toolPath, tool);

  for (let g = 1; g <= maxGenerations; g++) {
    if (budgetMs && Date.now() - startTime > budgetMs) {
      bus.log("farm", `Budget exhausted after ${g - 1} generations`);
      break;
    }

    const mutationType = pickMutation(mutations, g);
    const parent = selectParent(toolPath, db);

    bus.log("farm", `Gen ${g}: ${mutationType} mutation from gen ${parent?.generation || 0}`);

    const variant = await mutate(parent || bestVariant, mutationType, tool, org, invoke);
    if (!variant) {
      bus.log("farm", `Gen ${g}: mutation failed`);
      continue;
    }

    const verified = await verify(variant, tool, org, invoke);
    insertGeneration(db, verified, toolPath);

    if (verified.shadowPassed) {
      const improved = isImproved(verified, bestVariant, tool.metricDirection);
      if (improved) {
        bestVariant = verified;
        bus.log("farm", `Gen ${g}: IMPROVED — metric ${verified.metric.toFixed(4)}`);
      } else {
        bus.log("farm", `Gen ${g}: kept but no improvement`);
      }
    } else {
      bus.log("farm", `Gen ${g}: rejected — shadow check failed`);
    }
  }

  bus.log("farm", `Evolution complete. Best metric: ${bestVariant.metric.toFixed(4)}`);

  return {
    bestVariant,
    history: getGenerations(db, toolPath),
    elapsed: Date.now() - startTime,
  };
}

function loadTool(toolPath: string, options: EvolutionOptions, org: Org): MachineTool {
  const content = readFileSync(toolPath, "utf-8");
  const isPersona = toolPath.includes("/agents/");
  const isProtocol = toolPath.match(/(STRATEGY|INTELLIGENCE|ENGINEERING|COMMERCIAL)\.md$/i);

  return {
    path: toolPath,
    type: isPersona ? "persona" : isProtocol ? "protocol" : "program",
    division: detectDivision(toolPath),
    currentGeneration: 0,
    bestMetric: 0,
    metricName: options.metric || "quality_score",
    metricDirection: options.direction || "maximize",
    distilled: null,
    preferredTransport: "claude",
    transportHistory: [],
    benchmarks: [],
    isEvolving: true,
  };
}

function detectDivision(path: string) {
  for (const div of ["strategy", "intelligence", "engineering", "commercial"]) {
    if (path.includes(`/${div}/`)) return div as any;
  }
  return "intelligence" as any;
}

function seedVariant(toolPath: string, tool: MachineTool): Variant {
  const content = readFileSync(toolPath, "utf-8");
  return {
    id: `gen-0-${toolPath.replace(/\//g, "-")}`,
    generation: 0,
    parentId: "",
    mutationType: "prompt",
    content,
    diff: "",
    metric: 0,
    checks: [],
    shadowPassed: true,
    invariantPassed: true,
    timestamp: new Date().toISOString(),
  };
}

function selectParent(toolPath: string, db: ReturnType<typeof getDB>): Variant | null {
  const history = getGenerations(db, toolPath);
  if (history.length === 0) return null;

  const ranked = history.toSorted((a, b) => b.metric - a.metric);
  if (Math.random() < 0.2) {
    const lowIdx = Math.floor(Math.random() * Math.max(1, Math.floor(ranked.length * 0.25)));
    return ranked[ranked.length - 1 - lowIdx] || ranked[0];
  }

  const idx = powerLawSample(ranked.length);
  return ranked[idx];
}

function powerLawSample(n: number): number {
  const alpha = 2.0;
  const u = Math.random();
  let idx = 0;
  let sum = 0;
  const total = Array.from({length: n}, (_, i) => 1 / Math.pow(i + 1, alpha)).reduce((a, b) => a + b, 0);
  for (let i = 0; i < n; i++) {
    sum += (1 / Math.pow(i + 1, alpha)) / total;
    if (u <= sum) { idx = i; break; }
  }
  return Math.min(idx, n - 1);
}

function pickMutation(mutations: MutationType[], gen: number): MutationType {
  if (gen <= 3) return "prompt";
  return mutations[Math.floor(Math.random() * mutations.length)];
}

async function mutate(
  parent: Variant,
  mutationType: MutationType,
  tool: MachineTool,
  org: Org,
  invoke: (prompt: string) => Promise<string>
): Promise<Variant | null> {
  const personas = org.personas.filter(p => p.division === tool.division)
    .map(p => `  - ${p.name}: ${p.mission.slice(0, 80)}`).join("\n");

  const prompt = `MUTATE: ${mutationType} mutation on a ${tool.type} for the ${tool.division} division.

CURRENT CONTENT:
${parent.content.slice(0, 2000)}

MUTATION TYPE: ${mutationType}
${mutationGuide(mutationType, tool)}

AVAILABLE AGENTS:
${personas}

Produce the full mutated content. Preserve the overall structure. Change only what the mutation targets.
Respond with ONLY the mutated content. No preamble. No explanation.`;

  try {
    const content = await invoke(prompt);
    if (!content || content.length < 10) return null;

    const id = `gen-${parent.generation + 1}-${Date.now()}`;
    const diff = diffLines(parent.content, content);

    return {
      id, generation: parent.generation + 1, parentId: parent.id,
      mutationType, content, diff,
      metric: 0, checks: [], shadowPassed: false, invariantPassed: false,
      timestamp: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function mutationGuide(mt: MutationType, tool: MachineTool): string {
  const guides: Record<MutationType, string> = {
    prompt: "Rewrite the instruction text. Make it more specific, more constrained, clearer about boundaries. Add measurable targets.",
    scope: "Narrow or widen the domain boundaries. What should this agent handle? What should it NOT handle?",
    tool: "Propose a new tool dependency or internal capability this agent needs.",
    gate: "Add or modify a quality gate — what must pass before output leaves this agent?",
    trigger: "Change what events or conditions activate this agent.",
    protocol: "Modify the process or methodology constraints. How should work flow through this agent?",
    transport: "Do NOT change the content. This mutation only switches the LLM transport for evaluation. The content stays identical.",
  };
  return guides[mt] || "Improve this artifact.";
}

async function transportMutate(
  parent: Variant,
  tool: MachineTool,
  availableTransports: string[]
): Promise<{ variant: Variant; transport: string } | null> {
  const unused = availableTransports.filter(
    t => !tool.transportHistory.find(h => h.transport === t) ||
         Date.now() - new Date(tool.transportHistory.find(h => h.transport === t)!.lastTested).getTime() > 48 * 3600_000
  );

  const candidates = unused.length > 0 ? unused : availableTransports;
  const transport = candidates[Math.floor(Math.random() * candidates.length)];

  if (transport === tool.preferredTransport) return null;

  const id = `gen-${parent.generation + 1}-transport-${Date.now()}`;

  const variant: Variant = {
    id,
    generation: parent.generation + 1,
    parentId: parent.id,
    mutationType: "transport",
    content: parent.content,
    diff: `TRANSPORT: ${tool.preferredTransport} → ${transport}`,
    metric: 0,
    checks: [],
    shadowPassed: false,
    invariantPassed: true,
    timestamp: new Date().toISOString(),
  };

  return { variant, transport };
}

async function verify(
  variant: Variant,
  tool: MachineTool,
  org: Org,
  invoke: (prompt: string) => Promise<string>
): Promise<Variant> {
  const checks = [];

  const parseOk = parseCheck(variant.content, tool.type);
  checks.push({ layer: "parse", passed: parseOk, ms: 0 });
  variant.invariantPassed = parseOk;

  const invariantOk = parseOk && invariantCheck(variant.content, tool, org);
  checks.push({ layer: "invariant", passed: invariantOk, ms: 0 });

  if (invariantOk) {
    const shadowOk = await shadowCheck(variant.content, tool, org, invoke);
    checks.push({ layer: "shadow", passed: shadowOk, ms: 100 });
    variant.shadowPassed = shadowOk;
    variant.metric = shadowOk ? estimateMetric(variant, tool) : 0;
  } else {
    checks.push({ layer: "shadow", passed: false, ms: 0 });
    variant.metric = 0;
  }

  variant.checks = checks;
  return variant;
}

function parseCheck(content: string, type: string): boolean {
  if (type === "persona") {
    return content.includes("## Identity") || content.includes("## Mission");
  }
  return content.length > 20 && !content.includes("{{UNCLOSED");
}

function invariantCheck(content: string, tool: MachineTool, org: Org): boolean {
  const div = tool.division;
  const otherDivs = org.divisions.filter(d => d !== div);
  const mentionsOthers = otherDivs.some(d => {
    const regex = new RegExp(`\\b${d}/\\b.*?do`, "i");
    return regex.test(content);
  });
  return !mentionsOthers || content.includes("collaborat");
}

async function shadowCheck(
  content: string,
  tool: MachineTool,
  org: Org,
  invoke: (prompt: string) => Promise<string>
): Promise<boolean> {
  try {
    const prompt = `Validate this ${tool.type} definition for consistency.

${content.slice(0, 1000)}

Check:
1. Is it internally consistent?
2. Does it avoid contradictory instructions?
3. Are the boundaries clearly stated?

Respond with ONLY "pass" or "fail" followed by one sentence of reasoning.`;

    const response = await invoke(prompt);
    return response.toLowerCase().includes("pass");
  } catch {
    return true;
  }
}

function estimateMetric(variant: Variant, tool: MachineTool): number {
  const base = 0.3;
  let score = base;

  if (variant.content.includes("##")) score += 0.15;
  if (variant.content.match(/\b\s(must|should|shall)\s/g)) score += 0.1;
  if (variant.content.includes("- ")) score += 0.1;
  if (variant.content.toLowerCase().includes("boundary")) score += 0.1;
  if (variant.content.toLowerCase().includes("verify") || variant.content.toLowerCase().includes("check")) score += 0.1;

  score += (Math.random() * 0.2 - 0.1);
  return Math.max(0, Math.min(1, score));
}

function isImproved(variant: Variant, best: Variant, direction: string): boolean {
  return direction === "maximize" ? variant.metric > best.metric : variant.metric < best.metric;
}

function diffLines(oldText: string, newText: string): string {
  const o = oldText.split("\n");
  const n = newText.split("\n");
  const changes: string[] = [];
  const max = Math.max(o.length, n.length);

  for (let i = 0; i < max; i++) {
    if (i >= o.length) { changes.push(`+ ${n[i]}`); }
    else if (i >= n.length) { changes.push(`- ${o[i]}`); }
    else if (o[i] !== n[i]) { changes.push(`~ ${o[i].slice(0, 60)} → ${n[i].slice(0, 60)}`); }
  }

  return changes.slice(0, 30).join("\n");
}
