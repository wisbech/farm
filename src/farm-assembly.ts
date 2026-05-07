import type { AssemblyLine, Division, QualityGate, Org } from "./types";
import { bus } from "./bus";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { evolve } from "./farm-evolve";

export async function createAssemblyLine(
  division: Division,
  options: { autoEvolve?: boolean; evolutionInterval?: number },
  org: Org
): Promise<AssemblyLine> {
  const existing = loadAssemblyLine(division, org);
  if (existing && !options.autoEvolve) return existing;

  bus.log("farm", `Creating assembly line for ${division}/`);

  const line: AssemblyLine = {
    division,
    program: generateProgram(division, org),
    triggers: getTriggers(division),
    machineTools: getRegisteredTools(division, org),
    qualityGates: getQualityGates(division),
    metrics: getMetrics(division),
    autoEvolve: options.autoEvolve ?? false,
    evolutionInterval: options.evolutionInterval ?? 60,
  };

  saveAssemblyLine(division, line, org);
  bus.log("farm", `${division} assembly line: ${line.machineTools.length} tools, ${line.qualityGates.length} gates, autoEvolve=${line.autoEvolve}`);

  return line;
}

function generateProgram(division: Division, org: Org): string {
  const personas = org.personas.filter(p => p.division === division);
  const toolNames = personas.map(p => p.name).join(", ");

  return `# ${division.toUpperCase()} Assembly — Sentinal Farm

## Division
${division}/ — ${division.charAt(0).toUpperCase() + division.slice(1)}

## Registered Machine Tools
${toolNames}

## Quality Gates
- Parse: All variants must be structurally valid
- Invariant: Variants must respect division boundaries
- Shadow: Variants must pass held-back evaluation
- Benchmark: Variants must reach metric threshold

## Triggers
- Manual: \`sentinel evolve ${division}/agents/{tool}.md\`
- Auto: Evolve every ${60} minutes (configured in assembly line)

## Metrics
- quality_score: measures consistency, specificity, boundary clarity
- benchmark_accuracy: performance on generated benchmark suite

## Behavior
When autoEvolve is enabled, the farm periodically mutates registered
machine tools against their quality gates and benchmarks. Improvements
are archived. Converged tools can be distilled into formal state machines.`;
}

function getTriggers(division: Division): string[] {
  const triggers: Record<Division, string[]> = {
    strategy: ["client_brief_received", "market_signal_detected", "competitive_landscape_shift"],
    intelligence: ["research_brief_received", "technology_signal_detected", "source_threshold_met"],
    engineering: ["tooling_gap_identified", "performance_regression", "infrastructure_change"],
    commercial: ["findings_ready", "client_delivery_requested", "publication_triggered"],
  };
  return triggers[division] || ["task_received"];
}

function getRegisteredTools(division: Division, org: Org): string[] {
  return org.personas.filter(p => p.division === division).map(p => p.path);
}

function getQualityGates(division: Division): QualityGate[] {
  return [
    { name: "parse", layer: "parse", threshold: 0 },
    { name: "invariant", layer: "invariant", threshold: 0 },
    { name: "shadow", layer: "shadow", threshold: 0 },
    { name: "benchmark", layer: "benchmark", threshold: 0.7 },
  ];
}

function getMetrics(division: Division): { name: string; current: number; target: number }[] {
  return [
    { name: "quality_score", current: 0, target: 0.8 },
    { name: "benchmark_accuracy", current: 0, target: 0.7 },
  ];
}

function saveAssemblyLine(division: Division, line: AssemblyLine, org: Org) {
  const dir = join(org.root, ".sentinel");
  if (!existsSync(dir)) require("node:fs").mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${division}-assembly.json`), JSON.stringify(line, null, 2));
}

function loadAssemblyLine(division: Division, org: Org): AssemblyLine | null {
  try {
    const path = join(org.root, ".sentinel", `${division}-assembly.json`);
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch { return null; }
}

export async function autoEvolveLoop(
  line: AssemblyLine,
  org: Org,
  invoke: (prompt: string) => Promise<string>
) {
  bus.log("farm", `Auto-evolve active for ${line.division}/ (every ${line.evolutionInterval}m)`);

  setInterval(async () => {
    bus.log("farm", `Auto-evolving ${line.division}/ — ${line.machineTools.length} tools`);
    for (const toolPath of line.machineTools) {
      try {
        await evolve(toolPath, {
          generations: 5,
          metric: "quality_score",
          direction: "maximize",
        }, org, invoke);
      } catch (err) {
        bus.log("farm", `Auto-evolve failed for ${toolPath}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }, line.evolutionInterval * 60_000);
}
