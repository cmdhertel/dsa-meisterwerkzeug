// Live preview: replace inline `zauber: ...` / `liturgie: ...` code with the cast button (cursor outside).
import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { editorLivePreviewField } from "obsidian";
import type { Text } from "@codemirror/state";
import type DsaMeisterwerkzeugPlugin from "../main";
import { inlineCodeSpans } from "../probe/parse";
import { isMagicCode } from "./parse";
import { mountMagic } from "./view";

class MagicWidget extends WidgetType {
  constructor(private plugin: DsaMeisterwerkzeugPlugin, readonly raw: string) {
    super();
  }
  eq(o: MagicWidget) {
    return o.raw === this.raw;
  }
  toDOM() {
    return mountMagic(this.plugin, this.raw);
  }
  ignoreEvent() {
    return true;
  }
}

function insideFence(doc: Text, lineNo: number): boolean {
  let open: string | null = null;
  for (let n = 1; n < lineNo; n++) {
    const m = /^\s{0,3}(```+|~~~+)/.exec(doc.line(n).text);
    if (!m) continue;
    if (!open) open = m[1][0];
    else if (m[1][0] === open) open = null;
  }
  return open !== null;
}

export function magicEditorExtension(plugin: DsaMeisterwerkzeugPlugin) {
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
            if (!/`\s*(zauber|liturgie)\s*:/i.test(line.text)) continue;
            let fenced: boolean | null = null;
            for (const s of inlineCodeSpans(line.text)) {
              if (!isMagicCode(s.code)) continue;
              fenced ??= insideFence(doc, line.number);
              if (fenced) break;
              const a = line.from + s.from;
              const z = line.from + s.to;
              if (sel.ranges.some((r) => r.from <= z && r.to >= a)) continue;
              b.add(a, z, Decoration.replace({ widget: new MagicWidget(plugin, s.code) }));
            }
          }
        }
        return b.finish();
      }
    },
    { decorations: (v) => v.decorations },
  );
}
