import Phaser from "phaser";
import { gsap } from "gsap";
import { SYMBOLS } from "../consts/app.const";
import { TSymbolKey } from "../types/symbol.types";

export default class MainScene extends Phaser.Scene {
  private reels!: Phaser.GameObjects.Container[];
  private spinButton!: Phaser.GameObjects.Image;
  private soundOn: boolean = true;
  private spineObj?: any;

  private bgLoop!: Phaser.Sound.BaseSound;
  private spinSfx!: Phaser.Sound.BaseSound;
  private winSfx!: Phaser.Sound.BaseSound;
  private loseSfx!: Phaser.Sound.BaseSound;

  private rows = 3;
  private cols = 5;

  private isSpinning = false;
  private isSkipping = false;
  private spinTimers: Phaser.Time.TimerEvent[] = [];

  constructor() {
    super({ key: "MainScene" });
  }

  create(): void {
    const { width, height } = this.scale;

    const symbolWidth = 50;
    const symbolHeight = 50;
    const spacingX = 10;
    const spacingY = 10;

    const totalWidth = this.cols * (symbolWidth + spacingX) - spacingX;
    const totalHeight = this.rows * (symbolHeight + spacingY) - spacingY;

    this.add
      .image(width / 2, height / 2, "background")
      .setDisplaySize(width, height);
    this.add
      .image(width / 2, height / 2 - 20, "reels_frame")
      .setOrigin(0.5)
      .setDisplaySize(300, 180);

    this.reels = [];
    const startX = width / 2 - totalWidth / 2 + symbolWidth / 2;
    const startY = height / 2 - totalHeight / 2;

    this.reels = [];

    for (let col = 0; col < this.cols; col++) {
      const reel = this.add.container(
        startX + col * (symbolWidth + spacingX),
        startY
      );

      for (let row = 0; row < this.rows; row++) {
        const sym = Phaser.Utils.Array.GetRandom(SYMBOLS);
        const sprite = this.add.image(0, row * (symbolHeight + spacingY), sym);
        sprite.setDisplaySize(symbolWidth, symbolHeight);
        sprite.setData("row", row);
        sprite.setData("col", col);
        reel.add(sprite);
      }

      this.reels.push(reel);
    }

    this.spinButton = this.add
      .image(width / 2, height - 80, "spin_button")
      .setInteractive({ useHandCursor: true })
      .setDisplaySize(100, 100)
      .on("pointerdown", () => this.onSpin());

    this.bgLoop = this.sound.add("bg_loop", { loop: true, volume: 0.5 });
    this.spinSfx = this.sound.add("spin_sfx");
    this.winSfx = this.sound.add("win_sfx");
    this.loseSfx = this.sound.add("lose_sfx");
    if (this.soundOn) this.bgLoop.play();

    if (this.cache.json.exists("goblin") || this.textures.exists("goblin")) {
      try {
        // @ts-ignore
        this.spineObj = this.add
          .spine(width - 140, height - 140, "goblin", "idle", true)
          .setScale(0.5);
      } catch {
        console.warn("Spine plugin missing");
      }
    }

    const soundToggle = this.add
      .text(16, 16, "Sound: ON", { color: "#fff", fontSize: "16px" })
      .setInteractive()
      .on("pointerdown", () => {
        this.soundOn = !this.soundOn;
        soundToggle.setText(this.soundOn ? "Sound: ON" : "Sound: OFF");
        if (this.soundOn) {
          if (!this.bgLoop.isPlaying) this.bgLoop.play();
          else this.bgLoop.resume?.();
        } else {
          this.bgLoop.pause?.();
          this.sound.pauseAll?.();
        }
      });

    gsap.from(this.spinButton, {
      duration: 0.8,
      y: height,
      ease: "bounce.out",
    });
  }

  private async onSpin() {
    if (this.isSpinning) {
      this.isSkipping = true;
      this.skipSpinInstantly();
      return;
    }

    this.isSpinning = true;
    this.isSkipping = false;

    if (this.soundOn) this.spinSfx.play();

    this.reels
      .flatMap((r) => r.list as Phaser.GameObjects.Image[])
      .forEach((sprite) => {
        sprite.setAlpha(1);
      });

    const totalCycles = 20;
    const baseDelay = 80;
    const result = await this.mockServerSpin();

    this.spinTimers = [];

    this.reels.forEach((reel, colIndex) => {
      const sprites = reel.list as Phaser.GameObjects.Image[];
      let cycle = 0;

      const timer = this.time.addEvent({
        delay: baseDelay,
        loop: true,
        callback: () => {
          if (this.isSkipping) return;
          sprites.forEach((sprite) => {
            const randomSymbol = Phaser.Utils.Array.GetRandom(SYMBOLS);
            sprite.setTexture(randomSymbol);
          });

          cycle++;
          if (cycle >= totalCycles + colIndex * 5) {
            sprites.forEach((sprite, rowIndex) => {
              sprite.setTexture(result[rowIndex][colIndex]);
              sprite.setDisplaySize(50, 50);
            });
            timer.remove(false);

            if (colIndex === this.cols - 1) {
              this.time.delayedCall(100, () => this.finalizeSpin(result));
            }
          }
        },
      });

      this.spinTimers.push(timer);
    });
  }

  private skipSpinInstantly() {
    this.spinTimers.forEach((t) => t.remove(false));
    this.spinTimers = [];

    this.mockServerSpin().then((result) => {
      this.reels.forEach((reel, colIndex) => {
        const sprites = reel.list as Phaser.GameObjects.Image[];
        sprites.forEach((sprite, rowIndex) => {
          sprite.setTexture(result[rowIndex][colIndex]);
          sprite.setDisplaySize(50, 50);
        });
      });
      this.finalizeSpin(result);
    });
  }

  private mockServerSpin(): Promise<TSymbolKey[][]> {
    return new Promise((res) => {
      const delay = Phaser.Math.Between(500, 1200);
      this.time.delayedCall(delay, () => {
        const grid: TSymbolKey[][] = [];
        for (let row = 0; row < this.rows; row++) {
          const rowArr: TSymbolKey[] = [];
          for (let col = 0; col < this.cols; col++) {
            rowArr.push(Phaser.Utils.Array.GetRandom(SYMBOLS));
          }
          grid.push(rowArr);
        }
        res(grid);
      });
    });
  }

  private finalizeSpin(result: TSymbolKey[][]) {
    const winningLines = this.checkWinningLines(result);

    if (winningLines.length > 0) {
      if (this.soundOn) this.winSfx.play();
      this.playWinAnimation(winningLines, result);
    } else {
      if (this.soundOn) this.loseSfx.play();
      this.playLoseAnimation();
    }

    this.time.delayedCall(0, () => {
      this.spinButton.setVisible(true);
      this.isSpinning = false;
    });
  }

  private checkWinningLines(result: TSymbolKey[][]): number[][] {
    const lines: number[][] = [
      [0, 1, 2, 3, 4],
      [5, 6, 7, 8, 9],
      [10, 11, 12, 13, 14],
      [0, 6, 12, 8, 4],
      [10, 6, 2, 8, 14],
    ];

    const flat = result.flat();
    const wins: number[][] = [];

    for (const line of lines) {
      const [a, b, c, d, e] = line.map((i) => flat[i]);
      if (
        (a === b && b === c) ||
        (a === b && b === c && c === d) ||
        (a === b && b === c && c === d && d === e)
      ) {
        wins.push(line);
      }
    }
    return wins;
  }

  private playWinAnimation(winningLines: number[][], result: TSymbolKey[][]) {
    const flatSprites: Phaser.GameObjects.Image[] = [];
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        flatSprites.push(this.reels[col].list[row] as Phaser.GameObjects.Image);
      }
    }

    const animatedIndices = new Set<number>();

    for (const line of winningLines) {
      let matchGroup: number[] = [line[0]];
      for (let i = 1; i < line.length; i++) {
        if (
          result[Math.floor(line[i] / this.cols)][line[i] % this.cols] ===
          result[Math.floor(line[i - 1] / this.cols)][line[i - 1] % this.cols]
        ) {
          matchGroup.push(line[i]);
        } else {
          if (matchGroup.length >= 3)
            matchGroup.forEach((index) => animatedIndices.add(index));
          matchGroup = [line[i]];
        }
      }
      if (matchGroup.length >= 3)
        matchGroup.forEach((index) => animatedIndices.add(index));
    }

    for (const i of animatedIndices) {
      const sprite = flatSprites[i];
      gsap.to(sprite, {
        duration: 0.15,
        repeat: 6,
        yoyo: true,
        alpha: 0.3,
        ease: "power1.inOut",
      });
    }

    try {
      this.spineObj?.setAnimation(0, "win", false);
      this.spineObj?.addAnimation(0, "idle", true, 0);
    } catch {
      const { width } = this.scale;
      for (let i = 0; i < 12; i++) {
        const c = this.add.circle(
          width / 2 + Phaser.Math.Between(-150, 150),
          0,
          6,
          0xffff00
        );
        gsap.to(c, { duration: 1.2, y: 400, onComplete: () => c.destroy() });
      }
    }
  }

  private playLoseAnimation() {
    try {
      this.spineObj?.setAnimation(0, "lose", false);
      this.spineObj?.addAnimation(0, "idle", true, 0);
    } catch {
      gsap.to(this.reels, { duration: 0.2, x: "-=6", yoyo: true, repeat: 3 });
    }
  }
}
