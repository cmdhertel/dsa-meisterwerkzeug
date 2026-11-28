// Plugin code uses window.setTimeout & co. (popout-window safe, as Obsidian
// recommends). Tests run in Node, which has no window, so alias it to globalThis.
if (typeof window === "undefined") Object.assign(globalThis, { window: globalThis });
