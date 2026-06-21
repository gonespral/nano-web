import { SHORTCUT_CONTEXTS } from "../shortcuts.js";

// Derives the legend straight from shortcuts.js — the same table that
// drives actual key handling (useShortcuts), so this can never drift out
// of sync with what's really bound. Only bindings with a `display` show
// up here; others stay active but stay out of the bar (matching nano).
const DISPLAY_SETS = Object.fromEntries(
  Object.entries(SHORTCUT_CONTEXTS).map(([context, bindings]) => [
    context,
    bindings.map((b) => b.display).filter(Boolean),
  ])
);

const COLUMNS = 4;
// Keep the bar's height constant across contexts so switching tabs/modes
// doesn't jitter the layout.
const ROWS = Math.max(...Object.values(DISPLAY_SETS).map((set) => Math.ceil(set.length / COLUMNS)));

export default function ShortcutBar({ kind = "file" }) {
  const shortcuts = DISPLAY_SETS[kind] ?? DISPLAY_SETS.file;
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
