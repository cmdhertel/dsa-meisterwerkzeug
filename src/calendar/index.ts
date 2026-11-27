import { Notice, TFile } from "obsidian";
import type DsaMeisterwerkzeugPlugin from "../main";
import { addDays, formatDate } from "./engine";
import { CALENDAR_VIEW_TYPE, CalendarView, askForDate } from "./view";
import { CalendarState, setCalendar } from "./state";

export async function openCalendar(plugin: DsaMeisterwerkzeugPlugin): Promise<void> {
  const { workspace } = plugin.app;
  let leaf = workspace.getLeavesOfType(CALENDAR_VIEW_TYPE)[0];
  if (!leaf) {
    const right = workspace.getRightLeaf(false);
    if (!right) return;
    await right.setViewState({ type: CALENDAR_VIEW_TYPE, active: true });
    leaf = right;
  }
  await workspace.revealLeaf(leaf);
}

/** Registers the Aventurischer Kalender: view, commands and the inline `datum: heute`. */
export function registerCalendar(plugin: DsaMeisterwerkzeugPlugin): void {
  const state = new CalendarState(plugin.app, `${plugin.manifest.dir ?? `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`}/calendar.json`);
  setCalendar(plugin, state);
  const ready = state.load();
  plugin.register(() => void state.flush());

  plugin.registerView(CALENDAR_VIEW_TYPE, (leaf) => new CalendarView(leaf, plugin));
  plugin.addRibbonIcon("calendar-days", "Aventurischer Kalender öffnen", () => void openCalendar(plugin));
  plugin.addCommand({ id: "open-calendar", name: "Aventurischer Kalender öffnen", callback: () => void openCalendar(plugin) });
  plugin.addCommand({
    id: "calendar-next-day",
    name: "Einen Tag weiter",
    callback: () => new Notice(formatDate(state.advance(1))),
  });
  plugin.addCommand({ id: "calendar-set-date", name: "Datum setzen", callback: () => void askForDate(plugin) });
  plugin.addCommand({
    id: "calendar-insert-date",
    name: "Aktuelles Datum einfügen",
    editorCallback: (editor) => editor.replaceSelection(formatDate(state.getDate())),
  });

  // follow the campaign of the active note
  plugin.registerEvent(
    plugin.app.workspace.on("file-open", (file: TFile | null) => {
      const m = file && /^Campaigns\/([^/]+)\//.exec(file.path);
      if (m && state.active !== m[1] && plugin.app.vault.getAbstractFileByPath(`Campaigns/${m[1]}`)) state.setActive(m[1]);
    }),
  );

  // inline code `datum: heute`
  plugin.registerMarkdownPostProcessor((el) => {
    el.querySelectorAll("code").forEach((c) => {
      if (c.parentElement?.tagName === "PRE") return;
      const m = /^datum:\s*(heute|morgen|gestern)$/i.exec(c.textContent?.trim() ?? "");
      if (!m) return;
      const off = { heute: 0, morgen: 1, gestern: -1 }[m[1].toLowerCase() as "heute"];
      const span = createSpan({ cls: "dsa-cal-inline", text: formatDate(addDays(state.getDate(), off)) });
      c.replaceWith(span);
    });
  });
  void ready;
}
