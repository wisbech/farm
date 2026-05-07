<p align="center">
  <img src="https://raw.githubusercontent.com/wisbech/farm/main/docs/logo.svg" alt="Sentinel Farm" width="128" />
</p>

<h1 align="center">Sentinel Farm</h1>

<p align="center">
  <strong>My-org bootstrap + recursive agent orchestration + directed evolution.<br />
  Machine tools that iterate until they become formal state machines.</strong>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> ·
  <a href="#what-is-this">What</a> ·
  <a href="#the-farm">The Farm</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#api">API</a>
</p>

---

## What Is This?

Sentinel Farm is a **Dark Software Factory** — a recursive agent orchestration engine that bootstraps, evolves, and distills AI-native company structures.

The core concept: every persona, protocol, and tool in your organization is a **Machine Tool** — evolvable through directed mutation until its behavior stabilizes into a formal **STATE → ACTION → TRIGGER** machine.

```
AGENT DESCRIPTION          ──evolve──>         STATE MACHINE
"I research AI adoption..."                    intel-analyst:
                                               states: [idle, collecting,
                                               verifying, synthesizing]
```

Inspired by Datadog's harness-first engineering, Karpathy's autoresearch, and BCG's Dark Software Factory.

---

## Quick Start

```bash
# Install globally
npm install -g farm

# Configure your transport
farm launch claude --model claude-sonnet-4-20250514
farm launch pi --model anthropic/claude-sonnet-4-20250514
farm launch ollama --model llama3.1
farm launch                      # interactive picker

# Bootstrap a new company
farm --bootstrap "OSINT-powered advisory consultancy for enterprise tech strategy"

# Run tasks through the harness
farm "Research enterprise AI adoption in financial services"

# Or enter interactive mode
cd /path/to/my-org-workspace
farm
```

**Requirements:** [Bun](https://bun.sh) >= 1.0.0, plus at least one of: `claude`, `pi`, `opencode`, `codex`, `openai`, `copilot`, `hermes`, `ollama` — or an API key as fallback.

---

## The Farm

### Evolve

Directed evolution engine. Mutate personality prompts, protocols, and tools against verification pyramids. Keep what works.

```bash
farm evolve intelligence/agents/intel-analyst.md --generations 20
farm evolve intelligence/agents/intel-analyst.md --budget 30m
farm evolve intelligence/INTELLIGENCE.md --metric "source_diversity"
farm evolve commercial/brand/STYLE_GUIDE.md
```

How it works:
1. **SELECT** — power-law sample parent from archive (favor high scores, 20% diversity injection)
2. **MUTATE** — LLM proposes variant (prompt rewrite, scope change, tool invention, gate modification, trigger adjustment, protocol refinement)
3. **VERIFY** — cheapest pass first: parse → invariant → shadow → benchmark
4. **KEEP** or discard based on metric comparison
5. **ARCHIVE** — store in SQLite (every generation, metric, diff)

### Distill

When an agent has been evolved enough that its behavior is predictable, distill it into a formal state machine.

```bash
farm distill intelligence/agents/intel-analyst.md
farm machines
```

Outputs:
```json
{
  "states": [
    { "name": "idle", "triggers": ["brief_received"], "actions": ["validate"],
      "exits": [{ "to": "collecting", "trigger": "validated" }] },
    { "name": "collecting", "triggers": ["validated"], "actions": ["parallel_search"],
      "exits": [{ "to": "verifying", "trigger": "threshold_met" }] },
    { "name": "verifying", "triggers": ["threshold_met"], "actions": ["cross_reference"],
      "exits": [{ "to": "synthesizing", "trigger": "all_mapped" }] },
    { "name": "synthesizing", "triggers": ["all_mapped"], "actions": ["produce_findings"],
      "exits": [{ "to": "idle", "trigger": "delivered" }] }
  ]
}
```

Distilled machines can execute deterministically — no LLM needed for repeat patterns.

### Bench

ARFBench-style benchmark generation from your actual research artifacts.

```bash
farm bench generate intelligence/research/enterprise-ai-adoption
farm bench run bench-enterprise-ai-adoption-... intelligence/agents/intel-analyst.md
farm bench list
```

Generates 5-8 tiered multiple-choice questions:
- **Tier 1** — Factual recall from findings
- **Tier 2** — Comparison and correlation
- **Tier 3** — Implication and composition

### Tools

Invent command-line tools as mutations. Each generation can use tools invented in previous generations.

```bash
farm tools "SEC filing analysis"
farm tools "competitor pricing data"
```

### Assembly

Per-division assembly lines with automatic evolution.

```bash
farm assembly intelligence --auto-evolve --interval 60
farm assembly commercial
```

---

## Architecture

```
farm/
├── src/
│   ├── index.ts              # CLI: farm launch | evolve | distill | bench | tools | machines
│   ├── harness.ts            # Recursive task orchestrator
│   ├── farm-evolve.ts        # Directed evolution engine (BitsEvolve-inspired)
│   ├── farm-distiller.ts     # Evolution archive → formal state machine
│   ├── farm-bench.ts         # ARFBench-style benchmark generation
│   ├── farm-toolsmith.ts     # Tool invention as mutation strategy
│   ├── farm-assembly.ts      # Per-division assembly lines
│   ├── farm-db.ts            # SQLite: generations, machines, benchmarks
│   ├── decomposer.ts         # Hybrid: rule cache → LLM → fallback
│   ├── spawner.ts            # Persona → agent invocation
│   ├── bus.ts                # Inter-agent pub/sub
│   ├── synthesizer.ts        # Sub-task → unified output
│   ├── scanner.ts            # my-org filesystem detection
│   ├── bootstrap.ts          # LLM → blueprint → scaffold generation
│   ├── config.ts             # Transport configuration
│   ├── transport.ts          # Tool-agnostic LLM interface (9 transports)
│   └── types.ts              # SOLID type contracts
├── tests/
│   └── harness.test.ts       # 9 passing tests
├── docs/
│   ├── architecture.md
│   ├── personas.md
│   └── logo.svg
├── package.json
├── README.md
└── LICENSE
```

**Zero runtime dependencies.** ~1,700 lines of TypeScript across 15 source files.

---

## Philosophy

- **Recursion over configuration.** Decomposition depth is runtime behavior, not a config file.
- **Evolution over static.** Personas, protocols, and tools improve through generations.
- **Distillation into certainty.** Converged machine tools become formal state machines.
- **Tool-agnostic.** Claude Code, Pi, OpenCode, Codex, OpenAI CLI, Copilot, Hermes, Ollama, or raw API.
- **Singleton bootstrap.** One tool creates the org and runs it.
- **Zero lock-in. Zero deps.** Bun is the only runtime requirement.

## Related

- [my-org](https://github.com/wisbech/my-org) — The AI-native company structure
- [Datadog Harness-First](https://www.datadoghq.com/blog/ai/harness-first-agents/) — Harness-first methodology
- [BCG Dark Software Factory](https://www.bcgplatinion.com/insights/the-dark-software-factory) — The strategic vision
- [autoresearch](https://github.com/karpathy/autoresearch) — The evolution architecture

---

## License

MIT
