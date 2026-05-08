// farm-runner.ts — now thin wrapper around tmux-based serf sessions
// Direct agent spawning is handled by farm-session.ts via tmux sessions.
// This module exists for backward compat — harness and evolve will route through here.

export { createSerf as startAgent, sendToSerf, capturePane, attachSerf } from "./farm-session";
