import Phaser from 'phaser';
import { buildTutorialLaunchConfig } from './GameScene';

/** Thin launcher: the interactive tutorial is just GameScene in tutorial mode (see GameScene.ts). */
export class TutorialScene extends Phaser.Scene {
  constructor() {
    super('tutorial');
  }

  create(): void {
    this.scene.start('game', buildTutorialLaunchConfig());
  }
}
