// Copied from block/buzz-app (Apache-2.0): ownerCanvas from
// src/features/agent-harness/project.ts, approvedCanvas from
// src/features/channel-templates/canvas-approval.ts and attestedOwner from
// src/features/agents/owner-attestation.ts. A Canvas's project folders count
// only when its owner wrote it, or an agent the owner attested to.
import { schnorr } from "@noble/curves/secp256k1.js";

export type CanvasHead = Readonly<{
  pubkey: string;
  kind: number;
  created_at: number;
  tags: readonly (readonly string[])[];
  content: string;
}>;

const CANVAS_INSTRUCTIONS = "canvas-instructions";
const KEY = /^[0-9a-f]{64}$/;
const SIG = /^[0-9a-f]{128}$/;
const CLAUSE = /^(kind=|created_at<|created_at>)(0|[1-9][0-9]*)$/;

const hexToBytes = (hex: string) =>
  Uint8Array.from(hex.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));

export async function ownerCanvas(
  canvas:
    | Readonly<{
        available: boolean;
        read(channelId: string): Promise<CanvasHead | null | undefined>;
      }>
    | undefined,
  owner: string,
  channelId: string,
): Promise<string | undefined> {
  if (!canvas?.available) return undefined;
  const head = await canvas.read(channelId);
  if (!head) return undefined;
  if (await approvedCanvas(head, owner)) return head.content;
  console.warn("Ignoring a Canvas its owner's side has not approved", channelId);
  return undefined;
}

export async function approvedCanvas(head: CanvasHead, owner: string) {
  if (head.tags.some((tag) => tag[0] === CANVAS_INSTRUCTIONS)) return false;
  return head.pubkey === owner || (await attestedOwner(head)) === owner;
}

export async function attestedOwner(
  event: Pick<CanvasHead, "pubkey" | "kind" | "created_at" | "tags">,
): Promise<string | undefined> {
  const [tag, ...extra] = event.tags.filter((tag) => tag[0] === "auth");
  if (!tag || extra.length || !satisfied(tag[2] ?? "", event)) return undefined;
  const [name, owner, conditions, sig] = tag;
  const target = event.pubkey;
  if (
    name !== "auth" ||
    tag.length !== 4 ||
    !owner ||
    conditions === undefined ||
    !sig ||
    !KEY.test(owner) ||
    !SIG.test(sig) ||
    owner === target ||
    !validConditions(conditions)
  )
    return undefined;
  try {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`nostr:agent-auth:${target}:${conditions}`),
    );
    return schnorr.verify(hexToBytes(sig), new Uint8Array(digest), hexToBytes(owner))
      ? owner
      : undefined;
  } catch {
    return undefined;
  }
}

function validConditions(conditions: string) {
  return (
    conditions === "" ||
    conditions.split("&").every((clause) => {
      const [, name, digits] = CLAUSE.exec(clause) ?? [];
      if (!name || !digits) return false;
      return Number(digits) <= (name === "kind=" ? 65535 : 4294967295);
    })
  );
}

function satisfied(
  conditions: string,
  event: Pick<CanvasHead, "kind" | "created_at">,
) {
  if (!validConditions(conditions)) return false;
  if (conditions === "") return true;
  return conditions.split("&").every((clause) => {
    const [, name, digits] = CLAUSE.exec(clause) ?? [];
    const value = Number(digits);
    if (name === "kind=") return event.kind === value;
    return name === "created_at<" ? event.created_at < value : event.created_at > value;
  });
}
