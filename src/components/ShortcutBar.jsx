import { useLayoutEffect, useRef, useState } from "react";
import { SHORTCUT_CONTEXTS } from "../shortcuts.js";

// Derives the legend straight from shortcuts.js — the same table that
// drives actual key handling (useShortcuts), so this can never drift out
// of sync with what's really bound. Only bindings with a `display` show
// up here; others stay active but stay out of the bar (matching nano).
// Within a context, array order *is* priority: when there isn't room to
// show everything, the bar keeps a prefix of this list and drops the
// rest — so put the shortcuts you most want visible first in shortcuts.js.
const DISPLAY_SETS = Object.fromEntries(
  Object.entries(SHORTCUT_CONTEXTS).map(([context, bindings]) => [
    context,
    bindings.map((b) => b.display).filter(Boolean),
  ])
);

// The bar is always exactly this many rows tall, no matter the context or
// the viewport width, so switching tabs/modes or resizing the window never
// jitters the layout.
const ROWS = 2;
// Hard cap on how many shortcuts are ever shown, regardless of how much
// width is available. Raise/lower this to change the legend's density.
const MAX_VISIBLE = 12;
// Below this width per item, a column gets dropped rather than squeezed —
// keeps key+label legible instead of ellipsizing into nothing.
const MIN_ITEM_WIDTH = 130;
// Never compute more columns than MAX_VISIBLE could ever fill across ROWS.
const MAX_COLUMNS = Math.ceil(MAX_VISIBLE / ROWS);

// Tracks the bar's own width (not the viewport's) so the column count
// adapts correctly even if the bar is ever embedded somewhere narrower
// than the full window.
function useContainerWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

export default function ShortcutBar({ kind = "file" }) {
  const [containerRef, width] = useContainerWidth();
  const shortcuts = DISPLAY_SETS[kind] ?? DISPLAY_SETS.file;

  const columns = Math.min(MAX_COLUMNS, Math.max(1, Math.floor(width / MIN_ITEM_WIDTH)));
  const visible = shortcuts.slice(0, Math.min(MAX_VISIBLE, columns * ROWS));

  const rows = [];
  for (let r = 0; r < ROWS; r++) {
    const row = [];
    for (let c = 0; c < columns; c++) {
      row.push(visible[r * columns + c] ?? null);
    }
    rows.push(row);
  }

  return (
    <div className="nano-shortcutbar" ref={containerRef}>
      {rows.map((row, i) => (
        <div className="nano-shortcut-row" key={i}>
          {row.map((entry, j) =>
            entry ? (
              <div className="nano-shortcut" key={entry[0]}>
                <span className="key">{entry[0]}</span>
                <span className="label">{entry[1]}</span>
              </div>
            ) : (
              <div className="nano-shortcut" aria-hidden="true" style={{ visibility: "hidden" }} key={`pad-${j}`}>
                <span className="key">&nbsp;</span>
                <span className="label">&nbsp;</span>
              </div>
            )
          )}
        </div>
      ))}
    </div>
  );
}
