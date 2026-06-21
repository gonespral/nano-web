// Declarative keyboard-shortcut config: one binding table per "context"
// (which screen/mode is active). This is the single source of truth for
// both *behavior* (matched by useShortcuts) and the on-screen legend
// (rendered by ShortcutBar) — change a key or its label here and both
// follow automatically.
//
// A binding is { when, action, display }:
//   when    — (KeyboardEvent) => boolean
//   action  — string key looked up in the `actions` object a component
//             passes to useShortcuts(context, actions)
//   display — [key, label] shown in the ShortcutBar, or null to keep the
//             binding active without showing it (matches real nano,
//             which only surfaces a curated subset in its bottom bar).
//             Within a context, array order also doubles as display
//             priority — ShortcutBar shows a prefix of this list and
//             drops the tail when the bar is too narrow or capped, so
//             list your most important shortcuts first.

export const when = {
  // Ctrl+<key>, with no Alt/Meta/Shift (Shift is excluded so this can't
  // shadow a ctrlShift binding on the same letter, e.g. Ctrl+Z vs.
  // Ctrl+Shift+Z).
  ctrl: (k) => (e) => e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === k,
  // Ctrl+Shift+<key>, with no Alt/Meta.
  ctrlShift: (k) => (e) =>
    e.ctrlKey && e.shiftKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === k,
  // Alt+<key> ("M-<key>" in nano's notation), with no Ctrl/Meta.
  alt: (k) => (e) => e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === k,
  // Plain <key>, no modifiers at all (Shift is ignored on purpose for
  // letters like the file-manager's n/r/d).
  plain: (k) => (e) => !e.ctrlKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === k,
  // Shift+<namedKey>, e.g. Shift+Tab, with no Ctrl/Alt/Meta.
  shiftPlain: (k) => (e) => e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && e.key === k,
  // Raw e.key match, ignoring modifiers — for named keys like Escape.
  key: (k) => (e) => e.key === k,
  // Letter match ignoring modifiers — for lightweight y/n confirms.
  any: (k) => (e) => e.key.toLowerCase() === k,
};

// Bindings shared by more than one context.
const GO_HELP = { when: when.ctrl("g"), action: "openHelp", display: ["^G", "Get Help"] };
const GO_FILES = { when: when.ctrl("r"), action: "openFiles", display: ["^R", "Files"] };
const NEXT_TAB = { when: when.shiftPlain("Tab"), action: "cycleNext", display: ["Shift+Tab", "Next Tab"] };
const CLOSE_TAB = { when: when.alt("x"), action: "closeTab", display: ["Alt+X", "Close"] };
const CANCEL_PROMPT = { when: when.key("Escape"), action: "cancelPrompt", display: ["Esc", "Cancel"] };

export const SHORTCUT_CONTEXTS = {
  // A normal, editable file buffer.
  file: [
    GO_HELP,
    GO_FILES,
    { when: when.alt("r"), action: "startReplace", display: ["Alt+R", "Replace"] },
    NEXT_TAB,
    CLOSE_TAB,
    { when: when.ctrl("o"), action: "startWriteOut", display: ["^O", "Write Out"] },
    { when: when.ctrl("f"), action: "startSearch", display: ["^F", "Where Is"] },
    { when: when.ctrl("k"), action: "cutLine", display: ["^K", "Cut Text"] },
    { when: when.ctrl("c"), action: "copyText", display: ["^C", "Copy"] },
    { when: when.ctrl("v"), action: "pasteLine", display: ["^V", "Paste"] },
    { when: when.ctrl("j"), action: "justify", display: ["^J", "Justify"] },
    { when: when.ctrl("z"), action: "undo", display: ["^Z", "Undo"] },
    { when: when.ctrlShift("z"), action: "redo", display: ["Shift+^Z", "Redo"] },
    { when: when.alt("/"), action: "toggleComment", display: null },
    { when: when.ctrl("enter"), action: "toggleChecklist", display: null },
    { when: when.plain("enter"), action: "insertNewline", display: null },
    { when: when.plain("tab"), action: "indentOrTab", display: null },
  ],

  // The read-only Help tab.
  help: [GO_HELP, GO_FILES, NEXT_TAB],

  // The file-manager tab, file list focused (no delete pending).
  files: [
    GO_HELP,
    NEXT_TAB,
    { when: when.key("ArrowUp"), action: "filesMoveUp", display: null },
    { when: when.key("ArrowDown"), action: "filesMoveDown", display: ["Up/Dn", "Select"] },
    { when: when.key("Enter"), action: "filesOpenSelected", display: ["Enter", "Open"] },
    { when: when.plain("n"), action: "filesNewFile", display: ["N", "New File"] },
    { when: when.plain("r"), action: "filesRenameSelected", display: ["R", "Rename"] },
    { when: when.plain("d"), action: "filesDeleteSelected", display: ["D", "Delete"] },
  ],

  // y/n confirmation: about to delete a saved file.
  "confirm-delete-file": [
    { when: when.any("y"), action: "confirmDeleteYes", display: ["Y", "Delete"] },
    { when: when.any("n"), action: "confirmDeleteNo", display: ["N / Esc", "Cancel"] },
    { when: when.key("Escape"), action: "confirmDeleteNo", display: null },
  ],

  // y/n/^C confirmation: closing a modified buffer.
  "confirm-exit": [
    { when: when.any("y"), action: "confirmExitYes", display: ["Y", "Save & Close"] },
    { when: when.any("n"), action: "confirmExitNo", display: ["N", "Discard"] },
    { when: when.key("Escape"), action: "confirmExitCancel", display: ["Esc / ^C", "Cancel"] },
    { when: when.ctrl("c"), action: "confirmExitCancel", display: null },
  ],

  "prompt-save": [
    { when: when.key("Enter"), action: "submitSave", display: ["Enter", "Write"] },
    CANCEL_PROMPT,
  ],
  "prompt-search": [
    { when: when.key("Enter"), action: "submitSearch", display: ["Enter", "Find"] },
    CANCEL_PROMPT,
  ],
  "prompt-replace-search": [
    { when: when.key("Enter"), action: "submitReplaceSearch", display: ["Enter", "Next"] },
    CANCEL_PROMPT,
  ],
  "prompt-replace-with": [
    { when: when.key("Enter"), action: "submitReplaceWith", display: ["Enter", "Replace All"] },
    CANCEL_PROMPT,
  ],
  "prompt-new-file": [
    { when: when.key("Enter"), action: "submitNewFile", display: ["Enter", "Create"] },
    CANCEL_PROMPT,
  ],
  "prompt-rename-file": [
    { when: when.key("Enter"), action: "submitRename", display: ["Enter", "Rename"] },
    CANCEL_PROMPT,
  ],
};
