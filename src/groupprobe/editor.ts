// Live preview: replace inline `gruppenprobe: ...` etc. with the button (cursor outside). Mechanism copied from src/probe/editor.ts.
import { RangeSetBuilder } from "@codemirror/state";
import type { Text } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { editorLivePreviewField } from "obsidian";
import type DsaMeisterwerkzeugPlugin from "../main";
import { isGroupProbeCode } from "./parse";
import { mountGroupProbe } from "./view";

class GroupProbeWidget extends WidgetType {
  constructor(private plugin: DsaMeisterwerkzeugPlugin, readonly raw: string, readonly sourcePath: string) {
    super();
  }
  eq(other: GroupProbeWidget) {
    return other.raw === this.raw && other.sourcePath === this.sourcePath;
  }
  toDOM() {
    return mountGroupProbe(this.plugin, this.raw, this.sourcePath);
  }
  ignoreEvent() {
    return true;
  }
}

const INLINE_CODE = /(?<!`)`([^`\n]+)`(?!`)/g;
const LINE_HINT = /`\s*(gruppensammelprobe|gruppenprobe|sammelprobe)\s*:/i;

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

export function groupProbeEditorExtension(plugin: DsaMeisterwerkzeugPlugin) {
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
            if (!LINE_HINT.test(line.text)) continue;
            INLINE_CODE.lastIndex = 0;
            let m: RegExpExecArray | null;
            let fenced: boolean | null = null;
            while ((m = INLINE_CODE.exec(line.text))) {
              if (!isGroupProbeCode(m[1])) continue;
              fenced ??= insideFence(doc, line.number);
              if (fenced) break;
              const a = line.from + m.index;
              const z = a + m[0].length;
              if (sel.ranges.some((r) => r.from <= z && r.to >= a)) continue;
              b.add(a, z, Decoration.replace({ widget: new GroupProbeWidget(plugin, m[1], sourcePath) }));
            }
          }
        }
        return b.finish();
      }
    },
    { decorations: (v) => v.decorations },
  );
}
