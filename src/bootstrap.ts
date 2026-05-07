import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BootstrapBlueprint } from "./types";

export async function create(root: string, blueprint: BootstrapBlueprint) {
  await mkdir(root, { recursive: true });

  const devboxJson = devboxConfig(blueprint);
  await writeFile(join(root, "devbox.json"), devboxJson);

  const claudeMd = claudeMdContent(blueprint);
  await writeFile(join(root, "CLAUDE.md"), claudeMd);

  const agentsMd = agentsMdContent(blueprint);
  await writeFile(join(root, "AGENTS.md"), agentsMd);

  await mkdir(join(root, "wiki", "topics"), { recursive: true });
  await writeFile(join(root, "wiki", "index.md"), rootWikiContent(blueprint));

  for (const div of blueprint.divisions) {
    const divPath = join(root, div.name);
    await mkdir(join(divPath, "agents"), { recursive: true });
    await mkdir(join(divPath, "wiki", "topics"), { recursive: true });

    const contextContent = divisionContextContent(blueprint, div);
    await writeFile(join(divPath, `${div.name.toUpperCase()}.md`), contextContent);

    const wikiContent = `# ${capitalize(div.name)} Wiki\n\n*Topics pending — this division's knowledge base.*\n\n[Root Wiki](/wiki/index.md) | [Division Context](/${div.name}/${div.name.toUpperCase()}.md)\n`;
    await writeFile(join(divPath, "wiki", "index.md"), wikiContent);

    for (const agent of div.agents) {
      const agentContent = agentPersonaContent(agent, div.name, blueprint.name);
      await writeFile(join(divPath, "agents", `${agent.name.toLowerCase().replace(/\s+/g, "-")}.md`), agentContent);
    }
  }
}

export async function inferBlueprint(description: string, invoke: (prompt: string) => Promise<string>): Promise<BootstrapBlueprint> {
  const prompt = `You are designing an AI-native company structure using the my-org pattern. Given this organizational description, produce a company blueprint.

${description}

Output a structured blueprint with:
1. Company name (2-3 words)
2. Short description (1 sentence)
3. 3-4 divisions — each with a purpose statement
4. 3-5 agents per division — each with a role description
5. Optional devbox packages needed

Respond ONLY with the blueprint in this format:

NAME: Company Name
DESCRIPTION: One-sentence description of what this company does.

DIVISIONS:
strategy: {purpose}
  - Agent Name: {role}
  - Agent Name: {role}
  ...
intelligence: {purpose}
  - Agent Name: {role}
  ...
engineering: {purpose}
  - Agent Name: {role}
  ...
commercial: {purpose}
  - Agent Name: {role}
  ...

DEVBOX: python@3.12, nodejs@22, ripgrep, jq, pandoc, ffmpeg

Be specific. No hedging. Make bold, useful choices.`;

  const response = await invoke(prompt);
  return parseBlueprint(response);
}

function parseBlueprint(text: string): BootstrapBlueprint {
  const name = (text.match(/^NAME:\s*(.+)/m)?.[1] || "My Company").trim();
  const description = (text.match(/^DESCRIPTION:\s*(.+)/m)?.[1] || "").trim();
  const devboxRaw = text.match(/^DEVBOX:\s*(.+)/m)?.[1] || "python@3.12, nodejs@22, ripgrep, jq, pandoc, ffmpeg";
  const devbox = { packages: devboxRaw.split(",").map(s => s.trim()).filter(Boolean) };

  const divisions: BootstrapBlueprint["divisions"] = [];
  const divRegex = /^(\w+):\s*(.+)$/gm;
  const agentRegex = /^\s*-\s+(.+?):\s*(.+)$/gm;

  for (const line of text.split("\n")) {
    const divMatch = line.match(/^(\w+):\s*(.+)$/);
    if (divMatch && !line.startsWith("  -") && !line.startsWith("- ")) {
      const divName = divMatch[1].trim().toLowerCase();
      const purpose = divMatch[2].trim();
      if (["strategy", "intelligence", "engineering", "commercial"].includes(divName)) {
        divisions.push({ name: divName, purpose, agents: [] });
      }
      continue;
    }

    const agentMatch = line.match(/^\s*-\s+(.+?):\s*(.+)$/);
    if (agentMatch && divisions.length > 0) {
      const last = divisions[divisions.length - 1];
      last.agents.push({ name: agentMatch[1].trim(), role: agentMatch[2].trim() });
    }
  }

  // Ensure all expected divisions exist with at least empty agents
  const required = ["strategy", "intelligence", "engineering", "commercial"];
  for (const r of required) {
    if (!divisions.find(d => d.name === r)) {
      divisions.push({ name: r, purpose: `${capitalize(r)} division`, agents: [] });
    }
  }

  return { name, description, divisions, devbox };
}

function devboxConfig(bp: BootstrapBlueprint): string {
  return JSON.stringify({
    packages: bp.devbox?.packages || ["python@3.12", "nodejs@22", "ripgrep", "jq", "pandoc", "ffmpeg"],
    shell: { init_hook: ["export PYTHONPATH=."] }
  }, null, 2) + "\n";
}

function claudeMdContent(bp: BootstrapBlueprint): string {
  const lines = ["# CLAUDE.md — The Map", "", "Read this file first on every session.", "", "## Identity", "", `You are helping run **${bp.name}**. ${bp.description}`, "", "## Routing Table", "", "| Task | Division | Read First | Skills |", "|------|----------|------------|--------|"];

  for (const div of bp.divisions) {
    const examples = taskExamples(div.name);
    for (const ex of examples) {
      lines.push(`| ${ex.task} | ${div.name}/ | ${div.name.toUpperCase()}.md | ${ex.skills} |`);
    }
  }

  lines.push("", "## Rules", "", "- Read CLAUDE.md first on every new task", "- One division per session — don't load all contexts at once");
  lines.push("- Agent definitions live in `[division]/agents/`", "- Devbox is the canonical environment");
  return lines.join("\n") + "\n";
}

function taskExamples(div: string): { task: string; skills: string }[] {
  const map: Record<string, { task: string; skills: string }[]> = {
    strategy: [
      { task: "Client strategy, vision", skills: "Council, FirstPrinciples" },
      { task: "Market analysis, research", skills: "Research" },
      { task: "Financial modeling", skills: "Research" },
    ],
    intelligence: [
      { task: "OSINT research", skills: "Research, OSINT, Scraping" },
      { task: "Source verification", skills: "OSINT, Investigation" },
      { task: "Data aggregation", skills: "Research" },
    ],
    engineering: [
      { task: "Build tool, pipeline", skills: "CreateCLI" },
      { task: "Infrastructure, devbox", skills: "Shell scripting" },
    ],
    commercial: [
      { task: "Write article, report", skills: "ExtractWisdom, Fabric" },
      { task: "Brand, media production", skills: "Media, Art, Remotion" },
      { task: "Client proposal", skills: "Council" },
    ],
  };
  return map[div] || [{ task: capitalize(div), skills: "Research" }];
}

function agentsMdContent(bp: BootstrapBlueprint): string {
  const lines = ["# AGENTS.md", "", "Guidance for AI agents working in this repository.", "", "## Architecture"];
  lines.push("", `\`\`\`\n${bp.name.toLowerCase().replace(/\s+/g, "-")}/\n├── CLAUDE.md\n├── AGENTS.md\n├── devbox.json\n├── wiki/`);

  for (const div of bp.divisions) {
    lines.push(`├── ${div.name}/\n│   ├── ${div.name.toUpperCase()}.md\n│   ├── agents/\n│   └── wiki/`);
  }
  lines.push("\`\`\`");
  lines.push("", "## Critical Rules", "", "- Read CLAUDE.md before every task", "- One division per session", "- Agent definitions in `[division]/agents/`");
  lines.push("- Devbox is the canonical environment", "", "## Anti-Rationalization");
  lines.push("", "| Thought | Reality |", "|---------|---------|");
  lines.push("| \"I don't need to read the division context\" | You will miss constraints, agents, and workflows |");
  lines.push("| \"I can load all contexts at once\" | Token waste. Only load the workspace in use |");
  lines.push("| \"Wiki can wait\" | Knowledge loss. Write wiki entry, commit with deliverables |");

  return lines.join("\n") + "\n";
}

function divisionContextContent(bp: BootstrapBlueprint, div: { name: string; purpose: string; agents: { name: string; role: string }[] }): string {
  const lines = [`# ${capitalize(div.name)} Division — ${div.name.toUpperCase()}.md`, "", `Workspace context for the ${capitalize(div.name)} division.`, "", "## Purpose", "", div.purpose, "", "## Process", "", "1. Assess the task", "2. Execute", "3. Document in wiki", "", "## Agents"];

  lines.push("", "| Agent | Role | File |", "|-------|------|------|");
  for (const agent of div.agents) {
    const file = `${agent.name.toLowerCase().replace(/\s+/g, "-")}.md`;
    lines.push(`| ${agent.name} | ${agent.role} | \`agents/${file}\` |`);
  }

  lines.push("", "## Files", "", `\`\`\`\n${div.name}/\n├── ${div.name.toUpperCase()}.md\n├── agents/\n└── wiki/\n\`\`\``);
  lines.push("", "## What Good Looks Like", "", "- Work is documented", "- Decisions are tracked");
  lines.push("", "## What to Avoid", "", "- Mixing division contexts");

  return lines.join("\n") + "\n";
}

function agentPersonaContent(agent: { name: string; role: string }, division: string, company: string): string {
  return `# ${agent.name} — ${agent.role}

**Division:** ${capitalize(division)}
**Company:** ${company}

## Identity

You are the ${agent.name} of ${company}. ${agent.role}.

## Mission

Execute your role with precision and clarity. Your output shapes the company's ${division} function.

## Boundaries

- You operate within the ${division}/ division
- You collaborate with other agents when your domain intersects theirs
- You escalate to strategy/ when strategic decisions are needed

## What You Look For

- Clarity and precision in your work
- Actionable insights, not vague observations
- Collaboration opportunities with other divisions

## What You Reject

- Work that falls outside your defined mission
- Generic, unsubstantiated claims
- Decisions made without consulting the appropriate division
`;
}

function rootWikiContent(bp: BootstrapBlueprint): string {
  const lines = [`# ${bp.name} — Root Wiki`, "", bp.description, "", "## Divisions", ""];
  for (const div of bp.divisions) {
    lines.push(`- [${capitalize(div.name)}](/${div.name}/wiki/index.md) — ${div.purpose}`);
  }
  return lines.join("\n") + "\n";
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
