import { forwardRef } from "react";

const PromptBar = forwardRef(function PromptBar(
  { label, value, onChange, onKeyDown },
  ref
) {
  return (
    <div className="nano-promptbar">
      <span>{label}</span>
      <input
        ref={ref}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        autoFocus
        spellCheck={false}
      />
    </div>
  );
});

export default PromptBar;
