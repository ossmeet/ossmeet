import { createLazyFileRoute, Link } from "@tanstack/react-router";
import { lazy, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, X, Zap, Building2, Users, ArrowLeft } from "lucide-react";
import { getPlanLimits, type PlanType } from "@ossmeet/shared";
import { useIdleEnabled } from "@/lib/hooks/use-idle-enabled";
import { openPaddleCheckout } from "@/lib/paddle-checkout";
import { sessionQueryOptions } from "@/queries/session";

export const Route = createLazyFileRoute("/pricing")({
  component: PricingPage,
});

const BrandMark = lazy(() =>
  import("@/components/brand-mark").then((m) => ({ default: m.BrandMark }))
);

interface PricingTier {
  id: PlanType;
  name: string;
  description: string;
  price: string;
  priceLabel: string;
  icon: React.ReactNode;
  popular?: boolean;
}

const TIERS: PricingTier[] = [
  {
    id: "free",
    name: "Free",
    description: "Perfect for individuals and small teams getting started",
    price: "$0",
    priceLabel: "Forever free",
    icon: <Users className="h-5 w-5" />,
  },
  {
    id: "pro",
    name: "Pro",
    description: "For professionals who need more power and flexibility",
    price: "$5",
    priceLabel: "per user / month",
    icon: <Zap className="h-5 w-5" />,
    popular: true,
  },
  {
    id: "org",
    name: "Organization",
    description: "Advanced features for teams and organizations",
    price: "$25",
    priceLabel: "per user / month",
    icon: <Building2 className="h-5 w-5" />,
  },
];

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "Unlimited";
  const gb = bytes / (1024 * 1024 * 1024);
  return `${gb} GB`;
}

function formatDuration(minutes: number | null): string {
  if (minutes === null) return "Unlimited";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours} hours`;
}

interface FeatureRow {
  label: string;
  getValue: (plan: PlanType) => React.ReactNode;
  getIcon?: (plan: PlanType) => React.ReactNode;
}

const FEATURES: FeatureRow[] = [
  {
    label: "Participants per meeting",
    getValue: (plan) => getPlanLimits(plan).maxParticipants,
  },
  {
    label: "Concurrent meetings",
    getValue: (plan) => {
      const val = getPlanLimits(plan).maxConcurrentMeetings;
      return val === null ? "Unlimited" : val;
    },
  },
  {
    label: "Meeting duration",
    getValue: (plan) => formatDuration(getPlanLimits(plan).maxMeetingDurationMinutes),
  },
  {
    label: "Spaces",
    getValue: (plan) => {
      const val = getPlanLimits(plan).maxSpaces;
      return val === null ? "Unlimited" : val;
    },
  },
  {
    label: "Storage",
    getValue: (plan) => formatBytes(getPlanLimits(plan).maxStorageBytes),
  },
  {
    label: "Cloud recording",
    getIcon: (plan) =>
      getPlanLimits(plan).recordingEnabled ? (
        <Check className="h-5 w-5 text-green-600" />
      ) : (
        <X className="h-5 w-5 text-neutral-300" />
      ),
    getValue: () => null,
  },
  {
    label: "PDF export",
    getIcon: (plan) =>
      getPlanLimits(plan).pdfExportEnabled ? (
        <Check className="h-5 w-5 text-green-600" />
      ) : (
        <X className="h-5 w-5 text-neutral-300" />
      ),
    getValue: () => null,
  },
  {
    label: "AI assistant",
    getIcon: (plan) =>
      getPlanLimits(plan).aiAssistantEnabled ? (
        <Check className="h-5 w-5 text-green-600" />
      ) : (
        <X className="h-5 w-5 text-neutral-300" />
      ),
    getValue: () => null,
  },
  {
    label: "Reusable meeting links",
    getIcon: (plan) =>
      getPlanLimits(plan).reusableMeetingLink ? (
        <Check className="h-5 w-5 text-green-600" />
      ) : (
        <X className="h-5 w-5 text-neutral-300" />
      ),
    getValue: () => null,
  },
  {
    label: "Custom meeting codes",
    getIcon: (plan) =>
      getPlanLimits(plan).customMeetingCode ? (
        <Check className="h-5 w-5 text-green-600" />
      ) : (
        <X className="h-5 w-5 text-neutral-300" />
      ),
    getValue: () => null,
  },
  {
    label: "Custom subdomain",
    getIcon: (plan) =>
      getPlanLimits(plan).customSubdomain ? (
        <Check className="h-5 w-5 text-green-600" />
      ) : (
        <X className="h-5 w-5 text-neutral-300" />
      ),
    getValue: () => null,
  },
  {
    label: "Branded experience",
    getIcon: (plan) =>
      getPlanLimits(plan).brandedExperience ? (
        <Check className="h-5 w-5 text-green-600" />
      ) : (
        <X className="h-5 w-5 text-neutral-300" />
      ),
    getValue: () => null,
  },
  {
    label: "Admin dashboard",
    getIcon: (plan) =>
      getPlanLimits(plan).adminDashboard ? (
        <Check className="h-5 w-5 text-green-600" />
      ) : (
        <X className="h-5 w-5 text-neutral-300" />
      ),
    getValue: () => null,
  },
];

function PricingCard({
  tier,
  currentPlan,
}: {
  tier: PricingTier;
  currentPlan?: PlanType | null;
}) {
  const isCurrentPlan = currentPlan === tier.id;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUpgrade() {
    if (tier.id === "free") return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: tier.id }),
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
      setLoading(false);
    }
  }

  return (
    <div
      className={`relative flex flex-col rounded-2xl border bg-white p-5 transition-all hover:shadow-lg ${
        isCurrentPlan
          ? "border-green-400 shadow-elevated ring-2 ring-green-400/20"
          : tier.popular
            ? "border-accent-400 shadow-elevated"
            : "border-neutral-200/80 shadow-soft"
      }`}
    >
      {isCurrentPlan ? (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="inline-flex items-center rounded-full bg-green-600 px-3 py-1 text-xs font-bold text-white">
            Your current plan
          </span>
        </div>
      ) : tier.popular ? (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="inline-flex items-center rounded-full bg-accent-700 px-3 py-1 text-xs font-bold text-white">
            Most Popular
          </span>
        </div>
      ) : null}

      <div className="mb-2 flex items-center gap-3">
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-xl ${
            tier.popular ? "bg-accent-100 text-accent-700" : "bg-neutral-100 text-neutral-600"
          }`}
        >
          {tier.icon}
        </div>
        <div>
          <h3 className="font-bold text-neutral-900 font-heading">{tier.name}</h3>
        </div>
      </div>

      <p className="mb-2 text-sm text-neutral-500">{tier.description}</p>

      <div className="mb-3">
        <span className="text-3xl font-bold text-neutral-900">{tier.price}</span>
        <span className="ml-2 text-sm text-neutral-500">{tier.priceLabel}</span>
      </div>

      <div className="space-y-2">
        {FEATURES.map((feature) => (
          <div key={feature.label} className="flex items-center justify-between text-sm">
            <span className="text-neutral-600">{feature.label}</span>
            {feature.getIcon ? (
              feature.getIcon(tier.id)
            ) : (
              <span className="font-medium text-neutral-900">{feature.getValue(tier.id)}</span>
            )}
          </div>
        ))}
      </div>

      <div className="mt-auto pt-3">
        {isCurrentPlan ? (
          <Link
            to="/dashboard"
            className="inline-flex w-full items-center justify-center rounded-xl bg-green-100 py-3 text-sm font-bold text-green-800 transition-all hover:bg-green-200"
          >
            Go to Dashboard
          </Link>
        ) : currentPlan && tier.id !== "free" ? (
          <>
            <button
              onClick={handleUpgrade}
              disabled={loading}
              className={`inline-flex w-full items-center justify-center rounded-xl py-3 text-sm font-bold transition-all disabled:opacity-60 ${
                tier.popular
                  ? "bg-accent-700 text-white hover:bg-accent-800"
                  : "bg-neutral-100 text-neutral-900 hover:bg-neutral-200"
              }`}
            >
              {loading ? "Loading..." : "Upgrade"}
            </button>
            {error && (
              <p className="mt-2 text-center text-xs text-red-600">{error}</p>
            )}
          </>
        ) : (
          <Link
            to="/auth"
            search={{ mode: "signup" }}
            className={`inline-flex w-full items-center justify-center rounded-xl py-3 text-sm font-bold transition-all ${
              tier.popular
                ? "bg-accent-700 text-white hover:bg-accent-800"
                : "bg-neutral-100 text-neutral-900 hover:bg-neutral-200"
            }`}
          >
            Get Started
          </Link>
        )}
      </div>
    </div>
  );
}

function PricingPage() {
  const sessionEnabled = useIdleEnabled();
  const { data: session } = useQuery({
    ...sessionQueryOptions(),
    enabled: sessionEnabled,
  });
  const currentPlan = session?.user?.plan;

  return (
    <div className="min-h-screen bg-[#f5f4f2] font-sans">
      {/* Header */}
      <header className="relative z-50 px-6 py-5">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-700">
              <BrandMark className="h-4 w-4 text-white" />
            </div>
            <span className="font-heading text-lg font-bold tracking-tight text-neutral-900">
              OSSMeet
            </span>
          </Link>
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm font-medium text-neutral-600 transition-colors hover:text-accent-700"
          >
            <ArrowLeft size={16} />
            Back to home
          </Link>
        </div>
      </header>

      {/* Main content */}
      <main className="relative z-10 mx-auto max-w-6xl px-6 pb-6 pt-0">
        {/* Hero */}
        <div className="mb-6 text-center">
          <h1 className="font-heading text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl">
            Simple, transparent pricing
          </h1>
          <p className="mx-auto mt-2 max-w-2xl text-base text-neutral-600">
            Start free, upgrade when you need more. No hidden fees, cancel anytime.
          </p>
        </div>

        {/* Pricing cards */}
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {TIERS.map((tier) => (
            <PricingCard key={tier.id} tier={tier} currentPlan={currentPlan} />
          ))}
        </div>

        {/* FAQ or additional info */}
        <div className="mt-8 rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-soft">
          <h2 className="font-heading text-lg font-bold text-neutral-900">
            Frequently asked questions
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <h3 className="font-semibold text-neutral-900">Can I change plans anytime?</h3>
              <p className="mt-1 text-sm text-neutral-600">
                Yes, you can upgrade or downgrade at any time. Changes take effect immediately.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-neutral-900">What payment methods do you accept?</h3>
              <p className="mt-1 text-sm text-neutral-600">
                We accept all major credit cards and PayPal. Enterprise customers can pay by invoice.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-neutral-900">Is there a discount for annual billing?</h3>
              <p className="mt-1 text-sm text-neutral-600">
                Yes, save 20% when you choose annual billing on Pro and Organization plans.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-neutral-900">What happens when I hit my limits?</h3>
              <p className="mt-1 text-sm text-neutral-600">
                We will notify you before you reach any limits. You can upgrade instantly to continue.
              </p>
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="mt-4 text-center">
          <p className="text-neutral-600">
            Questions about enterprise pricing?{" "}
            <a
              href="mailto:support@ossmeet.com"
              className="font-medium text-accent-700 hover:text-accent-800 hover:underline"
            >
              Contact us
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}
