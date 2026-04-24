const PADDLE_BASE = "https://api.paddle.com";

type PaddleCustomer = { id: string; email: string; name: string };
type PaddleSubscription = {
  id: string;
  status: string;
  items: Array<{ price: { id: string } }>;
  customer_id: string;
};

async function paddleRequest<T>(
  apiKey: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${PADDLE_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Paddle ${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function getOrCreatePaddleCustomer(
  apiKey: string,
  email: string,
  name: string,
): Promise<string> {
  const search = await paddleRequest<{ data: PaddleCustomer[] }>(
    apiKey,
    "GET",
    `/customers?search=${encodeURIComponent(email)}&per_page=1`,
  );
  if (search.data.length > 0) return search.data[0].id;

  const created = await paddleRequest<{ data: PaddleCustomer }>(
    apiKey,
    "POST",
    "/customers",
    { email, name },
  );
  return created.data.id;
}

export async function createPortalSession(
  apiKey: string,
  customerId: string,
  returnUrl: string,
): Promise<string> {
  const res = await paddleRequest<{ data: { urls: { general: { overview: string } } } }>(
    apiKey,
    "POST",
    `/customers/${customerId}/portal-sessions`,
    { urls: [returnUrl] },
  );
  return res.data.urls.general.overview;
}

export async function cancelSubscription(
  apiKey: string,
  subscriptionId: string,
): Promise<void> {
  await paddleRequest(apiKey, "POST", `/subscriptions/${subscriptionId}/cancel`, {
    effective_from: "next_billing_period",
  });
}

export async function getSubscription(
  apiKey: string,
  subscriptionId: string,
): Promise<PaddleSubscription> {
  const res = await paddleRequest<{ data: PaddleSubscription }>(
    apiKey,
    "GET",
    `/subscriptions/${subscriptionId}`,
  );
  return res.data;
}

export async function verifyPaddleWebhookSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
): Promise<boolean> {
  const parts = Object.fromEntries(
    signatureHeader.split(";").map((p) => p.split("=", 2) as [string, string]),
  );
  const ts = parts["ts"];
  const h1 = parts["h1"];
  if (!ts || !h1) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );

  const signedPayload = `${ts}:${rawBody}`;
  const sigBytes = h1.match(/.{2}/g)!.map((b) => parseInt(b, 16));
  return crypto.subtle.verify("HMAC", key, new Uint8Array(sigBytes), encoder.encode(signedPayload));
}
