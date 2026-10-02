/** Minimal, typographic loading screen. */
export class LoadingScreen {
  readonly el: HTMLDivElement;
  private bar: HTMLDivElement;
  private label: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'loading';
    this.el.innerHTML = `
      <div class="loading-inner">
        <div class="title">Waldegg</div>
        <div class="subtitle">Gut Waldegg · Mühlviertel · November</div>
        <div class="bar"><div class="fill"></div></div>
        <div class="label">…</div>
      </div>`;
    parent.appendChild(this.el);
    this.bar = this.el.querySelector('.fill') as HTMLDivElement;
    this.label = this.el.querySelector('.label') as HTMLDivElement;
  }

  set(progress: number, text: string): void {
    this.bar.style.width = `${Math.round(progress * 100)}%`;
    this.label.textContent = text;
  }

  hide(): void {
    this.el.classList.add('hidden');
    setTimeout(() => this.el.remove(), 1200);
  }
}
