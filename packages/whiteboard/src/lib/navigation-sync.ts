import { WHITEBOARD_CONFIG } from "./constants";

export interface NavigationStateInput {
  myUserId: string | null;
  canManageNavigation: boolean;
  actingManagerId?: string | null;
  navigationControllerUserId?: string | null;
}

export function normalizeSyncedPageNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const pageNumber = Math.trunc(value);
  if (pageNumber < 1) return null;
  return Math.min(pageNumber, WHITEBOARD_CONFIG.MAX_PAGES);
}

export function deriveNavigationState({
  myUserId,
  canManageNavigation,
  actingManagerId = null,
  navigationControllerUserId = null,
}: NavigationStateInput) {
  const isNavigationController = navigationControllerUserId !== null && navigationControllerUserId === myUserId;
  const isActingManager = actingManagerId !== null && actingManagerId === myUserId;
  const canManageNavigationController = canManageNavigation || isActingManager;
  const shouldSyncPages = navigationControllerUserId ? isNavigationController : canManageNavigationController;

  return {
    isNavigationController,
    isActingManager,
    canManageNavigationController,
    shouldSyncPages,
  };
}
