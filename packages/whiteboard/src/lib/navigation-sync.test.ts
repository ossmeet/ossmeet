import { describe, expect, it } from "vitest";
import {
  deriveNavigationState,
  normalizeSyncedPageNumber,
} from "./navigation-sync";
import { WHITEBOARD_CONFIG } from "./constants";

describe("normalizeSyncedPageNumber", () => {
  it("normalizes positive numeric page values", () => {
    expect(normalizeSyncedPageNumber(1)).toBe(1);
    expect(normalizeSyncedPageNumber(2.9)).toBe(2);
  });

  it("rejects invalid page values", () => {
    expect(normalizeSyncedPageNumber(0)).toBeNull();
    expect(normalizeSyncedPageNumber(-1)).toBeNull();
    expect(normalizeSyncedPageNumber(Number.NaN)).toBeNull();
    expect(normalizeSyncedPageNumber("2")).toBeNull();
  });

  it("caps page values to the whiteboard maximum", () => {
    expect(normalizeSyncedPageNumber(WHITEBOARD_CONFIG.MAX_PAGES + 10)).toBe(
      WHITEBOARD_CONFIG.MAX_PAGES
    );
  });
});

describe("deriveNavigationState", () => {
  it("lets the host drive pages when no navigationController is active", () => {
    expect(
      deriveNavigationState({
        myUserId: "host",
        canManageNavigation: true,
      }).shouldSyncPages
    ).toBe(true);
  });

  it("lets only the navigationController drive pages during handoff", () => {
    expect(
      deriveNavigationState({
        myUserId: "host",
        canManageNavigation: true,
        navigationControllerUserId: "participant",
      }).shouldSyncPages
    ).toBe(false);
    expect(
      deriveNavigationState({
        myUserId: "participant",
        canManageNavigation: false,
        navigationControllerUserId: "participant",
      }).shouldSyncPages
    ).toBe(true);
  });

  it("treats acting manager state as manager-equivalent internally", () => {
    const state = deriveNavigationState({
      myUserId: "participant",
      canManageNavigation: false,
      actingManagerId: "participant",
    });

    expect(state.canManageNavigationController).toBe(true);
    expect(state.shouldSyncPages).toBe(true);
  });
});
