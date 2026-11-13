// Checks nostr.js against @noble/curves (from a Buzz checkout) and the BIP-340
// vectors: node test/nostr.mjs [path to node_modules/@noble/curves]
import { attestedOwner, npub, verifySchnorr } from "../nostr.js";
const nobleDir = process.argv[2] ?? `${process.env.HOME}/Documents/GitHub/buzz-editor-lab/buzz-app/node_modules/@noble`;
const { schnorr } = await import(`${nobleDir}/curves/secp256k1.js`);
const hex = (b) => Buffer.from(b).toString("hex");
let fails = 0;
const check = (name, ok) => { if (!ok) fails++; console.log(ok ? "ok  " : "FAIL", name); };

// BIP-340 vectors (verify-only subset).
const V = [
  ["F9308A019258C31049344F85F89D5229B531C845836F99B08601F113BCE036F9", "0000000000000000000000000000000000000000000000000000000000000000", "E907831F80848D1069A5371B402410364BDF1C5F8307B0084C55F1CE2DCA821525F66A4A85EA8B71E482A74F382D2CE5EBEEE8FDB2172F477DF4900D310536C0", true],
  ["DFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659", "243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89", "6896BD60EEAE296DB48A229FF71DFE071BDE413E6D43F917DC8DCF8C78DE33418906D11AC976ABCCB20B091292BFF4EA897EFCB639EA871CFA95F6DE339E4B0A", true],
  ["D69C3509BB99E412E68B0FE8544E72837DFA30746D8BE2AA65975F29D22DC7B9", "4DF3C3F68FCC83B27E9D42C90431A72499F17875C81A599B566C9889B9696703", "00000000000000000000003B78CE563F89A0ED9414F5AA28AD0D96D6795F9C6376AFB1548AF603B3EB45C9F8207DEE1060CB71C04E80F593060B07D28308D7F4", true],
  ["EEFDEA4CDB677750A420FEE807EACF21EB9898AE79B9768766E4FAA04A2D4A34", "243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89", "6CFF5C3BA86C69EA4B7376F31A9BCB4F74C1976089B2D9963DA2E5543E17776969E89B4C5564D00349106B8497785DD7D1D713A8AE82B32FA79D5F7FC407D39B", false],
  ["DFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659", "243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89", "FFF97BD5755EEEA420453A14355235D382F6472F8568A18B2F057A14602975563CC27944640AC607CD107AE10923D9EF7A73C643E166BE5EBEAFA34B1AC553E2", false],
  ["DFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659", "243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89", "1FA62E331EDBC21C394792D2AB1100A7B432B013DF3F6FF4F99FCB33E0E1515F28890B3EDB6E7189B630448B515CE4F8622A954CFE545735AAEA5134FCCDB2BD", false],
];
for (const [pk, m, sig, want] of V)
  check(`bip340 ${sig.slice(0, 8)} -> ${want}`, (await verifySchnorr(sig.toLowerCase(), Buffer.from(m, "hex"), pk.toLowerCase())) === want);

// NIP-OA auth tags as Buzz signs them.
const ownerSk = schnorr.utils.randomSecretKey ? schnorr.utils.randomSecretKey() : schnorr.utils.randomPrivateKey();
const owner = hex(schnorr.getPublicKey(ownerSk));
const agentSk = schnorr.utils.randomSecretKey ? schnorr.utils.randomSecretKey() : schnorr.utils.randomPrivateKey();
const agent = hex(schnorr.getPublicKey(agentSk));
const auth = async (target, conditions, sk = ownerSk) => {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`nostr:agent-auth:${target}:${conditions}`)));
  return ["auth", hex(schnorr.getPublicKey(sk)), conditions, hex(await schnorr.sign(digest, sk))];
};
const ev = (tags, extra = {}) => ({ pubkey: agent, kind: 9, created_at: 1000, tags, ...extra });
check("owner's attestation", (await attestedOwner(ev([await auth(agent, "")]))) === owner);
check("conditions met", (await attestedOwner(ev([await auth(agent, "kind=9&created_at>10")]))) === owner);
check("conditions not met", (await attestedOwner(ev([await auth(agent, "kind=1")]))) === undefined);
check("for another agent", (await attestedOwner(ev([await auth("c".repeat(64), "")]))) === undefined);
const forged = await auth(agent, "");
forged[1] = "d".repeat(64);
check("forged owner", (await attestedOwner(ev([forged]))) === undefined);
check("two auth tags", (await attestedOwner(ev([await auth(agent, ""), await auth(agent, "")]))) === undefined);
check("no auth tag", (await attestedOwner(ev([["h", "x"]]))) === undefined);
const t0 = Date.now();
for (let i = 0; i < 20; i++) await attestedOwner(ev([await auth(agent, "")]));
console.log(`     20 checks in ${Date.now() - t0}ms (signing included)`);

// npub against a known pair (NIP-19 example).
check("npub", npub("7e7e9c42a91bfef19fa929e5fda1b72e0ebc1a4c1141673e2794234d86addf4e") === "npub10elfcs4fr0l0r8af98jlmgdh9c8tcxjvz9qkw038js35mp4dma8qzvjptg");
console.log(fails ? `${fails} FAILED` : "all passed");
process.exit(fails ? 1 : 0);
