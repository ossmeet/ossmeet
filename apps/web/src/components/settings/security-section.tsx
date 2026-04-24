import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Shield, Trash2, KeyRound } from "lucide-react";
import {
  deletePasskey,
  finishPasskeyRegistration,
  listPasskeys,
  startPasskeyRegistration,
} from "@/server/auth";
import { getErrorMessage } from "@/lib/errors";
import { queryKeys } from "@/lib/query-keys";
import { SettingsSection } from "./settings-section";
import { Button } from "../ui/button";

export function SecuritySection() {
  const [passkeySupported, setPasskeySupported] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setPasskeySupported(typeof window !== "undefined" && "PublicKeyCredential" in window);
  }, []);

  const passkeysQuery = useQuery({
    queryKey: queryKeys.passkeys(),
    queryFn: () => listPasskeys(),
  });

  const addPasskeyMutation = useMutation({
    mutationFn: async () => {
      const { options } = await startPasskeyRegistration();
      const { startRegistration } = await import("@simplewebauthn/browser");
      const response = await startRegistration({ optionsJSON: options });
      await finishPasskeyRegistration({ data: { response } });
    },
    onSuccess: async () => {
      setError("");
      await passkeysQuery.refetch();
    },
    onError: (err) => {
      setError(getErrorMessage(err, "Could not register passkey."));
    },
  });

  const deletePasskeyMutation = useMutation({
    mutationFn: (passkeyId: string) => deletePasskey({ data: { passkeyId } }),
    onSuccess: async () => {
      setError("");
      await passkeysQuery.refetch();
    },
    onError: (err) => {
      setError(getErrorMessage(err, "Could not remove passkey."));
    },
  });

  return (
    <SettingsSection icon={Shield} title="Security">
      <div className="space-y-4">
        <p className="text-sm text-neutral-500">
          OTP email sign-in stays available for older devices. Add passkeys for faster sign-in where supported.
        </p>

        {passkeySupported ? (
          <Button
            type="button"
            variant="secondary"
            className="gap-2"
            loading={addPasskeyMutation.isPending}
            onClick={() => {
              setError("");
              addPasskeyMutation.mutate();
            }}
          >
            <KeyRound size={16} />
            Add Passkey
          </Button>
        ) : (
          <p className="text-sm text-neutral-500">This browser does not support passkeys.</p>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="space-y-2">
          {passkeysQuery.isLoading && <p className="text-sm text-neutral-500">Loading passkeys...</p>}
          {!passkeysQuery.isLoading && (passkeysQuery.data?.length ?? 0) === 0 && (
            <p className="text-sm text-neutral-500">No passkeys added yet.</p>
          )}
          {passkeysQuery.data?.map((pk) => (
            <div key={pk.id} className="flex items-center justify-between rounded-lg border border-neutral-200 px-3 py-2">
              <div>
                <p className="text-sm font-medium text-neutral-900">{pk.name || "Unnamed passkey"}</p>
                <p className="text-xs text-neutral-500">
                  {pk.deviceType === "multiDevice" ? "Synced device" : "Single device"}
                  {pk.lastUsedAt ? ` • Last used ${new Date(pk.lastUsedAt).toLocaleDateString()}` : ""}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-red-600 hover:text-red-700"
                onClick={() => deletePasskeyMutation.mutate(pk.id)}
                disabled={deletePasskeyMutation.isPending}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          ))}
        </div>
      </div>
    </SettingsSection>
  );
}
