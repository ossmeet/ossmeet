import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearch } from "@tanstack/react-router";
import { linkedAccountsQueryOptions } from "@/queries/settings";
import { getGoogleLinkUrl, unlinkGoogleAccount } from "@/server/auth/oauth-google";
import { queryKeys } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Link2 } from "lucide-react";
import { SettingsSection } from "./settings-section";

export function LinkedAccountsSection() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const search = useSearch({ from: "/_authed/settings/" });

  const { data: linkedAccounts = [], isLoading } = useQuery(linkedAccountsQueryOptions());

  const linkMutation = useMutation({
    mutationFn: () => getGoogleLinkUrl(),
    onSuccess: (result) => { window.location.href = result.url; },
  });

  const unlinkMutation = useMutation({
    mutationFn: () => unlinkGoogleAccount(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.linkedAccounts() });
      await queryClient.invalidateQueries({ queryKey: queryKeys.session() });
    },
  });

  const isGoogleLinked = linkedAccounts.some((acc) => acc.providerId === "google");
  const linkStatus = search.linked;
  const linkReason = search.reason;

  useEffect(() => {
    if (linkStatus) {
      const timer = setTimeout(() => {
        router.navigate({ to: "/settings", replace: true });
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [linkStatus, router]);

  const statusMessage = linkStatus === "google"
    ? "Google account linked successfully!"
    : linkStatus === "error"
      ? linkReason === "email_mismatch"
        ? "Google account email doesn't match your account email."
        : linkReason === "already_linked_other"
          ? "This Google account is already linked to another user."
          : linkReason === "rate_limited"
            ? "Too many attempts. Please try again later."
            : "Failed to link Google account. Please try again."
      : null;

  return (
    <SettingsSection icon={Link2} title="Linked Accounts">
      {statusMessage && (
        <Alert variant={linkStatus === "google" ? "success" : "error"} className="mb-4">
          {statusMessage}
        </Alert>
      )}

      <div className="space-y-4">
        <p className="text-sm text-neutral-500">
          Link Google as a fallback sign-in method if you lose email inbox access on one device.
        </p>
        <div className="flex items-center justify-between rounded-lg border border-neutral-200 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-100">
              <svg className="h-5 w-5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
            </div>
            <div>
              <p className="font-medium text-neutral-900">Google</p>
              <p className="text-sm text-neutral-500">
                {isGoogleLinked ? "Connected" : "Not connected"}
              </p>
            </div>
          </div>
          {isGoogleLinked ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => unlinkMutation.mutate()}
              loading={unlinkMutation.isPending}
            >
              Unlink
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => linkMutation.mutate()}
              loading={linkMutation.isPending || isLoading}
            >
              Link
            </Button>
          )}
        </div>

        {unlinkMutation.isError && (
          <Alert variant="error">
            {unlinkMutation.error instanceof Error ? unlinkMutation.error.message : "Failed to unlink account."}
          </Alert>
        )}
      </div>
    </SettingsSection>
  );
}
