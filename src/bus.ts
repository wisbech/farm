import type { BusMessage, Division } from "./types";

type BusListener = (msg: BusMessage) => void;

class MessageBus {
  private listeners = new Map<string, BusListener[]>();
  private history: BusMessage[] = [];

  subscribe(key: string, fn: BusListener) {
    const existing = this.listeners.get(key) || [];
    existing.push(fn);
    this.listeners.set(key, existing);
    return () => {
      const list = this.listeners.get(key)?.filter(l => l !== fn) || [];
      this.listeners.set(key, list);
    };
  }

  publish(msg: BusMessage) {
    this.history.push(msg);
    const keys = [msg.to, msg.division, msg.from, "*"].filter(Boolean) as string[];
    for (const key of keys) {
      for (const fn of this.listeners.get(key) || []) {
        fn(msg);
      }
    }
  }

  query(from: string, division: Division, content: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const msg: BusMessage = { from, to: "*", division, type: "query", content, timestamp: Date.now() };

      const timeout = setTimeout(() => resolve(""), 10000);
      const unsub = this.subscribe(from, (reply) => {
        if (reply.type === "response" && reply.to === from) {
          clearTimeout(timeout);
          unsub();
          resolve(reply.content);
        }
      });

      this.publish(msg);
    });
  }

  log(from: string, msg: string) {
    const m: BusMessage = { from, type: "signal", content: msg, timestamp: Date.now() };
    this.history.push(m);
    for (const fn of this.listeners.get("log") || []) fn(m);
  }

  clear() { this.history = []; }
}

export const bus = new MessageBus();
