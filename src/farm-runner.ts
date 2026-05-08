import { createSerf, sendToSerf, capturePane, type SerfStatus } from "./farm-session";
import type { FarmPersona } from "./farm-state";

export interface SerfProcess {
  session: string;
  persona: FarmPersona;
  send(input: string): void;
  read(): string;
  close(): void;
}

export function startSerf(
  persona: FarmPersona,
  transport: string,
  model: string,
  backend?: string,
): SerfProcess {
  const result = createSerf(persona, transport, model, backend);
  if (!result.ok) console.warn(`Serf ${persona.name}: ${result.error}`);

  return {
    session: result.session,
    persona,
    send(input: string) {
      sendToSerf(result.session, input);
    },
    read(): string {
      return capturePane(result.session);
    },
    close() {
      // Session persists until killed by farm kill command
    },
  };
}

export function startAgent(
  transportType: string,
  model: string,
  backend?: string,
  onOutput?: (text: string) => void,
  onClose?: (code: number | null) => void,
): { send(input: string): void; close(): void } {
  return {
    send(_input: string) {},
    close() {},
  };
}
