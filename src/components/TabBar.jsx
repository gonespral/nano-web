export default function TabBar({ buffers, activeId, onSelect, onClose, onNew, onSelectHelp, onSelectFiles }) {
  return (
    <div className="nano-tabbar">
      <div
        className={"nano-tab pinned" + (activeId === "help" ? " active" : "")}
        onClick={onSelectHelp}
      >
        <span>Help</span>
      </div>
      <div
        className={"nano-tab pinned" + (activeId === "files" ? " active" : "")}
        onClick={onSelectFiles}
      >
        <span>Files</span>
      </div>
      {buffers.map((b) => (
        <div
          key={b.id}
          className={"nano-tab" + (b.id === activeId ? " active" : "")}
          onClick={() => onSelect(b.id)}
        >
          <span>
            {b.filename || "New Buffer"}
            {b.modified ? " *" : ""}
          </span>
          <span
            className="close"
            onClick={(e) => {
              e.stopPropagation();
              onClose(b.id);
            }}
          >
            ×
          </span>
        </div>
      ))}
      <div className="nano-tab-new" onClick={onNew}>
        +
      </div>
    </div>
  );
}
