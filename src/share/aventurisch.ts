// "Aventurisch" style of the player view: same PlayerView, different renderer.
// Builds a small node tree (pure, testable, no DOM) that is then mounted into the element or serialised to HTML for tests.
import type { PlayerRow, PlayerView } from "./viewModel";

export interface VNode {
  tag: string;
  cls?: string;
  text?: string;
  attrs?: Record<string, string>;
  /** CSS custom properties, set via setCssProps when mounted (no inline style attribute) */
  props?: Record<string, string>;
  children?: VNode[];
  svg?: boolean;
}

const SVG_NS = "http://www.w3.org/2000/svg";

const h = (tag: string, cls?: string, children: (VNode | null | false)[] = [], text?: string, attrs?: Record<string, string>): VNode => ({
  tag,
  cls,
  text,
  attrs,
  children: children.filter((c): c is VNode => !!c),
});
const t = (tag: string, cls: string, text: string): VNode => ({ tag, cls, text });
const svg = (tag: string, attrs: Record<string, string>, children: VNode[] = []): VNode => ({ tag, attrs, children, svg: true });

/** Roman numerals 1..3999; 0 and invalid values stay "0". */
export function toRoman(n: number): string {
  if (!Number.isFinite(n) || n <= 0 || n >= 4000) return String(Math.max(0, Math.trunc(n) || 0));
  const map: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let r = Math.trunc(n);
  let out = "";
  for (const [v, s] of map) while (r >= v) { out += s; r -= v; }
  return out;
}

const flourish = (corner: string): VNode =>
  svg("svg", { class: `dsa-psa-corner dsa-psa-corner-${corner}`, viewBox: "0 0 60 60", "aria-hidden": "true" }, [
    svg("path", { d: "M3 57 V12 Q3 3 12 3 H57", fill: "none", stroke: "currentColor", "stroke-width": "2.2" }),
    svg("path", { d: "M10 57 V18 Q10 10 18 10 H57", fill: "none", stroke: "currentColor", "stroke-width": "0.9" }),
    svg("path", { d: "M16 16 q8 0 8 8 q0 -6 -6 -6 q-4 0 -2 -2z M24 8 q6 4 2 10 q1 -5 -4 -7z M8 24 q4 6 10 2 q-5 1 -7 -4z", fill: "currentColor" }),
    svg("circle", { cx: "5", cy: "5", r: "2.6", fill: "currentColor" }),
  ]);

const shield = (hero: boolean): VNode =>
  hero
    ? svg("svg", { class: "dsa-psa-crest", viewBox: "0 0 40 48", "aria-hidden": "true" }, [
        svg("path", { d: "M20 2 L37 8 V24 Q37 38 20 46 Q3 38 3 24 V8 Z", class: "dsa-crest-body" }),
        svg("path", { d: "M20 8 V40 M8 20 H32", class: "dsa-crest-line" }),
      ])
    : svg("svg", { class: "dsa-psa-crest", viewBox: "0 0 40 48", "aria-hidden": "true" }, [
        svg("path", { d: "M2 6 L10 10 L20 2 L30 10 L38 6 L35 26 L20 46 L5 26 Z", class: "dsa-crest-body" }),
        svg("path", { d: "M12 14 L28 34 M28 14 L12 34", class: "dsa-crest-line" }),
      ]);

const seal = (): VNode =>
  svg("svg", { class: "dsa-psa-seal", viewBox: "0 0 40 40", "aria-hidden": "true" }, [
    svg("path", { d: "M20 2 q5 0 8 4 q6 0 8 6 q4 4 2 9 q3 5 -1 10 q-1 6 -7 7 q-3 5 -9 4 q-6 1 -9 -4 q-6 -1 -7 -7 q-4 -5 -1 -10 q-2 -5 2 -9 q2 -6 8 -6 q3 -4 8 -4z", class: "dsa-seal-wax" }),
    svg("circle", { cx: "20", cy: "20", r: "11", class: "dsa-seal-ring" }),
    svg("path", { d: "M20 11 L22.6 17.4 L29 17.8 L24 22 L25.7 28.4 L20 24.9 L14.3 28.4 L16 22 L11 17.8 L17.4 17.4 Z", class: "dsa-seal-star" }),
  ]);

const ornament = (): VNode => t("div", "dsa-psa-orn", "❦ ✦ ❦");

function healthNodes(r: PlayerRow): (VNode | null)[] {
  const out: (VNode | null)[] = [];
  if (r.word) out.push(t("div", `dsa-psa-ribbon dsa-psa-word-${r.word.replace(/ /g, "-")}`, r.word));
  if (r.barPct !== null) {
    if (r.isHero) {
      const full = Math.ceil(Math.max(0, Math.min(100, r.barPct)) / 10);
      const hearts = Array.from({ length: 10 }, (_, i) => t("span", i < full ? "dsa-psa-heart on" : "dsa-psa-heart", "♥"));
      out.push(h("div", "dsa-psa-hearts", hearts, undefined, { "aria-hidden": "true" }));
    }
    const fillCls = r.barPct > 50 ? "ok" : r.barPct > 25 ? "warn" : "crit";
    out.push(
      h("div", "dsa-psa-bar", [
        { tag: "div", cls: `dsa-psa-fill ${fillCls}`, props: { "--dsa-fill": `${Math.round(r.barPct)}%` } },
        r.lepText ? t("span", "dsa-psa-bartext", r.lepText) : null,
      ]),
    );
  }
  return out;
}

function bannerNode(r: PlayerRow, i: number): VNode {
  const cls = ["dsa-psa-banner", r.isHero ? "is-hero" : "is-foe", r.current && "is-current", r.next && "is-next", r.down && "is-down", r.placeholder && "is-hidden"].filter(Boolean).join(" ");
  const head = h("div", "dsa-psa-head", [
    r.placeholder ? t("span", "dsa-psa-crest dsa-psa-crest-blank", "?") : shield(r.isHero),
    t("span", "dsa-psa-name", r.name),
    r.down && !r.placeholder ? t("span", "dsa-psa-skull", "☠") : null,
    r.current ? t("span", "dsa-psa-tag dsa-psa-tag-now", "am Zug") : r.next ? t("span", "dsa-psa-tag", "als Nächstes") : null,
    t("span", "dsa-psa-spacer", ""),
    r.ini ? t("span", "dsa-psa-ini", r.ini) : null,
  ]);
  const runes: VNode[] = [];
  if (!r.placeholder) {
    if (r.isHero && r.schmerz > 0) runes.push(t("span", "dsa-psa-rune", `Schmerz ${toRoman(r.schmerz)}`));
    for (const s of r.states) runes.push(t("span", "dsa-psa-rune", `${s.label} ${toRoman(s.level)}`));
    for (const e of r.effects ?? []) runes.push(t("span", "dsa-psa-rune dsa-psa-rune-fx", e));
  }
  return h("li", cls, [
    r.current ? seal() : null,
    h("div", "dsa-psa-body", [head, ...(r.placeholder ? [] : healthNodes(r)), runes.length ? h("div", "dsa-psa-runes", runes) : null]),
  ], undefined, { "data-pos": String(i + 1) });
}

/** Whole view as a node tree. */
export function buildAventurischTree(view: PlayerView): VNode {
  const corners = ["tl", "tr", "bl", "br"].map(flourish);
  const root = (children: (VNode | null)[]) => h("div", "dsa-psa-page", [...corners, ...children]);
  if (view.empty) {
    return root([h("div", "dsa-psa-empty", [ornament(), t("div", "dsa-psa-empty-title", "Die Waffen ruhen …"), t("div", "dsa-psa-empty-sub", "Noch ist kein Kampf entbrannt."), ornament()])]);
  }
  const roman = toRoman(view.round);
  return root([
    h("header", "dsa-psa-header", [
      t("div", "dsa-psa-kicker", "Kampfrunde"),
      h("div", "dsa-psa-round", [t("span", "dsa-psa-dropcap", roman.charAt(0)), t("span", "dsa-psa-roman", roman.slice(1))], undefined, { "aria-label": `Kampfrunde ${view.round}` }),
      ornament(),
    ]),
    h("ol", "dsa-psa-list", view.rows.map(bannerNode)),
  ]);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Serialise a tree to HTML (tests; also a faithful picture of what is mounted). */
export function toHtml(n: VNode): string {
  const style = n.props ? Object.entries(n.props).map(([k, v]) => `${k}:${v}`).join(";") : "";
  const attrs = { ...(n.attrs ?? {}), ...(n.cls ? { class: n.cls } : {}), ...(style ? { style } : {}) };
  const a = Object.entries(attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join("");
  return `<${n.tag}${a}>${n.text ? esc(n.text) : ""}${(n.children ?? []).map(toHtml).join("")}</${n.tag}>`;
}

function mount(doc: Document, parent: Element, n: VNode): void {
  const el = n.svg ? doc.createElementNS(SVG_NS, n.tag) : doc.createElement(n.tag);
  if (n.cls) el.setAttribute("class", n.cls);
  for (const [k, v] of Object.entries(n.attrs ?? {})) el.setAttribute(k, v);
  const setProps = (el as Partial<HTMLElement>).setCssProps;
  if (n.props && setProps) setProps.call(el, n.props);
  if (n.text) el.textContent = n.text;
  parent.appendChild(el);
  for (const c of n.children ?? []) mount(doc, el, c);
}

/** DOM rendering (popout-safe: uses the element's own document). */
export function renderAventurisch(el: HTMLElement, view: PlayerView): void {
  el.empty();
  el.removeClass("dsa-ps");
  el.addClass("dsa-psa");
  mount(el.ownerDocument, el, buildAventurischTree(view));
}
