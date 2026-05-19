import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

interface CloudflareRequest extends Request {
  cf?: {
    country?: string;
  };
}

function normalizeCountry(value: string | undefined): string | null {
  if (!value || !/^[A-Za-z]{2}$/.test(value)) return null;
  return value.toUpperCase();
}

export const getClientMeetingHints = createServerFn({ method: "GET" })
  .handler(async () => {
    const request = getRequest() as CloudflareRequest;
    return {
      country: normalizeCountry(request.cf?.country),
      acceptLanguage: request.headers.get("Accept-Language")?.slice(0, 200) ?? null,
    };
  });
