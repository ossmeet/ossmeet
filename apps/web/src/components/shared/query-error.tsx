import { useRouter } from "@tanstack/react-router";
import { useQueryErrorResetBoundary } from "@tanstack/react-query";

interface QueryErrorComponentProps {
  error: Error;
  message?: string;
}

/**
 * Shared error component for route-level query errors.
 * Provides a retry button that resets the error boundary and invalidates the route.
 */
export function QueryErrorComponent({
  error,
  message,
}: QueryErrorComponentProps) {
  const router = useRouter();
  const queryErrorResetBoundary = useQueryErrorResetBoundary();

  const handleRetry = () => {
    queryErrorResetBoundary.reset();
    router.invalidate();
  };

  return (
    <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
      <p className="text-sm text-neutral-500">
        {message || error.message || "Something went wrong"}
      </p>
      <button
        onClick={handleRetry}
        className="text-sm font-medium text-accent-700 hover:text-accent-800"
      >
        Retry
      </button>
    </div>
  );
}
