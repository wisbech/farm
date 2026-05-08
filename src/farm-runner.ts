import { spawn, ChildProcess } from "node:child_process";

export interface TransportProcess {
  send(input: string): void;
  close(): void;
}

export function spawnTransport(
  cmd: string,
  args: string[],
  onOutput: (text: string) => void,
  onClose: (code: number | null) => void
): TransportProcess {
  const child = spawn(cmd, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });

  let buffer = "";

  child.stdout.on("data", (d: Buffer) => {
    const text = d.toString();
    buffer += text;

    // flush on newlines, max 200ms batching
    if (text.includes("\n") || buffer.length > 2000) {
      onOutput(buffer);
      buffer = "";
    }
  });

  child.stderr.on("data", (d: Buffer) => {
    onOutput(`[stderr] ${d.toString()}`);
  });

  child.on("close", (code) => {
    if (buffer.length > 0) onOutput(buffer);
    onClose(code);
  });

  return {
    send(input: string) {
      if (child.stdin.writable) {
        child.stdin.write(input + "\n");
      }
    },
    close() {
      try { child.kill("SIGTERM"); } catch {}
    },
  };
}

export function startAgent(
  transportType: string,
  model: string,
  backend?: string,
  onOutput?: (text: string) => void,
  onClose?: (code: number | null) => void
): TransportProcess {
  const noop = () => {};
  const out = onOutput || noop;
  const close = onClose || noop;

  switch (transportType) {
    case "claude":
      return spawnTransport("claude", [
        "--model", model,
      ], out, close);

    case "pi":
      return spawnTransport("pi", [
        "--model", model,
        "--no-skills", "--no-extensions", "--no-context-files",
      ], out, close);

    case "opencode":
      return spawnTransport("opencode", [
        "--model", model,
      ], out, close);

    case "codex":
      return spawnTransport("codex", [
        "exec", "--model", model,
      ], out, close);

    case "copilot":
      return spawnTransport("github-copilot-cli", [], out, close);

    case "openai":
      return spawnTransport("openai", ["--model", model], out, close);

    default:
      // Try as generic process
      return spawnTransport(transportType, [], out, close);
  }
}
