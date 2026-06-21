export default function StatusLine({ message, variant = "normal" }) {
  return (
    <div className={"nano-statusline" + (variant === "error" ? " error" : "")}>
      {message}
    </div>
  );
}
