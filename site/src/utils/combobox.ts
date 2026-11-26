export type ComboboxSortMode = 'newest' | 'params-asc' | 'params-desc';

export interface ComboboxSortOption {
  key: ComboboxSortMode;
  label: string;
}

export interface ComboboxOption {
  value: string;
  label: string;
  group?: string;
  brand?: string;
  brandOrder?: number;
  series?: string;
  seriesOrder?: number;
  badge?: string;
  metaTag?: string;
  sortDate?: string;
  sortParams?: number;
  pinned?: boolean;
  sublabel?: string;
  searchBlob: string;
}

export interface CascaderLabelsConfig {
  searchPlaceholder?: string;
  brandHeader?: string;
  seriesHeader?: string;
  modelHeader?: string;
  allBrandsLabel?: (count: number) => string;
  allSeriesLabel?: (count: number) => string;
  itemsCountFormatter?: (count: number) => string;
  sortModes?: ComboboxSortOption[];
}

export interface SearchableComboboxConfig extends CascaderLabelsConfig {
  root: HTMLElement;
  options: ComboboxOption[];
  mode?: 'list' | 'cascader';
  placeholder?: string;
  emptyValue?: string;
  emptyText?: string;
  initialValue?: string;
  defaultShowAll?: boolean;
  initialSortMode?: ComboboxSortMode;
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

const ALL_TOKEN = '__ALL__';

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

  private mode: 'list' | 'cascader';
  private options: ComboboxOption[];
  private emptyValue: string;
  private emptyText: string;
  private allowCustomNumeric: boolean;
  private parseCustomNumeric?: (raw: string) => number | null;
  private formatCustomNumeric: (num: number) => string;
  private formatCustomActionLabel: (num: number) => string;
  private onChange: (value: string, option: ComboboxOption | null) => void;

  // Cascader UI labels & formatters
  private searchPlaceholder: string;
  private brandHeader: string;
  private seriesHeader: string;
  private modelHeader: string;
  private allBrandsLabel: (count: number) => string;
  private allSeriesLabel: (count: number) => string;
  private itemsCountFormatter: (count: number) => string;
  private sortModes: ComboboxSortOption[];
  private activeSortMode: ComboboxSortMode;
  private defaultShowAll: boolean;

  // Persistent cascader DOM nodes (kept mounted while typing inside panel search)
  private panelSearchInput: HTMLInputElement | null = null;
  private panelClearBtn: HTMLButtonElement | null = null;
  private panelCountEl: HTMLElement | null = null;
  private sortBarEl: HTMLElement | null = null;
  private brandHeaderEl: HTMLElement | null = null;
  private seriesHeaderEl: HTMLElement | null = null;
  private modelHeaderEl: HTMLElement | null = null;
  private brandsColEl: HTMLElement | null = null;
  private seriesColEl: HTMLElement | null = null;
  private modelsColEl: HTMLElement | null = null;
  private panelQuery: string = '';
  private activeBrand: string = '';
  private activeSeries: string = '';

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
  private onWinResize: () => void;

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

    this.mode = config.mode ?? 'list';
    this.options = [...config.options];
    this.emptyValue = config.emptyValue ?? '';
    this.emptyText = config.emptyText ?? 'No matching options';
    this.allowCustomNumeric = Boolean(config.allowCustomNumeric);
    this.parseCustomNumeric = config.parseCustomNumeric;
    this.formatCustomNumeric = config.formatCustomNumeric ?? ((n) => `${n} GB`);
    this.formatCustomActionLabel =
      config.formatCustomActionLabel ?? ((n) => `Use ${this.formatCustomNumeric(n)} (Custom)`);
    this.onChange = config.onChange;

    this.searchPlaceholder = config.searchPlaceholder ?? 'Search brand, series or model...';
    this.brandHeader = config.brandHeader ?? 'Brand';
    this.seriesHeader = config.seriesHeader ?? 'Series';
    this.modelHeader = config.modelHeader ?? 'Model';
    this.allBrandsLabel = config.allBrandsLabel ?? ((n) => `All (${n})`);
    this.allSeriesLabel = config.allSeriesLabel ?? ((n) => `All Series (${n})`);
    this.itemsCountFormatter = config.itemsCountFormatter ?? ((n) => `${n} models`);
    this.sortModes = config.sortModes ? [...config.sortModes] : [];
    this.activeSortMode = config.initialSortMode ?? 'newest';
    this.defaultShowAll = Boolean(config.defaultShowAll);

    if (config.placeholder) {
      this.input.placeholder = config.placeholder;
    }

    this.selectedValue = config.initialValue ?? this.emptyValue;
    this.syncLabelFromSelection();

    if (this.mode === 'cascader') {
      this.buildCascaderSkeleton();
    }

    this.onDocPointerDown = (ev: Event) => {
      if (!this.root.contains(ev.target as Node)) {
        if (this.isOpen || this.isFiltering) {
          this.commitOrRevertOnDismiss();
        }
      }
    };

    this.onWinResize = () => {
      if (this.mode === 'cascader' && this.isOpen) {
        this.positionCascaderPanel();
      }
    };

    this.bindEvents();
    this.refreshInputPresentation();
  }

  private getBrandOf(opt: ComboboxOption): string {
    return opt.brand || opt.group || 'Other';
  }

  private getSeriesOf(opt: ComboboxOption): string {
    return opt.series || opt.group || 'General';
  }

  private buildCascaderSkeleton() {
    this.listEl.innerHTML = `
      <div class="border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-2.5">
        <div class="relative flex items-center gap-2">
          <div class="relative flex-1">
            <svg class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ink-tertiary)]" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fill-rule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clip-rule="evenodd" />
            </svg>
            <input
              type="text"
              data-cb-panel-search
              autocomplete="off"
              spellcheck="false"
              placeholder="${escapeHtml(this.searchPlaceholder)}"
              class="field-input h-8 pl-8 pr-7 text-xs font-medium"
            />
            <button
              type="button"
              data-cb-panel-clear
              aria-label="Clear search"
              class="hidden absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-[var(--ink-tertiary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-primary)] cursor-pointer"
            >
              <svg class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
              </svg>
            </button>
          </div>
          <span data-cb-panel-count class="shrink-0 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1 font-mono text-[10px] font-semibold text-[var(--ink-secondary)] tabular-nums"></span>
        </div>
        <div data-cb-sort-bar class="mt-2 hidden flex-wrap items-center gap-1.5"></div>
      </div>
      <div class="grid grid-cols-[86px_112px_minmax(0,1fr)] sm:grid-cols-[132px_176px_minmax(0,1fr)] divide-x divide-[var(--border-hairline)] bg-[var(--bg-surface)]">
        <div class="min-w-0 flex flex-col">
          <div data-cb-brand-hdr class="border-b border-[var(--border-hairline)] bg-[var(--bg-subtle)] px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--ink-tertiary)]">${escapeHtml(this.brandHeader)}</div>
          <div data-cb-brands class="max-h-[280px] sm:max-h-[340px] overflow-y-auto py-1 thin-scrollbar"></div>
        </div>
        <div class="min-w-0 flex flex-col">
          <div data-cb-series-hdr class="border-b border-[var(--border-hairline)] bg-[var(--bg-subtle)] px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--ink-tertiary)]">${escapeHtml(this.seriesHeader)}</div>
          <div data-cb-series-list class="max-h-[280px] sm:max-h-[340px] overflow-y-auto py-1 thin-scrollbar"></div>
        </div>
        <div class="min-w-0 flex flex-col">
          <div data-cb-model-hdr class="border-b border-[var(--border-hairline)] bg-[var(--bg-subtle)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--ink-tertiary)]">${escapeHtml(this.modelHeader)}</div>
          <div data-cb-models class="max-h-[280px] sm:max-h-[340px] overflow-y-auto py-1 thin-scrollbar"></div>
        </div>
      </div>
    `;

    this.panelSearchInput = this.listEl.querySelector('[data-cb-panel-search]') as HTMLInputElement | null;
    this.panelClearBtn = this.listEl.querySelector('[data-cb-panel-clear]') as HTMLButtonElement | null;
    this.panelCountEl = this.listEl.querySelector('[data-cb-panel-count]') as HTMLElement | null;
    this.sortBarEl = this.listEl.querySelector('[data-cb-sort-bar]') as HTMLElement | null;
    this.brandHeaderEl = this.listEl.querySelector('[data-cb-brand-hdr]') as HTMLElement | null;
    this.seriesHeaderEl = this.listEl.querySelector('[data-cb-series-hdr]') as HTMLElement | null;
    this.modelHeaderEl = this.listEl.querySelector('[data-cb-model-hdr]') as HTMLElement | null;
    this.brandsColEl = this.listEl.querySelector('[data-cb-brands]') as HTMLElement | null;
    this.seriesColEl = this.listEl.querySelector('[data-cb-series-list]') as HTMLElement | null;
    this.modelsColEl = this.listEl.querySelector('[data-cb-models]') as HTMLElement | null;
  }

  private positionCascaderPanel() {
    if (this.mode !== 'cascader' || !this.isOpen) return;
    const vw = window.innerWidth || document.documentElement.clientWidth || 1280;
    const pad = 12;
    const desiredW = Math.min(680, Math.max(296, vw - pad * 2));
    this.listEl.style.width = `${desiredW}px`;
    const rect = this.root.getBoundingClientRect();
    let offsetLeft = 0;
    if (rect.left + desiredW > vw - pad) {
      offsetLeft = vw - pad - desiredW - rect.left;
    }
    if (rect.left + offsetLeft < pad) {
      offsetLeft = pad - rect.left;
    }
    this.listEl.style.left = `${Math.round(offsetLeft)}px`;
    this.listEl.style.right = 'auto';
  }

  private handleSharedKeydown(ev: KeyboardEvent, fromPanelSearch: boolean) {
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
          this.selectRenderedOption(this.renderedItems[this.activeIndex]);
        } else if (!fromPanelSearch && this.allowCustomNumeric && this.parseCustomNumeric) {
          const parsed = this.parseCustomNumeric(this.input.value);
          if (parsed !== null) {
            this.commitCustomNumber(parsed);
          }
        }
      } else if (!fromPanelSearch && this.allowCustomNumeric && this.parseCustomNumeric) {
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
      if (this.mode === 'cascader') {
        this.panelQuery = this.input.value;
        if (this.panelSearchInput) {
          this.panelSearchInput.value = this.input.value;
        }
        if (this.panelQuery.trim()) {
          this.activeBrand = ALL_TOKEN;
          this.activeSeries = ALL_TOKEN;
        } else {
          this.resetCascaderNavigationToSelection();
        }
      }
      if (!this.isOpen) {
        this.isOpen = true;
        this.setOpenAttributes(true);
      }
      this.activeIndex = 0;
      this.renderList();
      this.updateClearVisibility();
    });

    this.input.addEventListener('keydown', (ev: KeyboardEvent) => {
      this.handleSharedKeydown(ev, false);
    });

    this.input.addEventListener('blur', () => {
      window.setTimeout(() => {
        if (!this.root.contains(document.activeElement) && (this.isOpen || this.isFiltering)) {
          this.commitOrRevertOnDismiss();
        }
      }, 120);
    });

    if (this.panelSearchInput) {
      this.panelSearchInput.addEventListener('input', () => {
        this.panelQuery = this.panelSearchInput?.value ?? '';
        if (this.panelQuery.trim()) {
          this.activeBrand = ALL_TOKEN;
          this.activeSeries = ALL_TOKEN;
        } else {
          this.resetCascaderNavigationToSelection();
        }
        this.activeIndex = 0;
        this.renderList();
      });

      this.panelSearchInput.addEventListener('keydown', (ev: KeyboardEvent) => {
        this.handleSharedKeydown(ev, true);
      });

      this.panelSearchInput.addEventListener('blur', () => {
        window.setTimeout(() => {
          if (!this.root.contains(document.activeElement) && (this.isOpen || this.isFiltering)) {
            this.commitOrRevertOnDismiss();
          }
        }, 120);
      });
    }

    if (this.panelClearBtn) {
      this.panelClearBtn.addEventListener('mousedown', (ev: MouseEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.panelQuery = '';
        if (this.panelSearchInput) {
          this.panelSearchInput.value = '';
        }
        if (this.isFiltering) {
          this.isFiltering = false;
          this.refreshInputPresentation();
        }
        this.resetCascaderNavigationToSelection();
        this.renderList();
        this.panelSearchInput?.focus();
      });
    }

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
      const targetEl = ev.target as HTMLElement;
      const sortBtn = targetEl.closest('[data-cb-sort-mode]') as HTMLElement | null;
      if (sortBtn) {
        ev.preventDefault();
        const nextMode = sortBtn.getAttribute('data-cb-sort-mode') as ComboboxSortMode | null;
        if (nextMode) {
          this.activeSortMode = nextMode;
          this.activeIndex = 0;
          this.renderCascader();
        }
        return;
      }

      const brandBtn = targetEl.closest('[data-cb-brand]') as HTMLElement | null;
      if (brandBtn) {
        ev.preventDefault();
        const nextBrand = brandBtn.getAttribute('data-cb-brand') || '';
        this.selectCascaderBrand(nextBrand);
        return;
      }

      const seriesBtn = targetEl.closest('[data-cb-series]') as HTMLElement | null;
      if (seriesBtn) {
        ev.preventDefault();
        const nextSeries = seriesBtn.getAttribute('data-cb-series') || '';
        this.activeSeries = nextSeries;
        this.activeIndex = 0;
        this.renderCascader();
        return;
      }

      const optBtn = targetEl.closest('[data-cb-index]') as HTMLElement | null;
      if (optBtn) {
        ev.preventDefault();
        const idx = Number(optBtn.getAttribute('data-cb-index'));
        if (Number.isFinite(idx) && this.renderedItems[idx]) {
          this.selectRenderedOption(this.renderedItems[idx]);
        }
      }
    });

    document.addEventListener('pointerdown', this.onDocPointerDown);
    window.addEventListener('resize', this.onWinResize);
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
    this.input.classList.toggle('!text-[var(--accent-ink)]', synced);
    this.input.classList.toggle('!bg-[var(--accent-soft)]', synced);
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
    if (open && this.mode === 'cascader') {
      this.positionCascaderPanel();
    }
  }

  private getSortedBrands(pool: ComboboxOption[]): Array<{ name: string; order: number; count: number }> {
    const map = new Map<string, { name: string; order: number; firstIdx: number; count: number }>();
    pool.forEach((opt, i) => {
      const b = this.getBrandOf(opt);
      const ord = opt.brandOrder ?? 999;
      const prev = map.get(b);
      if (prev) {
        prev.count += 1;
        prev.order = Math.min(prev.order, ord);
      } else {
        map.set(b, { name: b, order: ord, firstIdx: i, count: 1 });
      }
    });
    return [...map.values()].sort((a, b) =>
      a.order !== b.order ? a.order - b.order : a.firstIdx - b.firstIdx,
    );
  }

  private getSortedSeries(
    pool: ComboboxOption[],
    brand: string,
  ): Array<{ name: string; order: number; count: number }> {
    const sub = brand && brand !== ALL_TOKEN ? pool.filter((o) => this.getBrandOf(o) === brand) : pool;
    const map = new Map<string, { name: string; order: number; firstIdx: number; count: number }>();
    sub.forEach((opt, i) => {
      const s = this.getSeriesOf(opt);
      const ord = opt.seriesOrder ?? 999;
      const prev = map.get(s);
      if (prev) {
        prev.count += 1;
        prev.order = Math.min(prev.order, ord);
      } else {
        map.set(s, { name: s, order: ord, firstIdx: i, count: 1 });
      }
    });
    return [...map.values()].sort((a, b) =>
      a.order !== b.order ? a.order - b.order : a.firstIdx - b.firstIdx,
    );
  }

  private resetCascaderNavigationToSelection() {
    const selectedOpt =
      this.selectedValue && this.displayOverride === null
        ? this.options.find((o) => o.value === this.selectedValue)
        : undefined;
    if (selectedOpt && !selectedOpt.pinned) {
      this.activeBrand = this.getBrandOf(selectedOpt);
      this.activeSeries = this.getSeriesOf(selectedOpt);
      return;
    }
    if (this.defaultShowAll || selectedOpt?.pinned) {
      this.activeBrand = ALL_TOKEN;
      this.activeSeries = ALL_TOKEN;
      return;
    }
    const normalPool = this.options.filter((o) => !o.pinned);
    const brands = this.getSortedBrands(normalPool);
    if (brands.length > 0) {
      this.activeBrand = brands[0].name;
      const seriesList = this.getSortedSeries(normalPool, this.activeBrand);
      this.activeSeries = seriesList[0]?.name ?? ALL_TOKEN;
    } else {
      this.activeBrand = ALL_TOKEN;
      this.activeSeries = ALL_TOKEN;
    }
  }

  private selectCascaderBrand(nextBrand: string) {
    this.activeBrand = nextBrand;
    const query = this.panelQuery.trim().toLowerCase();
    const tokens = query.split(/\s+/).filter(Boolean);
    const pool =
      tokens.length === 0
        ? this.options.filter((o) => !o.pinned)
        : this.options.filter((o) => !o.pinned && tokens.every((t) => o.searchBlob.includes(t)));
    if (nextBrand === ALL_TOKEN) {
      this.activeSeries = ALL_TOKEN;
    } else {
      const seriesList = this.getSortedSeries(pool, nextBrand);
      this.activeSeries =
        (tokens.length > 0 || this.defaultShowAll) && seriesList.length > 1
          ? ALL_TOKEN
          : (seriesList[0]?.name ?? ALL_TOKEN);
    }
    this.activeIndex = 0;
    this.renderCascader();
  }

  private renderCascader() {
    if (!this.brandsColEl || !this.seriesColEl || !this.modelsColEl) return;

    const query = this.panelQuery.trim().toLowerCase();
    const tokens = query.split(/\s+/).filter(Boolean);
    const matchedPool =
      tokens.length === 0
        ? this.options
        : this.options.filter((opt) => tokens.every((t) => opt.searchBlob.includes(t)));
    const pinnedPool = matchedPool.filter((o) => o.pinned);
    const normalPool = matchedPool.filter((o) => !o.pinned);

    if (this.panelClearBtn) {
      this.panelClearBtn.classList.toggle('hidden', query.length === 0);
    }
    if (this.panelCountEl) {
      const countTarget = normalPool.length > 0 || pinnedPool.length === 0 ? normalPool.length : matchedPool.length;
      this.panelCountEl.textContent = this.itemsCountFormatter(countTarget);
    }
    if (this.sortBarEl) {
      if (this.sortModes.length > 0) {
        this.sortBarEl.classList.remove('hidden');
        this.sortBarEl.classList.add('flex');
        this.sortBarEl.innerHTML = this.sortModes
          .map((m) => {
            const active = m.key === this.activeSortMode;
            return `<button type="button" data-cb-sort-mode="${escapeHtml(m.key)}" data-active="${active ? 'true' : 'false'}" class="pill-filter text-[11px]">${escapeHtml(m.label)}</button>`;
          })
          .join('');
      } else {
        this.sortBarEl.classList.add('hidden');
        this.sortBarEl.classList.remove('flex');
      }
    }
    if (this.brandHeaderEl) this.brandHeaderEl.textContent = this.brandHeader;
    if (this.seriesHeaderEl) this.seriesHeaderEl.textContent = this.seriesHeader;
    if (this.modelHeaderEl) this.modelHeaderEl.textContent = this.modelHeader;

    const brands = this.getSortedBrands(normalPool);

    if (brands.length === 0 && pinnedPool.length === 0) {
      this.brandsColEl.innerHTML = `<div class="px-2.5 py-3 text-[11px] text-[var(--ink-tertiary)]">—</div>`;
      this.seriesColEl.innerHTML = `<div class="px-2.5 py-3 text-[11px] text-[var(--ink-tertiary)]">—</div>`;
      this.renderedItems = [];
      this.activeIndex = -1;
      this.modelsColEl.innerHTML = `<div class="px-3 py-6 text-center text-xs text-[var(--ink-secondary)]">${escapeHtml(this.emptyText)}</div>`;
      return;
    }

    if (
      this.activeBrand !== ALL_TOKEN &&
      !brands.some((b) => b.name === this.activeBrand)
    ) {
      this.activeBrand =
        tokens.length > 0 || this.defaultShowAll ? ALL_TOKEN : (brands[0]?.name ?? ALL_TOKEN);
    } else if (!this.activeBrand) {
      this.activeBrand =
        tokens.length > 0 || this.defaultShowAll ? ALL_TOKEN : (brands[0]?.name ?? ALL_TOKEN);
    }

    const brandParts: string[] = [];
    if ((tokens.length > 0 || this.defaultShowAll) && brands.length > 1) {
      const isAllBrands = this.activeBrand === ALL_TOKEN;
      const cls = isAllBrands
        ? 'bg-[var(--accent-soft)] text-[var(--accent-ink)] font-semibold border-l-2 border-[var(--accent)]'
        : 'text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-primary)] border-l-2 border-transparent';
      brandParts.push(
        `<button type="button" data-cb-brand="${ALL_TOKEN}" class="flex w-full items-center justify-between gap-1 px-2 sm:px-2.5 py-2 text-left text-[11px] sm:text-xs transition-colors cursor-pointer ${cls}">
          <span class="truncate">${escapeHtml(this.allBrandsLabel(normalPool.length))}</span>
        </button>`,
      );
    }

    for (const b of brands) {
      const isActive = this.activeBrand === b.name;
      const cls = isActive
        ? 'bg-[var(--accent-soft)] text-[var(--accent-ink)] font-semibold border-l-2 border-[var(--accent)]'
        : 'text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-primary)] font-medium border-l-2 border-transparent';
      brandParts.push(
        `<button type="button" data-cb-brand="${escapeHtml(b.name)}" class="flex w-full items-center justify-between gap-1 px-2 sm:px-2.5 py-2 text-left text-[11px] sm:text-xs transition-colors cursor-pointer ${cls}">
          <span class="truncate">${escapeHtml(b.name)}</span>
          <span class="shrink-0 font-mono text-[10px] ${isActive ? 'text-[var(--accent-ink)]' : 'text-[var(--ink-tertiary)]'} tabular-nums">${b.count}</span>
        </button>`,
      );
    }
    this.brandsColEl.innerHTML = brandParts.join('');

    const seriesList = this.getSortedSeries(normalPool, this.activeBrand);
    const brandFilteredPool =
      this.activeBrand === ALL_TOKEN
        ? normalPool
        : normalPool.filter((o) => this.getBrandOf(o) === this.activeBrand);

    if (
      this.activeSeries !== ALL_TOKEN &&
      !seriesList.some((s) => s.name === this.activeSeries)
    ) {
      this.activeSeries =
        (tokens.length > 0 || this.defaultShowAll) && seriesList.length > 1
          ? ALL_TOKEN
          : (seriesList[0]?.name ?? ALL_TOKEN);
    } else if (!this.activeSeries) {
      this.activeSeries =
        (tokens.length > 0 || this.defaultShowAll) && seriesList.length > 1
          ? ALL_TOKEN
          : (seriesList[0]?.name ?? ALL_TOKEN);
    }

    const seriesParts: string[] = [];
    if ((tokens.length > 0 || this.defaultShowAll || this.activeBrand === ALL_TOKEN) && seriesList.length > 1) {
      const isAllSer = this.activeSeries === ALL_TOKEN;
      const cls = isAllSer
        ? 'bg-[var(--accent-soft)] text-[var(--accent-ink)] font-semibold border-l-2 border-[var(--accent)]'
        : 'text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-primary)] border-l-2 border-transparent';
      seriesParts.push(
        `<button type="button" data-cb-series="${ALL_TOKEN}" class="flex w-full items-center justify-between gap-1 px-2 sm:px-2.5 py-2 text-left text-[11px] sm:text-xs transition-colors cursor-pointer ${cls}">
          <span class="truncate">${escapeHtml(this.allSeriesLabel(brandFilteredPool.length))}</span>
        </button>`,
      );
    }

    for (const s of seriesList) {
      const isActive = this.activeSeries === s.name;
      const cls = isActive
        ? 'bg-[var(--accent-soft)] text-[var(--accent-ink)] font-semibold border-l-2 border-[var(--accent)]'
        : 'text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-primary)] font-medium border-l-2 border-transparent';
      seriesParts.push(
        `<button type="button" data-cb-series="${escapeHtml(s.name)}" class="flex w-full items-center justify-between gap-1 px-2 sm:px-2.5 py-2 text-left text-[11px] sm:text-xs transition-colors cursor-pointer ${cls}">
          <span class="truncate">${escapeHtml(s.name)}</span>
          <span class="shrink-0 font-mono text-[10px] ${isActive ? 'text-[var(--accent-ink)]' : 'text-[var(--ink-tertiary)]'} tabular-nums">${s.count}</span>
        </button>`,
      );
    }
    this.seriesColEl.innerHTML = seriesParts.join('');

    const filteredNormal =
      this.activeSeries === ALL_TOKEN
        ? brandFilteredPool
        : brandFilteredPool.filter((o) => this.getSeriesOf(o) === this.activeSeries);

    const orderedNormal =
      this.sortModes.length > 0
        ? [...filteredNormal].sort((a, b) => {
            if (this.activeSortMode === 'params-asc') {
              const pd = (a.sortParams ?? 0) - (b.sortParams ?? 0);
              if (pd !== 0) return pd;
              return (b.sortDate || '').localeCompare(a.sortDate || '') || a.label.localeCompare(b.label);
            }
            if (this.activeSortMode === 'params-desc') {
              const pd = (b.sortParams ?? 0) - (a.sortParams ?? 0);
              if (pd !== 0) return pd;
              return (b.sortDate || '').localeCompare(a.sortDate || '') || a.label.localeCompare(b.label);
            }
            return (
              (b.sortDate || '').localeCompare(a.sortDate || '') ||
              (b.sortParams ?? 0) - (a.sortParams ?? 0) ||
              a.label.localeCompare(b.label)
            );
          })
        : filteredNormal;

    const visibleOpts =
      this.activeBrand === ALL_TOKEN && this.activeSeries === ALL_TOKEN && pinnedPool.length > 0
        ? [...pinnedPool, ...orderedNormal]
        : orderedNormal;

    const items: RenderedOption[] = visibleOpts.map((opt) => ({ opt }));
    this.renderedItems = items;

    if (items.length === 0) {
      this.activeIndex = -1;
      this.modelsColEl.innerHTML = `<div class="px-3 py-6 text-center text-xs text-[var(--ink-secondary)]">${escapeHtml(this.emptyText)}</div>`;
      return;
    }

    if (!tokens.length) {
      const selIdx = items.findIndex((x) => x.opt.value === this.selectedValue);
      this.activeIndex = selIdx >= 0 ? selIdx : 0;
    } else if (this.activeIndex < 0 || this.activeIndex >= items.length) {
      this.activeIndex = 0;
    }

    const showSeriesHeaderInModels =
      this.sortModes.length === 0 && this.activeSeries === ALL_TOKEN && seriesList.length > 1;
    let lastSeries = '';
    const modelParts: string[] = [];

    items.forEach((item, idx) => {
      const { opt } = item;
      const curSeries = this.getSeriesOf(opt);
      if (showSeriesHeaderInModels && curSeries !== lastSeries) {
        modelParts.push(
          `<div class="sticky top-0 z-10 border-b border-[var(--border-hairline)] bg-[var(--bg-subtle)] px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--ink-tertiary)] backdrop-blur-xs">${escapeHtml(curSeries)}</div>`,
        );
      }
      lastSeries = curSeries;

      const isSelected = opt.value === this.selectedValue && this.displayOverride === null;
      const isActive = idx === this.activeIndex;
      const rowCls = isActive
        ? 'bg-[var(--accent-soft)] text-[var(--ink-primary)]'
        : isSelected
          ? 'bg-[var(--bg-subtle)] text-[var(--accent-ink)]'
          : 'text-[var(--ink-primary)] hover:bg-[var(--bg-subtle)]';

      const metaTagHtml = opt.metaTag
        ? `<span class="shrink-0 rounded border border-[var(--border-hairline)] bg-[var(--bg-subtle)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--ink-tertiary)] tabular-nums">${escapeHtml(opt.metaTag)}</span>`
        : '';

      const badgeHtml = opt.badge
        ? `<span class="hidden sm:inline-block shrink-0 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-subtle)] px-1.5 py-0.5 font-mono text-[10px] font-medium text-[var(--ink-secondary)]">${escapeHtml(opt.badge)}</span>`
        : '';

      const subHtml = opt.sublabel
        ? `<span class="block truncate text-[10px] sm:text-[11px] text-[var(--ink-tertiary)]">${escapeHtml(opt.sublabel)}</span>`
        : '';

      const checkHtml = isSelected
        ? `<svg class="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" /></svg>`
        : '';

      modelParts.push(
        `<button type="button" role="option" aria-selected="${isSelected ? 'true' : 'false'}" data-cb-option data-cb-index="${idx}" class="flex w-full items-center justify-between gap-2 px-2.5 sm:px-3 py-2 text-left text-[11px] sm:text-xs transition-colors cursor-pointer ${rowCls}">
          <span class="min-w-0 flex-1">
            <span class="block truncate ${isSelected ? 'font-semibold' : 'font-medium'}">${escapeHtml(opt.label)}</span>
            ${subHtml}
          </span>
          <span class="flex items-center gap-1.5 shrink-0">
            ${metaTagHtml}
            ${badgeHtml}
            ${checkHtml}
          </span>
        </button>`,
      );
    });

    this.modelsColEl.innerHTML = modelParts.join('');
    this.scrollActiveIntoView();
  }

  private renderList() {
    if (this.mode === 'cascader') {
      this.renderCascader();
      return;
    }

    const query = this.isFiltering ? this.input.value.trim().toLowerCase() : '';
    const tokens = query.split(/\s+/).filter(Boolean);

    const filtered =
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
      this.listEl.innerHTML = `<div class="px-3 py-4 text-center text-xs text-[var(--ink-secondary)]">${escapeHtml(this.emptyText)}</div>`;
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
          `<div class="sticky top-0 z-10 border-b border-[var(--border-hairline)] bg-[var(--bg-subtle)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--ink-tertiary)] backdrop-blur-xs">${escapeHtml(opt.group)}</div>`,
        );
      }
      lastGroup = opt.group;

      const isSelected = !item.isCustomAction && opt.value === this.selectedValue && this.displayOverride === null;
      const isActive = idx === this.activeIndex;
      const rowCls = isActive
        ? 'bg-[var(--accent-soft)] text-[var(--ink-primary)]'
        : isSelected
          ? 'bg-[var(--bg-subtle)] text-[var(--accent-ink)]'
          : 'text-[var(--ink-primary)] hover:bg-[var(--bg-subtle)]';

      const badgeHtml = opt.badge
        ? `<span class="shrink-0 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-subtle)] px-1.5 py-0.5 font-mono text-[10px] font-medium text-[var(--ink-secondary)]">${escapeHtml(opt.badge)}</span>`
        : '';

      const subHtml = opt.sublabel
        ? `<span class="block truncate text-[11px] text-[var(--ink-tertiary)]">${escapeHtml(opt.sublabel)}</span>`
        : '';

      const checkHtml = isSelected
        ? `<svg class="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" /></svg>`
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

  private getScrollContainer(): HTMLElement {
    return this.mode === 'cascader' && this.modelsColEl ? this.modelsColEl : this.listEl;
  }

  private updateActiveHighlight() {
    const container = this.getScrollContainer();
    const btns = Array.from(container.querySelectorAll('[data-cb-index]'));
    btns.forEach((btn) => {
      const idx = Number(btn.getAttribute('data-cb-index'));
      const active = idx === this.activeIndex;
      btn.classList.toggle('bg-[var(--accent-soft)]', active);
      btn.classList.toggle('text-[var(--ink-primary)]', active);
      if (active) {
        (btn as HTMLElement).scrollIntoView({ block: 'nearest' });
      }
    });
  }

  private scrollActiveIntoView() {
    if (this.activeIndex < 0) return;
    const container = this.getScrollContainer();
    const el = container.querySelector(`[data-cb-index="${this.activeIndex}"]`) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ block: 'nearest' });
    }
  }

  public open() {
    this.isOpen = true;
    if (this.mode === 'cascader') {
      if (this.isFiltering) {
        this.panelQuery = this.input.value;
        if (this.panelSearchInput) this.panelSearchInput.value = this.panelQuery;
      } else {
        this.panelQuery = '';
        if (this.panelSearchInput) this.panelSearchInput.value = '';
        this.resetCascaderNavigationToSelection();
      }
    }
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

  public setCascaderLabels(labels: CascaderLabelsConfig) {
    if (labels.searchPlaceholder !== undefined) {
      this.searchPlaceholder = labels.searchPlaceholder;
      if (this.panelSearchInput) {
        this.panelSearchInput.placeholder = this.searchPlaceholder;
      }
    }
    if (labels.brandHeader !== undefined) this.brandHeader = labels.brandHeader;
    if (labels.seriesHeader !== undefined) this.seriesHeader = labels.seriesHeader;
    if (labels.modelHeader !== undefined) this.modelHeader = labels.modelHeader;
    if (labels.allBrandsLabel !== undefined) this.allBrandsLabel = labels.allBrandsLabel;
    if (labels.allSeriesLabel !== undefined) this.allSeriesLabel = labels.allSeriesLabel;
    if (labels.itemsCountFormatter !== undefined) this.itemsCountFormatter = labels.itemsCountFormatter;
    if (labels.sortModes !== undefined) this.sortModes = [...labels.sortModes];
    if (this.mode === 'cascader' && this.isOpen) {
      this.renderCascader();
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
    if (this.mode === 'cascader') {
      this.panelQuery = '';
      if (this.panelSearchInput) this.panelSearchInput.value = '';
      this.resetCascaderNavigationToSelection();
    }
    this.refreshInputPresentation();
    if (!silent) {
      const fallbackOpt = this.options.find((o) => o.value === this.emptyValue) ?? null;
      this.onChange(this.emptyValue, fallbackOpt);
    }
  }
}
