import { Link } from "@tanstack/react-router";
import { Video } from "lucide-react";
import { OrbAnimation } from "./orb-animation";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

const taglines = [
  "Video meetings reimagined for education.",
  "Infinite canvas. Infinite possibilities.",
  "Collaborate in real-time, from anywhere.",
  "Spaces that keep your team organized.",
];

export function AuthLayout({ children }: { children: ReactNode }) {
  const [taglineIndex, setTaglineIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  // Track inner setTimeout to prevent state updates after unmount
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    const interval = setInterval(() => {
      setVisible(false);
      timeoutId = setTimeout(() => {
        setTaglineIndex((i) => (i + 1) % taglines.length);
        setVisible(true);
      }, 300);
    }, 4000);
    return () => {
      clearInterval(interval);
      clearTimeout(timeoutId);
    };
  }, []);

  return (
    <div className="flex min-h-screen">
      {/* Left panel — gradient (hidden on mobile) */}
      <div className="relative hidden w-[40%] overflow-hidden bg-gradient-to-br from-accent-950 via-accent-900 to-neutral-950 lg:block">
        <OrbAnimation />

        {/* Dot grid overlay */}
        <div className="absolute inset-0 bg-dot-grid-dense opacity-30 pointer-events-none" />

        {/* Brand + tagline overlay */}
        <div className="absolute inset-0 flex flex-col items-center justify-center p-12 text-center">
          <Link to="/" className="mb-8 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20 hover:scale-105 transition-transform duration-300">
              <Video className="text-2xl text-accent-300" />
            </div>
            <span className="text-3xl font-bold text-white font-heading tracking-tight">
              OSSMeet
            </span>
          </Link>
          <p
            className="text-lg font-medium text-accent-100/80 transition-all duration-300 shadow-sm"
            style={{ opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(4px)" }}
          >
            {taglines[taglineIndex]}
          </p>
        </div>
      </div>

      {/* Right panel — form area */}
      <div className="flex flex-1 items-center justify-center bg-stone-50 px-4 py-8 sm:px-8">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
