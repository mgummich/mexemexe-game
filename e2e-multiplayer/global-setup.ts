import fs from 'node:fs';

/**
 * Clears the previous run's evidence shards. Every worker in multiplayer.spec.ts and lobby.spec
 * .ts writes its own shard under docs/screenshots/, and the gate merges them, so a leftover shard
 * from an earlier run would otherwise let the gate pass on evidence this run never produced.
 * Mirrors e2e/global-setup.ts.
 */
export default function globalSetup(): void {
  for (const dir of ['verify-multiplayer-log-parts', 'verify-lobby-log-parts']) {
    fs.rmSync(`docs/screenshots/${dir}`, { force: true, recursive: true });
  }
}
