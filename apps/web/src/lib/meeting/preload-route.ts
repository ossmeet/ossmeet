type MeetingRoutePreloader = {
  loadRouteChunk: (route: any) => Promise<void> | undefined;
  routesByPath: Record<string, any>;
};

type IdleWindow = Window & {
  requestIdleCallback?: (
    callback: IdleRequestCallback,
    options?: IdleRequestOptions,
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

export function preloadMeetingRoute(router: MeetingRoutePreloader) {
  const meetingRoute = router.routesByPath["/$code"];
  if (!meetingRoute) {
    return Promise.resolve();
  }

  const routesToLoad = [meetingRoute.parentRoute, meetingRoute].filter(
    Boolean,
  );

  return Promise.all(
    routesToLoad.map((route) => router.loadRouteChunk(route) ?? Promise.resolve()),
  ).then(() => undefined);
}

export function scheduleIdleTask(task: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  const idleWindow = window as IdleWindow;
  if (idleWindow.requestIdleCallback && idleWindow.cancelIdleCallback) {
    const handle = idleWindow.requestIdleCallback(() => {
      task();
    }, { timeout: 1500 });

    return () => {
      idleWindow.cancelIdleCallback?.(handle);
    };
  }

  const timeoutId = window.setTimeout(task, 250);
  return () => {
    window.clearTimeout(timeoutId);
  };
}
