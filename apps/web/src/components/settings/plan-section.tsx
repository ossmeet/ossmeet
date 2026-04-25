import * as React from "react";
import { CreditCard, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SettingsSection } from "./settings-section";
import { getPlanLimits, type PlanType } from "@ossmeet/shared";
import { openPaddleCheckout } from "@/lib/paddle-checkout";

function formatDuration(minutes: number | null): string {
  if (minutes === null) return "Unlimited";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours} hours`;
}

interface PlanSectionProps {
  plan?: PlanType;
  subscriptionStatus?: "active" | "canceled" | "past_due" | "trialing" | "paused" | null;
}

export function PlanSection({ plan = "free", subscriptionStatus }: PlanSectionProps) {
  const limits = getPlanLimits(plan);
  const [loading, setLoading] = React.useState<"pro" | "org" | "portal" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const hasActiveSub = subscriptionStatus === "active" || subscriptionStatus === "trialing";

  async function startCheckout(targetPlan: "pro" | "org") {
    setLoading(targetPlan);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: targetPlan }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { customerId, priceId, email } = (await res.json()) as {
        customerId: string;
        priceId: string;
        email: string;
      };
      await openPaddleCheckout({
        priceId,
        customerId,
        email,
      });
    } catch (err) {
      console.error("Checkout failed:", err);
      setError("Something went wrong. Please try again or contact support.");
    } finally {
      setLoading(null);
    }
  }

  async function openPortal() {
    setLoading("portal");
    try {
      window.location.href = "/api/billing/portal";
    } finally {
      setLoading(null);
    }
  }

  return (
    <SettingsSection icon={CreditCard} title="Plan & Billing">
      <div className="flex items-center gap-3">
        <Badge variant="primary" size="md">
          {plan === "free" ? "Free Plan" : plan === "pro" ? "Pro Plan" : "Org Plan"}
        </Badge>
        {subscriptionStatus && subscriptionStatus !== "active" && (
          <Badge variant="warning" size="md" className="capitalize">
            {subscriptionStatus.replace("_", " ")}
          </Badge>
        )}
      </div>
      <p className="mt-2 text-sm text-neutral-500">
        {plan === "free"
          ? "You are on the free plan. Upgrade to unlock more features."
          : `You are on the ${plan} plan.`}
      </p>
      <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-neutral-500">Concurrent meetings</p>
            <p className="font-medium text-neutral-900">{limits.maxConcurrentMeetings ?? "Unlimited"}</p>
          </div>
          <div>
            <p className="text-neutral-500">Max participants</p>
            <p className="font-medium text-neutral-900">{limits.maxParticipants ?? "Unlimited"}</p>
          </div>
          <div>
            <p className="text-neutral-500">Meeting duration</p>
            <p className="font-medium text-neutral-900">{formatDuration(limits.maxMeetingDurationMinutes)}</p>
          </div>
          <div>
            <p className="text-neutral-500">Spaces</p>
            <p className="font-medium text-neutral-900">{limits.maxSpaces ?? "Unlimited"}</p>
          </div>
        </div>
      </div>

      {hasActiveSub ? (
        <Button
          variant="secondary"
          className="mt-4 gap-2"
          onClick={openPortal}
          disabled={loading === "portal"}
        >
          <ExternalLink size={14} />
          {loading === "portal" ? "Opening..." : "Manage billing"}
        </Button>
      ) : (
        <div className="mt-4 flex gap-3">
          {plan !== "pro" && plan !== "org" && (
            <Button
              variant="secondary"
              onClick={() => startCheckout("pro")}
              disabled={loading !== null}
            >
              {loading === "pro" ? "Loading..." : "Upgrade to Pro — $5/mo"}
            </Button>
          )}
          {plan !== "org" && (
            <Button
              variant="secondary"
              onClick={() => startCheckout("org")}
              disabled={loading !== null}
            >
              {loading === "org" ? "Loading..." : "Upgrade to Org — $25/mo"}
            </Button>
          )}
        </div>
      )}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </SettingsSection>
  );
}
