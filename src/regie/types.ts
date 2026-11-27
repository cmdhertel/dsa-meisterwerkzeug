// Sitzungsregie: shared data shapes of the note digest (pure, no obsidian imports).

/** A markdown task line. `line` is the 0-based line in the full file text (frontmatter included). */
export interface TaskItem {
  line: number;
  /** text without the "- [ ] " prefix */
  text: string;
  checked: boolean;
  /** nearest heading above ("" if none) */
  heading: string;
}

/** A fenced fight block (`dsa-kampf` or `encounter`). */
export interface BlockRef {
  kind: "dsa-kampf" | "encounter";
  /** line of the opening fence */
  line: number;
  /** block body (without fences, without callout quote prefixes) */
  source: string;
  /** `name:` of the block, else a short summary of the first creature lines, else "Kampf" */
  title: string;
}

export type ActionKind = "probe" | "gruppenprobe" | "sammelprobe" | "gruppensammelprobe" | "zauber" | "liturgie";

/** An inline code span that the plugin renders as an action (probe, spell, ...). */
export interface InlineAction {
  kind: ActionKind;
  /** code span content */
  raw: string;
  line: number;
}

export interface ReadAloud {
  title: string;
  /** plain markdown without the leading "> " */
  text: string;
  line: number;
}

export interface Fact {
  label: string;
  value: string;
}

export interface Section {
  heading: string;
  level: number;
  line: number;
}

export interface NoteDigest {
  /** first H1 text, "" if none */
  title: string;
  facts: Fact[];
  readAloud: ReadAloud[];
  tasks: TaskItem[];
  blocks: BlockRef[];
  actions: InlineAction[];
  /** wiki-link and embed targets (basename, no alias/heading/block/".md"), parallel to `linkPaths` */
  links: string[];
  /** same targets as written (path prefix kept, ".md" kept), parallel to `links` */
  linkPaths: string[];
  sections: Section[];
}

export interface Kurzprofil {
  auftreten: string;
  stimme: string;
  will: string;
  weiss: string;
  zitat: string;
  extra: Fact[];
}
