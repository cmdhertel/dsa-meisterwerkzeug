// Sitzungsregie: pure fight tracker (no obsidian imports).
import { combatEndText, combatStartText } from "./text";

/** Pure tracker for one fight: feed it snapshots, it tells when a fight starts / ends. */
export class FightTracker {
  inFight = false;
  round = 1;
  private foes: string[] = [];
  private down = new Set<string>();

  /** @returns text to log, or null */
  update(snapshot: { name: string; creature: boolean; down: boolean }[], round: number): string | null {
    const creatures = snapshot.filter((s) => s.creature);
    if (snapshot.length === 0) {
      if (!this.inFight) return null;
      const text = combatEndText(this.round, [...this.down].filter((n) => this.foes.includes(n)));
      this.reset();
      return text;
    }
    if (!this.inFight) {
      if (!creatures.length) return null;
      this.inFight = true;
      this.foes = [];
      this.down.clear();
    }
    this.round = Math.max(this.round, round);
    for (const c of creatures) {
      if (!this.foes.includes(c.name)) this.foes.push(c.name);
      if (c.down) this.down.add(c.name);
      else this.down.delete(c.name);
    }
    return null;
  }
  /** Start text, available once per fight right after it began. */
  startText(): string {
    return combatStartText(this.foes);
  }
  private reset(): void {
    this.inFight = false;
    this.round = 1;
    this.foes = [];
    this.down.clear();
  }
}
