// Table bus: features announce what just happened at the table (a probe was rolled, a spell was cast ...).
// The Sitzungsregie listens and writes the Mitschrift. No obsidian imports; listeners never break emitters.

export type TableEventType = "probe" | "cast" | "group" | "rest" | "note";

export interface TableEvent {
  type: TableEventType;
  /** ready-to-read German one-liner, e.g. "Thorwin: Klettern −1 gelungen, QS 2" */
  text: string;
  /** note the action was triggered from, if any */
  sourcePath?: string;
  /** optional structured details for consumers that want more than the text */
  data?: Record<string, unknown>;
}

export type TableListener = (e: TableEvent) => void;

export class TableBus {
  private listeners = new Set<TableListener>();

  on(fn: TableListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(e: TableEvent): void {
    for (const l of [...this.listeners]) {
      try {
        l(e);
      } catch (err) {
        console.error("DSA Meisterwerkzeug: Tisch-Ereignis fehlgeschlagen", err);
      }
    }
  }
}
