export type Action =
  | 'forward' | 'back' | 'left' | 'right'
  | 'sprint' | 'crouch' | 'jump'
  | 'interact' | 'flashlight' | 'journal' | 'pause' | 'lean_left' | 'lean_right';

const DEFAULT_BINDINGS: Record<string, Action> = {
  KeyW: 'forward', ArrowUp: 'forward',
  KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
  KeyC: 'crouch', ControlLeft: 'crouch',
  Space: 'jump',
  KeyE: 'interact',
  KeyF: 'flashlight',
  Tab: 'journal', KeyJ: 'journal',
  Escape: 'pause',
  KeyQ: 'lean_left',
};

/** Keyboard / mouse input with pointer lock. Polled once per frame by the game loop. */
export class Input {
  private down = new Set<Action>();
  private pressed = new Set<Action>();
  private released = new Set<Action>();
  private mdx = 0;
  private mdy = 0;
  private wheel = 0;
  mouseButtons = 0;
  private clicked = 0;
  enabled = true;

  constructor(private element: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      const a = DEFAULT_BINDINGS[e.code];
      if (a) {
        if (a === 'journal' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
        if (!e.repeat) { this.down.add(a); this.pressed.add(a); }
      }
    });
    window.addEventListener('keyup', (e) => {
      const a = DEFAULT_BINDINGS[e.code];
      if (a) { this.down.delete(a); this.released.add(a); }
    });
    window.addEventListener('blur', () => this.down.clear());
    window.addEventListener('mousemove', (e) => {
      if (this.locked) { this.mdx += e.movementX; this.mdy += e.movementY; }
    });
    window.addEventListener('mousedown', (e) => { this.mouseButtons |= 1 << e.button; this.clicked |= 1 << e.button; });
    window.addEventListener('mouseup', (e) => { this.mouseButtons &= ~(1 << e.button); });
    window.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
  }

  get locked(): boolean { return document.pointerLockElement === this.element; }

  requestLock(): void {
    if (!this.locked) {
      const p = (this.element as any).requestPointerLock?.({ unadjustedMovement: true });
      if (p && typeof p.catch === 'function') p.catch(() => this.element.requestPointerLock?.());
    }
  }

  exitLock(): void { if (this.locked) document.exitPointerLock(); }

  isDown(a: Action): boolean { return this.enabled && this.down.has(a); }
  wasPressed(a: Action): boolean { return this.enabled && this.pressed.has(a); }
  wasReleased(a: Action): boolean { return this.released.has(a); }
  wasClicked(button = 0): boolean { return this.enabled && (this.clicked & (1 << button)) !== 0; }

  consumeMouse(): { dx: number; dy: number; wheel: number } {
    const r = { dx: this.mdx, dy: this.mdy, wheel: this.wheel };
    this.mdx = 0; this.mdy = 0; this.wheel = 0;
    return r;
  }

  /** Call at end of each frame. */
  endFrame(): void {
    this.pressed.clear();
    this.released.clear();
    this.clicked = 0;
  }

  /** Inject a synthetic action (used by automation / gamepad bridge). */
  press(a: Action, hold = false): void {
    this.pressed.add(a);
    if (hold) this.down.add(a);
  }
  release(a: Action): void { this.down.delete(a); this.released.add(a); }
}
