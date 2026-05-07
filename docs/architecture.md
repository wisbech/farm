# Architecture

## System Overview

Sentinel Harness is a recursive task decomposition engine that operates on the [my-org](https://github.com/wisbech/my-org) pattern. It has two primary modes: **bootstrap** (create a new my-org company from a description) and **execute** (run tasks through the recursive harness).

```
┌─────────────────────────────────────────────────────────────────┐
│                      SENTINEL HARNESS                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐  │
│  │ scanner  │    │bootstrap │    │ harness  │    │transport │  │
│  │          │    │          │    │          │    │          │  │
│  │ Detect   │───▶│ Create   │    │ Recursive│◀──▶│ pi       │  │
│  │ my-org   │    │ my-org   │    │ engine   │    │ claude   │  │
│  │ pattern  │    │ scaffold │    │          │    │ opencode │  │
│  └──────────┘    └──────────┘    └────┬─────┘    │ copilot  │  │
│                                       │          │ bun      │  │
│                          ┌────────────┼──────┐   └──────────┘  │
│                          │            │      │                  │
│                     ┌────▼───┐  ┌────▼───┐ ┌─▼──────────┐      │
│                     │decompose│  │spawner │ │synthesizer │      │
│                     │         │  │        │ │            │      │
│                     │Task→Sub │  │Persona │ │Results→    │      │
│                     │ -tasks  │  │→Agent  │ │Unified     │      │
│                     └─────────┘  └────────┘ └────────────┘      │
│                                                                  │
│                          ┌──────┐                                │
│                          │ bus  │   Agent↔Agent communication   │
│                          └──────┘                                │
└─────────────────────────────────────────────────────────────────┘
```

## Recursive Engine Detail

The harness function (`src/harness.ts`) is the core of the system. At 75 lines, it implements a complete recursive work decomposition engine:

```typescript
async function harness(task, org, invoke) {
  // BASE CASE: Execute directly
  if (task.complexity === "leaf") {
    return spawnAgent(task, org, invoke);
  }

  // RECURSIVE CASE: Decompose and recurse
  const { subTasks } = await decompose(task, org, invoke);

  const results = independent(decomposed)
    ? await Promise.all(subTasks.map(st => harness(st, org, invoke)))
    : await sequential(subTasks.map(st => harness(st, org, invoke)));

  return synthesize(task, results, org, invoke);
}
```

### Recursion Behavior

1. A task enters with `complexity: "composite"`
2. The harness calls `decompose()` to break it into sub-tasks (all `complexity: "leaf"`)
3. Each leaf task is dispatched to a persona-driven agent via `spawnAgent()`
4. If decomposition produces more composite tasks, the harness recurses further
5. Results are merged via `synthesize()` before returning to the parent

### Parallel vs Sequential

- **Parallel** (`Promise.all`): Sub-tasks assigned to different divisions — no shared state or ordering dependencies
- **Sequential** (for loop): Sub-tasks in the same division — potential ordering dependencies, safer to run one at a time

## Decomposition Strategies

### Rule Cache (Fast Path)

Pre-defined patterns matching common workflows:

| Trigger | Decomposition |
|---------|--------------|
| "research" + "adoption"/"ai"/"technology" | Intel Analyst → Data Analyst → Source Validator |
| "publish" / "article" / "report" | Content Strategist → Editor-in-Chief |
| "strategy" / "client" / "engagement" | Strategist → CEO |

Cache hit → instant decomposition, no LLM call.

### LLM Decomposition (Slow Path)

For novel tasks, sends the task + available persona list to an LLM:

```
TASK: Research competitive landscape for X
DIVISION: strategy

AVAILABLE AGENTS:
  - CEO (strategy): Vision, direction, final calls
  - Strategist (strategy): GTM frameworks, client strategy
  ...

→ LLM returns JSON: { reasoning, subTasks[] }
```

### Fallback

If LLM decomposition fails or returns malformed JSON, routes the entire task to the division's default agent.

## Transport Layer

The transport layer (`src/transport.ts`) abstracts away the LLM interface:

```typescript
interface Transport {
  type: TransportType;
  invoke(params: TransportParams): Promise<string>;
}

interface TransportParams {
  systemPrompt: string;
  task: string;
}
```

### Detection

At startup, the transport layer probes for available CLIs using `spawn()` with `--version`. First successful probe wins. Priority order: `pi` → `claude` → `opencode` → `copilot` → `bun` (API fallback).

### Adding a Transport

Transport implementations are ~10-15 lines each. To add a new one:

```typescript
function myTransport(apiKey?: string): Transport {
  return {
    type: "my-tool",
    invoke: (params) => exec("my-tool", ["--print"], env, params.task, params.systemPrompt),
  };
}
```

## Scanner

The scanner (`src/scanner.ts`) detects the my-org pattern on the filesystem:

1. Check for `CLAUDE.md` + `AGENTS.md` at root
2. For each known division (`strategy`, `intelligence`, `engineering`, `commercial`), check for `{DIVISION}.md` context file
3. Load persona `.md` files from `{division}/agents/`
4. Parse the routing table from `CLAUDE.md` markdown table
5. Load protocol from `INTELLIGENCE.md` or `AGENTS.md`

### Persona Parsing

```typescript
function parsePersona(content, division, path): Persona {
  const name = content.match(/^#\s+(.+?)(?:\s+—|$)/m)[1];
  const identity = extractSection(content, "Identity");
  const mission = extractSection(content, "Mission");
  const boundaries = extractSection(content, "Boundaries");
  const traits = extractBulletList(content, "Traits");

  return { name, division, identity, mission, boundaries, traits, path };
}
```

## Message Bus

The bus (`src/bus.ts`) provides typed inter-agent communication:

- **`publish(msg)`** — Broadcast to subscribers matching `to`, `division`, `from`, or `*`
- **`subscribe(key, fn)`** — Register listener, returns unsubscribe function
- **`query(from, division, content)`** — Send query, await response with 10s timeout
- **`log(from, msg)`** — Emit a signal to `"log"` subscribers (UI updates)

## Bootstrap

The bootstrap module (`src/bootstrap.ts`) handles the singleton creation flow:

1. Send user's description + my-org template prompt to LLM
2. Parse the text response into a `BootstrapBlueprint`
3. Create directory structure matching my-org pattern
4. Generate all files: `devbox.json`, `CLAUDE.md`, `AGENTS.md`, division context files, agent personas, wiki index pages
5. All agent personas include `## Identity`, `## Mission`, `## Boundaries` sections the harness uses at runtime

## SOLID Design

Each module has a single responsibility with no circular dependencies:

```
types.ts ──────────────────────────────────────────────────────────┐
    │                                                                │
    ├── scanner.ts  (reads filesystem → Org)                       │
    ├── bootstrap.ts (Org blueprint → filesystem)                  │
    ├── transport.ts (detects CLI → unified invoke interface)       │
    ├── decomposer.ts (Task → SubTask[], imports nothing internal) │
    ├── spawner.ts (Task + Org → AgentResult, imports types only)  │
    ├── bus.ts (singleton MessageBus, imports types only)          │
    ├── synthesizer.ts (Results → Result, imports types only)      │
    └── harness.ts (orchestrator, composes all above)              │
         │                                                          │
         └── index.ts (CLI, uses harness + scanner + bootstrap)    │
```

No circular imports. Every module can be tested in isolation.
