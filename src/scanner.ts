import { readdir, stat, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { Org, Division, Persona } from "./types";

const DIVISION_NAMES: Division[] = ["strategy", "intelligence", "engineering", "commercial"];
const CONTEXT_FILES = ["CLAUDE.md", "AGENTS.md"];

export async function detect(root: string): Promise<Org | null> {
  try {
    await stat(root);
  } catch {
    return null;
  }

  const claudeMd = await tryRead(join(root, "CLAUDE.md"));
  const agentsMd = await tryRead(join(root, "AGENTS.md"));

  if (!claudeMd || !agentsMd) return null;

  const divisions = await detectDivisions(root);
  if (divisions.length === 0) return null;

  const personas = await loadPersonas(root, divisions);
  const routingTable = parseRoutingTable(claudeMd);
  const protocol = await loadProtocol(root);

  return { root, divisions, personas, claudeMd, agentsMd, routingTable, protocol };
}

async function detectDivisions(root: string): Promise<Division[]> {
  const found: Division[] = [];
  for (const div of DIVISION_NAMES) {
    try {
      const contextPath = join(root, div, `${div.toUpperCase()}.md`);
      await stat(contextPath);
      found.push(div);
    } catch {}
  }
  return found;
}

async function loadPersonas(root: string, divisions: Division[]): Promise<Persona[]> {
  const personas: Persona[] = [];
  for (const div of divisions) {
    const agentsDir = join(root, div, "agents");
    try {
      const files = await readdir(agentsDir);
      for (const file of files) {
        if (!file.endsWith(".md")) continue;
        const content = await readFile(join(agentsDir, file), "utf-8");
        const persona = parsePersona(content, div, join(agentsDir, file));
        if (persona) personas.push(persona);
      }
    } catch {}
  }
  return personas;
}

function parsePersona(content: string, division: Division, path: string): Persona | null {
  const nameMatch = content.match(/^#\s+(.+?)(?:\s+—|$)/m);
  if (!nameMatch) return null;

  const name = nameMatch[1].trim();
  const identity = extractSection(content, "Identity");
  const mission = extractSection(content, "Mission");
  const boundaries = extractSection(content, "Boundaries");
  const traitsSection = extractSection(content, "Traits") || extractSection(content, "What You Look For");

  const traits = traitsSection
    ? traitsSection.split("\n")
        .filter(l => l.startsWith("- "))
        .map(l => l.replace(/^-\s+/, "").trim())
    : [];

  return { name, division, identity, mission, boundaries, traits, path };
}

function extractSection(content: string, heading: string): string {
  const regex = new RegExp(`##\\s+${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, "i");
  const match = content.match(regex);
  return match ? match[1].trim() : "";
}

function parseRoutingTable(claudeMd: string): Map<string, { division: Division; skills: string[] }> {
  const table = new Map<string, { division: Division; skills: string[] }>();
  const lines = claudeMd.split("\n");
  let inTable = false;

  for (const line of lines) {
    if (line.includes("| Task | Division |")) { inTable = true; continue; }
    if (inTable && line.startsWith("|---")) continue;
    if (inTable && !line.startsWith("|")) break;

    if (inTable && line.startsWith("|")) {
      const cells = line.split("|").map(c => c.trim()).filter(Boolean);
      if (cells.length < 3) continue;
      const taskPattern = cells[0].toLowerCase();
      const divisionStr = cells[1].replace(/\//g, "").trim();
      const skillsStr = cells.length > 3 ? cells[3] : "";

      for (const div of DIVISION_NAMES) {
        if (divisionStr === div) {
          const skills = skillsStr
            .split(/[,;]/)
            .map(s => s.trim().replace(/`/g, ""))
            .filter(Boolean);
          table.set(taskPattern, { division: div, skills });
        }
      }
    }
  }
  return table;
}

async function loadProtocol(root: string): Promise<string> {
  const paths = [
    join(root, "intelligence", "INTELLIGENCE.md"),
    join(root, "AGENTS.md"),
  ];
  for (const p of paths) {
    try {
      const content = await readFile(p, "utf-8");
      return content;
    } catch {}
  }
  return "";
}

async function tryRead(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}
