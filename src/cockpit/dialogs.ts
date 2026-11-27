// Small Obsidian modals used by the cockpit. Each returns a promise that resolves to null on cancel.
import { App, Modal, Setting, SuggestModal } from "obsidian";
import type { Combatant } from "../model";

function formModal<T>(app: App, title: string, build: (el: HTMLElement, submit: (v: T) => void) => void): Promise<T | null> {
  return new Promise((resolve) => {
    let done = false;
    class M extends Modal {
      onOpen() {
        this.titleEl.setText(title);
        build(this.contentEl, (v) => {
          done = true;
          resolve(v);
          this.close();
        });
      }
      onClose() {
        this.contentEl.empty();
        if (!done) resolve(null);
      }
    }
    new M(app).open();
  });
}

const num = (s: string): number => (s.trim() === "" ? NaN : Number(s.replace(",", ".")));

/** One number input (e.g. INI roll, count). */
export function promptNumber(app: App, title: string, label: string, initial: number, min = 0): Promise<number | null> {
  return formModal<number>(app, title, (el, submit) => {
    let v = String(initial);
    const go = () => {
      const n = num(v);
      if (Number.isFinite(n) && n >= min) submit(Math.trunc(n));
    };
    new Setting(el).setName(label).addText((t) => {
      t.setValue(v).onChange((x) => (v = x));
      t.inputEl.type = "number";
      t.inputEl.addEventListener("keydown", (e) => e.key === "Enter" && go());
      setTimeout(() => t.inputEl.select(), 0);
    });
    new Setting(el).addButton((b) => b.setButtonText("OK").setCta().onClick(go));
  });
}

/** Set a pool (AsP/KaP) by hand: number input with -5/-1/+1/+5 steps. Resolves to the wanted current value (caller clamps). */
export function promptEnergy(app: App, title: string, current: number, max: number): Promise<number | null> {
  return formModal<number>(app, title, (el, submit) => {
    let value = current;
    el.createEl("p", { text: `Aktuell ${current} von ${max}`, cls: "dsa-mw-muted" });
    let input: HTMLInputElement;
    const set = (n: number) => {
      value = Math.max(0, Math.min(max, Math.trunc(n)));
      input.value = String(value);
    };
    const steps = el.createDiv({ cls: "dsa-cp-steps" });
    new Setting(el).setName("Neuer Wert").addText((t) => {
      input = t.inputEl;
      t.setValue(String(current)).onChange((x) => {
        const n = num(x);
        if (Number.isFinite(n)) value = Math.max(0, Math.min(max, Math.trunc(n)));
      });
      t.inputEl.type = "number";
      t.inputEl.min = "0";
      t.inputEl.max = String(max);
      t.inputEl.addEventListener("keydown", (e) => e.key === "Enter" && submit(value));
      setTimeout(() => t.inputEl.select(), 0);
    });
    for (const d of [-5, -1, 1, 5]) {
      const b = steps.createEl("button", { text: d > 0 ? `+${d}` : `−${Math.abs(d)}` });
      b.addEventListener("click", () => set(value + d));
    }
    const full = steps.createEl("button", { text: "Voll" });
    full.addEventListener("click", () => set(max));
    new Setting(el).addButton((b) => b.setButtonText("Setzen").setCta().onClick(() => submit(value)));
  });
}

/** Damage or healing in one dialog: resolves to a signed LeP change (damage negative). */
export function promptLepDelta(app: App, title: string): Promise<number | null> {
  return formModal<number>(app, title, (el, submit) => {
    let v = "";
    const go = (sign: 1 | -1) => {
      const n = Math.abs(Math.trunc(num(v)));
      if (Number.isFinite(n) && n > 0) submit(sign * n);
    };
    new Setting(el).setName("Punkte").addText((t) => {
      t.onChange((x) => (v = x));
      t.inputEl.type = "number";
      t.inputEl.min = "0";
      t.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") go(e.shiftKey ? 1 : -1);
      });
      setTimeout(() => t.inputEl.focus(), 0);
    });
    new Setting(el)
      .addButton((b) => b.setButtonText("Schaden").setWarning().onClick(() => go(-1)))
      .addButton((b) => b.setButtonText("Heilung").setCta().onClick(() => go(1)));
  });
}

/** LeP max + INI base for creatures whose statblock says "variabel" (or lacks the value). */
export function promptStats(app: App, c: Combatant): Promise<{ lepMax: number; iniBase: number } | null> {
  return formModal(app, `${c.name}: Werte eintragen`, (el, submit) => {
    el.createEl("p", { text: "Der Wertekasten gibt diese Werte nicht fest vor.", cls: "dsa-mw-muted" });
    let lep = c.lepMax !== null ? String(c.lepMax) : "";
    let ini = c.iniBase !== null ? String(c.iniBase) : "";
    const err = el.createEl("p", { cls: "dsa-cp-error" });
    new Setting(el).setName("LeP (max)").addText((t) => {
      t.setValue(lep).onChange((x) => (lep = x));
      t.inputEl.type = "number";
      setTimeout(() => t.inputEl.focus(), 0);
    });
    new Setting(el).setName("INI-Basis").addText((t) => {
      t.setValue(ini).onChange((x) => (ini = x));
      t.inputEl.type = "number";
    });
    new Setting(el).addButton((b) =>
      b.setButtonText("Übernehmen").setCta().onClick(() => {
        const l = num(lep);
        const i = num(ini);
        if (!(l > 0) || !Number.isFinite(i)) return void err.setText("LeP (> 0) und INI-Basis angeben.");
        submit({ lepMax: Math.trunc(l), iniBase: Math.trunc(i) });
      }),
    );
  });
}

/** How many copies of a creature. */
export const promptCount = (app: App, name: string): Promise<number | null> => promptNumber(app, `${name} hinzufügen`, "Anzahl", 1, 1);

export interface ManualHeroInput {
  name: string;
  lepMax: number;
  iniBase: number;
  rs: number;
  vw: number | null;
}

export function promptManualHero(app: App): Promise<ManualHeroInput | null> {
  return formModal<ManualHeroInput>(app, "Held manuell hinzufügen", (el, submit) => {
    let name = "";
    let lep = "";
    let ini = "";
    let rs = "0";
    let vw = "";
    const err = el.createEl("p", { cls: "dsa-cp-error" });
    new Setting(el).setName("Name").addText((t) => {
      t.onChange((x) => (name = x));
      setTimeout(() => t.inputEl.focus(), 0);
    });
    const numField = (label: string, set: (v: string) => void, init = "") =>
      new Setting(el).setName(label).addText((t) => {
        t.setValue(init).onChange(set);
        t.inputEl.type = "number";
      });
    numField("LeP (max)", (x) => (lep = x));
    numField("INI-Basis", (x) => (ini = x));
    numField("Rüstungsschutz", (x) => (rs = x), "0");
    numField("Ausweichen (optional)", (x) => (vw = x));
    new Setting(el).addButton((b) =>
      b.setButtonText("Hinzufügen").setCta().onClick(() => {
        const l = num(lep);
        const i = num(ini);
        if (!name.trim() || !(l > 0) || !Number.isFinite(i)) return void err.setText("Name, LeP (> 0) und INI-Basis angeben.");
        const v = num(vw);
        submit({ name: name.trim(), lepMax: Math.trunc(l), iniBase: Math.trunc(i), rs: Number.isFinite(num(rs)) ? Math.trunc(num(rs)) : 0, vw: Number.isFinite(v) ? Math.trunc(v) : null });
      }),
    );
  });
}

export interface HeroChoice {
  id: string;
  label: string;
  campaign: string;
  /** already in the fight: cannot be selected again */
  disabled?: boolean;
  disabledHint?: string;
}

/** Multi-select heroes with an optional campaign filter. Resolves to the chosen ids. */
export function pickHeroes(app: App, heroes: HeroChoice[], onlyManualLabel = "Manuell hinzufügen…"): Promise<{ ids: string[]; manual: boolean } | null> {
  return formModal<{ ids: string[]; manual: boolean }>(app, "Helden hinzufügen", (el, submit) => {
    const campaigns = [...new Set(heroes.map((h) => h.campaign).filter(Boolean))].sort((a, b) => a.localeCompare(b, "de"));
    const chosen = new Set<string>();
    let filter = "";
    const list = el.createDiv({ cls: "dsa-cp-herolist" });
    const render = () => {
      list.empty();
      const shown = heroes.filter((h) => !filter || h.campaign === filter);
      if (!shown.length) list.createEl("p", { text: "Keine Helden mit importierten Daten.", cls: "dsa-mw-muted" });
      for (const h of shown) {
        const row = list.createEl("label", { cls: "dsa-cp-heropick" });
        const cb = row.createEl("input", { type: "checkbox" });
        cb.disabled = !!h.disabled;
        cb.checked = !h.disabled && chosen.has(h.id);
        cb.addEventListener("change", () => (cb.checked ? chosen.add(h.id) : chosen.delete(h.id)));
        row.createSpan({ text: h.label });
        if (h.disabledHint) row.createSpan({ text: ` (${h.disabledHint})`, cls: "dsa-mw-muted" });
      }
    };
    if (campaigns.length) {
      new Setting(el).setName("Kampagne").addDropdown((d) => {
        d.addOption("", "Alle");
        campaigns.forEach((c) => d.addOption(c, c));
        d.onChange((v) => {
          filter = v;
          render();
        });
      });
    }
    el.appendChild(list);
    render();
    new Setting(el)
      .addButton((b) => b.setButtonText("Hinzufügen").setCta().onClick(() => submit({ ids: [...chosen], manual: false })))
      .addButton((b) => b.setButtonText(onlyManualLabel).onClick(() => submit({ ids: [], manual: true })));
  });
}

/** Fuzzy-ish suggester over the bestiary using the repository's own search. */
export function suggestCreature(app: App, search: (q: string) => Combatant[]): Promise<Combatant | null> {
  return new Promise((resolve) => {
    let done = false;
    class M extends SuggestModal<Combatant> {
      getSuggestions(q: string) {
        return search(q);
      }
      renderSuggestion(c: Combatant, el: HTMLElement) {
        el.createDiv({ text: c.name });
        const lep = c.lepMax !== null ? `LeP ${c.lepMax}` : "LeP variabel";
        const ini = c.iniBase !== null ? `INI ${c.iniBase}` : "INI variabel";
        el.createEl("small", { text: `${lep} · ${ini} · RS ${c.rs ?? "?"}`, cls: "dsa-mw-muted" });
      }
      onChooseSuggestion(c: Combatant) {
        done = true;
        resolve(c);
      }
      onClose() {
        setTimeout(() => {
          if (!done) resolve(null);
        }, 0);
      }
    }
    const m = new M(app);
    m.setPlaceholder("Gegner suchen (Bestiarium + NSC)…");
    m.open();
  });
}
