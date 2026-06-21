// Renders inside the same content area EditArea uses, with the same
// line-number gutter as a normal file (or the Help tab) — so it reads as
// "a file" rather than a separate dialog. It's plain text — no textarea,
// no cursor — but each file row is interactive. The delete-confirm
// question itself lives in the standard StatusLine/ShortcutBar, not here.
function buildLines(files) {
  const lines = [
    { text: "nano-web file manager", fileIndex: null },
    { text: "", fileIndex: null },
    { text: files.length === 0 ? "No saved files yet." : "Saved files:", fileIndex: null },
    { text: "", fileIndex: null },
  ];

  if (files.length === 0) {
    lines.push({ text: "  (press N to create one)", fileIndex: null });
  } else {
    files.forEach((file, i) => {
      const lineCount = file.text.split("\n").length;
      const label = `${String(i + 1).padStart(2, " ")}. ${file.filename || "Untitled"}`;
      lines.push({
        text: `${label.padEnd(40, " ")}${lineCount} line${lineCount === 1 ? "" : "s"}`,
        fileIndex: i,
      });
    });
  }

  return lines;
}

export default function FileManagerPane({ files, selectedIndex, onHoverIndex, onOpen }) {
  const lines = buildLines(files);

  return (
    <div className="nano-filemanager-pane">
      <div className="nano-filemanager-linenumbers">
        {lines.map((_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <div className="nano-filemanager-content">
        {lines.map((line, i) => {
          const isFileRow = line.fileIndex !== null;
          const isActive = isFileRow && line.fileIndex === selectedIndex;
          return (
            <div
              key={i}
              className={"nano-filemanager-line" + (isFileRow ? " file-row" : "") + (isActive ? " active" : "")}
              onMouseEnter={isFileRow ? () => onHoverIndex(line.fileIndex) : undefined}
              onClick={isFileRow ? () => onOpen(files[line.fileIndex]) : undefined}
            >
              {line.text || " "}
            </div>
          );
        })}
      </div>
    </div>
  );
}
