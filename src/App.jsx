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
  replaceAll,
} from "./nanoKeymap.js";
import { detectLanguage } from "./syntaxHighlight.js";
import { useShortcuts } from "./useShortcuts.js";

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
  "^R  Jump to the Files tab (arrows/mouse to browse, Enter/click to open,",
  "    N to create a file, R to rename, D to delete)",
  "Alt+R  Search and replace (asks for a search term, then a replacement,",
  "       and replaces every occurrence in the buffer)",
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
  const [replaceTerm, setReplaceTerm] = useState("");
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

  // Current cursor/selection bounds, read fresh each time an action needs
  // them (actions are dispatched by useShortcuts, not by a textarea event,
  // so there's no `e.target` to read from).
  function getCursor() {
    const el = textareaRef.current;
    return { start: el?.selectionStart ?? 0, end: el?.selectionEnd ?? 0 };
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

  // --- Actions: one function per shortcuts.js `action` name. Keeping
  // these as plain named functions (rather than inlining logic into the
  // bindings) is what makes the keymap in shortcuts.js purely data — swap
  // a key or a context's action list there without touching any of this.

  function startWriteOut() {
    setPromptValue(filename);
    setMode("prompt-save");
  }

  function startSearch() {
    setPromptValue(searchTerm);
    setMode("prompt-search");
  }

  function startReplace() {
    setPromptValue(searchTerm);
    setMode("prompt-replace-search");
  }

  function closeTab() {
    if (modified && !isReadOnly) {
      setMode("confirm-exit");
    } else {
      closeActiveBuffer();
    }
  }

  function actionCutLine() {
    const { start } = getCursor();
    const r = cutLine(text, start);
    if (!r.cut) {
      setStatusError("Nothing to cut");
      return;
    }
    recordUndo(activeId, text, { discrete: true });
    updateActiveBuffer(() => ({ text: r.newText, modified: true }));
    setCutBuffer(r.cut);
    setStatus("Cut text");
    setSelection(r.newCursor, r.newCursor);
  }

  function actionPasteLine() {
    if (!cutBuffer) {
      setStatusError("Cutbuffer is empty");
      return;
    }
    const { start } = getCursor();
    recordUndo(activeId, text, { discrete: true });
    const r = pasteAt(text, start, cutBuffer);
    updateActiveBuffer(() => ({ text: r.newText, modified: true }));
    setStatus("Pasted text");
    setSelection(r.newCursor, r.newCursor);
  }

  function actionShowPosition() {
    const { start } = getCursor();
    const { line, col } = getLineCol(text, start);
    setStatus(`line ${line}, col ${col}`);
  }

  function actionJustify() {
    const { start } = getCursor();
    recordUndo(activeId, text, { discrete: true });
    const r = justifyParagraph(text, start);
    updateActiveBuffer(() => ({ text: r.newText, modified: true }));
    setSelection(r.newCursor, r.newCursor);
    setStatus("Justified paragraph");
  }

  function actionToggleComment() {
    const { start, end } = getCursor();
    recordUndo(activeId, text, { discrete: true });
    const r = toggleLineComment(text, start, end);
    updateActiveBuffer(() => ({ text: r.newText, modified: true }));
    setSelection(r.newStart, r.newEnd);
    setStatus("Toggled comment");
  }

  function actionCopyText() {
    const { start, end } = getCursor();
    setCutBuffer(copyLineOrSelection(text, start, end));
    setStatus("Copied text");
  }

  function actionToggleChecklist() {
    const { start } = getCursor();
    recordUndo(activeId, text, { discrete: true });
    const r = toggleChecklist(text, start);
    updateActiveBuffer(() => ({ text: r.newText, modified: true }));
    setSelection(r.newCursor, r.newCursor);
  }

  function actionInsertNewline() {
    const { start, end } = getCursor();
    recordUndo(activeId, text, { discrete: true });
    const indent = leadingWhitespace(text, start);
    const insertion = "\n" + indent;
    const newText = text.slice(0, start) + insertion + text.slice(end);
    updateActiveBuffer(() => ({ text: newText, modified: true }));
    setSelection(start + insertion.length, start + insertion.length);
  }

  function actionIndentOrTab() {
    const { start, end } = getCursor();
    recordUndo(activeId, text, { discrete: true });
    if (start !== end) {
      const r = indentLines(text, start, end, TAB_SIZE);
      updateActiveBuffer(() => ({ text: r.newText, modified: true }));
      setSelection(r.newStart, r.newEnd);
    } else {
      const spaces = " ".repeat(TAB_SIZE);
      const newText = text.slice(0, start) + spaces + text.slice(end);
      updateActiveBuffer(() => ({ text: newText, modified: true }));
      setSelection(start + spaces.length, start + spaces.length);
    }
  }

  function filesMoveUp() {
    setFmIndex((i) => Math.max(i - 1, 0));
  }

  function filesMoveDown() {
    setFmIndex((i) => Math.min(i + 1, Math.max(files.length - 1, 0)));
  }

  function filesOpenSelected() {
    openFileFromManager(files[fmIndex]);
  }

  function confirmDeleteYes() {
    deleteFile(fmConfirmDelete);
  }

  function confirmDeleteNo() {
    setFmConfirmDelete(null);
  }

  function confirmExitYes() {
    if (writeOut(filename)) {
      closeActiveBuffer();
      setMode("edit");
    } else {
      // Name clash with another saved file — fall back to the save prompt
      // so the user can pick a different name instead of silently losing
      // the buffer.
      setPromptValue(filename);
      setMode("prompt-save");
    }
  }

  function confirmExitNo() {
    closeActiveBuffer();
    setMode("edit");
  }

  function confirmExitCancel() {
    setStatus("Cancelled");
    setMode("edit");
    refocusEditor();
  }

  function submitSave() {
    if (writeOut(promptValue)) {
      setMode("edit");
      refocusEditor();
    }
    // On a name clash writeOut already set the error; stay in the prompt.
  }

  function submitSearch() {
    doSearch(promptValue);
    setMode("edit");
    refocusEditor();
  }

  function submitReplaceSearch() {
    if (!promptValue) {
      setStatusError("No search string");
      setMode("edit");
      refocusEditor();
      return;
    }
    setReplaceTerm(promptValue);
    setSearchTerm(promptValue);
    setPromptValue("");
    setMode("prompt-replace-with");
  }

  function submitReplaceWith() {
    const r = replaceAll(text, replaceTerm, promptValue);
    if (r.count === 0) {
      setStatusError(`"${replaceTerm}" not found`);
    } else {
      recordUndo(activeId, text, { discrete: true });
      updateActiveBuffer(() => ({ text: r.newText, modified: true }));
      setStatus(`Replaced ${r.count} occurrence${r.count === 1 ? "" : "s"}`);
    }
    setMode("edit");
    refocusEditor();
  }

  function submitNewFile() {
    if (createNewFileFromPrompt(promptValue)) {
      setMode("edit");
      refocusEditor();
    }
  }

  function submitRename() {
    if (renameFileFromPrompt(promptValue)) {
      setMode("edit");
      refocusEditor();
    }
  }

  function cancelPrompt() {
    setStatus("Cancelled");
    setFmRenameTarget(null);
    setMode("edit");
    refocusEditor();
  }

  // nanorc: set minibar — messages show briefly, then revert to the
  // filename/flags/position line.
  useEffect(() => {
    if (status === null) return;
    const t = setTimeout(() => setStatus(null), 2500);
    return () => clearTimeout(t);
  }, [status]);

  // Which binding table (shortcuts.js) is live right now — also doubles
  // as the ShortcutBar's legend selector, so behavior and the on-screen
  // hints can never disagree about what context we're in.
  const shortcutContext =
    mode !== "edit"
      ? mode
      : isHelpTab
      ? "help"
      : isFilesTab
      ? fmConfirmDelete
        ? "confirm-delete-file"
        : "files"
      : "file";

  useShortcuts(shortcutContext, {
    openHelp: openHelpTab,
    openFiles: openFileManagerTab,
    startReplace,
    cycleNext: () => cycleBuffer(1),
    closeTab,
    startWriteOut,
    startSearch,
    cutLine: actionCutLine,
    pasteLine: actionPasteLine,
    showPosition: actionShowPosition,
    justify: actionJustify,
    undo,
    redo,
    toggleComment: actionToggleComment,
    copyText: actionCopyText,
    toggleChecklist: actionToggleChecklist,
    insertNewline: actionInsertNewline,
    indentOrTab: actionIndentOrTab,
    filesMoveUp,
    filesMoveDown,
    filesOpenSelected,
    filesNewFile: requestNewFile,
    filesRenameSelected: () => requestRenameFile(files[fmIndex]),
    filesDeleteSelected: () => requestDeleteFile(files[fmIndex]),
    confirmDeleteYes,
    confirmDeleteNo,
    confirmExitYes,
    confirmExitNo,
    confirmExitCancel,
    submitSave,
    submitSearch,
    submitReplaceSearch,
    submitReplaceWith,
    submitNewFile,
    submitRename,
    cancelPrompt,
  });

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
        />
      )}
      {mode === "prompt-search" && (
        <PromptBar
          ref={promptInputRef}
          label="Search:"
          value={promptValue}
          onChange={(e) => setPromptValue(e.target.value)}
        />
      )}
      {mode === "prompt-replace-search" && (
        <PromptBar
          ref={promptInputRef}
          label="Search (to replace):"
          value={promptValue}
          onChange={(e) => setPromptValue(e.target.value)}
        />
      )}
      {mode === "prompt-replace-with" && (
        <PromptBar
          ref={promptInputRef}
          label="Replace With:"
          value={promptValue}
          onChange={(e) => setPromptValue(e.target.value)}
        />
      )}
      {mode === "prompt-new-file" && (
        <PromptBar
          ref={promptInputRef}
          label="New File Name:"
          value={promptValue}
          onChange={(e) => setPromptValue(e.target.value)}
        />
      )}
      {mode === "prompt-rename-file" && (
        <PromptBar
          ref={promptInputRef}
          label="Rename To:"
          value={promptValue}
          onChange={(e) => setPromptValue(e.target.value)}
        />
      )}
      <ShortcutBar kind={shortcutContext} />
    </div>
  );
}
