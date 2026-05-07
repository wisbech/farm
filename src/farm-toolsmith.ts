import type { Org } from "./types";
import { bus } from "./bus";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface InventedTool {
  name: string;
  path: string;
  description: string;
  language: string;
  code: string;
}

export async function inventTool(
  domain: string,
  constraints: string,
  org: Org,
  invoke: (prompt: string) => Promise<string>
): Promise<InventedTool | null> {
  const toolsDir = join(org.root, "tools");
  if (!existsSync(toolsDir)) mkdirSync(toolsDir, { recursive: true });

  const existingTools = tryList(toolsDir);

  bus.log("farm", `Inventing tool for domain: ${domain}`);

  const prompt = `You are inventing a command-line tool for a knowledge-worker AI organization.

DOMAIN: ${domain}
CONSTRAINTS: ${constraints}
EXISTING TOOLS (don't duplicate): ${existingTools.join(", ") || "none"}
AVAILABLE RUNTIME: bun, python3, shell, ripgrep, jq, pandoc, ffmpeg

Invent a small, focused tool. The tool should be a single script that:
1. Solves a specific, narrow problem in this domain
2. Can be invoked from the command line
3. Produces structured output (text, JSON, or CSV)
4. Is under 60 lines

Output:

NAME: tool-name (kebab-case)
LANGUAGE: bun | python | shell
DESCRIPTION: One-sentence description of what this tool does
CODE:
\`\`\`
#!/usr/bin/env {runtime}
... the full tool implementation ...
\`\`\``;

  try {
    const response = await invoke(prompt);
    const tool = parseToolResponse(response, toolsDir);
    if (!tool) return null;

    writeFileSync(tool.path, tool.code);
    try { require("node:child_process").execSync(`chmod +x ${tool.path}`); } catch {}

    bus.log("farm", `Tool invented: ${tool.name} (${tool.language})`);
    return tool;
  } catch (err) {
    bus.log("farm", `Tool invention failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function parseToolResponse(text: string, toolsDir: string): InventedTool | null {
  const name = text.match(/^NAME:\s*(.+)/m)?.[1]?.trim();
  const language = text.match(/^LANGUAGE:\s*(.+)/m)?.[1]?.trim();
  const description = text.match(/^DESCRIPTION:\s*(.+)/m)?.[1]?.trim();
  const codeMatch = text.match(/```(?:[\w]*\n)?([\s\S]*?)```/);
  const code = codeMatch?.[1]?.trim();

  if (!name || !code) return null;

  const lang = language?.toLowerCase() || "shell";
  const ext = lang === "python" ? ".py" : lang === "bun" ? ".ts" : ".sh";

  return {
    name,
    path: join(toolsDir, `${name}${ext}`),
    description: description || `Tool for ${name}`,
    language: lang,
    code,
  };
}

function tryList(dir: string): string[] {
  try {
    const { readdirSync } = require("node:fs");
    return readdirSync(dir);
  } catch { return []; }
}
