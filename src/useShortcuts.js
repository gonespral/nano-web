import { useEffect, useRef } from "react";
import { SHORTCUT_CONTEXTS } from "./shortcuts.js";

// Registers exactly one window-level keydown listener (capture phase) for
// the given context's bindings. Capture + window (rather than a handler
// on some specific element) means it fires no matter what's focused —
// including nothing at all, which happens whenever the active tab has no
// textarea (e.g. the Files tab).
//
// `actions` may be a fresh object every render; only `context` changing
// tears down and re-adds the listener, so re-renders don't churn it.
export function useShortcuts(context, actions) {
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    const bindings = SHORTCUT_CONTEXTS[context] ?? [];
    if (bindings.length === 0) return;

    function onKeyDown(e) {
      const binding = bindings.find((b) => b.when(e));
      if (!binding) return;
      e.preventDefault();
      e.stopPropagation();
      actionsRef.current[binding.action]?.();
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [context]);
}
