// Command "Probe würfeln": ad-hoc check in a modal.
import { AbstractInputSuggest, App, Component, Modal, Notice, Setting } from "obsidian";
import { TALENTS } from "../data/talents.generated";
import type { TalentDef } from "../engine/types";
import type DsaMeisterwerkzeugPlugin from "../main";
import { findTalent, normalizeTalentName } from "./parse";
import { ProbeView, Selection, orderedHeroChoices, rememberHero } from "./view";

class TalentSuggest extends AbstractInputSuggest<TalentDef> {
  constructor(app: App, private input: HTMLInputElement, private onPick: (t: TalentDef) => void) {
    super(app, input);
  }
  getSuggestions(q: string) {
    const n = normalizeTalentName(q);
    return TALENTS.filter((t) => normalizeTalentName(t.name).includes(n)).slice(0, 30);
  }
  renderSuggestion(t: TalentDef, el: HTMLElement) {
    el.setText(`${t.name}  (${t.attrs.join("/")})`);
  }
  selectSuggestion(t: TalentDef) {
    this.input.value = t.name;
    this.onPick(t);
    this.close();
  }
}

export interface ProbeModalOptions {
  talent?: string;
  modifier?: number;
  sourcePath?: string;
}

export class ProbeModal extends Modal {
  private owner = new Component();
  private view: ProbeView | null = null;
  /** @param opts optional prefill (used by the Sitzungsregie quick actions): talent name, modifier, note path for hero ordering */
  constructor(private plugin: DsaMeisterwerkzeugPlugin, private opts: ProbeModalOptions = {}) {
    super(plugin.app);
  }
  onOpen() {
    this.owner.load();
    this.titleEl.setText("Probe würfeln");
    const sourcePath = this.opts.sourcePath ?? this.plugin.app.workspace.getActiveFile()?.path ?? "";
    const { primary, others } = orderedHeroChoices(this.plugin, sourcePath);
    const choices = [...primary, ...others];

    const pre = this.opts.talent ? findTalent(this.opts.talent) : null;
    let talent: TalentDef | null = pre && pre.ok ? pre.talent : null;
    let modifier = this.opts.modifier ?? 0;
    let selValue = choices[0] ? `hero:${choices[0].uid}` : "manual";
    const manual: { attrs: [number, number, number]; fw: number } = { attrs: [12, 12, 12], fw: 0 };

    new Setting(this.contentEl).setName("Talent").addText((t) => {
      t.setPlaceholder("Talent suchen …");
      if (this.opts.talent) t.setValue(talent?.name ?? this.opts.talent);
      new TalentSuggest(this.app, t.inputEl, (x) => (talent = x));
      t.onChange((v) => {
        const f = findTalent(v);
        talent = f.ok ? f.talent : null;
      });
    });
    new Setting(this.contentEl)
      .setName("Modifikator")
      .setDesc("+ = leichter, - = schwerer")
      .addText((t) => {
        t.inputEl.type = "number";
        t.setValue(String(modifier)).onChange((v) => (modifier = Math.trunc(Number(v) || 0)));
      });
    new Setting(this.contentEl).setName("Held").addDropdown((d) => {
      for (const h of choices) d.addOption(`hero:${h.uid}`, h.name);
      if (choices.length > 1) d.addOption("all", "Alle Helden");
      d.addOption("manual", "Ohne Held (manuell)");
      d.setValue(selValue).onChange((v) => {
        selValue = v;
        manualBox.toggle(v === "manual");
      });
    });
    const manualBox = this.contentEl.createDiv({ cls: "dsa-probe-manual" });
    manualBox.toggle(selValue === "manual");
    ["Eigenschaft 1", "Eigenschaft 2", "Eigenschaft 3"].forEach((l, i) =>
      new Setting(manualBox).setName(l).addText((t) => {
        t.inputEl.type = "number";
        t.setValue("12").onChange((v) => (manual.attrs[i] = Number(v) || 0));
      }),
    );
    new Setting(manualBox).setName("FW").addText((t) => {
      t.inputEl.type = "number";
      t.setValue("0").onChange((v) => (manual.fw = Math.max(0, Number(v) || 0)));
    });

    const out = this.contentEl.createDiv({ cls: "dsa-probe-modal-out" });
    new Setting(this.contentEl).addButton((b) =>
      b
        .setButtonText("Würfeln")
        .setCta()
        .onClick(() => {
          if (!talent) return void new Notice("Bitte ein gültiges Talent wählen.");
          let sel: Selection;
          if (selValue === "all") sel = { kind: "all" };
          else if (selValue === "manual") sel = { kind: "manual", attrs: [...manual.attrs] as [number, number, number], fw: manual.fw };
          else {
            const uid = selValue.slice(5);
            rememberHero(uid);
            sel = { kind: "hero", uid };
          }
          this.view?.destroy();
          out.empty();
          const host = out.createDiv();
          this.view = new ProbeView(this.plugin, host, { talent, modifier, outcomes: [], failure: [] }, sourcePath, this.owner, { withButton: false });
          this.view.roll(sel);
        }),
    );
  }
  onClose() {
    this.view?.destroy();
    this.owner.unload();
    this.contentEl.empty();
  }
}
