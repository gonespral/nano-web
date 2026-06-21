import { useEffect, useRef, useState } from "react";
import TabBar from "./components/TabBar.jsx";
import EditArea from "./components/EditArea.jsx";
import FileManagerPane from "./components/FileManager.jsx";
import StatusLine from "./components/StatusLine.jsx";
import ShortcutBar from "./components/ShortcutBar.jsx";
import PromptBar from "./components/PromptBar.jsx";
import ExitedScreen from "./components/ExitedScreen.jsx";
import {
  cutLine,
  pasteAt,
  findNext,
  getLineCol,
  leadingWhitespace,
  indentLines,
  toggleLineComment,
  toggleChecklist,
  copyLineOrSelection,
  justifyParagraph,
  matchEditorShortcut,
} from "./nanoKeymap.js";
import { detectLanguage } from "./syntaxHighlight.js";

const STORAGE_KEY = "nano-web:buffers";
const FILES_STORAGE_KEY = "nano-web:files";
const TAB_SIZE = 4; // nanorc: set tabsize 4
const UNDO_LIMIT = 200;
const UNDO_COALESCE_MS = 700; // keystrokes within this window collapse into one undo step
const HELP_TEXT = [
  "nano-web help",
  "",
  "^G  Display this help text",
  "^O  Write the current buffer (trims trailing blanks, clears the modified flag)",
  "^F  Search for text (wraps around, repeat ^F to find next)",
  "Alt+R  Jump to the Files tab (arrows/mouse to browse, Enter/click to open,",
  "       N to create a file, R to rename, D to delete)",
  "^K  Cut from the cursor to the end of the line",
  "^U  Paste the last cut/copied text",
  "^C  Show the current cursor position (also shown live in the bar)",
  "^J  Justify (reflow) the current paragraph to 80 columns",
  "Alt+U  Undo the last change",
  "Alt+E  Redo the last undone change",
  "Alt+X  Close the current tab (prompts to save if modified)",
  "Enter  New line, auto-indented to match the line above",
  "Ctrl+Enter  Toggle the current line as a '- [ ]' checklist item, or check/uncheck it",
  "Tab  Indent the selected lines (or insert spaces at the cursor)",
  "Shift+Tab  Cycle to the next tab",
  "Alt+/  Toggle a // comment on the current line or selection",
  "Alt+W  Copy the selection (or current line) without cutting it",
  "",
  "The Help and Files tabs on the left are always there — they can't be",
  "closed, just switched away from. Closing a file's tab never deletes it;",
  "it stays in the Files tab until you delete it from there.",
  "",
  "Press ^G again to return here from any tab.",
].join("\n");

let nextBufferId = 1;
let nextFileId = 1;

function createBuffer(overrides = {}) {
  return {
    id: nextBufferId++,
    text: "",
    filename: "",
    modified: false,
    readOnly: false,
    fileId: null,
    ...overrides,
  };
}

function commonPrefixLength(a, b) {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i++;
  return i;
}

export default function App() {
  const [buffers, setBuffers] = useState([]);
  // activeId is either a buffer's numeric id, or one of the pinned-tab
  // sentinels "help" / "files". Land on the Files tab by default.
  const [activeId, setActiveId] = useState("files");
  // `files` is the durable store of saved files (backs the Files tab and
  // localStorage). `buffers` are just the currently open tabs — closing a
  // tab only removes it from `buffers`, never from `files`.
  const [files, setFiles] = useState([]);
  const [mode, setMode] = useState("edit");
  const [promptValue, setPromptValue] = useState("");
  const [status, setStatusText] = useState(
    "Welcome to nano-web — press ^G for help"
  );
  const [statusVariant, setStatusVariant] = useState("normal");
  const [cutBuffer, setCutBuffer] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [cursorInfo, setCursorInfo] = useState({ line: 1, col: 1 });
  const [hasSelection, setHasSelection] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);

  const [fmIndex, setFmIndex] = useState(0);
  const [fmConfirmDelete, setFmConfirmDelete] = useState(null);
  const [fmRenameTarget, setFmRenameTarget] = useState(null);

  const textareaRef = useRef(null);
  const promptInputRef = useRef(null);
  // Per-buffer undo/redo history. Kept outside React state since it's
  // write-heavy and never rendered directly.
  const undoStacksRef = useRef({});
  const redoStacksRef = useRef({});
  const lastEditRef = useRef({ bufferId: null, time: 0 });

  function setStatus(message) {
    setStatusText(message);
    setStatusVariant("normal");
  }

  // nano-style error messages: shown centered, white on red — e.g.
  // "[ Cutbuffer is empty ]" or "[ Nothing to undo ]".
  function setStatusError(message) {
    setStatusText(`[ ${message} ]`);
    setStatusVariant("error");
  }

  const isHelpTab = activeId === "help";
  const isFilesTab = activeId === "files";
  const active = isHelpTab || isFilesTab ? null : buffers.find((b) => b.id === activeId);
  const text = active?.text ?? (isHelpTab ? HELP_TEXT : "");
  const filename = active?.filename ?? (isHelpTab ? "Help" : isFilesTab ? "Files" : "");
  const modified = active?.modified ?? false;
  const isReadOnly = active?.readOnly ?? (isHelpTab || isFilesTab);

  useEffect(() => {
    try {
      const savedFiles = localStorage.getItem(FILES_STORAGE_KEY);
      const savedTabs = localStorage.getItem(STORAGE_KEY);

      let restoredFiles = [];
      if (savedFiles) {
        const parsedFiles = JSON.parse(savedFiles);
        if (Array.isArray(parsedFiles)) restoredFiles = parsedFiles;
      }

      let restoredTabs = null;
      let restoredActiveId = null;

      if (savedTabs) {
        const parsed = JSON.parse(savedTabs);
        if (Array.isArray(parsed.buffers) && parsed.buffers.length > 0) {
          const fileBuffers = parsed.buffers
            .filter((buffer) => !buffer.kind || buffer.kind === "file")
            .map((buffer) => ({
              ...buffer,
              readOnly: false,
              fileId: buffer.fileId ?? null,
            }));

          // Migrate pre-file-manager storage: tabs used to *be* the saved
          // files, so promote any named tab to a file record once.
          if (restoredFiles.length === 0) {
            fileBuffers.forEach((buffer) => {
              if (buffer.filename) {
                const fileId = nextFileId++;
                restoredFiles.push({ id: fileId, filename: buffer.filename, text: buffer.text });
                buffer.fileId = fileId;
              }
            });
          }

          if (fileBuffers.length > 0) {
            restoredTabs = fileBuffers;
            restoredActiveId = fileBuffers.some((buffer) => buffer.id === parsed.activeId)
              ? parsed.activeId
              : fileBuffers[0].id;
          }
        }
      }

      if (restoredFiles.length > 0) {
        nextFileId = Math.max(...restoredFiles.map((f) => f.id)) + 1;
        setFiles(restoredFiles);
      }
      if (restoredTabs) {
        nextBufferId = Math.max(...restoredTabs.map((b) => b.id)) + 1;
        setBuffers(restoredTabs);
        setActiveId(restoredActiveId);
      }
    } catch {
      // ignore corrupt/old storage payloads
    }
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    localStorage.setItem(FILES_STORAGE_KEY, JSON.stringify(files));
  }, [files, isHydrated]);

  useEffect(() => {
    if (!isHydrated) return;
    const activeFileId = buffers.some((buffer) => buffer.id === activeId) ? activeId : buffers[0]?.id ?? null;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ buffers, activeId: activeFileId }));
  }, [buffers, activeId, isHydrated]);

  function updateActiveBuffer(patch) {
    setBuffers((bs) =>
      bs.map((b) => (b.id === activeId ? { ...b, ...patch(b) } : b))
    );
  }

  function refocusEditor() {
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function syncCursor() {
    const el = textareaRef.current;
    if (!el) return;
    setCursorInfo(getLineCol(text, el.selectionStart));
    setHasSelection(el.selectionStart !== el.selectionEnd);
  }

  function setSelection(start, end) {
    requestAnimationFrame(() => {
      textareaRef.current?.setSelectionRange(start, end);
      syncCursor();
    });
  }

  // Records `prevText` (the text *before* the change about to be applied)
  // onto the undo stack. Plain typing coalesces into a single step within
  // UNDO_COALESCE_MS; discrete actions (cut, paste, justify, ...) always
  // get their own step. Any new edit clears the redo stack.
  function recordUndo(bufferId, prevText, { discrete = false } = {}) {
    if (bufferId == null) return;
    const stack = undoStacksRef.current[bufferId] ?? (undoStacksRef.current[bufferId] = []);
    const now = Date.now();
    const last = lastEditRef.current;
    const isContinuation = !discrete && last.bufferId === bufferId && now - last.time < UNDO_COALESCE_MS;
    if (!isContinuation) {
      stack.push(prevText);
      if (stack.length > UNDO_LIMIT) stack.shift();
    }
    lastEditRef.current = { bufferId, time: now };
    redoStacksRef.current[bufferId] = [];
  }

  function undo() {
    const stack = undoStacksRef.current[activeId];
    if (!stack || stack.length === 0) {
      setStatusError("Nothing to undo");
      return;
    }
    const prevText = stack.pop();
    const redoStack = redoStacksRef.current[activeId] ?? (redoStacksRef.current[activeId] = []);
    redoStack.push(text);
    const cursor = commonPrefixLength(text, prevText);
    updateActiveBuffer(() => ({ text: prevText, modified: true }));
    setSelection(cursor, cursor);
    setStatus("Undo");
    lastEditRef.current = { bufferId: null, time: 0 };
  }

  function redo() {
    const stack = redoStacksRef.current[activeId];
    if (!stack || stack.length === 0) {
      setStatusError("Nothing to redo");
      return;
    }
    const nextText = stack.pop();
    const undoStack = undoStacksRef.current[activeId] ?? (undoStacksRef.current[activeId] = []);
    undoStack.push(text);
    const cursor = commonPrefixLength(text, nextText);
    updateActiveBuffer(() => ({ text: nextText, modified: true }));
    setSelection(cursor, cursor);
    setStatus("Redo");
    lastEditRef.current = { bufferId: null, time: 0 };
  }

  function openHelpTab() {
    setActiveId("help");
    refocusEditor();
  }

  function openFileManagerTab() {
    setActiveId("files");
    setFmIndex(0);
    setFmConfirmDelete(null);
    refocusEditor();
  }

  function openFileFromManager(file) {
    if (!file) return;
    const existingTab = buffers.find((b) => b.fileId === file.id);
    if (existingTab) {
      setActiveId(existingTab.id);
    } else {
      const nb = createBuffer({ filename: file.filename, text: file.text, fileId: file.id });
      setBuffers((bs) => [...bs, nb]);
      setActiveId(nb.id);
    }
    refocusEditor();
  }

  // Excludes `excludeFileId` so renaming/resaving a file under the name it
  // already has isn't flagged as a clash with itself.
  function isNameTaken(name, excludeFileId = null) {
    return files.some((f) => f.filename === name && f.id !== excludeFileId);
  }

  function requestNewFile() {
    setPromptValue("");
    setMode("prompt-new-file");
  }

  function createNewFileFromPrompt(name) {
    const finalName = name.trim() || "New File";
    if (isNameTaken(finalName)) {
      setStatusError(`"${finalName}" already exists`);
      return false;
    }
    const file = { id: nextFileId++, filename: finalName, text: "" };
    setFiles((fs) => [...fs, file]);
    const nb = createBuffer({ filename: finalName, text: "", fileId: file.id });
    setBuffers((bs) => [...bs, nb]);
    setActiveId(nb.id);
    setStatus(`Created ${finalName}`);
    return true;
  }

  function requestRenameFile(file) {
    if (!file) return;
    setFmRenameTarget(file);
    setPromptValue(file.filename);
    setMode("prompt-rename-file");
  }

  function renameFileFromPrompt(name) {
    const finalName = name.trim();
    const target = fmRenameTarget;
    if (!finalName || !target) {
      setFmRenameTarget(null);
      return true;
    }
    if (isNameTaken(finalName, target.id)) {
      setStatusError(`"${finalName}" already exists`);
      return false;
    }
    setFmRenameTarget(null);
    setFiles((fs) => fs.map((f) => (f.id === target.id ? { ...f, filename: finalName } : f)));
    setBuffers((bs) => bs.map((b) => (b.fileId === target.id ? { ...b, filename: finalName } : b)));
    setStatus(`Renamed to ${finalName}`);
    return true;
  }

  function requestDeleteFile(file) {
    if (!file) return;
    setFmConfirmDelete(file);
  }

  function deleteFile(file) {
    setBuffers((bs) => {
      const idx = bs.findIndex((b) => b.fileId === file.id);
      const next = bs.filter((b) => b.fileId !== file.id);
      if (idx !== -1) {
        delete undoStacksRef.current[bs[idx].id];
        delete redoStacksRef.current[bs[idx].id];
        if (bs[idx].id === activeId) {
          setActiveId("files");
        }
      }
      return next;
    });
    setFiles((fs) => fs.filter((f) => f.id !== file.id));
    setStatus(`Deleted ${file.filename}`);
    setFmConfirmDelete(null);
  }

  function cycleBuffer(direction) {
    setBuffers((bs) => {
      if (bs.length === 0) return bs;
      const currentIndex = bs.findIndex((b) => b.id === activeId);
      const nextIndex = (currentIndex + direction + bs.length) % bs.length;
      setActiveId(bs[nextIndex].id);
      return bs;
    });
    refocusEditor();
  }

  // Top-level shortcuts that must work no matter which tab is active or
  // focused — including the pinned Help/Files tabs, which have no
  // textarea to attach a keydown handler to. Registered on `window`
  // (capture phase) rather than a React handler on the app div: once the
  // textarea unmounts (e.g. switching to the Files tab), focus falls back
  // to <body>, which is an *ancestor* of the app div, so a capture
  // listener on that div would never see events targeting body. window is
  // an ancestor of every possible target, so it always sees the key.
  useEffect(() => {
    if (mode !== "edit") return;
    function onWindowKeyDown(e) {
      if (e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "g") {
        e.preventDefault();
        e.stopPropagation();
        openHelpTab();
        return;
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "r") {
        e.preventDefault();
        e.stopPropagation();
        openFileManagerTab();
        return;
      }
      if (e.key === "Tab" && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        cycleBuffer(1);
        return;
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "x") {
        e.preventDefault();
        e.stopPropagation();
        if (activeId === "help" || activeId === "files") return; // pinned tabs can't be closed
        if (modified && !isReadOnly) {
          setMode("confirm-exit");
        } else {
          closeActiveBuffer();
        }
      }
    }
    window.addEventListener("keydown", onWindowKeyDown, true);
    return () => window.removeEventListener("keydown", onWindowKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, activeId, modified, isReadOnly]);

  // nanorc: set trimblanks — strip trailing whitespace per line on write.
  // "Writing out" commits the buffer to the `files` store (clears the
  // modified flag); it's also persisted to localStorage on every change,
  // no file download.
  function writeOut(name) {
    const finalName = name.trim() || filename || "buffer.txt";
    if (isNameTaken(finalName, active?.fileId ?? null)) {
      setStatusError(`"${finalName}" already exists`);
      return false;
    }
    const trimmed = text.replace(/[ \t]+$/gm, "");
    const fileId = active?.fileId ?? nextFileId++;
    recordUndo(activeId, text, { discrete: true });
    setFiles((fs) => {
      if (fs.some((f) => f.id === fileId)) {
        return fs.map((f) => (f.id === fileId ? { ...f, filename: finalName, text: trimmed } : f));
      }
      return [...fs, { id: fileId, filename: finalName, text: trimmed }];
    });
    updateActiveBuffer(() => ({ filename: finalName, text: trimmed, modified: false, fileId }));
    setStatus(`Wrote ${trimmed.split("\n").length} lines`);
    return true;
  }

  function doSearch(term) {
    setSearchTerm(term);
    const cursor = textareaRef.current?.selectionEnd ?? 0;
    const idx = findNext(text, cursor, term);
    if (idx === -1) {
      setStatusError(term ? `"${term}" not found` : "No search string");
    } else {
      setStatus(`Found "${term}"`);
      textareaRef.current?.focus();
      setSelection(idx, idx + term.length);
    }
  }

  function closeActiveBuffer() {
    setBuffers((bs) => {
      const idx = bs.findIndex((b) => b.id === activeId);
      const next = bs.filter((b) => b.id !== activeId);
      setActiveId(next.length > 0 ? next[Math.min(idx, next.length - 1)].id : "files");
      return next;
    });
    delete undoStacksRef.current[activeId];
    delete redoStacksRef.current[activeId];
  }

  function closeBuffer(id) {
    setBuffers((bs) => {
      const idx = bs.findIndex((b) => b.id === id);
      const next = bs.filter((b) => b.id !== id);
      if (id === activeId) {
        setActiveId(next.length > 0 ? next[Math.min(idx, next.length - 1)].id : "files");
      }
      return next;
    });
    delete undoStacksRef.current[id];
    delete redoStacksRef.current[id];
  }

  function newBuffer() {
    const nb = createBuffer();
    setBuffers((bs) => [...bs, nb]);
    setActiveId(nb.id);
    refocusEditor();
  }

  function handleEditorKeyDown(e) {
    if (mode !== "edit" || isReadOnly) return;
    const el = textareaRef.current;
    const selStart = el?.selectionStart ?? 0;
    const selEnd = el?.selectionEnd ?? 0;

    // bind M-u undo / M-e redo
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "u") {
      e.preventDefault();
      undo();
      return;
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "e") {
      e.preventDefault();
      redo();
      return;
    }

    // Ctrl+Enter: toggle the current line as a "- [ ]"/"- [x]" checklist item
    if (e.key === "Enter" && e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      recordUndo(activeId, text, { discrete: true });
      const r = toggleChecklist(text, selStart);
      updateActiveBuffer(() => ({ text: r.newText, modified: true }));
      setSelection(r.newCursor, r.newCursor);
      return;
    }

    // nanorc: set autoindent
    if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      recordUndo(activeId, text, { discrete: true });
      const indent = leadingWhitespace(text, selStart);
      const insertion = "\n" + indent;
      const newText = text.slice(0, selStart) + insertion + text.slice(selEnd);
      updateActiveBuffer(() => ({ text: newText, modified: true }));
      setSelection(selStart + insertion.length, selStart + insertion.length);
      return;
    }

    // nanorc: set tabstospaces (+ indent/unindent selected lines)
    if (e.key === "Tab" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      recordUndo(activeId, text, { discrete: true });
      if (selStart !== selEnd) {
        const r = indentLines(text, selStart, selEnd, TAB_SIZE);
        updateActiveBuffer(() => ({ text: r.newText, modified: true }));
        setSelection(r.newStart, r.newEnd);
      } else {
        const spaces = " ".repeat(TAB_SIZE);
        const newText = text.slice(0, selStart) + spaces + text.slice(selEnd);
        updateActiveBuffer(() => ({ text: newText, modified: true }));
        setSelection(selStart + spaces.length, selStart + spaces.length);
      }
      return;
    }

    // bind M-/ comment main
    if (e.altKey && e.key === "/") {
      e.preventDefault();
      recordUndo(activeId, text, { discrete: true });
      const r = toggleLineComment(text, selStart, selEnd);
      updateActiveBuffer(() => ({ text: r.newText, modified: true }));
      setSelection(r.newStart, r.newEnd);
      setStatus("Toggled comment");
      return;
    }

    // bind M-w copy all
    if (e.altKey && e.key.toLowerCase() === "w") {
      e.preventDefault();
      setCutBuffer(copyLineOrSelection(text, selStart, selEnd));
      setStatus("Copied text");
      return;
    }

    const action = matchEditorShortcut(e);
    if (!action) return;
    e.preventDefault();

    switch (action) {
      case "writeOut":
        setPromptValue(filename);
        setMode("prompt-save");
        break;
      case "search":
        setPromptValue(searchTerm);
        setMode("prompt-search");
        break;
      case "cutLine": {
        const r = cutLine(text, selStart);
        if (!r.cut) {
          setStatusError("Nothing to cut");
          break;
        }
        recordUndo(activeId, text, { discrete: true });
        updateActiveBuffer(() => ({ text: r.newText, modified: true }));
        setCutBuffer(r.cut);
        setStatus("Cut text");
        setSelection(r.newCursor, r.newCursor);
        break;
      }
      case "pasteLine": {
        if (!cutBuffer) {
          setStatusError("Cutbuffer is empty");
          break;
        }
        recordUndo(activeId, text, { discrete: true });
        const r = pasteAt(text, selStart, cutBuffer);
        updateActiveBuffer(() => ({ text: r.newText, modified: true }));
        setStatus("Pasted text");
        setSelection(r.newCursor, r.newCursor);
        break;
      }
      case "showPosition": {
        const { line, col } = getLineCol(text, selStart);
        setStatus(`line ${line}, col ${col}`);
        break;
      }
      case "justify": {
        recordUndo(activeId, text, { discrete: true });
        const r = justifyParagraph(text, selStart);
        updateActiveBuffer(() => ({ text: r.newText, modified: true }));
        setSelection(r.newCursor, r.newCursor);
        setStatus("Justified paragraph");
        break;
      }
      default:
        break;
    }
  }

  function handlePromptKeyDown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      let success = true;
      if (mode === "prompt-save") success = writeOut(promptValue);
      else if (mode === "prompt-search") doSearch(promptValue);
      else if (mode === "prompt-new-file") success = createNewFileFromPrompt(promptValue);
      else if (mode === "prompt-rename-file") success = renameFileFromPrompt(promptValue);
      // A duplicate filename leaves the prompt open so the user can retype.
      if (success !== false) {
        setMode("edit");
        refocusEditor();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setStatus("Cancelled");
      setFmRenameTarget(null);
      setMode("edit");
      refocusEditor();
    }
  }

  function restart() {
    const nb = createBuffer();
    setBuffers([nb]);
    setActiveId(nb.id);
    setCutBuffer("");
    setSearchTerm("");
    setStatus("Welcome to nano-web — press ^G for help");
    setMode("edit");
    refocusEditor();
  }

  // confirm-exit captures keys at the window level rather than on the
  // (possibly unfocused) textarea.
  useEffect(() => {
    if (mode !== "confirm-exit") return;
    function onWindowKeyDown(e) {
      const key = e.key.toLowerCase();
      if (key === "y") {
        e.preventDefault();
        if (writeOut(filename)) {
          closeActiveBuffer();
          setMode("edit");
        } else {
          // Name clash with another saved file — fall back to the save
          // prompt so the user can pick a different name instead of
          // silently losing the buffer.
          setPromptValue(filename);
          setMode("prompt-save");
        }
      } else if (key === "n") {
        e.preventDefault();
        closeActiveBuffer();
        setMode("edit");
      } else if (e.key === "Escape" || (e.ctrlKey && key === "c")) {
        e.preventDefault();
        setStatus("Cancelled");
        setMode("edit");
        refocusEditor();
      }
    }
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, filename, text, activeId]);

  // Files tab: arrow keys / mouse move the highlight, Enter or a click
  // opens, N/R/D create, rename, delete. Captured at the window level
  // since the pane has no single focused element (it's plain text, not a
  // textarea).
  useEffect(() => {
    if (mode !== "edit" || !isFilesTab) return;
    function onWindowKeyDown(e) {
      if (fmConfirmDelete) {
        const key = e.key.toLowerCase();
        if (key === "y") {
          e.preventDefault();
          deleteFile(fmConfirmDelete);
        } else if (key === "n" || e.key === "Escape") {
          e.preventDefault();
          setFmConfirmDelete(null);
        }
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFmIndex((i) => Math.min(i + 1, Math.max(files.length - 1, 0)));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setFmIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        openFileFromManager(files[fmIndex]);
        return;
      }
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const key = e.key.toLowerCase();
      if (key === "n") {
        e.preventDefault();
        requestNewFile();
      } else if (key === "r") {
        e.preventDefault();
        requestRenameFile(files[fmIndex]);
      } else if (key === "d") {
        e.preventDefault();
        requestDeleteFile(files[fmIndex]);
      }
    }
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, isFilesTab, files, fmIndex, fmConfirmDelete]);

  // nanorc: set minibar — messages show briefly, then revert to the
  // filename/flags/position line.
  useEffect(() => {
    if (status === null) return;
    const t = setTimeout(() => setStatus(null), 2500);
    return () => clearTimeout(t);
  }, [status]);

  if (buffers.length === 0 && !isHelpTab && !isFilesTab) {
    return (
      <div className="nano-app">
        <ExitedScreen onRestart={restart} />
      </div>
    );
  }

  // nanorc: set stateflags (I=autoindent, S=softwrap, M=mark) + minibar
  const flags = "IS" + (hasSelection ? "M" : "");
  const totalLines = text.split("\n").length;
  const percent =
    totalLines > 1 ? Math.round(((cursorInfo.line - 1) / (totalLines - 1)) * 100) : 100;
  const minibarInfo = isFilesTab
    ? `Files   ${files.length} saved file${files.length === 1 ? "" : "s"}`
    : `${filename || "New Buffer"}${modified ? " *" : ""}   [${flags}]   line ${cursorInfo.line}, col ${cursorInfo.col}   ${percent}%`;
  const fmSelectedIndex = Math.min(fmIndex, Math.max(files.length - 1, 0));
  const shortcutKind =
    mode === "edit"
      ? isHelpTab
        ? "help"
        : isFilesTab
        ? fmConfirmDelete
          ? "confirm-delete-file"
          : "files"
        : "file"
      : mode;

  return (
    <div className="nano-app">
      <TabBar
        buffers={buffers}
        activeId={activeId}
        onSelect={(id) => {
          setActiveId(id);
          refocusEditor();
        }}
        onClose={closeBuffer}
        onNew={newBuffer}
        onSelectHelp={openHelpTab}
        onSelectFiles={openFileManagerTab}
      />
      {isFilesTab ? (
        <FileManagerPane
          files={files}
          selectedIndex={fmSelectedIndex}
          onHoverIndex={setFmIndex}
          onOpen={openFileFromManager}
        />
      ) : (
        <EditArea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            if (isReadOnly) return;
            recordUndo(activeId, text, { discrete: false });
            updateActiveBuffer(() => ({ text: e.target.value, modified: true }));
          }}
          onKeyDown={handleEditorKeyDown}
          onSelect={syncCursor}
          language={detectLanguage(filename)}
          readOnly={isReadOnly}
        />
      )}
      {mode === "confirm-exit" ? (
        <StatusLine message="Save modified buffer? (y/n, ^C to cancel)" />
      ) : isFilesTab && fmConfirmDelete ? (
        <StatusLine message={`Delete "${fmConfirmDelete.filename}"? (y/n)`} />
      ) : (
        <StatusLine message={status ?? minibarInfo} variant={statusVariant} />
      )}

      {mode === "prompt-save" && (
        <PromptBar
          ref={promptInputRef}
          label="File Name to Write:"
          value={promptValue}
          onChange={(e) => setPromptValue(e.target.value)}
          onKeyDown={handlePromptKeyDown}
        />
      )}
      {mode === "prompt-search" && (
        <PromptBar
          ref={promptInputRef}
          label="Search:"
          value={promptValue}
          onChange={(e) => setPromptValue(e.target.value)}
          onKeyDown={handlePromptKeyDown}
        />
      )}
      {mode === "prompt-new-file" && (
        <PromptBar
          ref={promptInputRef}
          label="New File Name:"
          value={promptValue}
          onChange={(e) => setPromptValue(e.target.value)}
          onKeyDown={handlePromptKeyDown}
        />
      )}
      {mode === "prompt-rename-file" && (
        <PromptBar
          ref={promptInputRef}
          label="Rename To:"
          value={promptValue}
          onChange={(e) => setPromptValue(e.target.value)}
          onKeyDown={handlePromptKeyDown}
        />
      )}
      <ShortcutBar kind={shortcutKind} />
    </div>
  );
}
