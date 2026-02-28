// Loading and empty state components

interface LoadingStateProps {
  message: string;
}

export function LoadingState({ message }: LoadingStateProps) {
  return (
    <div className="tg-loading">
      <span className="tg-loading__text">{message}</span>
    </div>
  );
}
