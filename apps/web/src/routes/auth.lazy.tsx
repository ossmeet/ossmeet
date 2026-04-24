import { createLazyFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  checkEmailStatus,
  finishPasskeyAuthentication,
  getRememberedUser,
  login,
  signUp,
  startPasskeyAuthentication,
} from "@/server/auth";
import { getGoogleAuthUrl } from "@/server/auth/oauth-google";
import { getErrorMessage } from "@/lib/errors";
import { AuthLayout } from "@/components/auth/auth-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { queryKeys } from "@/lib/query-keys";
import { resetAuthQueryCache } from "@/lib/auth-query-cache";
import { sanitizeInternalRedirect } from "@/lib/safe-redirect";
import { ArrowLeft, KeyRound, Mail, User } from "lucide-react";

export const Route = createLazyFileRoute("/auth")({
  component: AuthPage,
});

type FlowStep = "method" | "existing" | "new";

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  rate_limited: "Too many attempts. Please try again later.",
  oauth_error: "Google sign-in failed. Please try again.",
  auth_failed: "Authentication failed. Please try again.",
};

function AuthPage() {
  const { redirect: redirectTo, error: oauthError } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<FlowStep>("method");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [emailHasPasskey, setEmailHasPasskey] = useState(false);
  const [error, setError] = useState(
    oauthError ? (OAUTH_ERROR_MESSAGES[oauthError] ?? "Something went wrong. Please try again.") : ""
  );
  const [passkeySupported, setPasskeySupported] = useState(false);

  const rememberedQuery = useQuery({
    queryKey: queryKeys.rememberedUser(),
    queryFn: () => getRememberedUser(),
    staleTime: 1000 * 60 * 5,
  });

  useEffect(() => {
    setPasskeySupported(typeof window !== "undefined" && "PublicKeyCredential" in window);
  }, []);

  const checkEmailMutation = useMutation({
    mutationFn: (data: { email: string }) => checkEmailStatus({ data }),
    onSuccess: (result) => {
      setError("");
      if (result.exists) {
        setEmailHasPasskey(result.hasPasskey);
        setStep("existing");
      } else {
        setStep("new");
      }
    },
    onError: (err) => {
      setError(getErrorMessage(err, "Could not continue with this email."));
    },
  });

  const loginMutation = useMutation({
    mutationFn: (data: { email: string }) => login({ data }),
    onSuccess: (result) => {
      navigate({ to: "/verify", search: { email: result.email, mode: "login", redirect: redirectTo } });
    },
    onError: (err) => {
      setError(getErrorMessage(err, "Something went wrong. Please try again."));
    },
  });

  const signUpMutation = useMutation({
    mutationFn: (data: { name: string; email: string }) => signUp({ data }),
    onSuccess: (result) => {
      navigate({ to: "/verify", search: { email: result.email, mode: "signup", redirect: redirectTo } });
    },
    onError: (err) => {
      setError(getErrorMessage(err, "Something went wrong. Please try again."));
    },
  });

  const googleMutation = useMutation({
    mutationFn: async () => {
      const { url } = await getGoogleAuthUrl({ data: { redirectTo } });
      window.location.href = url;
    },
  });

  const passkeyMutation = useMutation({
    mutationFn: async () => {
      const start = await startPasskeyAuthentication();
      const { startAuthentication } = await import("@simplewebauthn/browser");
      const response = await startAuthentication({ optionsJSON: start.options });
      return finishPasskeyAuthentication({
        data: { challengeId: start.challengeId, response },
      });
    },
    onSuccess: async () => {
      await resetAuthQueryCache(queryClient);
      const safeTo = sanitizeInternalRedirect(redirectTo) ?? "/dashboard";
      await navigate({ to: safeTo });
    },
    onError: (err) => {
      setError(getErrorMessage(err, "Passkey sign-in failed. Use email code instead."));
    },
  });

  const isPending =
    checkEmailMutation.isPending ||
    loginMutation.isPending ||
    signUpMutation.isPending ||
    googleMutation.isPending ||
    passkeyMutation.isPending;

  function resetToMethod() {
    setStep("method");
    setEmailHasPasskey(false);
    setName("");
    setError("");
  }

  function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    checkEmailMutation.mutate({ email });
  }

  function handleRememberedLogin() {
    const remembered = rememberedQuery.data;
    if (!remembered?.email) return;
    setError("");
    setEmail(remembered.email);
    checkEmailMutation.mutate({ email: remembered.email });
  }

  function handleCreateAccountSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    signUpMutation.mutate({ name, email });
  }

  return (
    <AuthLayout>
      <div className="mb-8 text-center lg:hidden">
        <div className="inline-flex items-center gap-2">
          <div className="h-10 w-10 rounded-xl bg-accent-700" />
        </div>
      </div>

      {step === "method" && (
        <div className="animate-fade-in">
          <h1 className="text-2xl font-bold text-neutral-900 font-heading">Welcome to OSSMeet</h1>
          <p className="mt-2 text-sm text-neutral-500">Continue with Google or email.</p>

          <div className="mt-6 space-y-4">
            <Button
              type="button"
              variant="secondary"
              className="w-full gap-2"
              onClick={() => googleMutation.mutate()}
              disabled={isPending}
            >
              <GoogleIcon />
              Continue with Google
            </Button>

            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-neutral-200" />
              <span className="text-xs text-neutral-400">or</span>
              <div className="h-px flex-1 bg-neutral-200" />
            </div>

            {rememberedQuery.data && (
              <Button
                type="button"
                variant="secondary"
                className="w-full gap-2"
                onClick={handleRememberedLogin}
                disabled={isPending}
              >
                <Mail size={16} />
                Continue with {rememberedQuery.data.email}
              </Button>
            )}

            <form onSubmit={handleEmailSubmit} className="space-y-4">
              <Input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                leftIcon={<Mail size={18} className="text-neutral-400" />}
                required
                autoComplete="email"
                autoFocus
              />

              {error && <p className="text-sm text-red-600">{error}</p>}

              <Button type="submit" className="w-full" loading={checkEmailMutation.isPending}>
                Continue with email
              </Button>
            </form>
          </div>
        </div>
      )}

      {step === "existing" && (
        <div className="animate-fade-in">
          <button
            onClick={resetToMethod}
            className="mb-6 inline-flex items-center gap-2 text-sm text-neutral-500 transition-colors hover:text-accent-700"
          >
            <ArrowLeft size={16} />
            Use another email
          </button>

          <h1 className="text-2xl font-bold text-neutral-900 font-heading">Welcome back</h1>
          <p className="mt-2 text-sm text-neutral-500">
            <span className="font-medium text-neutral-700">{email}</span> already has an account.
          </p>

          <div className="mt-6 space-y-4">
            {passkeySupported && emailHasPasskey && (
              <Button
                type="button"
                variant="secondary"
                className="w-full gap-2"
                onClick={() => {
                  setError("");
                  passkeyMutation.mutate();
                }}
                disabled={isPending}
              >
                <KeyRound size={16} />
                Continue with Passkey
              </Button>
            )}
            <Button
              type="button"
              className="w-full"
              loading={loginMutation.isPending}
              onClick={() => {
                setError("");
                loginMutation.mutate({ email });
              }}
            >
              Send email code
            </Button>

            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
        </div>
      )}

      {step === "new" && (
        <div className="animate-fade-in">
          <button
            onClick={resetToMethod}
            className="mb-6 inline-flex items-center gap-2 text-sm text-neutral-500 transition-colors hover:text-accent-700"
          >
            <ArrowLeft size={16} />
            Use another email
          </button>

          <h1 className="text-2xl font-bold text-neutral-900 font-heading">Create your account</h1>
          <p className="mt-2 text-sm text-neutral-500">
            {email} is new here. Add your name to continue.
          </p>

          <form onSubmit={handleCreateAccountSubmit} className="mt-6 space-y-4">
            <Input
              type="text"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              leftIcon={<User size={18} className="text-neutral-400" />}
              required
              autoComplete="name"
              autoFocus
            />

            {error && <p className="text-sm text-red-600">{error}</p>}

            <Button type="submit" className="w-full" loading={signUpMutation.isPending}>
              Send verification code
            </Button>
          </form>
        </div>
      )}
    </AuthLayout>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.29h6.44a5.5 5.5 0 0 1-2.39 3.61v3h3.88c2.27-2.09 3.56-5.17 3.56-8.63Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.95-2.9l-3.88-3c-1.07.72-2.44 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.95H1.26v3.11A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.3A7.2 7.2 0 0 1 4.9 12c0-.8.14-1.57.37-2.3V6.59H1.26a12 12 0 0 0 0 10.82l4.01-3.11Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.76 0 3.34.61 4.58 1.8l3.43-3.43C17.95 1.07 15.23 0 12 0A12 12 0 0 0 1.26 6.59l4.01 3.11c.95-2.84 3.6-4.95 6.73-4.95Z"
      />
    </svg>
  );
}
