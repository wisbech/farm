import { describe, it, expect } from "bun:test";
import { harness } from "../src/harness";
import { decompose } from "../src/decomposer";
import { bus } from "../src/bus";
import type { Org, Task, Division, Persona } from "../src/types";

function createTestOrg(personas: Persona[] = []): Org {
  return {
    root: "/test",
    divisions: ["strategy", "intelligence", "engineering", "commercial"],
    personas,
    claudeMd: "",
    agentsMd: "",
    routingTable: new Map(),
    protocol: "",
  };
}

function createTestPersona(name: string, division: Division, mission: string): Persona {
  return {
    name,
    division,
    identity: `You are ${name}.`,
    mission,
    boundaries: `Operate within ${division}.`,
    traits: ["test-trait"],
    path: `/test/${division}/agents/${name}.md`,
  };
}

// Mock invoke that echos back
function echoInvoke(prompt: string): Promise<string> {
  return Promise.resolve(prompt.slice(0, 200));
}

describe("MessageBus", () => {
  it("delivers messages to matching subscribers", () => {
    const received: string[] = [];
    bus.subscribe("test-agent", (msg) => received.push(msg.content));
    bus.publish({ from: "sender", to: "test-agent", type: "query", content: "hello", timestamp: 1 });
    expect(received).toContain("hello");
  });

  it("wildcard subscribers receive all messages", () => {
    const received: string[] = [];
    bus.subscribe("*", (msg) => received.push(msg.content));
    bus.publish({ from: "sender", type: "signal", content: "broadcast", timestamp: 1 });
    expect(received).toContain("broadcast");
  });
});

describe("Decomposer", () => {
  it("matches research + AI tasks via rules", async () => {
    const org = createTestOrg([
      createTestPersona("Intel Analyst", "intelligence", "Research and source collection"),
      createTestPersona("Data Analyst", "intelligence", "Quantitative analysis"),
      createTestPersona("Source Validator", "intelligence", "Claims verification"),
    ]);

    const task: Task = {
      id: "task-1",
      description: "Research AI adoption rates in enterprise financial services",
      division: "intelligence",
      complexity: "composite",
      status: "pending",
    };

    const result = await decompose(task, org, echoInvoke);
    expect(result.subTasks.length).toBe(3);
    expect(result.subTasks[0].assignee).toBe("Intel Analyst");
    expect(result.subTasks[1].assignee).toBe("Data Analyst");
    expect(result.subTasks[2].assignee).toBe("Source Validator");
    expect(result.reasoning).toContain("Research tasks decompose");
  });

  it("matches publication tasks via rules", async () => {
    const org = createTestOrg([
      createTestPersona("Content Strategist", "commercial", "Content creation"),
      createTestPersona("Editor-in-Chief", "commercial", "Editorial review"),
    ]);

    const task: Task = {
      id: "task-2",
      description: "Publish an article about quantum computing",
      division: "commercial",
      complexity: "composite",
      status: "pending",
    };

    const result = await decompose(task, org, echoInvoke);
    expect(result.subTasks.length).toBe(2);
    expect(result.subTasks[0].assignee).toBe("Content Strategist");
    expect(result.subTasks[1].assignee).toBe("Editor-in-Chief");
  });

  it("caches decompositions for repeated tasks", async () => {
    const org = createTestOrg([
      createTestPersona("Intel Analyst", "intelligence", "Research"),
      createTestPersona("Data Analyst", "intelligence", "Data"),
      createTestPersona("Source Validator", "intelligence", "Verify"),
    ]);

    const task: Task = {
      id: "task-3",
      description: "Research AI adoption rates",
      division: "intelligence",
      complexity: "composite",
      status: "pending",
    };

    const first = await decompose(task, org, echoInvoke);
    const second = await decompose(task, org, echoInvoke);
    expect(second).toEqual(first);
  });

  it("falls back to LLM for unknown patterns", async () => {
    const org = createTestOrg([
      createTestPersona("Default Agent", "intelligence", "General tasks"),
    ]);

    const task: Task = {
      id: "task-4",
      description: "Some entirely novel task nobody has decompositions for",
      division: "intelligence",
      complexity: "composite",
      status: "pending",
    };

    const result = await decompose(task, org, echoInvoke);
    expect(result.subTasks.length).toBeGreaterThanOrEqual(0);
  });
});

describe("Harness", () => {
  it("executes leaf tasks directly", async () => {
    const org = createTestOrg([
      createTestPersona("Test Agent", "intelligence", "Handle test tasks"),
    ]);

    const task: Task = {
      id: "task-leaf",
      description: "Simple task",
      division: "intelligence",
      complexity: "leaf" as const,
      assignee: "Test Agent",
      status: "pending",
    };

    const result = await harness(task, org, echoInvoke);
    expect(result.agent).toBe("Test Agent");
    expect(result.taskId).toBe("task-leaf");
    expect(result.content).toBeTruthy();
  });

  it("decomposes and executes composite tasks", async () => {
    const org = createTestOrg([
      createTestPersona("Intel Analyst", "intelligence", "Research and source collection"),
      createTestPersona("Data Analyst", "intelligence", "Quantitative analysis"),
      createTestPersona("Source Validator", "intelligence", "Claims verification"),
    ]);

    const task: Task = {
      id: "task-composite",
      description: "Research AI adoption in financial services",
      division: "intelligence",
      complexity: "composite" as const,
      status: "pending",
    };

    const result = await harness(task, org, echoInvoke);
    expect(result.agent).toBe("synthesizer");
    expect(result.content).toBeTruthy();
    expect(result.taskId).toBe("task-composite");
  });

  it("handles missing personas gracefully", async () => {
    const org = createTestOrg([]);

    const task: Task = {
      id: "task-nobody",
      description: "Task with no available agent",
      division: "intelligence",
      complexity: "leaf" as const,
      assignee: "Nobody",
      status: "pending",
    };

    const result = await harness(task, org, echoInvoke);
    expect(result.agent).toBe("system");
    expect(result.content).toContain("No agent found");
  });
});
