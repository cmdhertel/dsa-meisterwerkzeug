// Commands: start a group/Sammel probe ad hoc, insert inline syntax.
import { AbstractInputSuggest, App, Editor, Modal, Notice, Setting } from "obsidian";
import { TALENTS } from "../data/talents.generated";
import type { TalentDef } from "../engine/types";
import type DsaMeisterwerkzeugPlugin from "../main";
import { findTalent, normalizeTalentName } from "../probe/parse";
import { SAMMEL_DEFAULT_ATTEMPTS, SAMMEL_DEFAULT_TARGET } from "./constants";
import { GroupKind, KIND_LABEL, signed } from "./logic";
import type { GroupSpec } from "./parse";
import { GroupProbeModal } from "./view";

// duplicate of the TalentSuggest in src/probe/command.ts (not exported there)
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

const SYNTAX_PREFIX: Record<GroupKind, string> = { gruppe: "gruppenprobe", sammel: "sammelprobe", gruppensammel: "gruppensammelprobe" };

export function inlineSyntax(kind: GroupKind, talent: string, modifier: number, target: number, attempts: number, interval: string): string {
  const parts = [`${SYNTAX_PREFIX[kind]}: ${talent}${signed(modifier)}`];
  if (kind !== "gruppe") {
    parts.push(`Ziel ${target}`, `Versuche ${attempts}`);
    if (interval.trim()) parts.push(`Intervall ${interval.trim()}`);
  }
  return parts.join(" | ");
}

/** Setup dialog: talent (+ for Sammelproben target/attempts/interval); `onSubmit` is called with the values. */
class SetupModal extends Modal {
  constructor(
    app: App,
    private kind: GroupKind,
    private insert: boolean,
    private onSubmit: (v: { talent: TalentDef; modifier: number; target: number; attempts: number; interval: string }) => void,
  ) {
    super(app);
  }
  onOpen() {
    this.titleEl.setText(this.insert ? `${KIND_LABEL[this.kind]} einfügen` : `${KIND_LABEL[this.kind]}`);
    let talent: TalentDef | null = null;
    let modifier = 0;
    let target = SAMMEL_DEFAULT_TARGET;
    let attempts = SAMMEL_DEFAULT_ATTEMPTS;
    let interval = "";
    new Setting(this.contentEl).setName("Talent").addText((t) => {
      t.setPlaceholder("Talent suchen …");
      new TalentSuggest(this.app, t.inputEl, (x) => (talent = x));
      t.onChange((v) => {
        const f = findTalent(v);
        talent = f.ok ? f.talent : null;
      });
      window.setTimeout(() => t.inputEl.focus(), 0);
    });
    const num = (name: string, desc: string, init: number, set: (n: number) => void) =>
      new Setting(this.contentEl).setName(name).setDesc(desc).addText((t) => {
        t.inputEl.type = "number";
        t.setValue(String(init)).onChange((v) => set(Math.trunc(Number(v) || 0)));
      });
    num("Modifikator", "+ = leichter, - = schwerer", 0, (n) => (modifier = n));
    if (this.kind !== "gruppe") {
      num("Ziel (QS)", "", target, (n) => (target = Math.max(1, n)));
      num("Versuche", "", attempts, (n) => (attempts = Math.max(1, n)));
      new Setting(this.contentEl).setName("Intervall").setDesc("z. B. 1 Stunde").addText((t) => t.onChange((v) => (interval = v)));
    }
    new Setting(this.contentEl).addButton((b) =>
      b
        .setButtonText(this.insert ? "Einfügen" : "Weiter")
        .setCta()
        .onClick(() => {
          if (!talent) return void new Notice("Bitte ein gültiges Talent wählen.");
          this.close();
          this.onSubmit({ talent, modifier, target, attempts, interval });
        }),
    );
  }
  onClose() {
    this.contentEl.empty();
  }
}

export function startAdHoc(plugin: DsaMeisterwerkzeugPlugin, kind: GroupKind): void {
  new SetupModal(plugin.app, kind, false, (v) => {
    const spec: GroupSpec = {
      kind,
      talent: v.talent,
      modifier: v.modifier,
      target: kind === "gruppe" ? null : v.target,
      maxAttempts: v.attempts,
      interval: v.interval.trim(),
      qsTexts: [],
      elseTexts: [],
      successTexts: [],
      doneText: [],
      failText: [],
      partialText: [],
    };
    new GroupProbeModal(plugin, spec, plugin.app.workspace.getActiveFile()?.path ?? "", null).open();
  }).open();
}

export function registerGroupProbeCommands(plugin: DsaMeisterwerkzeugPlugin): void {
  plugin.addCommand({ id: "gruppenprobe-wuerfeln", name: "Proben: Gruppenprobe würfeln", callback: () => startAdHoc(plugin, "gruppe") });
  plugin.addCommand({ id: "sammelprobe-starten", name: "Proben: Sammelprobe starten", callback: () => startAdHoc(plugin, "sammel") });
  plugin.addCommand({ id: "gruppensammelprobe-starten", name: "Proben: Gruppensammelprobe starten", callback: () => startAdHoc(plugin, "gruppensammel") });
  plugin.addCommand({
    id: "gruppenprobe-einfuegen",
    name: "Proben: Gruppen-/Sammelprobe einfügen",
    editorCallback: (editor: Editor) => {
      const kinds = [
        ["gruppe", "Gruppenprobe"],
        ["sammel", "Sammelprobe"],
        ["gruppensammel", "Gruppensammelprobe"],
      ] as const;
      // kind chooser as tiny modal
      const m = new Modal(plugin.app);
      m.titleEl.setText("Welche Probe einfügen?");
      for (const [k, label] of kinds)
        new Setting(m.contentEl).setName(label).addButton((b) =>
          b.setButtonText("Wählen").onClick(() => {
            m.close();
            new SetupModal(plugin.app, k, true, (v) => {
              editor.replaceSelection("`" + inlineSyntax(k, v.talent.name, v.modifier, v.target, v.attempts, v.interval) + "`");
            }).open();
          }),
        );
      m.open();
    },
  });
}
