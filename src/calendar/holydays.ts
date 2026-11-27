// Editable table of fixed holy days. month: 0..11 = Praios..Rahja, 12 = Namenlose Tage. Keep it small and certain.
export interface HolyDay {
  month: number;
  day: number;
  name: string;
}

export const HOLY_DAYS: HolyDay[] = [
  { month: 0, day: 1, name: "Tag des Praios (Sommersonnenwende, Neujahr)" },
  { month: 12, day: 1, name: "Namenloser Tag (Beginn der Namenlosen Tage)" },
  { month: 12, day: 2, name: "Namenloser Tag (Tage ohne Götterschutz)" },
  { month: 12, day: 3, name: "Namenloser Tag (Tage ohne Götterschutz)" },
  { month: 12, day: 4, name: "Namenloser Tag (Tage ohne Götterschutz)" },
  { month: 12, day: 5, name: "Namenloser Tag (Ende des Jahres)" },
];
