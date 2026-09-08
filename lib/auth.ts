export const COOKIE_NAME = "auth-token";
export const TOKEN_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/** Simple Web Crypto HMAC-SHA256 hex signature compatible with Edge runtime */
async function sign(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function createToken(username: string, secret: string): Promise<string> {
  const payload = `${username}:${Date.now()}`;
  const signature = await sign(payload, secret);
  return `${payload}.${signature}`;
}

export async function verifyToken(token: string, secret: string, username = process.env.SITE_USERNAME ?? "listener"): Promise<boolean> {
  if (token.length > 1024) return false;
  const lastDot = token.lastIndexOf(".");
  if (lastDot === -1) return false;

  const payload = token.slice(0, lastDot);
  const signature = token.slice(lastDot + 1);
  const colon = payload.lastIndexOf(":");
  const timestamp = Number(payload.slice(colon + 1));
  const age = Date.now() - timestamp;
  if (colon < 1 || payload.slice(0, colon) !== username || !Number.isSafeInteger(timestamp)
    || age < 0 || age >= TOKEN_MAX_AGE * 1000 || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  return crypto.subtle.verify("HMAC", key,
    Uint8Array.from(signature.match(/.{2}/g)!, (byte) => parseInt(byte, 16)), encoder.encode(payload));
}
