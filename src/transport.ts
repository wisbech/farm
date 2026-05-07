import { spawn } from "node:child_process";
import type { Transport, TransportParams, TransportType } from "./types";
import { loadConfig } from "./config";

export function createTransport(type: TransportType, apiKey?: string, baseUrl?: string, model?: string): Transport {
  switch (type) {
    case "pi": return piTransport(apiKey, model);
    case "claude": return claudeTransport(apiKey, model);
    case "opencode": return opencodeTransport(apiKey, model);
    case "codex": return codexTransport(model);
    case "openai": return openaiCLITransport(apiKey, model);
    case "copilot": return copilotTransport();
    case "hermes": return hermesTransport(model);
    case "ollama": return ollamaTransport(baseUrl, model);
    default: return bunTransport(apiKey, model);
  }
}

function piTransport(apiKey?: string, modelOverride?: string): Transport {
  const model = modelOverride || "anthropic/claude-sonnet-4-20250514";
  return {
    type: "pi",
    invoke: (params) => exec("pi", [
      "--print", "--no-skills", "--no-extensions", "--no-context-files",
      "--model", model,
    ], envWithKey(apiKey), params.task, params.systemPrompt),
  };
}

function claudeTransport(apiKey?: string, modelOverride?: string): Transport {
  const model = modelOverride || "claude-sonnet-4-20250514";
  return {
    type: "claude",
    invoke: (params) => exec("claude", [
      "--print", "--model", model,
    ], envWithKey(apiKey), `${params.systemPrompt}\n\n${params.task}`),
  };
}

function opencodeTransport(apiKey?: string, modelOverride?: string): Transport {
  const model = modelOverride || "claude-sonnet-4-20250514";
  return {
    type: "opencode",
    invoke: (params) => exec("opencode", [
      "--model", model,
    ], envWithKey(apiKey), `${params.systemPrompt}\n\n---\n\n${params.task}`),
  };
}

function codexTransport(modelOverride?: string): Transport {
  const model = modelOverride || "gpt-5";
  return {
    type: "codex",
    invoke: (params) => exec("codex", [
      "exec", "--model", model,
    ], {}, `${params.systemPrompt}\n\n${params.task}`),
  };
}

function openaiCLITransport(apiKey?: string, modelOverride?: string): Transport {
  const model = modelOverride || "gpt-5";
  return {
    type: "openai",
    invoke: (params) => exec("openai", [
      "--model", model,
    ], envWithKey(apiKey), `${params.systemPrompt}\n\n${params.task}`),
  };
}

function copilotTransport(): Transport {
  return {
    type: "copilot",
    invoke: (params) => exec("github-copilot-cli", [], {},
      `${params.systemPrompt}\n\n${params.task}\n\nRespond without preamble or explanation.`),
  };
}

function hermesTransport(modelOverride?: string): Transport {
  const model = modelOverride || "llama3.1";
  return {
    type: "hermes",
    invoke: (params) => exec("hermes", [], {},
      `${params.systemPrompt}\n\n${params.task}`),
  };
}

function ollamaTransport(baseUrl?: string, modelOverride?: string): Transport {
  const base = baseUrl || "http://localhost:11434";
  const model = modelOverride || "llama3.1";

  return {
    type: "ollama",
    invoke: async (params) => {
      const response = await fetch(`${base}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          system: params.systemPrompt,
          prompt: params.task,
          stream: false,
        }),
        signal: AbortSignal.timeout(120_000),
      });

      const json = await response.json() as { response?: string; error?: string };
      if (json.error) throw new Error(`Ollama: ${json.error}`);
      return json.response || "";
    },
  };
}

function bunTransport(apiKey?: string, modelOverride?: string): Transport {
  const key = apiKey || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || "";
  const model = modelOverride || "claude-sonnet-4-20250514";

  return {
    type: "bun",
    invoke: async (params) => {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          system: params.systemPrompt,
          messages: [{ role: "user", content: params.task }],
        }),
        signal: AbortSignal.timeout(120_000),
      });

      const json = await response.json() as { error?: { message: string }; content?: { text: string }[] };
      if (json.error) throw new Error(`Anthropic API: ${json.error.message}`);
      return json.content?.[0]?.text || JSON.stringify(json);
    },
  };
}

function exec(cmd: string, args: string[], env: Record<string, string>, input: string, systemPrompt?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let fullInput = input;
    if (systemPrompt) {
      fullInput = `${systemPrompt}\n\n---\n\n${input}\n\nRespond directly. No preamble. No "Based on". Just the output.`;
    }

    const child = spawn(cmd, args, {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

    child.on("close", (code) => {
      if (code === 0 || stdout.trim().length > 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`${cmd} exited ${code}: ${stderr}`));
      }
    });

    child.on("error", (err) => reject(new Error(`${cmd} not found: ${err.message}`)));

    child.stdin.write(fullInput);
    child.stdin.end();
  });
}

function envWithKey(apiKey?: string): Record<string, string> {
  const env: Record<string, string> = {};
  if (apiKey) {
    if (apiKey.startsWith("sk-ant")) env.ANTHROPIC_API_KEY = apiKey;
    else if (apiKey.startsWith("sk-")) env.OPENAI_API_KEY = apiKey;
  }
  return env;
}
