export interface CustomSelectOption {
  value: string;
  label: string;
  dataI18n?: string;
}

export interface CustomSelectConfig {
  root: HTMLElement;
  options?: CustomSelectOption[];
  initialValue?: string;
  disabled?: boolean;
  align?: 'left' | 'right';
  onChange: (value: string, option: CustomSelectOption | null) => void;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export class CustomSelect {
  private root: HTMLElement;
  private btn: HTMLButtonElement;
  private labelEl: HTMLElement;
  private chevronEl: Element | null;
  private menuEl: HTMLElement;

  private options: CustomSelectOption[] = [];
  private selectedValue: string = '';
  private isOpen: boolean = false;
  private isDisabled: boolean = false;
  private align: 'left' | 'right';
  private focusedIdx: number = -1;
  private onChange: (value: string, option: CustomSelectOption | null) => void;
  private onDocPointerDown: (ev: Event) => void;

  constructor(config: CustomSelectConfig) {
    this.root = config.root;
    const btn = config.root.querySelector('[data-cs-btn]') as HTMLButtonElement | null;
    const labelEl = config.root.querySelector('[data-cs-label]') as HTMLElement | null;
    const menuEl = config.root.querySelector('[data-cs-menu]') as HTMLElement | null;
    if (!btn || !labelEl || !menuEl) {
      throw new Error('CustomSelect requires [data-cs-btn], [data-cs-label], and [data-cs-menu]');
    }
    this.btn = btn;
    this.labelEl = labelEl;
    this.menuEl = menuEl;
    this.chevronEl = btn.querySelector('[data-cs-chevron]');
    this.align = config.align ?? (config.root.dataset.align === 'right' ? 'right' : 'left');
    this.onChange = config.onChange;

    if (config.options && config.options.length > 0) {
      this.options = [...config.options];
      this.selectedValue = config.initialValue ?? this.options[0]?.value ?? '';
      this.renderOptions();
    } else {
      this.readOptionsFromDom();
      if (config.initialValue !== undefined) {
        this.selectedValue = config.initialValue;
      }
      this.syncSelectionUi();
    }

    this.setDisabled(Boolean(config.disabled ?? this.btn.disabled));

    this.onDocPointerDown = (ev: Event) => {
      if (!this.root.contains(ev.target as Node) && this.isOpen) {
        this.close();
      }
    };

    this.bindEvents();
  }

  private readOptionsFromDom() {
    const els = Array.from(this.menuEl.querySelectorAll('[data-cs-option]'));
    this.options = els.map((el) => {
      const lbl = el.querySelector('[data-cs-opt-label]') ?? el;
      return {
        value: el.getAttribute('data-cs-option') || '',
        label: (lbl.textContent || '').trim(),
        dataI18n: lbl.getAttribute('data-i18n') || undefined,
      };
    });
    const active = els.find((el) => el.getAttribute('aria-selected') === 'true');
    this.selectedValue = active?.getAttribute('data-cs-option') ?? this.options[0]?.value ?? '';
  }

  private bindEvents() {
    this.btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (this.isDisabled) return;
      if (this.isOpen) this.close();
      else this.open();
    });

    this.btn.addEventListener('keydown', (ev: KeyboardEvent) => {
      if (this.isDisabled) return;
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        if (!this.isOpen) {
          this.open();
        } else {
          const delta = ev.key === 'ArrowDown' ? 1 : -1;
          const next = Math.max(0, Math.min(this.options.length - 1, this.focusedIdx + delta));
          this.focusedIdx = next;
          this.updateHighlight();
        }
      } else if (ev.key === 'Enter' || ev.key === ' ') {
        if (this.isOpen) {
          ev.preventDefault();
          const chosen = this.options[this.focusedIdx];
          if (chosen) this.commitSelection(chosen);
          else this.close();
        }
      } else if (ev.key === 'Escape' && this.isOpen) {
        ev.preventDefault();
        ev.stopPropagation();
        this.close();
      } else if (ev.key === 'Tab' && this.isOpen) {
        this.close();
      }
    });

    this.menuEl.addEventListener('mousedown', (ev: MouseEvent) => {
      ev.preventDefault();
      const btn = (ev.target as HTMLElement).closest('[data-cs-option]') as HTMLElement | null;
      if (!btn) return;
      const val = btn.getAttribute('data-cs-option') || '';
      const opt = this.options.find((o) => o.value === val);
      if (opt) this.commitSelection(opt);
    });

    document.addEventListener('pointerdown', this.onDocPointerDown);
  }

  private commitSelection(opt: CustomSelectOption) {
    this.selectedValue = opt.value;
    this.syncSelectionUi();
    this.close();
    this.onChange(opt.value, opt);
  }

  private renderOptions() {
    this.menuEl.innerHTML = this.options
      .map((opt) => {
        const selected = opt.value === this.selectedValue;
        const cls = selected
          ? 'bg-[var(--accent-soft)] text-[var(--accent-ink)] font-semibold'
          : 'text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-primary)] font-medium';
        const i18nAttr = opt.dataI18n ? ` data-i18n="${escapeHtml(opt.dataI18n)}"` : '';
        const checkHtml = selected
          ? '<svg class="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" /></svg>'
          : '';
        return `<button type="button" role="option" aria-selected="${selected ? 'true' : 'false'}" data-cs-option="${escapeHtml(opt.value)}" class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition-colors cursor-pointer ${cls}">
          <span class="truncate" data-cs-opt-label${i18nAttr}>${escapeHtml(opt.label)}</span>
          ${checkHtml}
        </button>`;
      })
      .join('');
    this.syncSelectionUi();
  }

  private syncSelectionUi() {
    const optEls = Array.from(this.menuEl.querySelectorAll('[data-cs-option]'));
    let activeOpt = this.options.find((o) => o.value === this.selectedValue) ?? this.options[0];
    optEls.forEach((el) => {
      const val = el.getAttribute('data-cs-option') || '';
      const isSel = val === this.selectedValue;
      el.setAttribute('aria-selected', isSel ? 'true' : 'false');
      el.classList.remove(
        'bg-[var(--accent-soft)]',
        'text-[var(--accent-ink)]',
        'font-semibold',
        'text-[var(--ink-secondary)]',
        'hover:bg-[var(--bg-subtle)]',
        'hover:text-[var(--ink-primary)]',
        'font-medium',
      );
      if (isSel) {
        el.classList.add('bg-[var(--accent-soft)]', 'text-[var(--accent-ink)]', 'font-semibold');
        const lbl = el.querySelector('[data-cs-opt-label]');
        if (lbl && activeOpt) {
          activeOpt = { ...activeOpt, label: (lbl.textContent || activeOpt.label).trim() };
        }
      } else {
        el.classList.add(
          'text-[var(--ink-secondary)]',
          'hover:bg-[var(--bg-subtle)]',
          'hover:text-[var(--ink-primary)]',
          'font-medium',
        );
      }
      const existingCheck = el.querySelector('[data-cs-check]');
      if (existingCheck) {
        existingCheck.classList.toggle('hidden', !isSel);
      } else {
        const svg = el.querySelector('svg');
        if (isSel && !svg) {
          el.insertAdjacentHTML(
            'beforeend',
            '<svg data-cs-check class="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" /></svg>',
          );
        } else if (!isSel && svg) {
          svg.remove();
        }
      }
    });

    if (activeOpt) {
      this.labelEl.textContent = activeOpt.label;
      if (activeOpt.dataI18n) this.labelEl.setAttribute('data-i18n', activeOpt.dataI18n);
      else this.labelEl.removeAttribute('data-i18n');
    }
  }

  private updateHighlight() {
    const optEls = Array.from(this.menuEl.querySelectorAll('[data-cs-option]'));
    optEls.forEach((el, idx) => {
      el.classList.toggle('bg-[var(--bg-subtle)]', idx === this.focusedIdx);
    });
  }

  private positionMenu() {
    this.menuEl.style.left = '';
    this.menuEl.style.right = '';
    if (this.align === 'right') {
      this.menuEl.style.right = '0';
      this.menuEl.style.left = 'auto';
    } else {
      this.menuEl.style.left = '0';
      this.menuEl.style.right = 'auto';
    }
  }

  public open() {
    if (this.isDisabled) return;
    this.isOpen = true;
    this.positionMenu();
    this.focusedIdx = Math.max(
      0,
      this.options.findIndex((o) => o.value === this.selectedValue),
    );
    this.btn.setAttribute('aria-expanded', 'true');
    this.menuEl.classList.remove('hidden');
    if (this.chevronEl) this.chevronEl.classList.add('rotate-180');
  }

  public close() {
    this.isOpen = false;
    this.btn.setAttribute('aria-expanded', 'false');
    this.menuEl.classList.add('hidden');
    if (this.chevronEl) this.chevronEl.classList.remove('rotate-180');
  }

  public getValue(): string {
    return this.selectedValue;
  }

  public hasOption(value: string): boolean {
    return this.options.some((o) => o.value === value);
  }

  public setValue(value: string, silent: boolean = true) {
    const match = this.options.find((o) => o.value === value);
    if (!match) return;
    this.selectedValue = value;
    this.syncSelectionUi();
    if (!silent) this.onChange(value, match);
  }

  public setOptions(options: CustomSelectOption[], preserveSelection: boolean = true) {
    this.options = [...options];
    if (!preserveSelection || !this.options.some((o) => o.value === this.selectedValue)) {
      this.selectedValue = this.options[0]?.value ?? '';
    }
    this.renderOptions();
  }

  public setDisabled(disabled: boolean, overrideLabel?: string) {
    this.isDisabled = disabled;
    this.btn.disabled = disabled;
    if (disabled && this.isOpen) this.close();
    if (overrideLabel !== undefined) {
      this.labelEl.textContent = overrideLabel;
    }
  }

  public syncLocaleLabels() {
    this.readOptionsFromDom();
    this.syncSelectionUi();
  }
}
