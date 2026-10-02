import type { Input } from '../core/Input';

/** Minimal diegetic-leaning HUD: centre dot, contextual prompt, click-to-play overlay. */
export class HUD {
  readonly el: HTMLDivElement;
  private prompt: HTMLDivElement;
  private overlay: HTMLDivElement;
  private info: HTMLDivElement;
  private lastPrompt = '';

  constructor(parent: HTMLElement, private input: Input, private canvas: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.innerHTML = `
      <div class="dot"></div>
      <div class="prompt"></div>
      <div class="info"></div>
      <div class="overlay">
        <div class="overlay-inner">
          <div class="title">Waldegg</div>
          <div class="hint">Klicken zum Spielen · Click to play</div>
          <div class="keys">WASD gehen · Shift laufen · C ducken/kriechen · F Taschenlampe · E benutzen · Q spähen · Esc Pause</div>
        </div>
      </div>`;
    parent.appendChild(this.el);
    this.prompt = this.el.querySelector('.prompt')!;
    this.overlay = this.el.querySelector('.overlay')!;
    this.info = this.el.querySelector('.info')!;
    this.overlay.addEventListener('click', () => this.input.requestLock());
    canvas.addEventListener('click', () => this.input.requestLock());
    document.addEventListener('pointerlockchange', () => this.sync());
    this.sync();
  }

  private sync(): void {
    this.overlay.style.display = this.input.locked ? 'none' : 'flex';
  }

  setPrompt(text: string | null): void {
    const t = text ?? '';
    if (t === this.lastPrompt) return;
    this.lastPrompt = t;
    this.prompt.textContent = t ? `[E]  ${t}` : '';
    this.prompt.style.opacity = t ? '1' : '0';
  }

  setInfo(text: string): void { this.info.textContent = text; }
}
