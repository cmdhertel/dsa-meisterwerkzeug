// Pure helpers for the Kampf-Cockpit (no obsidian imports): encounter parsing, drag payloads, attack setup.
import { DEFENSE_STEP, RANGED_DEFENSE_MOD } from "../engine/constants";
import type { AttackKind, AttackParams, AttackResult, CheckResult, RangedDefenseKind } from "../engine/combat";
import { computeValue } from "../engine/combat";
import { tryParseDice } from "../engine/dice";
import { Reach } from "../engine/effectConstants";
import { defenseBlockFor, effectsOf, incapacitatingStatus, reachFromText, statusModifiers, statusNotes, timedStateLevels } from "../engine/effects";
import {
  STATE_LABELS,
  StateId,
  effectiveLevels,
  incapacitatedBy,
  statePenaltyBreakdown,
  totalStatePenalty,
} from "../engine/states";
import { BodyType, LastHit, WoundResult, ZONE_LABEL, ZONE_SHORT, ZoneKey, ZoneParams, targetedModifier, woundThreshold, zoneRollRanges, zoneRsFor } from "../engine/hitzones";
import type { Modifier } from "../engine/types";
import type { Combatant, Weapon } from "../model";
import type { CombatEntry } from "../combat/store";

// ---------------------------------------------------------------- encounter blocks

export interface EncounterCreature {
  name: string;
  amount: number;
  hp?: number;
}

const FENCE = /^```+\s*(encounter(?:-table)?)\s*$/;

/**
 * Parses initiative-tracker `encounter` (and `encounter-table`) code blocks. Supported creature syntax:
 *   - 3: Goblin
 *   - Die Krähe
 *       amount: 1
 *       hp: 28
 * Never throws; unknown lines are ignored.
 */
export function parseEncounterBlocks(text: string): EncounterCreature[] {
  const lines = text.split(/\r?\n/);
  const out: EncounterCreature[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!FENCE.test(lines[i].trim())) continue;
    const body: string[] = [];
    for (i++; i < lines.length && !/^```+\s*$/.test(lines[i].trim()); i++) body.push(lines[i]);
    out.push(...parseEncounterBody(body));
  }
  return out;
}

function parseEncounterBody(body: string[]): EncounterCreature[] {
  const out: EncounterCreature[] = [];
  let inCreatures = false;
  let cur: EncounterCreature | null = null;
  const flush = () => {
    if (cur && cur.name) out.push(cur);
    cur = null;
  };
  for (const raw of body) {
    if (!raw.trim()) continue;
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim();
    if (indent === 0 && !line.startsWith("-")) {
      flush();
      inCreatures = /^creatures\s*:/i.test(line);
      continue;
    }
    if (!inCreatures) continue;
    if (line.startsWith("-")) {
      flush();
      const item = line.replace(/^-\s*/, "").replace(/^["']|["']$/g, "");
      const m = item.match(/^(\d+)\s*:\s*(.+)$/);
      if (m) {
        cur = { name: m[2].trim().replace(/^["']|["']$/g, ""), amount: Math.max(1, parseInt(m[1], 10)) };
      } else if (item) {
        cur = { name: item.replace(/:\s*$/, "").trim(), amount: 1 };
      }
      continue;
    }
    const kv = line.match(/^([A-Za-z_]+)\s*:\s*(.*)$/);
    if (kv && cur) {
      const key = kv[1].toLowerCase();
      const n = parseInt(kv[2], 10);
      if (key === "amount" && Number.isFinite(n)) cur.amount = Math.max(1, n);
      else if ((key === "hp" || key === "lep") && Number.isFinite(n)) cur.hp = n;
    }
  }
  flush();
  return out;
}

/** Exact (case-insensitive) match first, then prefix, then substring. */
export function matchCreatureName<T extends { name: string }>(query: string, candidates: readonly T[]): T | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const lc = (c: T) => c.name.toLowerCase();
  return (
    candidates.find((c) => lc(c) === q) ??
    candidates.find((c) => lc(c).startsWith(q)) ??
    candidates.find((c) => lc(c).includes(q)) ??
    null
  );
}

// ---------------------------------------------------------------- drag payloads

/**
 * Extracts a vault path / link text from what Obsidian's file explorer puts into a drag event:
 * `obsidian://open?vault=X&file=Folder%2FNote` (text/plain or text/uri-list), `[[Note]]`, or a plain path.
 * Returns null when nothing usable is found. Result may lack the ".md" extension.
 */
export function parseDragPayload(payload: string | null | undefined): string | null {
  if (!payload) return null;
  for (const lineRaw of payload.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line || line.startsWith("#")) continue;
    if (/^obsidian:\/\//i.test(line)) {
      const q = line.indexOf("?");
      if (q < 0) continue;
      const params = new URLSearchParams(line.slice(q + 1));
      const file = params.get("file");
      if (file) return file;
      continue;
    }
    const wiki = line.match(/^!?\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]$/);
    if (wiki) return wiki[1].trim();
    if (/^[a-z]+:\/\//i.test(line)) continue;
    return line;
  }
  return null;
}

// ---------------------------------------------------------------- attack setup

export interface DefenseOption {
  id: string;
  label: string;
  kind: "PA" | "VW" | null;
  /** null = must be typed in */
  value: number | null;
}

/** Defense choices for a target. Default (index into the returned list): PA vs. melee if available, else Ausweichen. */
export function defenseOptions(defender: CombatEntry, kind: AttackKind): { options: DefenseOption[]; defaultId: string } {
  const options: DefenseOption[] = [];
  defender.weapons.forEach((w, i) => {
    if (w.kind === "melee" && w.pa !== null) options.push({ id: `pa${i}`, label: `PA (${w.name})`, kind: "PA", value: w.pa });
  });
  if (defender.vw !== null) options.push({ id: "vw", label: "Ausweichen / VW", kind: "VW", value: defender.vw });
  options.push({ id: "pa-manual", label: "PA (manuell)", kind: "PA", value: null });
  options.push({ id: "vw-manual", label: "Ausweichen (manuell)", kind: "VW", value: null });
  options.push({ id: "none", label: "Keine Verteidigung", kind: null, value: null });
  const firstPa = options.find((o) => o.kind === "PA" && o.value !== null);
  const vw = options.find((o) => o.id === "vw");
  let def: DefenseOption | undefined;
  if (kind === "nahkampf") def = firstPa ?? vw;
  else def = vw ?? firstPa;
  return { options, defaultId: def?.id ?? "none" };
}

export function entryLevels(e: CombatEntry) {
  return effectiveLevels(e.states, e.lep, e.lepMax, timedStateLevels(effectsOf(e)));
}
export const entryStatePenalty = (e: CombatEntry): number => totalStatePenalty(entryLevels(e));

/** Itemised state penalties of an entry as negative modifiers ("Schmerz II" -2). */
export function statePenaltyLines(e: CombatEntry): Modifier[] {
  const lv = entryLevels(e);
  const parts = statePenaltyBreakdown(lv);
  return (Object.keys(parts) as StateId[]).map((id) => ({
    label: `${STATE_LABELS[id]} ${ROMAN[lv[id]] ?? lv[id]}`,
    value: -(parts[id] ?? 0),
  }));
}

export const ROMAN = ["", "I", "II", "III", "IV"];

/** Why this combatant cannot defend with the given defense kind (Status or incapacitating Zustand), or null. */
export function defenseBlock(e: CombatEntry, kind: "PA" | "VW"): string | null {
  return defenseBlockFor(effectsOf(e), entryLevels(e), kind);
}
/** True when a Status (Bewusstlos, Handlungsunfähig) or a Zustand IV makes the combatant incapacitated. */
export const isDownByEffects = (e: CombatEntry): boolean => incapacitatedBy(entryLevels(e)).length > 0 || incapacitatingStatus(effectsOf(e)).length > 0;

/** Reach class of the weapon behind a defense option id ("pa0" = weapon 0); null if unknown. */
export function reachOfDefenseOption(d: CombatEntry, optionId: string): Reach | null {
  const m = /^pa(\d+)$/.exec(optionId);
  return m ? reachFromText(d.weapons[Number(m[1])]?.rw) : null;
}

export interface AttackInput {
  kind: AttackKind;
  attacker: CombatEntry;
  defender: CombatEntry;
  /** AT or FK */
  value: number;
  /** damage dice such as "1W6+4" */
  tp: string;
  atMod: number;
  tpMod: number;
  /** ranged only: free modifier for distance/size/visibility */
  rangedMod: number;
  defense: { kind: "PA" | "VW"; value: number } | null;
  defenseMod: number;
  rangedType?: RangedDefenseKind;
  patzerMode?: "tabelle" | "sp";
  /** reach of the attacker's weapon (for Eingeengt); ranged attacks use "kurz" (no penalty) */
  attackerReach?: Reach | null;
  /** reach of the defender's parry weapon (for Eingeengt) */
  defenderReach?: Reach | null;
  /** GM override: let the target defend although a Status/Zustand forbids it */
  ignoreDefenseBlock?: boolean;
  /** Trefferzonen: present = rule is on; `targeted` = zone the attacker aims at (null = roll the zone), `sf` = Gezielter Angriff/Schuss */
  hitZones?: { targeted: ZoneKey | null; sf: boolean; /** zone fixed by hand: no roll, no penalty */ fixed?: ZoneKey | null };
}

const nz = (label: string, value: number): Modifier[] => (value ? [{ label, value }] : []);

/** Defender weapon dice for a defense Patzer with self damage (first weapon with readable TP, else unarmed). */
const defenderTp = (d: CombatEntry): string => d.weapons.find((w) => w.tp)?.tp ?? "1W6";

/** The defense that actually happens: null if the target cannot defend (Status/Zustand) unless overridden. */
export function effectiveDefense(i: AttackInput): { kind: "PA" | "VW"; value: number } | null {
  if (!i.defense) return null;
  if (!i.ignoreDefenseBlock && defenseBlock(i.defender, i.defense.kind)) return null;
  return i.defense;
}

/** Trefferzonen context of the defender (humanoid / mittel when the entry carries no body data). */
export function zoneParamsFor(defender: CombatEntry, targeted: ZoneKey | null, forced: ZoneKey | null = null): ZoneParams {
  return { bodyType: defender.bodyType ?? "humanoid", size: defender.size ?? "mittel", ko: defender.ko ?? null, targeted, forced, zoneRs: defender.zoneRs };
}

/** AT/FK modifier line of a targeted attack, or null when no zone is aimed at. */
export function targetModifierLine(i: Pick<AttackInput, "defender" | "hitZones">): Modifier | null {
  const hz = i.hitZones;
  if (!hz?.targeted) return null;
  const surprised = effectsOf(i.defender).some((e) => e.kind === "status" && e.key === "ueberrascht");
  const value = targetedModifier(hz.targeted, { sf: hz.sf, surprised });
  const notes = [hz.sf ? "SF halbiert" : "", surprised ? "überrascht +2" : ""].filter(Boolean).join(", ");
  return { label: `Gezielt: ${ZONE_LABEL[hz.targeted]}${notes ? ` (${notes})` : ""}`, value };
}

export function buildAttackParams(i: AttackInput): AttackParams {
  const kindLabel = i.kind === "fernkampf" ? "FK" : "AT";
  const attackReach = i.kind === "fernkampf" ? "kurz" : i.attackerReach ?? null;
  const defense = effectiveDefense(i);
  const attackMods: Modifier[] = [
    ...nz(`Freier Modifikator (${kindLabel})`, i.atMod),
    ...(i.kind === "fernkampf" ? nz("Fernkampf-Modifikator", i.rangedMod) : []),
    ...statusModifiers(effectsOf(i.attacker), "at", { reach: attackReach }),
    ...(() => { const m = targetModifierLine(i); return m && m.value ? [m] : []; })(),
  ];
  const defenseMods: Modifier[] = [
    ...nz("Freier Modifikator (Verteidigung)", i.defenseMod),
    ...(defense ? statusModifiers(effectsOf(i.defender), defense.kind === "PA" ? "pa" : "vw", { reach: i.defenderReach ?? null }) : []),
  ];
  return {
    kind: i.kind,
    rangedType: i.kind === "fernkampf" ? i.rangedType : undefined,
    patzerMode: i.patzerMode,
    ...(i.hitZones ? { zones: zoneParamsFor(i.defender, i.hitZones.targeted, i.hitZones.fixed ?? null) } : {}),
    attacker: {
      id: i.attacker.id,
      value: i.value,
      modifiers: attackMods,
      statePenalty: entryStatePenalty(i.attacker),
      tp: i.tp,
      tpModifiers: nz("Freier Modifikator (TP)", i.tpMod),
    },
    defender: {
      id: i.defender.id,
      defense,
      modifiers: defenseMods,
      statePenalty: entryStatePenalty(i.defender),
      defensesUsed: i.defender.defensesUsed,
      defensePenalty: i.defender.defensePenalty,
      defenseMode: i.defender.defenseMode,
      rs: i.defender.rs,
      weaponTp: defenderTp(i.defender),
    },
  };
}

export interface PreviewLine {
  label: string;
  value: number;
}
export interface PreviewCheck {
  lines: PreviewLine[];
  value: number;
}
export interface EffectInfo {
  /** modifier lines that come from Zustände (itemised) and Status, per side */
  attackerNotes: string[];
  defenderNotes: string[];
  /** reason the target cannot defend (null if it can) */
  defenseBlocked: string | null;
}

/** Rule reminders (Status notes) and the defense block of an attack, for the modal. */
export function effectInfo(i: AttackInput): EffectInfo {
  return {
    attackerNotes: statusNotes(effectsOf(i.attacker)),
    defenderNotes: statusNotes(effectsOf(i.defender)),
    defenseBlocked: i.defense ? defenseBlock(i.defender, i.defense.kind) : null,
  };
}

/** Itemised preview of the AT value and (if any) the defense value, before rolling. */
export function previewAttack(i: AttackInput): { attack: PreviewCheck; defense: PreviewCheck | null } {
  const defenseUsed = effectiveDefense(i);
  const p = buildAttackParams(i);
  const aMods = [...(p.attacker.modifiers ?? []), ...statePenaltyLines(i.attacker)];
  const attackLines: PreviewLine[] = [{ label: i.kind === "fernkampf" ? "FK" : "AT", value: i.value }, ...aMods];
  const attackValue = computeValue({ base: i.value, modifiers: p.attacker.modifiers, statePenalty: p.attacker.statePenalty }).value;
  let defense: PreviewCheck | null = null;
  if (defenseUsed) {
    const dm = [...(p.defender.modifiers ?? [])];
    if (i.kind === "fernkampf" && i.rangedType) dm.push({ label: i.rangedType === "schuss" ? "Schusswaffenangriff" : "Wurfwaffenangriff", value: RANGED_DEFENSE_MOD[i.rangedType] });
    const counter = p.defender.defensePenalty ?? 0;
    const lines: PreviewLine[] = [{ label: defenseUsed.kind === "PA" ? "PA" : "Ausweichen", value: defenseUsed.value }, ...dm, ...statePenaltyLines(i.defender)];
    if (counter) lines.push({ label: "Verteidigungen in dieser KR", value: -counter });
    const value = computeValue({ base: defenseUsed.value, modifiers: dm, statePenalty: p.defender.statePenalty, extraPenalties: counter ? [{ label: "", value: counter }] : [] }).value;
    defense = { lines, value };
  }
  return { attack: { lines: attackLines, value: attackValue }, defense };
}

/** null when the input is usable, else a German reason. */
export function validateAttackInput(i: Pick<AttackInput, "value" | "tp" | "defense">): string | null {
  if (!Number.isFinite(i.value)) return "AT/FK-Wert fehlt.";
  if (!tryParseDice(i.tp)) return "TP unlesbar (erwartet z. B. 1W6+4).";
  if (i.defense && !Number.isFinite(i.defense.value)) return "Verteidigungswert fehlt.";
  return null;
}

/** Weapon -> default AT/FK value (null if unknown). */
export const weaponValue = (w: Weapon | null): number | null => (w ? (w.kind === "ranged" ? w.fk : w.at) : null);

/** Defense counter step to apply when the GM counts a defense by hand. */
export function manualDefenseDelta(e: Pick<CombatEntry, "defenseMode">): { defensesDelta: number; defensePenaltyDelta: number } {
  return { defensesDelta: 1, defensePenaltyDelta: e.defenseMode === "cumulative" ? DEFENSE_STEP : 0 };
}

// ---------------------------------------------------------------- heroes in the fight

/** True when this hero already fights: same note (sourcePath), or, for a hero without a note, the same name. */
export function heroInCombat(entries: readonly Pick<CombatEntry, "kind" | "name" | "sourcePath">[], hero: { name: string; notePath?: string }): boolean {
  return entries.some((e) => e.kind === "hero" && (hero.notePath ? e.sourcePath === hero.notePath : e.name === hero.name));
}

// ---------------------------------------------------------------- manual combatants

export function manualCombatant(name: string, lepMax: number, iniBase: number, rs = 0, vw: number | null = null): Combatant {
  return { name, kind: "hero", sourcePath: "", lepMax, iniBase, rs, vw, weapons: [], needsManual: [] };
}

/** True if the GM has to type in LeP and/or INI before this creature can be added. */
export const needsStatsPrompt = (c: Combatant): boolean => c.needsManual.length > 0 || c.lepMax === null || c.iniBase === null;

// ---------------------------------------------------------------- result text

const sign = (n: number) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);

/** One-line description of a d20 check: "W20 12 gegen 14 → Erfolg", incl. confirmation. */
export function describeCheck(c: CheckResult): string {
  let s = `W20 ${c.roll} gegen ${c.value}`;
  if (c.halved) s += ` (halbiert von ${c.valueBeforeHalving})`;
  s += c.success ? " → Erfolg" : " → Fehlschlag";
  if (c.natural === "crit") s += `; Bestätigung W20 ${c.confirmRoll} → ${c.confirmed ? "kritischer Erfolg bestätigt" : "nicht bestätigt"}`;
  if (c.natural === "patzer") s += `; Bestätigung W20 ${c.confirmRoll} → ${c.confirmed ? "PATZER bestätigt" : "kein Patzer"}`;
  return s;
}

export const OUTCOME_LABEL: Record<AttackResult["outcome"], string> = {
  patzer: "Patzer",
  miss: "daneben",
  defended: "pariert / ausgewichen",
  hit: "Treffer",
};

export function describeDamage(r: AttackResult): string | null {
  const d = r.damage;
  if (!d) return null;
  const dice = `${d.tpRoll.spec.text}: [${d.tpRoll.rolls.join(", ")}]${d.tpRoll.bonus ? sign(d.tpRoll.bonus) : ""}`;
  const mods = d.tpModifiers.map((m) => `${m.label} ${sign(m.value)}`).join(", ");
  return `TP ${dice}${mods ? `, ${mods}` : ""} = ${d.tpSubtotal}${d.doubled ? ` ×2 (kritisch) = ${d.tpTotal}` : ""} − RS ${d.rs} = ${d.dealt} SP`;
}

// ---------------------------------------------------------------- Trefferzonen text

/** "Kopf (W20 2)" / "Kopf (gezielt)" + RS source; null without a zone hit. */
export function describeZone(r: AttackResult): string | null {
  const z = r.zone;
  if (!z) return null;
  const how = z.manual ? `festgelegt${z.fromRoll ? `, gewürfelt war W20 ${z.fromRoll}` : ""}` : z.roll === null ? "gezielt" : `W20 ${z.roll}`;
  return `Getroffen: ${ZONE_LABEL[z.zone]} (${how}), ${z.rsSource === "zone" ? `Zonen-RS ${z.rs}` : `RS ${z.rs} (gesamt)`}`;
}

/** Wound suggestion sentence for the result view (never applied automatically). */
export function describeWound(w: WoundResult): string {
  const mult = w.multiple > 1 ? ` (${w.multiple}× Schwelle)` : "";
  return `Wundeffekt möglich: ${w.sp} SP ≥ Wundschwelle ${w.threshold}${mult}. Probe auf Selbstbeherrschung (${w.resist}) −${w.resistPenalty}; bei Misslingen: ${w.effect.text}`;
}

/** Compact badge text for the cockpit: "Kopf · 7 SP" (+ " ⚠" when a wound effect was possible). */
export function lastHitText(h: LastHit): string {
  return `${ZONE_SHORT[h.zone]} · ${h.sp} SP${h.wound ? " ⚠" : ""}`;
}

/** Compact one-liner for the roll log. */
export function summarizeResult(r: AttackResult, attacker: string, defender: string, weapon: string): string {
  const head = `${attacker} (${weapon}) → ${defender}: `;
  const at = `AT ${r.attack.roll}/${r.attack.value}`;
  switch (r.outcome) {
    case "patzer":
      return `${head}${at} PATZER${r.patzer?.entry ? ` – ${r.patzer.entry.name}` : ""}`;
    case "miss":
      return `${head}${at} daneben`;
    case "defended":
      return `${head}${at}, ${r.defense?.kind ?? "PA"} ${r.defense?.check?.roll}/${r.defense?.check?.value} → pariert`;
    default:
      return `${head}${at}${r.defense?.check ? `, ${r.defense.kind} ${r.defense.check.roll}/${r.defense.check.value} ✗` : ""} → ${r.damage?.dealt ?? 0} SP${r.zone ? ` (${ZONE_SHORT[r.zone.zone]}${r.wound ? `, Wundeffekt: ${r.wound.effect.label}` : ""})` : ""}`;
  }
}

// ---------------------------------------------------------------- Trefferzonen overview (cockpit)

export interface ZoneRow {
  zone: ZoneKey;
  label: string;
  /** W20 range for this body type and size */
  range: string;
  rs: number;
  rsSource: "zone" | "gesamt";
  sp: number;
  hits: number;
  wounds: number;
  /** "3 · 1 Wunde" */
  hitsText: string;
}

export interface ZoneOverview {
  bodyType: BodyType;
  lep: number;
  lepMax: number;
  /** half KO rounded up; null = KO unknown */
  threshold: number | null;
  /** empty for bodies without zones */
  rows: ZoneRow[];
}

export const hitsText = (hits: number, wounds: number): string => (wounds ? `${hits} · ${wounds} ${wounds === 1 ? "Wunde" : "Wunden"}` : `${hits}`);

/** Everything the "Trefferzonen" section of an expanded combatant card shows. Pure. */
export function zoneOverview(e: CombatEntry): ZoneOverview {
  const bodyType = e.bodyType ?? "humanoid";
  const size = e.size ?? "mittel";
  const rows: ZoneRow[] = zoneRollRanges(bodyType, size).map(({ zone, range }) => {
    const { rs, source } = zoneRsFor(zone, e.zoneRs, e.rs);
    const t = e.zoneDamage?.[zone] ?? { sp: 0, hits: 0, wounds: 0 };
    return { zone, label: ZONE_LABEL[zone], range, rs, rsSource: source, sp: t.sp, hits: t.hits, wounds: t.wounds, hitsText: hitsText(t.hits, t.wounds) };
  });
  return { bodyType, lep: e.lep, lepMax: e.lepMax, threshold: e.ko && e.ko > 0 ? woundThreshold(e.ko) : null, rows };
}
