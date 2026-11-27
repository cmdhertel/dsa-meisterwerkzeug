// Live preview: replace inline `probe: ...` code with the probe button (cursor outside).
import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { Component, editorLivePreviewField } from "obsidian";
import type { Text } from "@codemirror/state";
import type DsaMeisterwerkzeugPlugin from "../main";
import { isProbeCode } from "./parse";
import { mountProbe, ProbeView } from "./view";

class ProbeWidget extends WidgetType {
  private owner: Component | null = null;
  private view: ProbeView | null = null;
  constructor(private plugin: DsaMeisterwerkzeugPlugin, readonly raw: string, readonly sourcePath: string) {
    super();
  }
  eq(other: ProbeWidget) {
    return other.raw === this.raw && other.sourcePath === this.sourcePath;
  }
  toDOM() {
    this.owner = new Component();
    this.owner.load();
    const { el, view } = mountProbe(this.plugin, this.raw, this.sourcePath, this.owner);
    this.view = view;
    return el;
  }
  destroy() {
    this.view?.destroy();
    this.owner?.unload();
  }
  ignoreEvent() {
    return true;
  }
}

const INLINE_CODE = /(?<!`)`([^`\n]+)`(?!`)/g;

/** true if `lineNo` (1-based) lies inside a fenced code block (``` or ~~~). */
export function insideFence(doc: Text, lineNo: number): boolean {
  let open: string | null = null;
  for (let n = 1; n < lineNo; n++) {
    const m = /^\s{0,3}(```+|~~~+)/.exec(doc.line(n).text);
    if (!m) continue;
    if (!open) open = m[1][0];
    else if (m[1][0] === open) open = null;
  }
  return open !== null;
}

export function probeEditorExtension(plugin: DsaMeisterwerkzeugPlugin) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || u.selectionSet || u.transactions.length) this.decorations = this.build(u.view);
      }
      build(view: EditorView): DecorationSet {
        const b = new RangeSetBuilder<Decoration>();
        if (!view.state.field(editorLivePreviewField, false)) return b.finish();
        const sourcePath = plugin.app.workspace.getActiveFile()?.path ?? "";
        const sel = view.state.selection;
        const doc = view.state.doc;
        let lastLine = -1;
        for (const { from, to } of view.visibleRanges) {
          let pos = from;
          while (pos <= to) {
            const line = doc.lineAt(pos);
            pos = line.to + 1;
            if (line.number <= lastLine) continue;
            lastLine = line.number;
            if (!/`\s*probe\s*:/i.test(line.text)) continue;
            INLINE_CODE.lastIndex = 0;
            let m: RegExpExecArray | null;
            let fenced: boolean | null = null;
            while ((m = INLINE_CODE.exec(line.text))) {
              if (!isProbeCode(m[1])) continue;
              fenced ??= insideFence(doc, line.number);
              if (fenced) break;
              const a = line.from + m.index;
              const z = a + m[0].length;
              if (sel.ranges.some((r) => r.from <= z && r.to >= a)) continue;
              b.add(a, z, Decoration.replace({ widget: new ProbeWidget(plugin, m[1], sourcePath) }));
            }
          }
        }
        return b.finish();
      }
    },
    { decorations: (v) => v.decorations },
  );
}
