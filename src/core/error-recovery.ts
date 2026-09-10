export interface RecoverySceneManager {
  getActiveScenes(): Array<{ scene: { key: string } }>;
  stop(key: string): void;
  start(key: string): void;
}

/** Stop crashed active scenes before returning to exactly one menu scene. */
export function recoverToMenu(manager: RecoverySceneManager): void {
  const active = manager.getActiveScenes();
  const hasMenu = active.some((scene) => scene.scene.key === 'menu');
  for (const scene of active) {
    if (scene.scene.key !== 'menu') manager.stop(scene.scene.key);
  }
  if (!hasMenu) manager.start('menu');
}
