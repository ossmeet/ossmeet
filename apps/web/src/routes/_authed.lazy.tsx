import { useState } from "react";
import { createLazyFileRoute, Link, Outlet, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { logout } from "@/server/auth";
import { Sidebar } from "@/components/layout/sidebar";
import { MobileNav } from "@/components/layout/mobile-nav";
import { UserMenu } from "@/components/layout/user-menu";
import { Bell } from "lucide-react";
import { cn } from "@ossmeet/shared";
import { BrandMark } from "@/components/brand-mark";

export const Route = createLazyFileRoute("/_authed")({
  component: AuthedLayout,
  errorComponent: AuthedErrorComponent,
});

function AuthedErrorComponent({ error: _error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="text-center">
        <h2 className="text-xl font-semibold text-neutral-900">Something went wrong</h2>
        <p className="mt-2 text-sm text-neutral-500">
          We couldn&apos;t load this page. Please try again.
        </p>
        <div className="mt-4 flex items-center justify-center gap-3">
          <button
            onClick={() => {
              reset();
              router.invalidate();
            }}
            className="rounded-lg bg-accent-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-800"
          >
            Retry
          </button>
          <Link
            to="/dashboard"
            className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
          >
            Go to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

function AuthedLayout() {
  const { session } = Route.useRouteContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const handleLogout = async () => {
    try {
      await logout();
      await queryClient.cancelQueries();
      queryClient.clear();
      await router.navigate({ to: "/" });
    } catch (error) {
      console.error("Logout navigation failed:", error);
      window.location.href = "/";
    }
  };

  return (
    <div className="flex min-h-screen bg-stone-50">
      {/* Solid professional backdrop */}
      <div className="fixed inset-0 pointer-events-none bg-stone-50" />

      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((v) => !v)}
      />

      <div className="flex min-w-0 flex-1 flex-col relative">
        {/* Mobile Header */}
        <div className="flex items-center justify-between border-b border-stone-200/80 bg-white/70 backdrop-blur-xl px-4 py-3 lg:hidden">
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-accent-600 to-accent-700 shadow-sm">
              <BrandMark className="h-4.5 w-4.5 text-white" />
            </div>
            <span className="text-lg font-bold tracking-tight text-stone-800 font-heading">
              OSSMeet
            </span>
          </Link>
          <UserMenu
            user={{
              name: session.user.name,
              email: session.user.email,
              image: session.user.image,
            }}
            onLogout={handleLogout}
          />
        </div>

        {/* Desktop Header - Glassmorphism */}
        <header className="hidden lg:flex items-center justify-between border-b border-stone-200/60 bg-white/60 backdrop-blur-xl px-6 py-3 sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <span className="text-sm text-stone-400 font-medium">Dashboard</span>
          </div>

          <div className="flex items-center gap-3">
            <button className="relative p-2.5 rounded-xl text-stone-500 hover:bg-stone-100/80 hover:text-stone-700 transition-all duration-200">
              <Bell size={20} />
              <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-accent-500 ring-2 ring-white hidden" />
            </button>

            <div className="h-6 w-px bg-stone-200/80" />

            <UserMenu
              user={{
                name: session.user.name,
                email: session.user.email,
                image: session.user.image,
              }}
              onLogout={handleLogout}
            />
          </div>
        </header>

        <main className={cn(
          "flex-1 transition-all duration-300 relative",
          "p-4 pb-24 sm:p-6 lg:p-8 lg:pb-8"
        )}>
          <div className="animate-fade-in">
            <Outlet />
          </div>
        </main>
      </div>

      <MobileNav />
    </div>
  );
}
