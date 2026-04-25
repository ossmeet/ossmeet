type PaddleCheckoutEvent = {
  name?: string;
  type?: string;
  code?: string;
  detail?: string;
  errors?: Array<{ field?: string; message?: string }>;
};

type PaddleCheckoutOpenOptions = {
  items: Array<{ priceId: string; quantity: number }>;
  customer?: { id?: string; email?: string };
  settings?: {
    displayMode?: "overlay" | "inline";
    variant?: "multi-page" | "one-page";
  };
};

type PaddleGlobal = {
  Initialize: (opts: {
    token: string;
    eventCallback?: (event: PaddleCheckoutEvent) => void;
  }) => void;
  Environment?: { set?: (env: string) => void };
  Checkout: {
    open: (opts: PaddleCheckoutOpenOptions) => void;
  };
};

declare global {
  interface Window {
    Paddle?: PaddleGlobal;
    __ossmeetPaddleScriptPromise?: Promise<void>;
    __ossmeetPaddleInitialized?: boolean;
  }
}

type OpenCheckoutOptions = {
  priceId: string;
  customerId: string;
  email?: string;
};

function getPaddle(): PaddleGlobal {
  const paddle = window.Paddle;
  if (!paddle) throw new Error("Paddle.js is unavailable");
  return paddle;
}

async function loadPaddleJs(): Promise<void> {
  if (typeof window === "undefined") return;
  if (window.Paddle) return;

  const existingPromise = window.__ossmeetPaddleScriptPromise;
  if (existingPromise) {
    await existingPromise;
    return;
  }

  window.__ossmeetPaddleScriptPromise = new Promise<void>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>('script[src="https://cdn.paddle.com/paddle/v2/paddle.js"]');
    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener("error", () => reject(new Error("Failed to load Paddle.js")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://cdn.paddle.com/paddle/v2/paddle.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Paddle.js"));
    document.head.appendChild(script);
  });

  try {
    await window.__ossmeetPaddleScriptPromise;
  } catch (error) {
    window.__ossmeetPaddleScriptPromise = undefined;
    throw error;
  }
}

function logCheckoutEvent(event: PaddleCheckoutEvent): void {
  if (
    event.name === "checkout.error" ||
    event.name === "checkout.payment.error" ||
    event.name === "checkout.warning"
  ) {
    console.error("Paddle checkout event:", event);
  }
}

export async function getPaddleClient(): Promise<PaddleGlobal> {
  if (typeof window === "undefined") {
    throw new Error("Paddle checkout is only available in the browser");
  }

  await loadPaddleJs();

  const paddle = getPaddle();
  if (window.__ossmeetPaddleInitialized) return paddle;

  const clientToken = (import.meta.env as Record<string, string>).VITE_PADDLE_CLIENT_TOKEN;
  const environment = (import.meta.env as Record<string, string>).PADDLE_ENVIRONMENT;

  if (!clientToken) {
    throw new Error("Paddle client token is not configured");
  }

  paddle.Initialize({
    token: clientToken,
    eventCallback: logCheckoutEvent,
  });

  if (environment === "sandbox") {
    paddle.Environment?.set?.("sandbox");
  }

  window.__ossmeetPaddleInitialized = true;
  return paddle;
}

export async function openPaddleCheckout({
  priceId,
  customerId,
  email,
}: OpenCheckoutOptions): Promise<void> {
  const paddle = await getPaddleClient();

  paddle.Checkout.open({
    settings: {
      displayMode: "overlay",
    },
    items: [{ priceId, quantity: 1 }],
    customer: { id: customerId, email },
  });
}
