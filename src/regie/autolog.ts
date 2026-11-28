// Sitzungsregie: automatic journal entries (table bus, combat, calendar). Works without an open view,
// but only writes while a session is running; tracking state is always kept up to date silently.
import type DsaMeisterwerkzeugPlugin from "../main";
import { calendarOf } from "../calendar/state";
import { formatDate } from "../calendar/engine";
import type { TableEventType } from "../bus";
import type { JournalKind } from "./run";
import type { RegieState } from "./state";
import { FightTracker } from "./fight";
import { campaignName } from "./vault";

const KIND_OF: Record<TableEventType, JournalKind> = { probe: "probe", cast: "zauber", group: "gruppe", rest: "rast", note: "notiz" };

export function registerAutoLog(plugin: DsaMeisterwerkzeugPlugin, regie: RegieState): void {
  const auto = () => plugin.settings.regieAutoLog !== false;
  // --- table bus
  plugin.register(
    plugin.table.on((e) => {
      const run = regie.running();
      // "note" events are the GM's own entries and are kept even with auto-logging off
      if (run && (auto() || e.type === "note")) regie.log(run.sessionPath, KIND_OF[e.type] ?? "notiz", e.text);
    }),
  );

  // --- combat
  const tracker = new FightTracker();
  let announced = false;
  let timer: number | null = null;
  const snapshot = () => plugin.combat.entries.map((en) => ({ name: en.name, creature: en.kind === "creature", down: plugin.combat.isDown(en.id) }));
  const logRun = (text: string) => {
    const run = regie.running();
    if (run && auto()) regie.log(run.sessionPath, "kampf", text);
  };
  const onCombat = () => {
    // fallen creatures must be noted before a clear wipes the entries, so track on every event
    const wasFight = tracker.inFight;
    const end = tracker.update(snapshot(), plugin.combat.state.round);
    if (end) {
      if (timer) window.clearTimeout(timer);
      timer = null;
      if (announced) logRun(end);
      announced = false;
      return;
    }
    if (!wasFight && tracker.inFight) {
      if (timer) window.clearTimeout(timer);
      // short delay: encounter loading adds several creatures in a row
      timer = window.setTimeout(() => {
        timer = null;
        if (!tracker.inFight) return;
        announced = true;
        logRun(tracker.startText());
      }, 400);
    }
  };
  plugin.register(plugin.combat.on(onCombat));
  plugin.register(() => timer && window.clearTimeout(timer));
  // a fight that was already running at startup is not announced again
  tracker.update(snapshot(), plugin.combat.state.round);
  announced = tracker.inFight;

  // --- calendar date changes
  const cal = calendarOf(plugin);
  const logged = new Map<string, string>();
  let calTimer: number | null = null;
  const campaignOfRun = (): string => {
    const run = regie.running();
    return run ? campaignName(plugin.app, run.sessionPath) : "";
  };
  const current = (campaign: string) => formatDate(cal.getDate(campaign || undefined));
  // the calendar file loads asynchronously at startup: that is not a date change
  let armed = false;
  const armTimer = window.setTimeout(() => (armed = true), 3000);
  plugin.register(() => window.clearTimeout(armTimer));
  const onCal = () => {
    const campaign = campaignOfRun();
    const key = campaign || cal.active;
    const now = current(campaign);
    if (!armed) {
      logged.set(key, now);
      return;
    }
    if (!logged.has(key)) {
      logged.set(key, now);
      return;
    }
    if (logged.get(key) === now) return;
    if (!regie.running()) {
      logged.set(key, now); // silent baseline update
      return;
    }
    if (calTimer) window.clearTimeout(calTimer);
    // coalesce quick successive changes (stepping through days)
    calTimer = window.setTimeout(() => {
      calTimer = null;
      const run = regie.running();
      if (!run) return;
      const c = campaignName(plugin.app, run.sessionPath);
      const k = c || cal.active;
      const d = current(c);
      if (logged.get(k) !== d) {
        logged.set(k, d);
        if (auto()) regie.log(run.sessionPath, "datum", `Neuer Tag: ${d}`);
      }
    }, 2000);
  };
  logged.set(campaignOfRun() || cal.active, current(campaignOfRun()));
  plugin.register(cal.on(onCal));
  plugin.register(() => calTimer && window.clearTimeout(calTimer));
}
