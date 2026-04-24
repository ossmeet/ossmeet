import { createLazyFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  verifyOTP,
  resendOTP,
  verifyLoginOtp,
  resendLoginOtp,
  startPasskeyRegistration,
  finishPasskeyRegistration,
} from "@/server/auth";
import { resetAuthQueryCache } from "@/lib/auth-query-cache";
import { sanitizeInternalRedirect } from "@/lib/safe-redirect";
import { getErrorMessage } from "@/lib/errors";
import { Spinner } from "@/components/ui/spinner";
import { AuthLayout } from "@/components/auth/auth-layout";
import { KeyRound, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createLazyFileRoute("/verify")({
  component: VerifyPage,
});

function VerifyPage() {
  const { email, mode, redirect: redirectTo } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isLogin = mode === "login";

  const [otp, setOtp] = useState(Array(6).fill(""));
  const [error, setError] = useState("");
  const [resendMsg, setResendMsg] = useState("");
  const [passkeySupported, setPasskeySupported] = useState(false);
  const [showPostSignupStep, setShowPostSignupStep] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const verifyMutation = useMutation({
    mutationFn: (otpCode: string) =>
      isLogin
        ? verifyLoginOtp({ data: { email, otp: otpCode } })
        : verifyOTP({ data: { email, otp: otpCode } }),
    onSuccess: async () => {
      await resetAuthQueryCache(queryClient);
      if (!isLogin && passkeySupported) {
        setShowPostSignupStep(true);
        return;
      }
      const safeTo = sanitizeInternalRedirect(redirectTo) ?? "/dashboard";
      await navigate({ to: safeTo });
    },
    onError: (err) => {
      setError(getErrorMessage(err, "Invalid or expired code."));
      setOtp(Array(6).fill(""));
      inputRefs.current[0]?.focus();
    },
  });

  const setupPasskeyMutation = useMutation({
    mutationFn: async () => {
      const start = await startPasskeyRegistration();
      const { startRegistration } = await import("@simplewebauthn/browser");
      const response = await startRegistration({ optionsJSON: start.options });
      await finishPasskeyRegistration({
        data: { response },
      });
    },
    onSuccess: async () => {
      const safeTo = sanitizeInternalRedirect(redirectTo) ?? "/dashboard";
      await navigate({ to: safeTo });
    },
    onError: (err) => {
      setError(getErrorMessage(err, "Passkey setup failed. You can skip and add it later in settings."));
    },
  });

  useEffect(() => {
    setPasskeySupported(typeof window !== "undefined" && "PublicKeyCredential" in window);
  }, []);

  const resendMutation = useMutation({
    mutationFn: () =>
      isLogin
        ? resendLoginOtp({ data: { email } })
        : resendOTP({ data: { email } }),
    onSuccess: (result) => {
      const resent = typeof result === "object" && result !== null && "resent" in result
        ? (result as { resent: boolean }).resent
        : true;
      setResendMsg(resent ? "A new code has been sent." : "Please wait before requesting another code.");
      setError("");
    },
    onError: (err) => {
      setResendMsg(getErrorMessage(err, "Failed to resend code. Please try again."));
    },
  });

  function handleChange(index: number, value: string) {
    if (!/^\d*$/.test(value)) return;
    const next = [...otp];
    next[index] = value.slice(-1);
    setOtp(next);
    setError("");
    setResendMsg("");

    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    const code = next.join("");
    if (code.length === 6 && next.every((digit) => digit !== "")) {
      verifyMutation.mutate(code);
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault();
    setError("");
    setResendMsg("");

    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!text) return;

    const next = Array(6).fill("");
    for (let i = 0; i < text.length; i++) next[i] = text[i];
    setOtp(next);

    if (text.length === 6) {
      verifyMutation.mutate(text);
    } else {
      inputRefs.current[text.length]?.focus();
    }
  }

  if (showPostSignupStep) {
    return (
      <AuthLayout>
        <div className="animate-fade-in-up">
          <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-accent-100">
            <KeyRound size={24} className="text-accent-700" />
          </div>
          <h1 className="text-2xl font-bold text-neutral-900">Save a passkey?</h1>
          <p className="mt-2 text-sm text-neutral-500">
            Passkeys help you sign in even if you lose email access.
          </p>
          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
          <div className="mt-6 space-y-3">
            <Button
              type="button"
              className="w-full"
              loading={setupPasskeyMutation.isPending}
              onClick={() => {
                setError("");
                setupPasskeyMutation.mutate();
              }}
            >
              Save passkey
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              onClick={() => {
                const safeTo = sanitizeInternalRedirect(redirectTo) ?? "/dashboard";
                navigate({ to: safeTo });
              }}
            >
              Skip for now
            </Button>
          </div>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <div className="animate-fade-in-up">
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-accent-100">
          <Mail size={24} className="text-accent-700" />
        </div>

        <h1 className="text-2xl font-bold text-neutral-900">
          {isLogin ? "Check your email" : "Verify your email"}
        </h1>
        <p className="mt-2 text-sm text-neutral-500">
          Enter the 6-digit code sent to{" "}
          <span className="font-medium text-neutral-700">{email}</span>
        </p>
        {isLogin && (
          <p className="mt-2 text-xs text-neutral-400">
            If this email does not have an account, no sign-in code will arrive.
          </p>
        )}

        <div className="mt-8 flex justify-center gap-2" onPaste={handlePaste}>
          {otp.map((digit, i) => (
            <input
              key={i}
              ref={(el) => {
                inputRefs.current[i] = el;
              }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              onChange={(e) => handleChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              disabled={verifyMutation.isPending || setupPasskeyMutation.isPending}
              className="h-12 w-10 rounded-lg border border-neutral-300 bg-white text-center font-mono text-lg font-semibold text-neutral-900 transition-all duration-150 focus-visible:border-accent-500 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/20 disabled:opacity-50"
              autoFocus={i === 0}
            />
          ))}
        </div>

        {verifyMutation.isPending && (
          <div className="mt-4 flex justify-center">
            <Spinner brand />
          </div>
        )}

        {error && (
          <p className="mt-4 text-center text-sm text-red-600">{error}</p>
        )}
        {resendMsg && (
          <p className="mt-4 text-center text-sm text-neutral-600">{resendMsg}</p>
        )}

        <div className="mt-8 text-center">
          <p className="text-sm text-neutral-500">
            Didn&apos;t receive a code?{" "}
            <button
              type="button"
              onClick={() => resendMutation.mutate()}
              disabled={resendMutation.isPending}
              className="font-medium text-accent-700 hover:text-accent-800 disabled:opacity-50"
            >
              {resendMutation.isPending ? "Sending..." : "Resend"}
            </button>
          </p>
        </div>
      </div>
    </AuthLayout>
  );
}
