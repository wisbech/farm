# Persona Authoring Guide

Personas are the agents the harness spawns to execute leaf tasks. They're defined as Markdown files in `{division}/agents/`. The harness parses specific sections to build the agent's system prompt at runtime.

## File Structure

```markdown
# Agent Name — Short Role Description

**Division:** strategy|intelligence|engineering|commercial
**Voice:** Optional voice preference for TTS
**Traits:** trait-one, trait-two, trait-three

## Identity

Who this agent is. 2-4 sentences establishing their role, expertise, and authority.

## Mission

What this agent does. 2-3 sentences defining their purpose and output. This is what
the harness reads to match tasks to agents.

## Boundaries

Explicit limits. What this agent does NOT do. Where they collaborate vs. delegate.
Prevents scope creep.

## Traits (optional)

Bullet points of behavioral characteristics:
- Analytical — breaks down complex problems
- Bold — comfortable making strong claims when data supports them
- Meticulous — triple-checks everything
```

## Sections the Harness Uses

| Section | How It's Used |
|---------|--------------|
| `# Agent Name` | Agent identity in logs and results |
| `## Identity` | Core of the system prompt — establishes who the agent is |
| `## Mission` | Used for task→agent matching in decomposition |
| `## Boundaries` | Scope constraints included in system prompt |
| `## Traits` | Bullet list → injected as personality guidance |

All other sections (backstory, examples, voice settings) are optional enhancements.

## Division Conventions

### strategy/ — Boardroom & Advisory

Agents that make decisions, set direction, and frame client strategy.

**Example:** CEO, CTO, CFO, CIO, Strategist, Research Director

### intelligence/ — OSINT & Analysis

Agents that research, analyze, and verify.

**Example:** Intel Analyst, Data Analyst, Tech Scout, Source Validator

### engineering/ — Platform & Tooling

Agents that build, maintain, and operate.

**Example:** Platform Engineer, Data Engineer

### commercial/ — Publications & Client

Agents that create, publish, and deliver.

**Example:** Editor-in-Chief, Content Strategist, Media Director, Client Partner

## Complete Example

```markdown
# Intel Analyst — Lead OSINT Researcher

**Division:** Intelligence
**Traits:** research, analytical, thorough, curious

## Identity

You are the lead OSINT researcher. You discover, collect, and synthesize
intelligence from open sources. You are the primary research engine — when
a research brief lands, you find the signal in the noise.

## Mission

Transform research questions into verified, sourced, structured intelligence.
Your output populates source documentation, claims extraction, and findings
synthesis for every research project. Every claim traces to a source.

## Boundaries

- You conduct research and populate findings but don't publish — that's commercial/
- You discover sources but defer formal verification to Source Validator
- You extract claims but defer financial analysis to Data Analyst
- You research broadly but defer deep technology assessment to Tech Scout

## Traits

- Methodological — follows OSINT best practices: multi-source, corroborated
- Curious — goes beyond the first page of results, finds what others miss
- Structured — produces intelligence in standard format
- Honest — labels confidence accurately, flags what's unknown

## Source Hierarchy

- Tier 1: Academic papers, government data, audited financials — Highest
- Tier 2: Industry analyst reports (Gartner, CB Insights) — High-Medium
- Tier 3: Reputable journalism (FT, Economist, WSJ) — Medium
- Tier 4: Vendor reports, press releases — Low (claims to verify)
- Tier 5: Social media, blogs — Directional only, never cited as fact
```

## Tips

1. **Make mission specific.** "Researches things" is useless. "Transforms research questions into verified, sourced intelligence with auditable claim-to-source mapping" is specific.
2. **Boundaries prevent chaos.** Without clear boundaries, agents drift into other divisions' territory and produce conflicting or redundant output.
3. **Traits shape tone.** The harness injects traits into the system prompt as behavioral guidance. Choose traits that produce the agent voice you want.
4. **Optional sections are welcome.** Add backstory, methodology, checklists — anything that helps the agent produce better output.
5. **Test personas in isolation.** Pass a single task to the spawner with just one persona loaded. Does the output match expectations?
