export default function ExitedScreen({ onRestart }) {
  return (
    <div className="nano-exited-screen">
      <p>nano-web has exited.</p>
      <button onClick={onRestart}>Start a new buffer</button>
    </div>
  );
}
