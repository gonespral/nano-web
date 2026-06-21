export function getLineCol(text, cursor) {
  const upToCursor = text.slice(0, cursor);
  const lines = upToCursor.split("\n");
  return { line: lines.length, col: lines[lines.length - 1].length + 1 };
}

export function lineBounds(text, cursor) {
  const start = text.lastIndexOf("\n", cursor - 1) + 1;
  let end = text.indexOf("\n", cursor);
  if (end === -1) end = text.length;
  else end += 1;
  return { start, end };
}

export function leadingWhitespace(text, cursor) {
  const { start } = lineBounds(text, cursor);
  const match = text.slice(start, cursor).match(/^[ \t]*/);
  return match ? match[0] : "";
}

// nanorc has `set cutfromcursor`: ^K cuts from the cursor to the end of
// the line instead of the whole line. If the cursor is already at the
// end of the line, it also swallows the newline (merging with the next
// line), matching nano's behavior.
export function cutLine(text, cursor) {
  let end = text.indexOf("\n", cursor);
  if (end === -1) end = text.length;
  else if (end === cursor) end += 1;
  const cut = text.slice(cursor, end);
  const newText = text.slice(0, cursor) + text.slice(end);
  return { newText, cut, newCursor: cursor };
}

export function pasteAt(text, cursor, cutBuffer) {
  if (!cutBuffer) return { newText: text, newCursor: cursor };
  const newText = text.slice(0, cursor) + cutBuffer + text.slice(cursor);
  return { newText, newCursor: cursor + cutBuffer.length };
}

export function copyLineOrSelection(text, start, end) {
  if (start !== end) return text.slice(start, end);
  const { start: lineStart, end: lineEnd } = lineBounds(text, start);
  return text.slice(lineStart, lineEnd);
}

// Indents every line touched by [start, end] by `tabSize` spaces.
export function indentLines(text, start, end, tabSize) {
  const indent = " ".repeat(tabSize);
  const firstLineStart = text.lastIndexOf("\n", start - 1) + 1;
  const segment = text.slice(firstLineStart, end);
  const indented = segment.replace(/^/gm, indent);
  const newText = text.slice(0, firstLineStart) + indented + text.slice(end);
  return {
    newText,
    newStart: start + indent.length,
    newEnd: end + (indented.length - segment.length),
  };
}

// Removes up to `tabSize` leading spaces (or one leading tab) from every
// line touched by [start, end].
export function dedentLines(text, start, end, tabSize) {
  const firstLineStart = text.lastIndexOf("\n", start - 1) + 1;
  const segment = text.slice(firstLineStart, end);
  let firstLineRemoved = 0;
  let removedTotal = 0;
  const newLines = segment.split("\n").map((line, i) => {
    let removed = "";
    if (line.startsWith("\t")) removed = "\t";
    else {
      const match = line.match(new RegExp(`^ {1,${tabSize}}`));
      if (match) removed = match[0];
    }
    if (i === 0) firstLineRemoved = removed.length;
    removedTotal += removed.length;
    return line.slice(removed.length);
  });
  const newSegment = newLines.join("\n");
  const newText = text.slice(0, firstLineStart) + newSegment + text.slice(end);
  return {
    newText,
    newStart: Math.max(firstLineStart, start - firstLineRemoved),
    newEnd: Math.max(firstLineStart, end - removedTotal),
  };
}

// Toggles a "// " line-comment prefix on every line touched by [start, end].
export function toggleLineComment(text, start, end) {
  const marker = "// ";
  const firstLineStart = text.lastIndexOf("\n", start - 1) + 1;
  const segment = text.slice(firstLineStart, end);
  const lines = segment.split("\n");
  const allCommented = lines.every(
    (l) => l.trim() === "" || l.trimStart().startsWith("//")
  );

  let firstLineDelta = 0;
  let totalDelta = 0;
  const newLines = lines.map((line, i) => {
    if (allCommented) {
      const idx = line.indexOf("//");
      if (idx === -1) return line;
      const removeLen = line[idx + 2] === " " ? 3 : 2;
      if (i === 0) firstLineDelta = -removeLen;
      totalDelta += -removeLen;
      return line.slice(0, idx) + line.slice(idx + removeLen);
    }
    if (line.trim() === "") return line;
    const ws = line.match(/^[ \t]*/)[0];
    if (i === 0) firstLineDelta = marker.length;
    totalDelta += marker.length;
    return ws + marker + line.slice(ws.length);
  });

  const newSegment = newLines.join("\n");
  const newText = text.slice(0, firstLineStart) + newSegment + text.slice(end);
  return {
    newText,
    newStart: Math.max(firstLineStart, start + firstLineDelta),
    newEnd: Math.max(firstLineStart, end + totalDelta),
  };
}

const CHECKLIST_RE = /^(\s*)-\s\[( |x|X)\]\s?(.*)$/;

// Ctrl+Enter: turns the current line into an unchecked "- [ ] " item, or
// if it already is one, toggles its checked state.
export function toggleChecklist(text, cursor) {
  const lineStart = text.lastIndexOf("\n", cursor - 1) + 1;
  let lineEnd = text.indexOf("\n", cursor);
  if (lineEnd === -1) lineEnd = text.length;
  const line = text.slice(lineStart, lineEnd);

  const match = line.match(CHECKLIST_RE);
  let newLine;
  if (match) {
    const [, indent, mark, rest] = match;
    const newMark = mark.trim() === "" ? "x" : " ";
    newLine = `${indent}- [${newMark}] ${rest}`;
  } else {
    const indent = line.match(/^\s*/)[0];
    newLine = `${indent}- [ ] ${line.slice(indent.length)}`;
  }

  const newText = text.slice(0, lineStart) + newLine + text.slice(lineEnd);
  const delta = newLine.length - line.length;
  const newCursor = Math.min(Math.max(cursor + delta, lineStart), lineStart + newLine.length);
  return { newText, newCursor };
}

// Finds the next occurrence of `term` strictly after `cursor`, wrapping
// around to the start of the buffer if nothing is found after it.
export function findNext(text, cursor, term) {
  if (!term) return -1;
  const after = text.indexOf(term, cursor + 1);
  if (after !== -1) return after;
  return text.indexOf(term, 0);
}

const FILL_WIDTH = 80; // nanorc: set fill 80

// Finds the contiguous run of non-blank lines around `cursor` — nano
// treats that run as a single paragraph to reflow.
function paragraphBounds(text, cursor) {
  const lines = text.split("\n");
  let pos = 0;
  let cursorLine = lines.length - 1;
  for (let i = 0; i < lines.length; i++) {
    if (cursor <= pos + lines[i].length) {
      cursorLine = i;
      break;
    }
    pos += lines[i].length + 1;
  }

  let startLine = cursorLine;
  while (startLine > 0 && lines[startLine - 1].trim() !== "") startLine--;
  let endLine = cursorLine;
  while (endLine < lines.length - 1 && lines[endLine + 1].trim() !== "") endLine++;

  let startOffset = 0;
  for (let i = 0; i < startLine; i++) startOffset += lines[i].length + 1;
  let endOffset = startOffset;
  for (let i = startLine; i <= endLine; i++) {
    endOffset += lines[i].length + (i < endLine ? 1 : 0);
  }

  return { lines, startLine, endLine, startOffset, endOffset };
}

// ^J Justify: reflows the paragraph (contiguous non-blank lines) around
// `cursor` to `fillWidth` columns, keeping the first line's indentation.
export function justifyParagraph(text, cursor, fillWidth = FILL_WIDTH) {
  const { lines, startLine, endLine, startOffset, endOffset } = paragraphBounds(text, cursor);
  const paragraphLines = lines.slice(startLine, endLine + 1);
  if (paragraphLines.every((l) => l.trim() === "")) {
    return { newText: text, newCursor: cursor };
  }

  const indent = paragraphLines[0].match(/^[ \t]*/)[0];
  const words = paragraphLines.join(" ").trim().split(/\s+/).filter(Boolean);

  const wrapped = [];
  let line = indent;
  let lineHasWord = false;
  for (const word of words) {
    const candidate = lineHasWord ? `${line} ${word}` : `${line}${word}`;
    if (lineHasWord && candidate.length > fillWidth) {
      wrapped.push(line);
      line = `${indent}${word}`;
    } else {
      line = candidate;
    }
    lineHasWord = true;
  }
  wrapped.push(line);

  const newParagraph = wrapped.join("\n");
  const newText = text.slice(0, startOffset) + newParagraph + text.slice(endOffset);
  return { newText, newCursor: startOffset + newParagraph.length };
}

// Replaces every occurrence of `term` with `replacement`. Plain substring
// matching, same semantics as findNext's search.
export function replaceAll(text, term, replacement) {
  if (!term) return { newText: text, count: 0 };
  const parts = text.split(term);
  return { newText: parts.join(replacement), count: parts.length - 1 };
}
