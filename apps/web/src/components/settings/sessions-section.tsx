import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { sessionsListQueryOptions } from "@/queries/settings";
import { revokeSession, revokeAllOtherSessions } from "@/server/auth";
import { queryKeys } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Monitor } from "lucide-react";
import { SettingsSection } from "./settings-section";

export function SessionsSection() {
  const queryClient = useQueryClient();
  const router = useRouter();

  const { data: sessionsList = [], isLoading } = useQuery(sessionsListQueryOptions());

  const revokeMutation = useMutation({
    mutationFn: (sessionId: string) => revokeSession({ data: { sessionId } }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all() });
      if (result.wasCurrentSession) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.session() });
        await router.invalidate();
      }
    },
  });

  const revokeAllMutation = useMutation({
    mutationFn: () => revokeAllOtherSessions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all() });
    },
  });

  const otherSessions = sessionsList.filter((s) => !s.isCurrent);

  return (
    <SettingsSection icon={Monitor} title="Active Sessions">
      {isLoading ? (
        <p className="text-sm text-neutral-500">Loading sessions...</p>
      ) : (
        <div className="space-y-4">
          {sessionsList.map((session) => (
            <div
              key={session.id}
              className="flex items-center justify-between rounded-lg border border-neutral-200 p-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate font-medium text-neutral-900">
                    {parseUserAgent(session.userAgent)}
                  </p>
                  {session.isCurrent && (
                    <Badge variant="success" size="sm">Current</Badge>
                  )}
                </div>
                <p className="mt-1 text-sm text-neutral-500">
                  {session.ipAddress || "Unknown IP"} · Signed in{" "}
                  {formatRelativeTime(session.createdAt)}
                </p>
              </div>
              {!session.isCurrent && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => revokeMutation.mutate(session.id)}
                  loading={revokeMutation.isPending && revokeMutation.variables === session.id}
                >
                  Revoke
                </Button>
              )}
            </div>
          ))}

          {otherSessions.length > 0 && (
            <Button
              variant="secondary"
              onClick={() => revokeAllMutation.mutate()}
              loading={revokeAllMutation.isPending}
              className="mt-2"
            >
              Revoke all other sessions
            </Button>
          )}

          {revokeMutation.isError && (
            <Alert variant="error">
              {revokeMutation.error instanceof Error ? revokeMutation.error.message : "Failed to revoke session."}
            </Alert>
          )}
        </div>
      )}
    </SettingsSection>
  );
}

function parseUserAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  let browser = "Unknown browser";
  let os = "Unknown OS";
  if (ua.includes("Chrome") && !ua.includes("Edg")) browser = "Chrome";
  else if (ua.includes("Firefox")) browser = "Firefox";
  else if (ua.includes("Safari") && !ua.includes("Chrome")) browser = "Safari";
  else if (ua.includes("Edg")) browser = "Edge";
  if (ua.includes("Windows")) os = "Windows";
  else if (ua.includes("Mac OS")) os = "macOS";
  else if (ua.includes("Linux")) os = "Linux";
  else if (ua.includes("Android")) os = "Android";
  else if (ua.includes("iPhone") || ua.includes("iPad")) os = "iOS";
  return `${browser} on ${os}`;
}

function formatRelativeTime(date: Date | null): string {
  if (!date) return "Unknown";
  const diff = Date.now() - new Date(date).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(date).toLocaleDateString();
}
