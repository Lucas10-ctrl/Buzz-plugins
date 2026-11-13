// Small Nostr helpers for handoffs between the owner's agents, with no
// dependencies: BIP-340 signature checks for NIP-OA owner attestations
// (the `auth` tag Buzz signs onto every agent event), and npub encoding.

const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const G = [
  0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n,
  0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n,
];
const HEX = /^[0-9a-f]*$/;

const mod = (a, m = P) => ((a % m) + m) % m;

function pow(base, exp, m = P) {
  let result = 1n;
  base = mod(base, m);
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % m;
    base = (base * base) % m;
    exp >>= 1n;
  }
  return result;
}

/** a⁻¹ mod P, by the extended Euclidean algorithm. */
function inv(a) {
  let [u, v] = [mod(a), P];
  let [s0, s1] = [1n, 0n];
  while (u !== 0n) {
    const q = v / u;
    [u, v] = [v - q * u, u];
    [s0, s1] = [s1 - q * s0, s0];
  }
  return mod(s1);
}

// Jacobian points [X, Y, Z]; Z = 0 is infinity.
function dbl([X, Y, Z]) {
  if (Z === 0n || Y === 0n) return [0n, 1n, 0n];
  const YY = (Y * Y) % P;
  const S = (4n * X * YY) % P;
  const M = (3n * X * X) % P;
  const X3 = mod(M * M - 2n * S);
  return [X3, mod(M * (S - X3) - 8n * YY * YY), (2n * Y * Z) % P];
}

function add(a, b) {
  if (a[2] === 0n) return b;
  if (b[2] === 0n) return a;
  const [X1, Y1, Z1] = a;
  const [X2, Y2, Z2] = b;
  const Z1Z1 = (Z1 * Z1) % P;
  const Z2Z2 = (Z2 * Z2) % P;
  const U1 = (X1 * Z2Z2) % P;
  const U2 = (X2 * Z1Z1) % P;
  const S1 = (Y1 * Z2 * Z2Z2) % P;
  const S2 = (Y2 * Z1 * Z1Z1) % P;
  if (U1 === U2) return S1 === S2 ? dbl(a) : [0n, 1n, 0n];
  const H = mod(U2 - U1);
  const R = mod(S2 - S1);
  const HH = (H * H) % P;
  const HHH = (H * HH) % P;
  const V = (U1 * HH) % P;
  const X3 = mod(R * R - HHH - 2n * V);
  return [X3, mod(R * (V - X3) - S1 * HHH), (Z1 * Z2 * H) % P];
}

function mul(point, k) {
  let result = [0n, 1n, 0n];
  let addend = point;
  while (k > 0n) {
    if (k & 1n) result = add(result, addend);
    addend = dbl(addend);
    k >>= 1n;
  }
  return result;
}

function affine([X, Y, Z]) {
  if (Z === 0n) return undefined;
  const zi = inv(Z);
  const zi2 = (zi * zi) % P;
  return [(X * zi2) % P, (Y * zi2 * zi) % P];
}

function liftX(x) {
  if (x >= P) return undefined;
  const c = mod(x * x * x + 7n);
  const y = pow(c, (P + 1n) / 4n);
  if ((y * y) % P !== c) return undefined;
  return [x, y % 2n === 0n ? y : P - y, 1n];
}

const bytesOf = (hex) => Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));
const hexOf = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const big = (bytes) => BigInt(`0x${hexOf(bytes) || "0"}`);

async function sha256(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const all = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    all.set(part, at);
    at += part.length;
  }
  return new Uint8Array(await crypto.subtle.digest("SHA-256", all));
}

/** BIP-340: whether `sig` (128 hex) signs the 32-byte `message` for x-only `pubkey` (64 hex). */
export async function verifySchnorr(sig, message, pubkey) {
  if (!/^[0-9a-f]{128}$/.test(sig) || !/^[0-9a-f]{64}$/.test(pubkey) || message.length !== 32) return false;
  const point = liftX(BigInt(`0x${pubkey}`));
  if (!point) return false;
  const r = BigInt(`0x${sig.slice(0, 64)}`);
  const s = BigInt(`0x${sig.slice(64)}`);
  if (r >= P || s >= N) return false;
  const tag = await sha256(new TextEncoder().encode("BIP0340/challenge"));
  const e = mod(big(await sha256(tag, tag, bytesOf(sig.slice(0, 64)), bytesOf(pubkey), message)), N);
  const R = affine(add(mul([G[0], G[1], 1n], s), mul(point, mod(N - e, N))));
  return !!R && R[1] % 2n === 0n && R[0] === r;
}

const CLAUSE = /^(kind=|created_at<|created_at>)(0|[1-9][0-9]*)$/;

function satisfied(conditions, event) {
  if (conditions === "") return true;
  return conditions.split("&").every((clause) => {
    const [, name, digits] = CLAUSE.exec(clause) ?? [];
    if (!name) return false;
    const value = Number(digits);
    if (name === "kind=") return event.kind === value;
    return name === "created_at<" ? event.created_at < value : event.created_at > value;
  });
}

/**
 * NIP-OA: the owner a signed event's single `auth` tag proves, or undefined.
 * The relay checks the event's own signature; this checks the owner's.
 */
export async function attestedOwner(event) {
  const tags = (event?.tags ?? []).filter((t) => t[0] === "auth");
  if (tags.length !== 1) return undefined;
  const [, owner, conditions, sig] = tags[0];
  if (tags[0].length !== 4 || !/^[0-9a-f]{64}$/.test(owner ?? "") || owner === event.pubkey) return undefined;
  if (typeof conditions !== "string" || !HEX.test(sig ?? "") || !satisfied(conditions, event)) return undefined;
  try {
    const digest = await sha256(new TextEncoder().encode(`nostr:agent-auth:${event.pubkey}:${conditions}`));
    return (await verifySchnorr(sig, digest, owner)) ? owner : undefined;
  } catch {
    return undefined;
  }
}

// ── bech32 (npub) ──
const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function polymod(values) {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i];
  }
  return chk >>> 0;
}

/** `npub1…` for a 64-hex public key. */
export function npub(pubkey) {
  const data = [];
  let acc = 0;
  let bits = 0;
  for (const byte of bytesOf(pubkey)) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      data.push((acc >>> bits) & 31);
    }
  }
  if (bits) data.push((acc << (5 - bits)) & 31);
  const hrp = "npub";
  const expanded = [...[...hrp].map((c) => c.charCodeAt(0) >> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31)];
  const pm = polymod([...expanded, ...data, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = Array.from({ length: 6 }, (_, i) => (pm >>> (5 * (5 - i))) & 31);
  return `${hrp}1${[...data, ...checksum].map((d) => CHARSET[d]).join("")}`;
}
