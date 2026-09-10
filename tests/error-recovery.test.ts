import { describe, expect, it } from 'vitest';
import { recoverToMenu } from '../src/core/error-recovery';

describe('error recovery', () => {
  it('stops all active non-menu scenes before starting menu once', () => {
    const stopped: string[] = [];
    const started: string[] = [];
    const scenes = [{ scene: { key: 'game' } }, { scene: { key: 'hud' } }];

    recoverToMenu({
      getActiveScenes: () => scenes,
      stop: (key) => stopped.push(key),
      start: (key) => started.push(key),
    });

    expect(stopped).toEqual(['game', 'hud']);
    expect(started).toEqual(['menu']);
  });

  it('does not restart an already active menu scene', () => {
    const stopped: string[] = [];
    const started: string[] = [];

    recoverToMenu({
      getActiveScenes: () => [{ scene: { key: 'menu' } }],
      stop: (key) => stopped.push(key),
      start: (key) => started.push(key),
    });

    expect(stopped).toEqual([]);
    expect(started).toEqual([]);
  });
});
