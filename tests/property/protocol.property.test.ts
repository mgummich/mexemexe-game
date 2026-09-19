/**
 * Protocol properties — the two claims the online layer rests on, over every state legal play can
 * reach and every seat in it:
 *
 *   privacy  a view carries the seat's own hand and nobody else's (INV-N2)
 *   sync     the client's reconstruction of that view digests to the server's hash (INV-N1)
 *
 * The second one is what `verify:multiplayer` proves expensively with real browsers comparing
 * state hashes. Here it is proven for free, because `buildView`, `digestOfState`, `stateHash` and
 * `viewToState` are all pure: if a redaction ever dropped a field the digest reads, this fails in
 * milliseconds instead of as a desync in a browser suite.
 *
 * `tests/viewToState.test.ts` owns the named cases (the placeholder contract, a smuggled
 * placeholder card being refused). This file owns the "for every state, for every seat" half.
 */
import { describe, expect, it } from 'vitest';
import { buildView, digestOfState, digestOfView, stateHash } from '../../src/net/protocol';
import { viewToState } from '../../src/net/viewToState';
import type { GameState } from '../../src/rules/types';
import { reachableState } from '../helpers/generators';
import { forAll, runs } from '../helpers/property';

const STATE = {
  runs: runs(12, 250),
  size: 10,
  generate: reachableState,
  describe: (s: GameState) => `deal ${s.seed}, ${s.players.length} seats, turn ${s.turn}`,
};

describe('redacted views', () => {
  it('carry the seat that asked and no other hand', () => {
    forAll('a view carries only its own hand', STATE, (state) => {
      for (let seat = 0; seat < state.players.length; seat++) {
        const view = buildView(state, seat, 3);
        for (const player of view.players) {
          if (player.seat === seat) {
            expect(player.hand?.map((c) => c.id)).toEqual(state.players[seat]!.hand.map((c) => c.id));
          } else {
            expect(player.hand, `seat ${seat} was sent seat ${player.seat}'s hand`).toBeUndefined();
            expect(player.handCount).toBe(state.players[player.seat]!.hand.length);
          }
        }
        // The pile is a count too: no seat may learn which cards are still to come.
        expect(view.drawCount).toBe(state.drawPile.length);
      }
    });
  });

  it('agree with the authoritative digest, before and after the client rebuilds them', () => {
    forAll('every seat digests to the authoritative hash', STATE, (state) => {
      const rev = 7;
      const authoritative = stateHash(digestOfState(state, rev));
      for (let seat = 0; seat < state.players.length; seat++) {
        const view = buildView(state, seat, rev);
        expect(view.hash, `seat ${seat} would have reported a desync`).toBe(authoritative);
        // What the client actually holds is `viewToState(view)` — placeholders and all. Its digest
        // has to come back to the same value, or a client compares itself out of sync with a
        // server that is right.
        expect(stateHash(digestOfState(viewToState(view), rev))).toBe(authoritative);
        expect(stateHash(digestOfView(view))).toBe(authoritative);
      }
    });
  });
});
