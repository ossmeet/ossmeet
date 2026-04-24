import { createLazyFileRoute, useNavigate } from "@tanstack/react-router";
import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { joinViaInvite } from "@/server/spaces";
import { queryKeys } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";

export const Route = createLazyFileRoute("/invite/$token")({
  component: InviteRoute,
  errorComponent: InviteError,
});

function InviteError({ error }: { error: Error }) {
  const navigate = useNavigate();
  const message = error instanceof Error ? error.message : "Invalid or expired invite link";

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 bg-neutral-50">
      <p className="text-red-600">{message}</p>
      <Button variant="secondary" onClick={() => navigate({ to: "/dashboard" })}>
        Go to Dashboard
      </Button>
    </div>
  );
}

function InviteRoute() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { token } = Route.useParams();

  const joinMutation = useMutation({
    mutationFn: () => joinViaInvite({ data: { token } }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.spaces.all() });
      await navigate({ to: "/spaces/$spaceId", params: { spaceId: result.spaceId } });
    },
  });
  const join = joinMutation.mutate;

  const attemptedRef = React.useRef(false);
  React.useEffect(() => {
    if (attemptedRef.current) return;
    attemptedRef.current = true;
    join();
  }, [join]);

  if (joinMutation.isError) {
    const message = joinMutation.error instanceof Error
      ? joinMutation.error.message
      : "Failed to join space";

    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-neutral-50">
        <p className="text-red-600">{message}</p>
        <Button variant="secondary" onClick={() => navigate({ to: "/dashboard" })}>
          Go to Dashboard
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-screen items-center justify-center bg-neutral-50">
      <div className="text-center">
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-accent-500 border-t-transparent" />
        <p className="text-neutral-600">Joining space...</p>
      </div>
    </div>
  );
}
