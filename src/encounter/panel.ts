// Shared DOM pieces: estimate panel and the enemy table.
import type { Estimate } from "./estimate";
import { ResolvedEntry, bestAt, bestTp } from "./build";

const fmt = (n: number, d = 1): string => (n === Infinity ? "∞" : Number.isFinite(n) ? n.toFixed(d).replace(".", ",") : "–");

export function renderEstimatePanel(el: HTMLElement, e: Estimate, partyLabel: string): void {
  el.empty();
  el.addClass("dsa-enc-estimate");
  const head = el.createDiv({ cls: "dsa-enc-est-head" });
  head.createSpan({ text: "Grobe Einschätzung: " });
  head.createSpan({ text: e.rating, cls: `dsa-enc-rating dsa-enc-rating-${e.rating.replace("ö", "oe").replace("ä", "ae")}` });
  if (e.ratio !== null) head.createSpan({ text: ` (Verhältnis ${fmt(e.ratio)})`, cls: "dsa-mw-muted" });
  el.createDiv({
    text: "Heuristik, keine offizielle Regel: statischer Vergleich der erwarteten Schadensraten, ohne Ausfälle während des Kampfes, Zauber, Manöver oder Gelände.",
    cls: "dsa-enc-hint",
  });
  const t = el.createEl("table", { cls: "dsa-enc-table dsa-enc-est-table" });
  const hr = t.createEl("thead").createEl("tr");
  for (const h of ["", "Kämpfer", "LeP gesamt", "Angriffe/Runde", "Schaden/Runde", "Runden bis 0 LeP"]) hr.createEl("th", { text: h });
  const body = t.createEl("tbody");
  const row = (label: string, s: Estimate["heroes"], rounds: number) => {
    const r = body.createEl("tr");
    r.createEl("td", { text: label });
    r.createEl("td", { text: String(s.count) });
    r.createEl("td", { text: String(Math.round(s.lep)) });
    r.createEl("td", { text: fmt(s.actionsPerRound, 0) });
    r.createEl("td", { text: fmt(s.damagePerRound) });
    r.createEl("td", { text: fmt(rounds) });
  };
  // damage column = damage this side deals; "rounds" = rounds the OTHER side needs to drop this side
  row("Helden", e.heroes, e.roundsToDropHeroes);
  row("Gegner", e.enemies, e.roundsToDropEnemies);
  el.createDiv({ text: `Helden: ${partyLabel}`, cls: "dsa-mw-muted dsa-enc-small" });
  if (e.guessed.length) {
    const d = el.createEl("details", { cls: "dsa-enc-guessed" });
    d.createEl("summary", { text: `${e.guessed.length} Werte fehlten und wurden geschätzt` });
    const ul = d.createEl("ul");
    for (const g of e.guessed) ul.createEl("li", { text: g });
  }
}

export interface TableHooks {
  openNote: (path: string) => void;
}

export function renderEnemyTable(el: HTMLElement, rows: readonly ResolvedEntry[], hooks: TableHooks): void {
  const t = el.createEl("table", { cls: "dsa-enc-table" });
  const hr = t.createEl("thead").createEl("tr");
  for (const h of ["Anzahl", "Kreatur", "LeP", "INI", "RS", "AT", "TP"]) hr.createEl("th", { text: h });
  const body = t.createEl("tbody");
  for (const r of rows) {
    const tr = body.createEl("tr");
    const dice = r.entry.countDice;
    tr.createEl("td", { text: dice ? (r.countIsGuess ? dice : `${r.count} (${dice})`) : `${r.count}×` });
    const nameTd = tr.createEl("td");
    if (r.catalog && !r.adhoc) {
      const a = nameTd.createEl("a", { text: r.displayName, cls: "internal-link", attr: { href: r.catalog.path, "data-href": r.catalog.path } });
      a.addEventListener("click", (ev) => {
        ev.preventDefault();
        hooks.openNote(r.catalog!.path);
      });
      if (r.entry.name && r.entry.name !== r.catalog.name) nameTd.createSpan({ text: ` (${r.catalog.name})`, cls: "dsa-mw-muted" });
    } else {
      nameTd.createSpan({ text: r.displayName });
      nameTd.createSpan({ text: r.catalog ? " (ohne Wertekasten)" : " (eigener Gegner)", cls: "dsa-mw-muted" });
    }
    const c = r.combatant;
    const cell = (v: string | number | null, missing: boolean) => {
      const td = tr.createEl("td", { text: v === null ? "?" : String(v) });
      if (missing) td.addClass("dsa-enc-missing");
    };
    const varLep = c.needsManual.includes("lep");
    const varIni = c.needsManual.includes("ini");
    cell(varLep ? "variabel" : c.lepMax, varLep || c.lepMax === null);
    cell(varIni ? "variabel" : c.iniBase, varIni || c.iniBase === null);
    cell(c.rs, c.rs === null);
    const at = bestAt(c);
    cell(at, at === null);
    const tp = bestTp(c);
    cell(tp, tp === null);
  }
}
