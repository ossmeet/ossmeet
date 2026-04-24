import { createLazyFileRoute, useRouter } from "@tanstack/react-router";
import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import * as React from "react";
import { DangerZoneSection } from "@/components/settings/danger-zone-section";
import { LinkedAccountsSection } from "@/components/settings/linked-accounts-section";
import { NotificationsSection } from "@/components/settings/notifications-section";
import { PlanSection } from "@/components/settings/plan-section";
import { ProfileSection } from "@/components/settings/profile-section";
import { SecuritySection } from "@/components/settings/security-section";
import { SessionsSection } from "@/components/settings/sessions-section";

export const Route = createLazyFileRoute("/_authed/settings/")({
  component: SettingsPage,
  errorComponent: SettingsError,
});

function SettingsError({ error }: { error: Error }) {
  const router = useRouter();
  const queryErrorResetBoundary = useQueryErrorResetBoundary();

  return (
    <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
      <p className="text-sm text-neutral-500">{error.message || "Failed to load settings"}</p>
      <button
        onClick={() => {
          queryErrorResetBoundary.reset();
          router.invalidate();
        }}
        className="text-sm font-medium text-accent-700 hover:text-accent-800"
      >
        Retry
      </button>
    </div>
  );
}

function SettingsPage() {
  const { session } = Route.useRouteContext();
  const user = session.user;

  const sections = [
    { id: "profile", label: "Profile" },
    { id: "plan-&-billing", label: "Plan & Billing" },
    { id: "security", label: "Security" },
    { id: "active-sessions", label: "Active Sessions" },
    { id: "linked-accounts", label: "Linked Accounts" },
    { id: "notifications", label: "Notifications" },
    { id: "danger-zone", label: "Danger Zone" },
  ];

  const [activeSection, setActiveSection] = React.useState<string>("profile");

  return (
    <div className="mx-auto max-w-6xl animate-fade-in relative pb-12">
      <div className="relative rounded-3xl overflow-hidden p-8 lg:p-10 bg-white shadow-sm ring-1 ring-black/5 mb-8">
        <div className="relative z-10">
          <h1 className="text-3xl lg:text-4xl font-bold tracking-tight text-stone-900 font-heading">
            Settings
          </h1>
          <p className="mt-2 text-stone-500 font-medium">
            Manage your account settings and preferences.
          </p>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-8 items-start">
        {/* Sticky Sidebar Navigation */}
        <div className="hidden lg:block w-56 shrink-0 sticky top-24">
          <nav className="space-y-1">
            {sections.map((sec) => (
              <button
                key={sec.id}
                type="button"
                onClick={() => setActiveSection(sec.id)}
                className={`block w-full text-left px-4 py-2.5 rounded-xl text-[14px] font-medium transition-colors ${
                  activeSection === sec.id
                    ? "bg-stone-200/60 text-stone-900"
                    : "text-stone-600 hover:bg-stone-200/50 hover:text-stone-900"
                }`}
              >
                {sec.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content Area */}
        <div className="flex-1 w-full min-w-0">
          {activeSection === "profile" && <ProfileSection user={user} />}
          {activeSection === "plan-&-billing" && (
            <PlanSection
              plan={user.plan as import("@ossmeet/shared").PlanType}
              subscriptionStatus={user.subscriptionStatus}
              userId={user.id}
            />
          )}
          {activeSection === "security" && <SecuritySection />}
          {activeSection === "active-sessions" && <SessionsSection />}
          {activeSection === "linked-accounts" && <LinkedAccountsSection />}
          {activeSection === "notifications" && <NotificationsSection />}
          {activeSection === "danger-zone" && <DangerZoneSection />}
        </div>
      </div>
    </div>
  );
}
