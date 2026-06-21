import { forwardRef, useLayoutEffect, useMemo, useRef, useState } from "react";
import { tokenizeLine } from "../syntaxHighlight.js";

const MAX_HIGHLIGHTED_LINES = 5000;
const TAB_SIZE = 4;

const EditArea = forwardRef(function EditArea(
  { value, onChange, onKeyDown, onSelect, language, readOnly },
  ref
) {
  const gutterRef = useRef(null);
  const backdropRef = useRef(null);
  const [rowHeights, setRowHeights] = useState([]);
  const [scrollInfo, setScrollInfo] = useState({ top: 0, height: 100 });

  const lines = value.split("\n");
  const tokenizedLines = useMemo(
    () =>
      lines.length > MAX_HIGHLIGHTED_LINES
        ? lines.map((l) => [{ text: l || " ", type: null }])
        : lines.map((line) => tokenizeLine(line, language)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [value, language]
  );

  useLayoutEffect(() => {
    const textarea = ref?.current;
    if (!textarea || !backdropRef.current) return;

    function recompute() {
      const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 16;
      const heights = Array.from(backdropRef.current.children).map((child) => {
        const rows = Math.max(1, Math.round(child.getBoundingClientRect().height / lineHeight));
        return rows * lineHeight;
      });
      setRowHeights(heights);
    }

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(textarea);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, language]);

  useLayoutEffect(() => {
    const textarea = ref?.current;
    if (!textarea || !backdropRef.current) return;

    function recompute() {
      const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 16;
      const heights = Array.from(backdropRef.current.children).map((child) => {
        const rows = Math.max(1, Math.round(child.getBoundingClientRect().height / lineHeight));
        return rows * lineHeight;
      });
      setRowHeights(heights);
    }

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(textarea);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, language]);

  function handleScroll(e) {
    const { scrollTop, scrollHeight, clientHeight } = e.target;
    if (gutterRef.current) gutterRef.current.style.transform = `translateY(-${scrollTop}px)`;
    if (backdropRef.current) backdropRef.current.style.transform = `translateY(-${scrollTop}px)`;
    setScrollInfo({
      top: scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0,
      height: scrollHeight > 0 ? Math.max(4, (clientHeight / scrollHeight) * 100) : 100,
    });
  }

  return (
    <div className="nano-editarea">
      <div className="nano-linenumbers-viewport">
        <div className="nano-linenumbers" ref={gutterRef}>
          {lines.map((_, i) => (
            <div
              key={i}
              style={rowHeights[i] ? { height: `${rowHeights[i]}px` } : undefined}
            >
              {i + 1}
            </div>
          ))}
        </div>
      </div>
      <div className="nano-textarea-wrapper">
        <div className="nano-backdrop-viewport">
          <div className="nano-backdrop" ref={backdropRef}>
            {tokenizedLines.map((tokens, i) => (
              <div key={i}>
                {tokens.map((t, j) =>
                  t.type ? (
                    <span key={j} className={`tok-${t.type}`}>
                      {t.text}
                    </span>
                  ) : (
                    <span key={j}>{t.text}</span>
                  )
                )}
              </div>
            ))}
          </div>
        </div>
        <textarea
          ref={ref}
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onSelect={onSelect}
          onScroll={handleScroll}
          readOnly={readOnly}
          spellCheck={false}
          autoFocus
        />
      </div>
      <div className="nano-indicator">
        <div
          className="nano-indicator-thumb"
          style={{ top: `${scrollInfo.top}%`, height: `${scrollInfo.height}%` }}
        />
      </div>
    </div>
  );
});

export default EditArea;
