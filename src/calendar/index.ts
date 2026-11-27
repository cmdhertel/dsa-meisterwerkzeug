import { Notice, TFile } from "obsidian";
import type DsaMeisterwerkzeugPlugin from "../main";
import { addDays, formatDate } from "./engine";
import { CALENDAR_VIEW_TYPE, CalendarView, askForDate } from "./view";
import { CalendarState, setCalendar } from "./state";
import { campaignOfFile, registerCampaignCache } from "./campaigns";

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
  const state = new CalendarState(plugin.app, `${plugin.manifest.dir ?? `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`}/calendar.json`, {
    onLoadFailed: () =>
      new Notice("Aventurischer Kalender: calendar.json ist beschädigt und wurde nicht geladen. Eine Kopie liegt als calendar.json.bak daneben; die Datei wird nicht überschrieben.", 15000),
  });
  setCalendar(plugin, state);
  const ready = state.load();
  // commands and handlers wait for the stored state, so they never act on empty defaults
  const afterLoad = (fn: () => unknown) => async () => {
    await ready;
    await fn();
  };
  plugin.register(() => void state.flush());
  registerCampaignCache(plugin);

  plugin.registerView(CALENDAR_VIEW_TYPE, (leaf) => new CalendarView(leaf, plugin));
  plugin.addRibbonIcon("calendar-days", "Aventurischer Kalender öffnen", () => void openCalendar(plugin));
  plugin.addCommand({ id: "open-calendar", name: "Kalender: Aventurischen Kalender öffnen", callback: afterLoad(() => openCalendar(plugin)) });
  plugin.addCommand({
    id: "calendar-next-day",
    name: "Kalender: Einen Tag weiter",
    callback: afterLoad(() => new Notice(formatDate(state.advance(1)))),
  });
  plugin.addCommand({ id: "calendar-set-date", name: "Kalender: Datum setzen", callback: afterLoad(() => askForDate(plugin)) });
  plugin.addCommand({
    id: "calendar-insert-date",
    name: "Kalender: Aktuelles Datum einfügen",
    editorCallback: async (editor) => {
      await ready;
      editor.replaceSelection(formatDate(state.getDate()));
    },
  });

  // follow the campaign of the active note
  plugin.registerEvent(
    plugin.app.workspace.on("file-open", async (file: TFile | null) => {
      await ready;
      const c = file && campaignOfFile(plugin, file);
      if (c && state.active !== c) state.setActive(c);
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
}
