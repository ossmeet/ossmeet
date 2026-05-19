export function OrbAnimation() {
  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* Primary orb */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <div className="h-64 w-64 rounded-full bg-gradient-to-br from-accent-500/30 to-amber-400/30 blur-3xl animate-pulse-glow" />
      </div>

      {/* Orbiting particles */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <div className="animate-[orbit_20s_linear_infinite]">
          <div className="h-3 w-3 rounded-full bg-accent-400/60 shadow-glow-accent" />
        </div>
      </div>
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <div className="animate-[orbit_20s_linear_infinite]" style={{ animationDelay: "-7s", animationDuration: "15s" }}>
          <div className="h-2 w-2 rounded-full bg-amber-400/60 shadow-sm" />
        </div>
      </div>
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <div className="animate-[orbit_20s_linear_infinite]" style={{ animationDelay: "-14s", animationDuration: "25s" }}>
          <div className="h-2.5 w-2.5 rounded-full bg-accent-300/40" />
        </div>
      </div>

      {/* Small floating particles */}
      <div className="absolute left-[20%] top-[30%] h-1.5 w-1.5 rounded-full bg-accent-300/50 animate-float" />
      <div
        className="absolute right-[25%] top-[60%] h-1 w-1 rounded-full bg-amber-300/50 animate-float"
        style={{ animationDelay: "-2s" }}
      />
      <div
        className="absolute left-[60%] top-[20%] h-1 w-1 rounded-full bg-violet-400/40 animate-float"
        style={{ animationDelay: "-4s" }}
      />
    </div>
  );
}
