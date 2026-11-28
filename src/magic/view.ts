// Inline button for `zauber: ...` / `liturgie: ...`.
import type DsaMeisterwerkzeugPlugin from "../main";
import { CastModal } from "./dialog";
import { parseMagic } from "./parse";

export function mountMagic(plugin: DsaMeisterwerkzeugPlugin, raw: string): HTMLElement {
  const parsed = parseMagic(raw);
  const el = createSpan();
  el.addClass("dsa-probe", "dsa-magic");
  if (!parsed.ok) {
    el.addClass("dsa-probe-error");
    el.setText(`⚠ ${parsed.error}`);
    el.title = raw;
    return el;
  }
  const s = parsed.spec;
  const mod = s.modifier ? ` ${s.modifier > 0 ? "+" : ""}${s.modifier}` : "";
  const btn = el.createEl("button", { cls: "dsa-probe-btn dsa-magic-btn", text: `${s.kind === "zauber" ? "✨" : "🙏"} ${s.name}${mod}` });
  btn.title = s.hero ? `${s.name} – ${s.hero}` : s.name;
  btn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    new CastModal(plugin, { spell: s.name, kind: s.kind, modifier: s.modifier, casterName: s.hero ?? undefined }).open();
  });
  return el;
}
