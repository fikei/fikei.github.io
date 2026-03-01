// Loading state — Soundscape-style full-screen overlay with spinner

interface LoadingStateProps {
  message: string;
}

export function LoadingState({ message }: LoadingStateProps) {
  return (
    <div className="tg-loading-overlay">
      <h1 className="tg-loading-overlay__title">TASTE MAP</h1>
      <div className="tg-loading-overlay__spinner" />
      <span className="tg-loading-overlay__message">{message}</span>
    </div>
  );
}
