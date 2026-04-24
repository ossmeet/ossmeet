const enc = new TextEncoder();

function base64urlEncode(data: Uint8Array): string {
  const binary = String.fromCharCode(...data);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const padding = (4 - (padded.length % 4)) % 4;
  const binary = atob(padded + "=".repeat(padding));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export interface WhiteboardJWTClaims {
  sub: string;
  name: string;
  role: string;
  sid: string;
  exp: number;
  iss: string;
  aud: string | string[];
}

/**
 * Create a signed JWT for whiteboard server authentication
 */
export async function createWhiteboardJWT(
  secret: string,
  payload: {
    sub: string;
    name: string;
    role: string;
    sid: string; // meeting ID / session ID
  },
  expiresInSeconds = 3600
): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  // Include iss/aud claims for defense-in-depth
  const claims = { ...payload, iss: "ossmeet", aud: "whiteboard", iat: now, exp: now + expiresInSeconds };

  const headerB64 = base64urlEncode(enc.encode(JSON.stringify(header)));
  const payloadB64 = base64urlEncode(enc.encode(JSON.stringify(claims)));
  const message = `${headerB64}.${payloadB64}`;

  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  const sigB64 = base64urlEncode(new Uint8Array(sig));

  return `${message}.${sigB64}`;
}

export async function verifyWhiteboardJWT(
  token: string,
  secret: string
): Promise<WhiteboardJWTClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT format");
  const [header, body, signature] = parts;

  let headerObj: unknown;
  try {
    headerObj = JSON.parse(new TextDecoder().decode(base64urlDecode(header)));
  } catch {
    throw new Error("Invalid JWT header encoding");
  }
  if (!headerObj || typeof headerObj !== "object" || (headerObj as { alg?: string }).alg !== "HS256") {
    throw new Error("Invalid JWT algorithm");
  }

  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );

  let signatureBytes: Uint8Array;
  try {
    signatureBytes = base64urlDecode(signature);
  } catch {
    throw new Error("Invalid JWT signature encoding");
  }

  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes as BufferSource,
    enc.encode(`${header}.${body}`)
  );
  if (!valid) throw new Error("Invalid JWT signature");

  let claims: unknown;
  try {
    claims = JSON.parse(new TextDecoder().decode(base64urlDecode(body)));
  } catch {
    throw new Error("Invalid JWT body encoding");
  }

  if (
    !claims ||
    typeof claims !== "object" ||
    typeof (claims as WhiteboardJWTClaims).sub !== "string" ||
    typeof (claims as WhiteboardJWTClaims).name !== "string" ||
    typeof (claims as WhiteboardJWTClaims).role !== "string" ||
    typeof (claims as WhiteboardJWTClaims).sid !== "string" ||
    typeof (claims as WhiteboardJWTClaims).exp !== "number" ||
    typeof (claims as WhiteboardJWTClaims).iss !== "string" ||
    (typeof (claims as WhiteboardJWTClaims).aud !== "string" &&
      !Array.isArray((claims as WhiteboardJWTClaims).aud))
  ) {
    throw new Error("JWT missing required claims (sub, name, role, sid, exp, iss, aud)");
  }

  const validated = claims as WhiteboardJWTClaims;
  if (validated.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error("JWT expired");
  }
  if (validated.iss !== "ossmeet") {
    throw new Error("Invalid JWT issuer");
  }
  const audienceValid = Array.isArray(validated.aud)
    ? validated.aud.includes("whiteboard")
    : validated.aud === "whiteboard";
  if (!audienceValid) throw new Error("Invalid JWT audience");
  if (!["host", "participant", "guest"].includes(validated.role)) {
    throw new Error("Invalid JWT role");
  }

  return validated;
}
