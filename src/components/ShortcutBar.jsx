const EDIT_SHORTCUTS = [
  ["^G", "Get Help"],
  ["^O", "Write Out"],
  ["Alt+R", "Files"],
  ["^F", "Where Is"],
  ["^K", "Cut Text"],
  ["^U", "Paste"],
  ["^C", "Cur Pos"],
  ["^J", "Justify"],
  ["Alt+U", "Undo"],
  ["Alt+E", "Redo"],
  ["Alt+X", "Close"],
];

const HELP_SHORTCUTS = [
  ["Alt+R", "Files"],
  ["Shift+Tab", "Next Tab"],
];

const FILES_SHORTCUTS = [
  ["Up/Dn", "Select"],
  ["Enter", "Open"],
  ["N", "New File"],
  ["R", "Rename"],
  ["D", "Delete"],
  ["Shift+Tab", "Next Tab"],
];

const SAVE_SHORTCUTS = [
  ["Enter", "Write"],
  ["Esc", "Cancel"],
];

const SEARCH_SHORTCUTS = [
  ["Enter", "Find"],
  ["Esc", "Cancel"],
];

const NEW_FILE_SHORTCUTS = [
  ["Enter", "Create"],
  ["Esc", "Cancel"],
];

const RENAME_SHORTCUTS = [
  ["Enter", "Rename"],
  ["Esc", "Cancel"],
];

const CONFIRM_EXIT_SHORTCUTS = [
  ["Y", "Save & Close"],
  ["N", "Discard"],
  ["Esc / ^C", "Cancel"],
];

const CONFIRM_DELETE_SHORTCUTS = [
  ["Y", "Delete"],
  ["N / Esc", "Cancel"],
];

const SHORTCUT_SETS = {
  file: EDIT_SHORTCUTS,
  help: HELP_SHORTCUTS,
  files: FILES_SHORTCUTS,
  "confirm-exit": CONFIRM_EXIT_SHORTCUTS,
  "confirm-delete-file": CONFIRM_DELETE_SHORTCUTS,
  "prompt-save": SAVE_SHORTCUTS,
  "prompt-search": SEARCH_SHORTCUTS,
  "prompt-new-file": NEW_FILE_SHORTCUTS,
  "prompt-rename-file": RENAME_SHORTCUTS,
};
const COLUMNS = 4;
const ROWS = Math.max(
  ...Object.values(SHORTCUT_SETS).map((set) => Math.ceil(set.length / COLUMNS))
);

export default function ShortcutBar({ kind = "file" }) {
  const shortcuts = SHORTCUT_SETS[kind] ?? EDIT_SHORTCUTS;
  const rows = [];
  for (let i = 0; i < ROWS * COLUMNS; i += COLUMNS) {
    rows.push(shortcuts.slice(i, i + COLUMNS));
  }

  return (
    <div className="nano-shortcutbar">
      {rows.map((row, i) => (
        <div className="nano-shortcut-row" key={i}>
          {row.map(([key, label]) => (
            <div className="nano-shortcut" key={key}>
              <span className="key">{key}</span>
              <span className="label">{label}</span>
            </div>
          ))}
          {Array.from({ length: COLUMNS - row.length }).map((_, j) => (
            <div className="nano-shortcut" aria-hidden="true" style={{ visibility: "hidden" }} key={`pad-${j}`}>
              <span className="key">&nbsp;</span>
              <span className="label">&nbsp;</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
