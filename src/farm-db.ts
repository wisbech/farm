import { Database } from "bun:sqlite";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import type { Variant, Benchmark, BenchmarkResult, SMState } from "./types";

const DB_DIR = ".sentinel";
const DB_FILE = "farm.db";

let db: Database | null = null;

export function getDB(workspaceDir: string): Database {
  if (db) return db;
  const path = join(workspaceDir, DB_DIR, DB_FILE);
  db = new Database(path);
  db.run("PRAGMA journal_mode=WAL");
  db.run("PRAGMA foreign_keys=ON");
  migrate(db);
  return db;
}

async function migrate(d: Database) {
  d.run(`
    CREATE TABLE IF NOT EXISTS generations (
      id TEXT PRIMARY KEY,
      tool_path TEXT NOT NULL,
      generation INTEGER NOT NULL,
      parent_id TEXT,
      mutation_type TEXT NOT NULL,
      content TEXT NOT NULL,
      diff TEXT DEFAULT '',
      metric REAL DEFAULT 0,
      checks TEXT DEFAULT '[]',
      shadow_passed INTEGER DEFAULT 0,
      invariant_passed INTEGER DEFAULT 0,
      timestamp TEXT DEFAULT (datetime('now'))
    )
  `);

  d.run(`
    CREATE TABLE IF NOT EXISTS machines (
      id TEXT PRIMARY KEY,
      tool_path TEXT NOT NULL,
      states TEXT NOT NULL,
      distilled_from TEXT NOT NULL,
      metric REAL DEFAULT 0,
      timestamp TEXT DEFAULT (datetime('now'))
    )
  `);

  d.run(`
    CREATE TABLE IF NOT EXISTS benchmarks (
      id TEXT PRIMARY KEY,
      domain TEXT NOT NULL,
      questions TEXT NOT NULL,
      created_from TEXT DEFAULT '',
      timestamp TEXT DEFAULT (datetime('now'))
    )
  `);

  d.run(`
    CREATE TABLE IF NOT EXISTS bench_runs (
      id TEXT PRIMARY KEY,
      bench_id TEXT NOT NULL,
      tool_path TEXT NOT NULL,
      accuracy REAL DEFAULT 0,
      f1 REAL DEFAULT 0,
      per_tier TEXT DEFAULT '[]',
      timestamp TEXT DEFAULT (datetime('now'))
    )
  `);
}

export function insertGeneration(d: Database, v: Variant, toolPath: string) {
  d.run(
    `INSERT OR REPLACE INTO generations
     (id, tool_path, generation, parent_id, mutation_type, content, diff, metric, checks, shadow_passed, invariant_passed, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [v.id, toolPath, v.generation, v.parentId, v.mutationType,
     v.content, v.diff, v.metric, JSON.stringify(v.checks),
     v.shadowPassed ? 1 : 0, v.invariantPassed ? 1 : 0, v.timestamp]
  );
}

export function getGenerations(d: Database, toolPath: string): Variant[] {
  const rows = d.query(
    `SELECT * FROM generations WHERE tool_path = ? ORDER BY generation`,
    [toolPath]
  ).all() as any[];

  return rows.map(r => ({
    id: r.id,
    generation: r.generation,
    parentId: r.parent_id,
    mutationType: r.mutation_type,
    content: r.content,
    diff: r.diff,
    metric: r.metric,
    checks: JSON.parse(r.checks),
    shadowPassed: Boolean(r.shadow_passed),
    invariantPassed: Boolean(r.invariant_passed),
    timestamp: r.timestamp,
  }));
}

export function getLatestGeneration(d: Database, toolPath: string): Variant | null {
  const row = d.query(
    `SELECT * FROM generations WHERE tool_path = ? ORDER BY generation DESC LIMIT 1`,
    [toolPath]
  ).get() as any;

  if (!row) return null;
  return {
    id: row.id,
    generation: row.generation,
    parentId: row.parent_id,
    mutationType: row.mutation_type,
    content: row.content,
    diff: row.diff,
    metric: row.metric,
    checks: JSON.parse(row.checks),
    shadowPassed: Boolean(row.shadow_passed),
    invariantPassed: Boolean(row.invariant_passed),
    timestamp: row.timestamp,
  };
}

export function insertMachine(d: Database, toolPath: string, states: SMState[], distilledFrom: string, metric: number) {
  const id = `machine-${toolPath.replace(/\//g, "-")}-${Date.now()}`;
  d.run(
    `INSERT OR REPLACE INTO machines (id, tool_path, states, distilled_from, metric, timestamp)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    [id, toolPath, JSON.stringify(states), distilledFrom, metric]
  );
  return id;
}

export function getMachine(d: Database, toolPath: string): { states: SMState[]; metric: number } | null {
  const row = d.query(
    `SELECT states, metric FROM machines WHERE tool_path = ? ORDER BY timestamp DESC LIMIT 1`,
    [toolPath]
  ).get() as any;

  if (!row) return null;
  return { states: JSON.parse(row.states), metric: row.metric };
}

export function insertBenchmark(d: Database, bench: Benchmark) {
  d.run(
    `INSERT OR REPLACE INTO benchmarks (id, domain, questions, created_from, timestamp)
     VALUES (?, ?, ?, ?, ?)`,
    [bench.id, bench.domain, JSON.stringify(bench.questions), bench.createdFrom, bench.timestamp]
  );
}

export function getBenchmarks(d: Database): Benchmark[] {
  const rows = d.query(`SELECT * FROM benchmarks ORDER BY timestamp DESC`).all() as any[];
  return rows.map(r => ({
    id: r.id,
    domain: r.domain,
    createdFrom: r.created_from,
    questions: JSON.parse(r.questions),
    timestamp: r.timestamp,
  }));
}

export function getBenchmark(d: Database, id: string): Benchmark | null {
  const row = d.query(`SELECT * FROM benchmarks WHERE id = ?`, [id]).get() as any;
  if (!row) return null;
  return {
    id: row.id,
    domain: row.domain,
    createdFrom: row.created_from,
    questions: JSON.parse(row.questions),
    timestamp: row.timestamp,
  };
}

export function insertBenchRun(d: Database, result: BenchmarkResult) {
  d.run(
    `INSERT INTO bench_runs (id, bench_id, tool_path, accuracy, f1, per_tier, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [result.benchId + "-" + result.toolPath + "-" + Date.now(),
     result.benchId, result.toolPath, result.accuracy, result.f1,
     JSON.stringify(result.perTier), result.timestamp]
  );
}

export function getBenchRuns(d: Database, toolPath: string): BenchmarkResult[] {
  const rows = d.query(
    `SELECT * FROM bench_runs WHERE tool_path = ? ORDER BY timestamp DESC`,
    [toolPath]
  ).all() as any[];

  return rows.map(r => ({
    benchId: r.bench_id,
    toolPath: r.tool_path,
    accuracy: r.accuracy,
    f1: r.f1,
    perTier: JSON.parse(r.per_tier),
    timestamp: r.timestamp,
  }));
}
