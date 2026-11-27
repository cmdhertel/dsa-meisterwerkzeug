// Generated "## Spielwerte" block between marker comments. Pure.
import type { TalentGroup } from "../engine/types";
import { TALENTS } from "../data/talents.generated";
import { Hero, weaponValues } from "./model";

export const BLOCK_START = "%% dsa-import:start %%";
export const BLOCK_END = "%% dsa-import:end %%";

const GROUPS: TalentGroup[] = ["Körper", "Gesellschaft", "Natur", "Wissen", "Handwerk"];
const dash = (n: number | null | undefined) => (n === null || n === undefined ? "–" : String(n));
const cell = (s: string) => s.replace(/\|/g, "\\|");

export function renderSpielwerte(hero: Hero): string {
  const L: string[] = [];
  L.push(BLOCK_START, "## Spielwerte", "");
  L.push(
    `**LeP** ${hero.lep.max} · **AsP** ${hero.asp.max} · **Schip** ${hero.schip.max} · **INI** ${hero.ini} · **AW** ${hero.aw} · **SK** ${hero.sk} · **ZK** ${hero.zk} · **GS** ${hero.gs} · **Wundschwelle** ${hero.wundschwelle}`,
    "",
  );

  L.push("### Talente", "");
  let any = false;
  for (const g of GROUPS) {
    const rows = TALENTS.filter((t) => t.group === g && (hero.talents[t.name] ?? 0) > 0);
    if (!rows.length) continue;
    any = true;
    L.push(`**${g}**`, "", "| Talent | Probe | FW |", "|---|---|---|");
    for (const t of rows) L.push(`| ${cell(t.name)} | ${t.attrs.join("/")} | ${hero.talents[t.name]} |`);
    L.push("");
  }
  const extra = hero.unknownTalents.filter((t) => t.value > 0);
  if (extra.length) {
    any = true;
    L.push("**Weitere**", "", "| Talent | FW |", "|---|---|");
    for (const t of extra) L.push(`| Talent #${t.key} | ${t.value} |`);
    L.push("");
  }
  if (!any) L.push("_Keine Talente über FW 0._", "");

  if (hero.spells.length) {
    L.push("### Zauber", "", "| Zauber | ZfW |", "|---|---|");
    for (const s of hero.spells) L.push(`| ${cell(s.label)} | ${s.value} |`);
    L.push("");
  }

  if (hero.weapons.length) {
    L.push("### Waffen", "", "| Waffe | Kampftechnik | AT/FK | PA | TP | RW |", "|---|---|---|---|---|---|");
    for (const w of hero.weapons) {
      const v = weaponValues(hero, w);
      L.push(
        `| ${cell(w.label)} | ${cell(w.entry?.kampftechnik || "–")} | ${dash(v.kind === "ranged" ? v.fk : v.at)} | ${dash(v.pa)} | ${v.tp ?? "–"} | ${cell(v.rw || "–")} |`,
      );
    }
    L.push("");
  }
  L.push(BLOCK_END);
  return L.join("\n");
}

/**
 * Replace the text between the markers (inclusive) or append the block if absent. Everything else is untouched.
 * If only one marker exists, the note is left alone and the block is appended (never destroy user text).
 */
export function applyBlock(content: string, block: string): string {
  const s = content.indexOf(BLOCK_START);
  const e = content.indexOf(BLOCK_END);
  if (s !== -1 && e !== -1 && e > s) {
    return content.slice(0, s) + block + content.slice(e + BLOCK_END.length);
  }
  const sep = content.endsWith("\n\n") ? "" : content.endsWith("\n") ? "\n" : "\n\n";
  return content + sep + block + "\n";
}

export const hasBlock = (content: string): boolean => {
  const s = content.indexOf(BLOCK_START);
  return s !== -1 && content.indexOf(BLOCK_END) > s;
};
