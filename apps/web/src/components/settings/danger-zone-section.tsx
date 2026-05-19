import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { deleteAccount, requestAccountDeletion } from "@/server/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";

export function DangerZoneSection() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);

  const requestOtpMutation = useMutation({
    mutationFn: () => requestAccountDeletion({ data: {} }),
    onSuccess: () => setOtpSent(true),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteAccount({ data: { confirmation: "DELETE", otp } }),
    onSuccess: async () => {
      await queryClient.cancelQueries();
      queryClient.clear();
      navigate({ to: "/" });
    },
  });

  const canDelete = confirmation === "DELETE" && otp.length === 6;

  function handleCancel() {
    setShowConfirm(false);
    setConfirmation("");
    setOtp("");
    setOtpSent(false);
  }

  return (
    <section className="rounded-xl border border-red-200 bg-white p-6">
      <div className="mb-4 flex items-center gap-2">
        <AlertTriangle size={18} className="text-red-500" />
        <h2 className="text-base font-semibold text-red-900">Danger Zone</h2>
      </div>

      {!showConfirm ? (
        <>
          <p className="text-sm text-neutral-600">
            Once you delete your account, there is no going back. All your data will be permanently removed.
          </p>
          <Button
            variant="secondary"
            className="mt-4 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
            onClick={() => setShowConfirm(true)}
          >
            Delete account
          </Button>
        </>
      ) : (
        <div className="space-y-4">
          <Alert variant="error">
            This action is permanent and cannot be undone. All your data, including meetings, spaces, and account information will be deleted.
          </Alert>

          {!otpSent ? (
            <>
              <p className="text-sm text-neutral-600">
                We'll send a confirmation code to your email address.
              </p>
              <Button
                variant="secondary"
                className="border-red-200 text-red-600 hover:bg-red-50"
                onClick={() => requestOtpMutation.mutate()}
                loading={requestOtpMutation.isPending}
              >
                Send confirmation code
              </Button>
            </>
          ) : (
            <>
              <div>
                <label className="text-sm font-medium text-neutral-700">
                  Enter the confirmation code sent to your email
                </label>
                <Input
                  className="mt-1"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  inputMode="numeric"
                  maxLength={6}
                  autoFocus
                  autoComplete="one-time-code"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-neutral-700">
                  Type <span className="font-mono font-bold">DELETE</span> to confirm
                </label>
                <Input
                  className="mt-1"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  placeholder="DELETE"
                  autoComplete="off"
                />
              </div>
            </>
          )}

          <div className="flex gap-3">
            <Button variant="secondary" onClick={handleCancel}>
              Cancel
            </Button>
            {otpSent && (
              <Button
                className="bg-red-600 text-white hover:bg-red-700"
                onClick={() => deleteMutation.mutate()}
                loading={deleteMutation.isPending}
                disabled={!canDelete}
              >
                Permanently delete account
              </Button>
            )}
          </div>

          {(requestOtpMutation.isError || deleteMutation.isError) && (
            <Alert variant="error">
              {requestOtpMutation.isError
                ? (requestOtpMutation.error instanceof Error ? requestOtpMutation.error.message : "Failed to send code.")
                : (deleteMutation.error instanceof Error ? deleteMutation.error.message : "Failed to delete account.")}
            </Alert>
          )}
        </div>
      )}
    </section>
  );
}
