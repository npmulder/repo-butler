export const ACTIONS_CALLBACK_SIGNATURE_HEADER = "x-rb-signature";

function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function bytesToHex(value: Uint8Array): string {
  return Array.from(value)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(
    value.byteOffset,
    value.byteOffset + value.byteLength,
  ) as ArrayBuffer;
}

async function hmacHex(
  secret: string,
  payload: string | Uint8Array,
): Promise<string> {
  const keyBytes = encodeUtf8(secret);
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(keyBytes),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = typeof payload === "string" ? encodeUtf8(payload) : payload;
  const digest = await crypto.subtle.sign("HMAC", key, toArrayBuffer(bytes));
  return bytesToHex(new Uint8Array(digest));
}

async function deriveActionsCallbackSecret(
  dispatchId: string,
  masterSecret: string,
): Promise<string> {
  return await hmacHex(masterSecret, dispatchId);
}

export async function verifyActionsCallbackSignature(input: {
  rawBody: Uint8Array;
  signature: string;
  dispatchId: string;
  masterSecret: string;
}): Promise<boolean> {
  if (!input.signature.startsWith("sha256=")) {
    return false;
  }

  const expected = input.signature.slice("sha256=".length);
  const callbackSecret = await deriveActionsCallbackSecret(
    input.dispatchId,
    input.masterSecret,
  );
  const computed = await hmacHex(callbackSecret, input.rawBody);

  if (expected.length !== computed.length) {
    return false;
  }

  let diff = 0;

  for (let index = 0; index < expected.length; index += 1) {
    diff |= expected.charCodeAt(index) ^ computed.charCodeAt(index);
  }

  return diff === 0;
}
