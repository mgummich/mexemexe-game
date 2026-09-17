/**
 * FNV-1a over a string. Not cryptographic: it detects divergence between two honest runs, it is
 * not a tamper check.
 *
 * One implementation, two callers with deliberately different inputs: `stateHash`
 * (`src/net/protocol.ts`) digests only what a client may know, so an online client can compare
 * itself to the server without holding hidden cards; `replayHash` (`src/game-state/replay.ts`)
 * digests the whole serialized state, because a replay runs offline and has every card anyway.
 */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
