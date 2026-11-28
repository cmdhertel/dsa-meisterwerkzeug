// Sitzungsregie: header (session picker, clock, Aventurian date, actions, overflow menu).
import { Menu, Notice, setIcon } from "obsidian";
import { formatDate } from "../calendar/engine";
import { openCalendar } from "../calendar";
import { calendarOf } from "../calendar/state";
import { openCockpit } from "../cockpit";
import { confirm } from "../hero/modals";
import { startAdHoc } from "../groupprobe/command";
import { openCastDialog } from "../magic";
import { openEncounterBuilder } from "../encounter";
import { ProbeModal } from "../probe/command";
import type { RegieCtx } from "./ctx";
import { formatClock, sessionElapsed } from "./run";
import { asyncHandler } from "../util";

export interface HeaderApi {
  /** re-read everything (session, run state, date) */
  refresh(): void;
  /** once per second: only touches the clock text */
  tick(): void;
}

function iconButton(parent: HTMLElement, icon: string, label: string, text?: string, cls = ""): HTMLButtonElement {
  const b = parent.createEl("button", { cls: `dsa-regie-btn ${cls}`.trim(), attr: { type: "button", "aria-label": label, title: label } });
  setIcon(b.createSpan({ cls: "dsa-regie-btn-icon" }), icon);
  if (text) b.createSpan({ cls: "dsa-regie-btn-text", text });
  return b;
}

export function buildHeader(host: HTMLElement, ctx: RegieCtx): HeaderApi {
  const { plugin } = ctx;
  host.addClass("dsa-regie-header");

  const pick = host.createEl("button", { cls: "dsa-regie-session-pick", attr: { type: "button", "aria-label": "Session wählen" } });
  setIcon(pick.createSpan({ cls: "dsa-regie-btn-icon" }), "clapperboard");
  const pickText = pick.createSpan({ cls: "dsa-regie-session-text" });
  const pickTitle = pickText.createSpan({ cls: "dsa-regie-session-title" });
  const pickSub = pickText.createSpan({ cls: "dsa-regie-session-sub" });
  pick.addEventListener("click", () => ctx.pickSession());

  const clockBox = host.createDiv({ cls: "dsa-regie-clockbox" });
  const dot = clockBox.createSpan({ cls: "dsa-regie-live-dot", attr: { "aria-hidden": "true" } });
  const clock = clockBox.createSpan({ cls: "dsa-regie-clock", text: "00:00", attr: { role: "timer", "aria-label": "Sitzungsdauer" } });
  const toggle = clockBox.createEl("button", { cls: "dsa-regie-btn mod-primary", attr: { type: "button" } });
  setIcon(toggle.createSpan({ cls: "dsa-regie-btn-icon" }), "play");
  const toggleText = toggle.createSpan({ cls: "dsa-regie-btn-text" });
  toggle.addEventListener("click", () => {
    const s = ctx.session();
    if (!s) return;
    if (ctx.isRunning()) ctx.endSession();
    else ctx.regie.start(s);
  });

  const dateBtn = host.createEl("button", { cls: "dsa-regie-date", attr: { type: "button", "aria-label": "Aventurischen Kalender öffnen" } });
  setIcon(dateBtn.createSpan({ cls: "dsa-regie-btn-icon" }), "calendar-days");
  const dateText = dateBtn.createSpan({ cls: "dsa-regie-date-text" });
  dateBtn.addEventListener("click", () => void openCalendar(plugin));

  const actions = host.createDiv({ cls: "dsa-regie-header-actions" });
  const note = iconButton(actions, "pencil", "Notiz zur Mitschrift", "Notiz");
  note.addEventListener("click", () => ctx.quickNote());
  const write = iconButton(actions, "file-pen-line", "Mitschrift in die Session-Notiz schreiben", "Mitschrift schreiben");
  write.addEventListener("click", () => ctx.writeMitschrift());
  const more = iconButton(actions, "more-horizontal", "Weitere Aktionen");
  more.addEventListener("click", (ev) => {
    const m = new Menu();
    const s = ctx.session() ?? "";
    m.addItem((i) => i.setTitle("Kampf-Cockpit öffnen").setIcon("swords").onClick(() => void openCockpit(plugin)));
    m.addItem((i) => i.setTitle("Begegnung bauen").setIcon("hammer").onClick(() => openEncounterBuilder(plugin)));
    m.addSeparator();
    m.addItem((i) => i.setTitle("Probe würfeln").setIcon("dices").onClick(() => new ProbeModal(plugin, { sourcePath: s }).open()));
    m.addItem((i) => i.setTitle("Gruppenprobe").setIcon("users").onClick(() => startAdHoc(plugin, "gruppe")));
    m.addItem((i) => i.setTitle("Zauber wirken").setIcon("sparkles").onClick(() => openCastDialog(plugin, { kind: "zauber" })));
    m.addSeparator();
    m.addItem((i) =>
      i
        .setTitle("Mitschrift zurücksetzen")
        .setIcon("trash-2")
        .setDisabled(!s)
        .onClick(asyncHandler(async () => {
          if (s && (await confirm(ctx.app, "Mitschrift zurücksetzen", "Alle Einträge, Szenenstatus und die Uhr dieser Session werden gelöscht. Die Session-Notiz bleibt unverändert.", "Zurücksetzen"))) {
            ctx.regie.reset(s);
            new Notice("Mitschrift zurückgesetzt.");
          }
        })),
    );
    m.showAtMouseEvent(ev);
  });

  const tick = () => {
    const run = ctx.run();
    clock.setText(formatClock(sessionElapsed(run, Date.now())));
  };

  const refresh = () => {
    const s = ctx.session();
    const info = ctx.sessionInfo();
    pickTitle.setText(info?.title ?? (s ? s.replace(/^.*\//, "").replace(/\.md$/, "") : "Keine Session"));
    pickSub.setText([info?.campaign, info?.datum].filter(Boolean).join(" · "));
    const run = ctx.run();
    const live = ctx.isRunning();
    const ended = run.endedAt !== null;
    dot.toggleClass("is-live", live);
    clockBox.toggleClass("is-live", live);
    toggleText.setText(live ? "Beenden" : ended ? "Fortsetzen" : "Start");
    setIcon(toggle.querySelector(".dsa-regie-btn-icon") as HTMLElement, live ? "square" : "play");
    toggle.setAttr("aria-label", live ? "Session beenden" : ended ? "Session fortsetzen" : "Session starten");
    toggle.disabled = !s;
    note.disabled = !s;
    write.disabled = !s;
    tick();
    try {
      const cal = calendarOf(plugin);
      const camp = ctx.campaign() || undefined;
      const d = cal.getDate(camp);
      const w = cal.getWeather(d, camp);
      const txt = formatDate(d) + (w?.description ? ` · ${w.description}` : "");
      dateText.setText(txt);
      dateBtn.setAttr("title", txt);
    } catch {
      dateText.setText("Kalender");
    }
  };
  return { refresh, tick };
}
