const GUEST_RECONNECT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const GUEST_RECONNECT_STORAGE_PREFIX = "ossmeet.guest.";
const AUTH_RECONNECT_STORAGE_PREFIX = "ossmeet.auth.admission.";

function getGuestReconnectStorageKey(code: string) {
  return `${GUEST_RECONNECT_STORAGE_PREFIX}${code}`;
}

function getAuthReconnectStorageKey(code: string) {
  return `${AUTH_RECONNECT_STORAGE_PREFIX}${code}`;
}

export function loadReconnectAdmissionId(
  code: string,
  isAuthenticated: boolean,
): string | undefined {
  if (isAuthenticated) {
    try {
      return (
        sessionStorage.getItem(getAuthReconnectStorageKey(code)) ?? undefined
      );
    } catch {
      return undefined;
    }
  }

  try {
    const stored = localStorage.getItem(getGuestReconnectStorageKey(code));
    if (!stored) return undefined;
    const parsed = JSON.parse(stored) as {
      admissionId?: string;
      updatedAt?: number;
    };
    const admissionId = parsed.admissionId;
    if (
      typeof admissionId === "string" &&
      typeof parsed.updatedAt === "number" &&
      Date.now() - parsed.updatedAt < GUEST_RECONNECT_TTL_MS
    ) {
      return admissionId;
    }
    localStorage.removeItem(getGuestReconnectStorageKey(code));
  } catch {
    // ignore corrupt storage
  }

  return undefined;
}

export function persistReconnectAdmissionId(
  code: string,
  admissionId: string,
  isGuest: boolean,
): void {
  try {
    if (isGuest) {
      localStorage.setItem(
        getGuestReconnectStorageKey(code),
        JSON.stringify({
          admissionId,
          updatedAt: Date.now(),
        }),
      );
      return;
    }

    sessionStorage.setItem(getAuthReconnectStorageKey(code), admissionId);
  } catch {
    // storage may be unavailable
  }
}

export function clearReconnectAdmissionId(
  code: string,
  isAuthenticated: boolean,
): void {
  try {
    if (isAuthenticated) {
      sessionStorage.removeItem(getAuthReconnectStorageKey(code));
      return;
    }

    localStorage.removeItem(getGuestReconnectStorageKey(code));
  } catch {
    // storage may be unavailable
  }
}
