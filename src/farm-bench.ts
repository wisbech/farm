import type { Benchmark, BenchmarkQuestion } from "./types";
import { bus } from "./bus";
import { readFileSync, existsSync } from "node:fs";
import { getDB, insertBenchmark, getBenchmarks, getBenchmark, insertBenchRun, getBenchRuns } from "./farm-db";
import type { Org } from "./types";

export async function generateBenchmark(
  researchPath: string,
  org: Org,
  invoke: (prompt: string) => Promise<string>
): Promise<Benchmark> {
  const db = getDB(org.root);

  const findings = tryRead(`${researchPath}/findings.md`);
  const claims = tryRead(`${researchPath}/claims.md`);
  const sources = tryRead(`${researchPath}/sources/sources.md`);
  const research = tryRead(`${researchPath}/RESEARCH.md`);

  if (!findings) {
    bus.log("farm", `No findings.md found at ${researchPath}/findings.md`);
    throw new Error("No findings found");
  }

  bus.log("farm", `Generating benchmark from ${researchPath}`);

  const context = `
RESEARCH SCOPE:
${research?.slice(0, 500) || "Unknown"}

FINDINGS (the ground truth):
${findings.slice(0, 2000)}

CLAIMS EXTRACT:
${claims?.slice(0, 800) || "No claims data"}

SOURCES:
${sources?.slice(0, 500) || "No source catalog"}
`;

  const prompt = `You are generating a benchmark to test knowledge about this research domain.
Given the research findings below (which are the GROUND TRUTH), generate questions.

${context}

Generate 5-8 multiple-choice questions:

1-2 FACTS (Tier 1): Direct factual recall from the findings. "What was the..."
2-3 CORRELATIONS (Tier 2): Comparative or relationship questions. "Which sector..."  
2-3 IMPLICATIONS (Tier 3): What conclusions follow from the data? "What does the gap between X and Y mean for..."

For EACH question:
- 4 options (A/B/C/D)
- ONE correct answer (indicated by 0-based index: 0=A, 1=B, 2=C, 3=D)
- Source reference (which section of findings supports this)
- Tier (1, 2, or 3)
- Wrong options must be plausible but incorrect

Output ONLY a JSON array:

[
  {
    "tier": 1,
    "question": "...",
    "options": ["A", "B", "C", "D"],
    "answer": 0,
    "source": "findings.md, paragraph 2"
  }
]`;

  try {
    const text = await invoke(prompt);
    const questions = parseQuestions(text);
    const slug = researchPath.split("/").pop() || "unknown";
    const id = `bench-${slug}-${Date.now()}`;

    const benchmark: Benchmark = {
      id,
      domain: slug,
      createdFrom: researchPath,
      questions,
      timestamp: new Date().toISOString(),
    };

    insertBenchmark(db, benchmark);
    bus.log("farm", `Benchmark generated: ${id} — ${questions.length} questions (T1:${questions.filter(q => q.tier===1).length}, T2:${questions.filter(q => q.tier===2).length}, T3:${questions.filter(q => q.tier===3).length})`);

    return benchmark;
  } catch (err) {
    bus.log("farm", `Benchmark generation failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

function parseQuestions(text: string): BenchmarkQuestion[] {
  try {
    const json = JSON.parse(extractJson(text));
    if (!Array.isArray(json)) throw new Error("Expected array");

    return json.map((q: any) => ({
      tier: (q.tier as 1 | 2 | 3) || 2,
      question: q.question || "",
      options: q.options || [],
      answer: typeof q.answer === "number" ? q.answer : 0,
      source: q.source || "",
    }));
  } catch {
    // Fallback: generate a single question
    return [{
      tier: 1,
      question: "Based on the research, what was the primary finding?",
      options: ["The data was inconclusive", "A clear trend was identified", "Multiple conflicting signals exist", "Further research is needed"],
      answer: 1,
      source: "findings.md (fallback)",
    }];
  }
}

function extractJson(text: string): string {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  const objStart = text.indexOf("{");
  const objEnd = text.lastIndexOf("}");
  if (objStart >= 0 && objEnd > objStart) return `[${text.slice(objStart, objEnd + 1)}]`;
  return "[]";
}

export async function runBenchmark(
  benchId: string,
  toolPath: string,
  org: Org,
  invoke: (prompt: string) => Promise<string>
) {
  const db = getDB(org.root);
  const bench = await getBenchmarkFromDB(db, benchId);
  if (!bench) { bus.log("farm", `Benchmark '${benchId}' not found`); return null; }

  const toolContent = tryRead(toolPath) || "";
  bus.log("farm", `Running ${bench.questions.length} questions against ${toolPath}`);

  let correct = 0;
  const tierCorrect = [0, 0, 0, 0];
  const tierTotal = [0, 0, 0, 0];

  for (const q of bench.questions) {
    const prompt = `Answer this multiple-choice question based on your domain knowledge.

QUESTION (Tier ${q.tier}): ${q.question}
A) ${q.options[0]}
B) ${q.options[1]}
C) ${q.options[2]}
D) ${q.options[3]}

Respond with ONLY the letter (A/B/C/D) of the correct answer.`;

    try {
      const response = await invoke(`${toolContent.slice(0, 1000)}\n\n---\n\n${prompt}`);
      const answer = response.trim().toUpperCase().charAt(0);
      const answerIdx = "ABCD".indexOf(answer);

      tierTotal[q.tier]++;
      if (answerIdx === q.answer) {
        correct++;
        tierCorrect[q.tier]++;
      }
    } catch {
      tierTotal[q.tier]++;
    }
  }

  const total = bench.questions.length;
  const accuracy = total > 0 ? correct / total : 0;
  const f1 = accuracy;

  const perTier = [1, 2, 3].map(tier => ({
    tier,
    accuracy: tierTotal[tier] > 0 ? tierCorrect[tier] / tierTotal[tier] : 0,
    f1: tierTotal[tier] > 0 ? tierCorrect[tier] / tierTotal[tier] : 0,
  }));

  const result = {
    benchId,
    toolPath,
    accuracy,
    f1,
    perTier,
    timestamp: new Date().toISOString(),
  };

  insertBenchRun(db, result);
  bus.log("farm", `Benchmark result: ${accuracy.toFixed(1)} accuracy (${correct}/${total}), T1:${perTier[0].accuracy.toFixed(1)} T2:${perTier[1].accuracy.toFixed(1)} T3:${perTier[2].accuracy.toFixed(1)}`);

  return result;
}

async function getBenchmarkFromDB(db: ReturnType<typeof getDB>, id: string): Promise<Benchmark | null> {
  try {
    const bench = getBenchmark(db, id);
    if (bench) return bench;

    const benches = getBenchmarks(db);
    const found = benches.find(b => b.id.includes(id));
    return found || benches[0] || null;
  } catch {
    return null;
  }
}

function tryRead(path: string): string | null {
  try { return readFileSync(path, "utf-8"); }
  catch { return null; }
}
