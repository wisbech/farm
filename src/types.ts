export type Division = "strategy" | "intelligence" | "engineering" | "commercial";

export interface Persona {
  name: string;
  division: Division;
  identity: string;
  mission: string;
  boundaries: string;
  traits: string[];
  voice?: string;
  path: string;
}

export interface Org {
  root: string;
  divisions: Division[];
  personas: Persona[];
  claudeMd: string;
  agentsMd: string;
  routingTable: Map<string, { division: Division; skills: string[] }>;
  protocol: string;
}

export interface Task {
  id: string;
  description: string;
  division: Division;
  complexity: "leaf" | "composite";
  parentId?: string;
  children?: Task[];
  assignee?: string;
  status: "pending" | "running" | "done" | "failed";
  result?: AgentResult;
}

export interface AgentResult {
  taskId: string;
  agent: string;
  content: string;
  artifacts: string[];
  needsUserInput?: string;
}

export interface DecompositionResult {
  subTasks: Task[];
  reasoning: string;
}

export interface BusMessage {
  from: string;
  to?: string;
  division?: Division;
  type: "query" | "response" | "artifact" | "signal";
  content: string;
  timestamp: number;
}

export type TransportType = "pi" | "claude" | "opencode" | "copilot" | "bun" | string;

export interface Transport {
  type: TransportType;
  invoke(params: TransportParams): Promise<string>;
}

export interface TransportParams {
  systemPrompt: string;
  task: string;
  tools?: ToolDef[];
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface BootstrapBlueprint {
  name: string;
  description: string;
  divisions: { name: string; purpose: string; agents: { name: string; role: string }[] }[];
  devbox?: { packages: string[] };
}

export type ArtifactType = "persona" | "protocol" | "program" | "tool" | "code" | "config";
export type MutationType = "prompt" | "scope" | "tool" | "gate" | "trigger" | "protocol" | "transport";

export interface TransportRecord {
  transport: TransportType;
  avgMetric: number;
  lastTested: string;
}

export interface MachineTool {
  path: string;
  type: ArtifactType;
  division: Division;
  currentGeneration: number;
  bestMetric: number;
  metricName: string;
  metricDirection: "minimize" | "maximize";
  distilled: SMState[] | null;
  benchmarks: string[];
  isEvolving: boolean;
  preferredTransport: TransportType;
  transportHistory: TransportRecord[];
}

export interface FarmConfig {
  security: {
    addPaths: string[];
    availableTransports: TransportType[];
  };
}

export interface FarmStatus {
  pid: number | null;
  running: { task: string; agent: string; started: string; id: string }[];
  queued: { task: string; id: string }[];
  completed: { task: string; result: string; time: string }[];
  lastActivity: string;
  uptime: number;
}

export interface ActivityEntry {
  type: "task_start" | "task_end" | "evolve_start" | "evolve_end" | "distill" | "bench" | "tool_invent" | "steer" | "system";
  message: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface SMState {
  name: string;
  description: string;
  triggers: string[];
  actions: string[];
  exits: { to: string; trigger: string }[];
}

export interface Variant {
  id: string;
  generation: number;
  parentId: string;
  mutationType: MutationType;
  content: string;
  diff: string;
  metric: number;
  checks: { layer: string; passed: boolean; ms: number }[];
  shadowPassed: boolean;
  invariantPassed: boolean;
  timestamp: string;
}

export interface EvolutionOptions {
  budget?: number;
  generations?: number;
  metric?: string;
  direction?: "minimize" | "maximize";
  mutations?: MutationType[];
}

export interface BenchmarkQuestion {
  tier: 1 | 2 | 3;
  question: string;
  options: string[];
  answer: number;
  source: string;
}

export interface Benchmark {
  id: string;
  domain: string;
  createdFrom: string;
  questions: BenchmarkQuestion[];
  timestamp: string;
}

export interface BenchmarkResult {
  benchId: string;
  toolPath: string;
  accuracy: number;
  f1: number;
  perTier: { tier: number; accuracy: number; f1: number }[];
  timestamp: string;
}

export interface QualityGate {
  name: string;
  layer: "parse" | "invariant" | "shadow" | "benchmark";
  threshold: number;
}

export interface AssemblyLine {
  division: Division;
  program: string;
  triggers: string[];
  machineTools: string[];
  qualityGates: QualityGate[];
  metrics: { name: string; current: number; target: number }[];
  autoEvolve: boolean;
  evolutionInterval: number;
}
