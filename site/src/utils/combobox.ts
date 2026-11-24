export interface ComboboxOption {
  value: string;
  label: string;
  group?: string;
  badge?: string;
  sublabel?: string;
  searchBlob: string;
}

export interface SearchableComboboxConfig {
  root: HTMLElement;
  options: ComboboxOption[];
  placeholder?: string;
  emptyValue?: string;
  emptyText?: string;
  initialValue?: string;
  allowCustomNumeric?: boolean;
  parseCustomNumeric?: (raw: string) => number | null;
  formatCustomNumeric?: (num: number) => string;
  formatCustomActionLabel?: (num: number) => string;
  onChange: (value: string, option: ComboboxOption | null) => void;
}

interface RenderedOption {
  opt: ComboboxOption;
  isCustomAction?: boolean;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export class SearchableCombobox {
  private root: HTMLElement;
  private input: HTMLInputElement;
  private toggleBtn: HTMLButtonElement | null;
  private clearBtn: HTMLButtonElement | null;
  private listEl: HTMLElement;
  private chevronEl: Element | null;

  private options: ComboboxOption[];
  private emptyValue: string;
  private emptyText: string;
  private allowCustomNumeric: boolean;
  private parseCustomNumeric?: (raw: string) => number | null;
  private formatCustomNumeric: (num: number) => string;
  private formatCustomActionLabel: (num: number) => string;
  private onChange: (value: string, option: ComboboxOption | null) => void;

  private selectedValue: string;
  private selectedLabel: string = '';
  private displayOverride: string | null = null;
  private allowClearOverride: boolean = true;
  private isSyncedStyle: boolean = false;

  private isOpen: boolean = false;
  private isFiltering: boolean = false;
  private activeIndex: number = -1;
  private renderedItems: RenderedOption[] = [];
  private ignoreFocusOpen: boolean = false;

  private onDocPointerDown: (ev: Event) => void;

  constructor(config: SearchableComboboxConfig) {
    this.root = config.root;
    const inputEl = config.root.querySelector('[data-cb-input]') as HTMLInputElement | null;
    const listEl = config.root.querySelector('[data-cb-list]') as HTMLElement | null;
    if (!inputEl || !listEl) {
      throw new Error('SearchableCombobox requires [data-cb-input] and [data-cb-list] inside root');
    }
    this.input = inputEl;
    this.listEl = listEl;
    this.toggleBtn = config.root.querySelector('[data-cb-toggle]') as HTMLButtonElement | null;
    this.clearBtn = config.root.querySelector('[data-cb-clear]') as HTMLButtonElement | null;
    this.chevronEl = this.toggleBtn?.querySelector('svg') ?? null;

    this.options = [...config.options];
    this.emptyValue = config.emptyValue ?? '';
    this.emptyText = config.emptyText ?? 'No matching options';
    this.allowCustomNumeric = Boolean(config.allowCustomNumeric);
    this.parseCustomNumeric = config.parseCustomNumeric;
    this.formatCustomNumeric = config.formatCustomNumeric ?? ((n) => `${n} GB`);
    this.formatCustomActionLabel =
      config.formatCustomActionLabel ?? ((n) => `Use ${this.formatCustomNumeric(n)} (Custom)`);
    this.onChange = config.onChange;

    if (config.placeholder) {
      this.input.placeholder = config.placeholder;
    }

    this.selectedValue = config.initialValue ?? this.emptyValue;
    this.syncLabelFromSelection();

    this.onDocPointerDown = (ev: Event) => {
      if (!this.root.contains(ev.target as Node)) {
        if (this.isOpen || this.isFiltering) {
          this.commitOrRevertOnDismiss();
        }
      }
    };

    this.bindEvents();
    this.refreshInputPresentation();
  }

  private bindEvents() {
    this.input.addEventListener('focus', () => {
      if (this.ignoreFocusOpen) {
        this.ignoreFocusOpen = false;
        return;
      }
      this.isFiltering = false;
      this.open();
      if (this.input.value && (this.input.value === this.selectedLabel || this.displayOverride !== null)) {
        try {
          this.input.select();
        } catch {
          // ignore on unsupported inputs
        }
      }
    });

    this.input.addEventListener('click', () => {
      if (!this.isOpen) {
        this.isFiltering = false;
        this.open();
      }
    });

    this.input.addEventListener('input', () => {
      this.isFiltering = true;
      this.displayOverride = null;
      this.setSyncedInputClasses(false);
      if (!this.isOpen) {
        this.isOpen = true;
        this.setOpenAttributes(true);
      }
      this.activeIndex = 0;
      this.renderList();
      this.updateClearVisibility();
    });

    this.input.addEventListener('keydown', (ev: KeyboardEvent) => {
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        if (!this.isOpen) {
          this.isFiltering = false;
          this.open();
        } else if (this.renderedItems.length > 0) {
          this.activeIndex = Math.min(this.renderedItems.length - 1, this.activeIndex + 1);
          this.updateActiveHighlight();
        }
      } else if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        if (!this.isOpen) {
          this.isFiltering = false;
          this.open();
        } else if (this.renderedItems.length > 0) {
          this.activeIndex = Math.max(0, this.activeIndex - 1);
          this.updateActiveHighlight();
        }
      } else if (ev.key === 'Enter') {
        if (this.isOpen) {
          ev.preventDefault();
          if (this.activeIndex >= 0 && this.renderedItems[this.activeIndex]) {
            const chosen = this.renderedItems[this.activeIndex];
            this.selectRenderedOption(chosen);
          } else if (this.allowCustomNumeric && this.parseCustomNumeric) {
            const parsed = this.parseCustomNumeric(this.input.value);
            if (parsed !== null) {
              this.commitCustomNumber(parsed);
            }
          }
        } else if (this.allowCustomNumeric && this.parseCustomNumeric) {
          const parsed = this.parseCustomNumeric(this.input.value);
          if (parsed !== null) {
            ev.preventDefault();
            this.commitCustomNumber(parsed);
          }
        }
      } else if (ev.key === 'Escape') {
        if (this.isOpen) {
          ev.preventDefault();
          ev.stopPropagation();
          this.close(true);
        }
      } else if (ev.key === 'Tab') {
        if (this.isOpen || this.isFiltering) {
          this.commitOrRevertOnDismiss();
        }
      }
    });

    this.input.addEventListener('blur', () => {
      // Delay slightly to allow mousedown selection handlers to run cleanly
      window.setTimeout(() => {
        if (!this.root.contains(document.activeElement) && (this.isOpen || this.isFiltering)) {
          this.commitOrRevertOnDismiss();
        }
      }, 120);
    });

    if (this.toggleBtn) {
      this.toggleBtn.addEventListener('mousedown', (ev: MouseEvent) => {
        ev.preventDefault();
        if (this.isOpen) {
          this.close(true);
        } else {
          this.isFiltering = false;
          this.ignoreFocusOpen = true;
          this.input.focus();
          this.open();
        }
      });
    }

    if (this.clearBtn) {
      this.clearBtn.addEventListener('mousedown', (ev: MouseEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.clear(false);
        this.close(false);
        this.input.blur();
      });
    }

    this.listEl.addEventListener('mousedown', (ev: MouseEvent) => {
      const target = (ev.target as HTMLElement).closest('[data-cb-index]') as HTMLElement | null;
      if (!target) return;
      ev.preventDefault();
      const idx = Number(target.getAttribute('data-cb-index'));
      if (Number.isFinite(idx) && this.renderedItems[idx]) {
        this.selectRenderedOption(this.renderedItems[idx]);
      }
    });

    document.addEventListener('pointerdown', this.onDocPointerDown);
  }

  private commitCustomNumber(num: number) {
    const valStr = String(num);
    const matched = this.options.find((o) => o.value === valStr) ?? null;
    const label = matched ? matched.label : this.formatCustomNumeric(num);
    this.selectedValue = valStr;
    this.selectedLabel = label;
    this.displayOverride = null;
    this.setSyncedInputClasses(false);
    this.isFiltering = false;
    this.close(false);
    this.refreshInputPresentation();
    this.onChange(
      valStr,
      matched ?? {
        value: valStr,
        label,
        badge: 'Custom',
        searchBlob: `${num} ${num}gb custom`,
      },
    );
  }

  private selectRenderedOption(item: RenderedOption) {
    if (item.isCustomAction && this.parseCustomNumeric) {
      const parsed = this.parseCustomNumeric(item.opt.value);
      if (parsed !== null) {
        this.commitCustomNumber(parsed);
        return;
      }
    }
    this.selectedValue = item.opt.value;
    this.selectedLabel = item.opt.value === this.emptyValue && this.emptyValue === '' ? '' : item.opt.label;
    this.displayOverride = null;
    this.setSyncedInputClasses(false);
    this.isFiltering = false;
    this.close(false);
    this.refreshInputPresentation();
    this.onChange(item.opt.value, item.opt);
  }

  private commitOrRevertOnDismiss() {
    if (this.isFiltering && this.allowCustomNumeric && this.parseCustomNumeric) {
      const raw = this.input.value.trim();
      if (raw === '') {
        this.selectedValue = this.emptyValue;
        this.selectedLabel = '';
        this.displayOverride = null;
        this.isFiltering = false;
        this.close(false);
        this.refreshInputPresentation();
        this.onChange(this.emptyValue, null);
        return;
      }
      const parsed = this.parseCustomNumeric(raw);
      if (parsed !== null && String(parsed) !== this.selectedValue) {
        this.commitCustomNumber(parsed);
        return;
      }
    }
    this.isFiltering = false;
    this.close(true);
  }

  private syncLabelFromSelection() {
    if (this.selectedValue === '' && this.emptyValue === '') {
      this.selectedLabel = '';
      return;
    }
    const found = this.options.find((o) => o.value === this.selectedValue);
    if (found) {
      this.selectedLabel = found.label;
    } else if (this.allowCustomNumeric && this.selectedValue) {
      const n = Number(this.selectedValue);
      this.selectedLabel = Number.isFinite(n) ? this.formatCustomNumeric(n) : this.selectedValue;
    } else {
      this.selectedLabel = '';
    }
  }

  private setSyncedInputClasses(synced: boolean) {
    this.isSyncedStyle = synced;
    this.input.classList.toggle('text-blue-700', synced);
    this.input.classList.toggle('bg-blue-50/40', synced);
    this.input.classList.toggle('text-slate-900', !synced);
    this.input.classList.toggle('bg-white', !synced);
  }

  private refreshInputPresentation() {
    this.input.value = this.displayOverride ?? this.selectedLabel;
    this.updateClearVisibility();
  }

  private updateClearVisibility() {
    if (!this.clearBtn) return;
    const hasOverrideClear = this.displayOverride !== null && this.allowClearOverride;
    const hasCustomVal =
      hasOverrideClear ||
      (this.displayOverride === null &&
        this.selectedValue !== '' &&
        this.selectedValue !== this.emptyValue) ||
      (this.isFiltering && this.input.value.trim().length > 0);
    this.clearBtn.classList.toggle('hidden', !hasCustomVal);
  }

  private setOpenAttributes(open: boolean) {
    this.input.setAttribute('aria-expanded', open ? 'true' : 'false');
    this.listEl.classList.toggle('hidden', !open);
    if (this.chevronEl) {
      this.chevronEl.classList.toggle('rotate-180', open);
    }
  }

  private renderList() {
    const query = this.isFiltering ? this.input.value.trim().toLowerCase() : '';
    const tokens = query.split(/\s+/).filter(Boolean);

    let filtered =
      tokens.length === 0
        ? this.options
        : this.options.filter((opt) => tokens.every((t) => opt.searchBlob.includes(t)));

    const items: RenderedOption[] = [];

    if (this.allowCustomNumeric && this.parseCustomNumeric && this.isFiltering && query) {
      const parsed = this.parseCustomNumeric(query);
      if (parsed !== null && !this.options.some((o) => o.value === String(parsed))) {
        const customOpt: ComboboxOption = {
          value: String(parsed),
          label: this.formatCustomActionLabel(parsed),
          group: undefined,
          badge: 'Custom',
          searchBlob: `${parsed} ${parsed}gb custom`,
        };
        items.push({ opt: customOpt, isCustomAction: true });
      }
    }

    for (const opt of filtered) {
      items.push({ opt });
    }

    this.renderedItems = items;

    if (items.length === 0) {
      this.activeIndex = -1;
      this.listEl.innerHTML = `<div class="px-3 py-4 text-center text-xs text-slate-500">${escapeHtml(this.emptyText)}</div>`;
      return;
    }

    // Default activeIndex to currently selected item if unfiltered, otherwise 0
    if (!this.isFiltering) {
      const selIdx = items.findIndex((x) => !x.isCustomAction && x.opt.value === this.selectedValue);
      this.activeIndex = selIdx >= 0 ? selIdx : 0;
    } else if (this.activeIndex < 0 || this.activeIndex >= items.length) {
      this.activeIndex = 0;
    }

    const htmlParts: string[] = [];
    let lastGroup: string | undefined = undefined;

    items.forEach((item, idx) => {
      const { opt } = item;
      if (opt.group && opt.group !== lastGroup) {
        htmlParts.push(
          `<div class="sticky top-0 z-10 border-b border-slate-100 bg-slate-50/95 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 backdrop-blur-xs">${escapeHtml(opt.group)}</div>`,
        );
      }
      lastGroup = opt.group;

      const isSelected = !item.isCustomAction && opt.value === this.selectedValue && this.displayOverride === null;
      const isActive = idx === this.activeIndex;
      const rowCls = isActive
        ? 'bg-blue-50 text-blue-950'
        : isSelected
          ? 'bg-slate-50/80 text-blue-700'
          : 'text-slate-800 hover:bg-slate-50';

      const badgeHtml = opt.badge
        ? `<span class="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-600">${escapeHtml(opt.badge)}</span>`
        : '';

      const subHtml = opt.sublabel
        ? `<span class="block truncate text-[11px] text-slate-500">${escapeHtml(opt.sublabel)}</span>`
        : '';

      const checkHtml = isSelected
        ? `<svg class="h-3.5 w-3.5 shrink-0 text-blue-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" /></svg>`
        : '';

      htmlParts.push(
        `<button type="button" role="option" aria-selected="${isSelected ? 'true' : 'false'}" data-cb-option data-cb-index="${idx}" class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition-colors cursor-pointer ${rowCls}">
          <span class="min-w-0 flex-1">
            <span class="block truncate ${isSelected ? 'font-semibold' : 'font-medium'}">${escapeHtml(opt.label)}</span>
            ${subHtml}
          </span>
          <span class="flex items-center gap-1.5 shrink-0">
            ${badgeHtml}
            ${checkHtml}
          </span>
        </button>`,
      );
    });

    this.listEl.innerHTML = htmlParts.join('');
    this.scrollActiveIntoView();
  }

  private updateActiveHighlight() {
    const btns = Array.from(this.listEl.querySelectorAll('[data-cb-index]'));
    btns.forEach((btn) => {
      const idx = Number(btn.getAttribute('data-cb-index'));
      const active = idx === this.activeIndex;
      btn.classList.toggle('bg-blue-50', active);
      btn.classList.toggle('text-blue-950', active);
      if (active) {
        (btn as HTMLElement).scrollIntoView({ block: 'nearest' });
      }
    });
  }

  private scrollActiveIntoView() {
    if (this.activeIndex < 0) return;
    const el = this.listEl.querySelector(`[data-cb-index="${this.activeIndex}"]`) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ block: 'nearest' });
    }
  }

  public open() {
    this.isOpen = true;
    this.setOpenAttributes(true);
    this.renderList();
  }

  public close(revertInput: boolean = true) {
    this.isOpen = false;
    this.isFiltering = false;
    this.setOpenAttributes(false);
    if (revertInput) {
      this.refreshInputPresentation();
    }
  }

  public focus() {
    this.input.focus();
  }

  public setPlaceholder(text: string) {
    this.input.placeholder = text;
  }

  public setEmptyText(text: string) {
    this.emptyText = text;
    if (this.isOpen && this.renderedItems.length === 0) {
      this.renderList();
    }
  }

  public setCustomActionFormatter(fn: (num: number) => string) {
    this.formatCustomActionLabel = fn;
  }

  public getValue(): string {
    return this.selectedValue;
  }

  public setOptions(options: ComboboxOption[], preserveSelection: boolean = true) {
    this.options = [...options];
    if (preserveSelection) {
      this.syncLabelFromSelection();
    } else {
      this.selectedValue = this.emptyValue;
      this.selectedLabel = '';
    }
    if (this.isOpen) {
      this.renderList();
    }
    this.refreshInputPresentation();
  }

  public setValue(value: string, displayLabel?: string) {
    this.selectedValue = value;
    this.displayOverride = null;
    this.setSyncedInputClasses(false);
    if (displayLabel !== undefined) {
      this.selectedLabel = displayLabel;
    } else {
      this.syncLabelFromSelection();
    }
    this.isFiltering = false;
    this.refreshInputPresentation();
  }

  public setDisplayOverride(
    label: string,
    isSyncedStyle: boolean = true,
    allowClear: boolean = false,
  ) {
    this.selectedValue = this.emptyValue;
    this.selectedLabel = '';
    this.displayOverride = label;
    this.allowClearOverride = allowClear;
    this.isFiltering = false;
    this.setSyncedInputClasses(isSyncedStyle);
    this.refreshInputPresentation();
  }

  public clear(silent: boolean = true) {
    this.selectedValue = this.emptyValue;
    this.displayOverride = null;
    this.setSyncedInputClasses(false);
    this.syncLabelFromSelection();
    this.isFiltering = false;
    this.refreshInputPresentation();
    if (!silent) {
      const fallbackOpt = this.options.find((o) => o.value === this.emptyValue) ?? null;
      this.onChange(this.emptyValue, fallbackOpt);
    }
  }
}
