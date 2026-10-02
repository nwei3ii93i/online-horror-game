import type { StoryDocument, StoryDocumentStyle } from '../world/story/documents';

/** Font stacks per writing style (system fonts only – the game runs offline). */
export const DOC_FONTS: Record<StoryDocumentStyle, string> = {
  handwriting_neat: '"Segoe Script", "Bradley Hand", "Apple Chancery", "Brush Script MT", "URW Chancery L", cursive',
  handwriting_shaky: '"Bradley Hand", "Segoe Print", "Apple Chancery", "URW Chancery L", cursive',
  handwriting_child: '"Comic Sans MS", "Chalkboard SE", "Segoe Print", "Comic Neue", cursive',
  typewriter: '"Courier New", Courier, "Nimbus Mono PS", monospace',
  print: 'Georgia, "Times New Roman", "Nimbus Roman", serif',
  stamp: '"Courier New", Courier, monospace',
};

/**
 * Full-screen reading view for found documents: the in-world German text on aged paper,
 * Tab switches to the English transcript. E / Esc / click closes.
 */
export class DocumentReader {
  private el: HTMLDivElement;
  private paper: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private body: HTMLDivElement;
  private hint: HTMLDivElement;
  private doc: StoryDocument | null = null;
  private lang: 'de' | 'en' = 'de';
  private openedAt = 0;
  /** Ids the player has read (journal). */
  readonly read = new Set<string>();
  onClose?: () => void;
  onOpen?: () => void;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'reader';
    this.el.innerHTML = `
      <div class="reader-title"></div>
      <div class="reader-paper"><div class="reader-body"></div></div>
      <div class="reader-hint"></div>`;
    parent.appendChild(this.el);
    this.paper = this.el.querySelector('.reader-paper')!;
    this.titleEl = this.el.querySelector('.reader-title')!;
    this.body = this.el.querySelector('.reader-body')!;
    this.hint = this.el.querySelector('.reader-hint')!;
    window.addEventListener('keydown', (e) => {
      if (!this.doc) return;
      if (e.code === 'Tab') { e.preventDefault(); this.lang = this.lang === 'de' ? 'en' : 'de'; this.render(); }
      else if ((e.code === 'KeyE' || e.code === 'Escape') && performance.now() - this.openedAt > 250) this.close();
      else if (e.code === 'ArrowDown' || e.code === 'KeyS') this.paper.scrollBy({ top: 120, behavior: 'smooth' });
      else if (e.code === 'ArrowUp' || e.code === 'KeyW') this.paper.scrollBy({ top: -120, behavior: 'smooth' });
    });
    window.addEventListener('wheel', (e) => { if (this.doc) this.paper.scrollBy({ top: e.deltaY }); }, { passive: true });
    window.addEventListener('mousedown', () => { if (this.doc && performance.now() - this.openedAt > 250) this.close(); });
  }

  get isOpen(): boolean { return this.doc !== null; }

  open(doc: StoryDocument): void {
    this.doc = doc;
    this.lang = 'de';
    this.openedAt = performance.now();
    this.read.add(doc.id);
    this.render();
    this.paper.scrollTop = 0;
    this.el.classList.add('open');
    this.onOpen?.();
  }

  close(): void {
    if (!this.doc) return;
    this.doc = null;
    this.el.classList.remove('open');
    this.onClose?.();
  }

  private render(): void {
    const d = this.doc!;
    const en = this.lang === 'en';
    this.titleEl.textContent = `${d.title[this.lang]}${d.date ? ` · ${d.date}` : ''}`;
    this.paper.className = `reader-paper kind-${d.kind} style-${d.style}${en ? ' transcript' : ''}`;
    this.body.style.fontFamily = en ? 'Georgia, "Times New Roman", serif' : DOC_FONTS[d.style];
    this.body.textContent = en ? d.en : d.de;
    this.hint.textContent = en ? '[Tab] Original   [E] put down' : '[Tab] English transcript   [E] weglegen';
  }
}
