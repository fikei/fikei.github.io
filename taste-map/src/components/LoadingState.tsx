// Loading state with terminal cursor blink

interface LoadingStateProps {
  message: string;
}

export function LoadingState({ message }: LoadingStateProps) {
  return (
    <div className="tg-loading">
      <span className="tg-loading__text">
        {message}<span className="tg-loading__cursor">{'\u2588'}</span>
      </span>
    </div>
  );
}
