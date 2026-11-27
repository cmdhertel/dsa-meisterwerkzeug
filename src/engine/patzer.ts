// Patzer tables, encoded from 20 - Regeln/Kampf/Patzertabellen.md (2W6).

export type PatzerTable = "nahkampf" | "fernkampf" | "verteidigung" | "magie" | "liturgie";

export interface PatzerEntry {
  roll: number;
  name: string;
  effect: string;
  /** weapon damage is rolled and dealt to the fumbler: 1 = once, 2 = doubled */
  selfDamage?: 1 | 2;
  /** suggested state (GM applies it; durations are not tracked by the engine) */
  suggestedState?: { state: "schmerz" | "betaeubung" | "furcht" | "verwirrung" | "entrueckung"; level: number; duration: string };
}

const UNZERSTOERBAR = " Bei unzerstörbaren Waffen wird das Ergebnis wie bei 5 behandelt.";

const NAHKAMPF: PatzerEntry[] = [
  { roll: 2, name: "Waffe zerstört", effect: "Die Waffe ist unwiederbringlich zerstört." + UNZERSTOERBAR },
  { roll: 3, name: "Waffe schwer beschädigt", effect: "Die Waffe ist nicht mehr verwendbar, bis sie repariert wird." + UNZERSTOERBAR },
  { roll: 4, name: "Waffe beschädigt", effect: "Alle Proben auf Attacke und Parade sind um 2 erschwert, bis die Waffe repariert wird." + UNZERSTOERBAR },
  { roll: 5, name: "Waffe verloren", effect: "Die Waffe ist zu Boden gefallen." },
  { roll: 6, name: "Waffe stecken geblieben", effect: "Die Waffe steckt fest. Befreien: 1 Aktion und eine um 1 erschwerte Probe auf Kraftakt (Ziehen & Zerren)." },
  { roll: 7, name: "Sturz", effect: "Der Held stürzt, wenn ihm keine um 2 erschwerte Probe auf Körperbeherrschung (Balance) gelingt. Sonst: Status Liegend." },
  { roll: 8, name: "Stolpern", effect: "Die nächste Handlung ist um 2 erschwert." },
  { roll: 9, name: "Fuß verdreht", effect: "Für 3 Kampfrunden eine Stufe Schmerz.", suggestedState: { state: "schmerz", level: 1, duration: "3 KR" } },
  { roll: 10, name: "Beule", effect: "Für eine Stunde eine Stufe Betäubung.", suggestedState: { state: "betaeubung", level: 1, duration: "1 Stunde" } },
  { roll: 11, name: "Selbst verletzt", effect: "Schaden der Waffe (inkl. Schadensbonus) wird ausgewürfelt und trifft den Kämpfer selbst. Unbewaffnet: 1W6 TP.", selfDamage: 1 },
  { roll: 12, name: "Selbst schwer verletzt", effect: "Schaden der Waffe (inkl. Schadensbonus) wird ausgewürfelt und verdoppelt. Unbewaffnet: 1W6 TP.", selfDamage: 2 },
];

const FERNKAMPF: PatzerEntry[] = [
  { roll: 2, name: "Waffe zerstört", effect: "Die Waffe ist unwiederbringlich zerstört." + UNZERSTOERBAR },
  { roll: 3, name: "Waffe schwer beschädigt", effect: "Die Waffe ist nicht mehr einsetzbar, bis sie repariert wird." + UNZERSTOERBAR },
  { roll: 4, name: "Waffe beschädigt", effect: "Alle Proben auf Fernkampf sind um 4 erschwert, bis die Waffe repariert wird." + UNZERSTOERBAR },
  { roll: 5, name: "Waffe verloren", effect: "Die Waffe ist zu Boden gefallen." },
  { roll: 6, name: "Kamerad/Unschuldiger getroffen", effect: "Das Geschoss trifft einen Freund oder Unbeteiligten (Schaden der Waffe inkl. Schadensbonus). Ist niemand in der Nähe: wie 11 Selbst verletzt." },
  { roll: 7, name: "Fehlschuss", effect: "Der spektakuläre Fehlschuss trifft ein Objekt (Ladenschild, Glasfenster ...)." },
  { roll: 8, name: "Zerrung", effect: "Für die nächsten 3 Kampfrunden eine Stufe Schmerz.", suggestedState: { state: "schmerz", level: 1, duration: "3 KR" } },
  { roll: 9, name: "Sehne herausgerutscht / Waffe nicht richtig gegriffen / Ladehemmung", effect: "2 komplette Kampfrunden, um die Waffe wieder einsatzbereit zu machen." },
  { roll: 10, name: "Zu konzentriert", effect: "Bis zur nächsten Aktion keine Verteidigungen möglich." },
  { roll: 11, name: "Selbst verletzt", effect: "Schaden der Waffe (inkl. Schadensbonus) wird ausgewürfelt und trifft den Schützen.", selfDamage: 1 },
  { roll: 12, name: "Schwer verletzt", effect: "Schwerer Eigentreffer: Schaden der Waffe (inkl. Schadensbonus), verdoppelt.", selfDamage: 2 },
];

// The vault's Verteidigung table is identical to the Nahkampf one.
const VERTEIDIGUNG: PatzerEntry[] = NAHKAMPF.map((e) => ({ ...e }));

const MAGIE: PatzerEntry[] = [
  { roll: 2, name: "Körpertausch", effect: "Der Geist des Zauberers tauscht für 1W6 Tage den Körper mit dem nächsten Lebewesen in seiner Nähe, das größer ist als eine Ratte." },
  { roll: 3, name: "Mindergeist", effect: "Der Zauberer wird für 1W6 Tage von einem Mindergeist verfolgt." },
  { roll: 4, name: "Neues Ziel", effect: "Das Ziel des Zaubers ändert sich zufällig nach Wahl des Meisters." },
  { roll: 5, name: "Verwandlung", effect: "Der Zauberer verwandelt sich für 1W6 Stunden in ein Kleintier nach Wahl des Spielleiters." },
  { roll: 6, name: "Funkenregen", effect: "Die gesamte Astralkraft verlässt den Körper des Zauberers als Regen aus bunten Funken, illusionären Schmetterlingen und kleinen Regenbögen. Die AsP können regulär regeneriert werden." },
  { roll: 7, name: "AE-Sperre", effect: "Der Zauberer verliert für 1W6 Tage die Fähigkeit, auf seinen AE-Vorrat zuzugreifen." },
  { roll: 8, name: "Kopfschmerzen", effect: "Für 1W6 Tage eine Stufe Betäubung.", suggestedState: { state: "betaeubung", level: 1, duration: "1W6 Tage" } },
  { roll: 9, name: "Astralkraft springt über", effect: "Die gesamte Astralkraft springt auf das nächste magisch begabte Ziel über (auch über dessen Maximum hinaus). Der Zauberer kann sie regulär regenerieren." },
  { roll: 10, name: "Stumm", effect: "Der Zauberer verliert für 1W6 Tage seine Befähigung zu sprechen." },
  { roll: 11, name: "Bunte Haare", effect: "Haar und Bart färben sich bunt, wachsen später in der ursprünglichen Farbe nach." },
  { roll: 12, name: "Ätherische Stimme", effect: "Eine ätherische Stimme erklingt aus dem Nichts und sagt „Tu das nie wieder!“" },
];

const LITURGIE: PatzerEntry[] = [
  { roll: 2, name: "Feuer", effect: "Im Umkreis von 2W6 Metern gehen brennbare Materialien in Flammen auf (außer Lebewesen und die Kleidung des Geweihten)." },
  { roll: 3, name: "Gegenteiliger Effekt", effect: "Die Liturgie/Zeremonie hat einen gegenteiligen Effekt." },
  { roll: 4, name: "Neues Ziel", effect: "Das Ziel der Liturgie/Zeremonie ändert sich zufällig nach Wahl des Meisters." },
  { roll: 5, name: "Visionen", effect: "Für 1W6 Tage nachts seltsame Visionen und Alpträume." },
  { roll: 6, name: "Eingeschüchtert", effect: "Für einen Tag 3 Stufen Furcht.", suggestedState: { state: "furcht", level: 3, duration: "1 Tag" } },
  { roll: 7, name: "KE-Sperre", effect: "Der Geweihte verliert für 1W6 Tage die Fähigkeit, auf seinen KE-Vorrat zuzugreifen." },
  { roll: 8, name: "Entrückt", effect: "Für einen Tag 4 Stufen Entrückung.", suggestedState: { state: "entrueckung", level: 4, duration: "1 Tag" } },
  { roll: 9, name: "Verwirrt", effect: "Für einen Tag 3 Stufen Verwirrung (unverständliches Zeug, spätere Erinnerungslücke).", suggestedState: { state: "verwirrung", level: 3, duration: "1 Tag" } },
  { roll: 10, name: "Stumm", effect: "Der Geweihte verliert für 1W6 Tage seine Befähigung zu sprechen." },
  { roll: 11, name: "Stigma", effect: "Für einen Tag erhält der Geweihte ein Stigma." },
  { roll: 12, name: "Verwurzelt", effect: "Der Geweihte verwurzelt mit dem Boden und kann seine Füße für 1W6 Minuten nicht bewegen (Status Fixiert)." },
];

export const PATZER_TABLES: Record<PatzerTable, PatzerEntry[]> = {
  nahkampf: NAHKAMPF,
  fernkampf: FERNKAMPF,
  verteidigung: VERTEIDIGUNG,
  magie: MAGIE,
  liturgie: LITURGIE,
};

export function lookupPatzer(table: PatzerTable, roll2w6: number): PatzerEntry {
  const e = PATZER_TABLES[table].find((x) => x.roll === roll2w6);
  if (!e) throw new Error(`No Patzer entry for ${table} ${roll2w6}`);
  return e;
}
