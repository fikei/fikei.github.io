/**
 * UsageInspector — Component Usage Inspector
 *
 * Shows all instances of a given component type across the analysed source
 * (GitHub files, Figma frames, or crawled page URLs) with location context.
 * Clicking an instance opens a right-side drawer with:
 *   - The raw source code block
 *   - File path + line number (for code sources)
 *   - Surrounding HTML context
 *   - Variant classification
 *
 * Usage:
 *   const inspector = new UsageInspector({ container, onToast });
 *   inspector.show(component);   // open / refresh
 *   inspector.hide();            // close
 */
class UsageInspector {
  constructor({ container, onToast } = {}) {
    this.container = container;
    this.onToast = onToast || (() => {});

    this.allInstances = [];      // flat list of all instances for current component
    this.filteredInstances = []; // after search/filter applied
    this.selectedIndex = -1;
    this.drawerOpen = false;
    this.el = null;              // root DOM element (injected once)

    this._boundKeydown = this._handleKeydown.bind(this);
  }

  // ----------------------------------------------------------------
  // Public
  // ----------------------------------------------------------------

  /**
   * Open the inspector for the given component.
   * Flattens variant.instances[] into a single list with variant name attached.
   */
  show(component) {
    if (!component) return;

    // Flatten instances from all variants
    this.allInstances = [];
    (component.variants || []).forEach(variant => {
      (variant.instances || []).forEach(instance => {
        this.allInstances.push({
          variantName: variant.name || 'default',
          componentType: component.type,
          componentName: component.name || component.type,
          ...instance
        });
      });
    });

    this.filteredInstances = [...this.allInstances];
    this.selectedIndex = -1;
    this.drawerOpen = false;

    if (!this.el) this._mount();
    this._updateTitle(component);
    this._renderGrid();
    this._closeDrawer();
    this.el.classList.add('visible');

    document.addEventListener('keydown', this._boundKeydown);
  }

  /** Hide the inspector and clean up listeners. */
  hide() {
    if (this.el) this.el.classList.remove('visible');
    this._closeDrawer();
    document.removeEventListener('keydown', this._boundKeydown);
  }

  // ----------------------------------------------------------------
  // DOM setup
  // ----------------------------------------------------------------

  _mount() {
    const wrapper = document.createElement('div');
    wrapper.className = 'usage-inspector';
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-label', 'Component usage inspector');
    wrapper.innerHTML = `
      <div class="ui-header">
        <div class="ui-header__left">
          <h3 class="ui-title" id="ui-title">Instances</h3>
          <span class="ui-count" id="ui-count"></span>
        </div>
        <div class="ui-header__right">
          <input type="search" class="input input--sm ui-search" id="ui-search"
            placeholder="Filter by path or variant..." aria-label="Filter instances">
          <button class="btn btn--ghost btn--sm" id="ui-close" aria-label="Close inspector">Close</button>
        </div>
      </div>

      <div class="ui-body">
        <div class="ui-grid" id="ui-grid" role="list"></div>

        <aside class="ui-drawer" id="ui-drawer" aria-hidden="true" hidden>
          <div class="ui-drawer__header">
            <nav class="ui-drawer__nav" aria-label="Instance navigation">
              <button class="btn btn--ghost btn--xs" id="ui-prev" aria-label="Previous instance">&larr;</button>
              <span class="ui-drawer__nav-label" id="ui-nav-label" aria-live="polite"></span>
              <button class="btn btn--ghost btn--xs" id="ui-next" aria-label="Next instance">&rarr;</button>
            </nav>
            <button class="btn btn--ghost btn--xs" id="ui-drawer-close" aria-label="Close drawer">&times;</button>
          </div>
          <div class="ui-drawer__body" id="ui-drawer-body"></div>
        </aside>
      </div>
    `;

    this.container.appendChild(wrapper);
    this.el = wrapper;

    // Bind static controls
    wrapper.querySelector('#ui-close').addEventListener('click', () => this.hide());
    wrapper.querySelector('#ui-drawer-close').addEventListener('click', () => this._closeDrawer());
    wrapper.querySelector('#ui-prev').addEventListener('click', () => this._stepDrawer(-1));
    wrapper.querySelector('#ui-next').addEventListener('click', () => this._stepDrawer(1));
    wrapper.querySelector('#ui-search').addEventListener('input', e => this._applyFilter(e.target.value));
  }

  // ----------------------------------------------------------------
  // Grid
  // ----------------------------------------------------------------

  _updateTitle(component) {
    const titleEl = this.el?.querySelector('#ui-title');
    if (titleEl) titleEl.textContent = `${component.name || component.type} — instances`;
  }

  _renderGrid() {
    const grid = this.el?.querySelector('#ui-grid');
    const countEl = this.el?.querySelector('#ui-count');
    if (!grid) return;

    const n = this.filteredInstances.length;
    if (countEl) countEl.textContent = `${n} instance${n !== 1 ? 's' : ''}`;

    if (n === 0) {
      grid.innerHTML = `
        <div class="ui-empty">
          <p>No instances found.</p>
          <small>Run a GitHub or Figma scan to see file-level attribution.</small>
        </div>
      `;
      return;
    }

    grid.innerHTML = this.filteredInstances.map((inst, i) => {
      const loc = inst.location || {};
      const locLabel = this._formatLocation(loc);
      const shortLabel = locLabel.length > 64 ? '…' + locLabel.slice(-61) : locLabel;
      const sourceIcon = loc.type === 'file' ? '📄' : loc.type === 'figma-frame' ? '🎨' : '🌐';

      return `
        <div class="ui-card" role="listitem" data-index="${i}" tabindex="0" aria-label="${this._escAtr(locLabel)}">
          <div class="ui-card__preview" aria-hidden="true">
            <div class="ui-card__preview-html">${this._previewHtml(inst.html || '')}</div>
          </div>
          <div class="ui-card__meta">
            <span class="ui-variant-badge">${this._escHtml(inst.variantName || 'default')}</span>
            <span class="ui-location" title="${this._escAtr(locLabel)}">${sourceIcon} <code>${this._escHtml(shortLabel)}</code></span>
          </div>
        </div>
      `;
    }).join('');

    // Bind click + keyboard on cards
    grid.querySelectorAll('.ui-card').forEach(card => {
      const open = () => this._openDrawer(parseInt(card.dataset.index, 10));
      card.addEventListener('click', open);
      card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
  }

  _applyFilter(query) {
    const q = query.trim().toLowerCase();
    this.filteredInstances = q
      ? this.allInstances.filter(inst =>
          (inst.location?.path || '').toLowerCase().includes(q) ||
          (inst.variantName || '').toLowerCase().includes(q)
        )
      : [...this.allInstances];
    this._renderGrid();
  }

  // ----------------------------------------------------------------
  // Drawer
  // ----------------------------------------------------------------

  _openDrawer(index) {
    if (index < 0 || index >= this.filteredInstances.length) return;
    this.selectedIndex = index;
    this.drawerOpen = true;

    const drawer = this.el?.querySelector('#ui-drawer');
    if (drawer) {
      drawer.hidden = false;
      drawer.setAttribute('aria-hidden', 'false');
    }
    this.el?.classList.add('drawer-open');
    this._renderDrawerContent();
    this._highlightCard(index);
  }

  _closeDrawer() {
    this.drawerOpen = false;
    const drawer = this.el?.querySelector('#ui-drawer');
    if (drawer) {
      drawer.hidden = true;
      drawer.setAttribute('aria-hidden', 'true');
    }
    this.el?.classList.remove('drawer-open');
    this._highlightCard(-1);
  }

  _stepDrawer(delta) {
    const next = this.selectedIndex + delta;
    if (next >= 0 && next < this.filteredInstances.length) {
      this._openDrawer(next);
    }
  }

  _highlightCard(activeIndex) {
    this.el?.querySelectorAll('.ui-card').forEach(card => {
      card.classList.toggle('selected', parseInt(card.dataset.index, 10) === activeIndex);
    });
  }

  _renderDrawerContent() {
    const body = this.el?.querySelector('#ui-drawer-body');
    const navLabel = this.el?.querySelector('#ui-nav-label');
    if (!body) return;

    const inst = this.filteredInstances[this.selectedIndex];
    if (!inst) return;

    if (navLabel) {
      navLabel.textContent = `${this.selectedIndex + 1} / ${this.filteredInstances.length}`;
    }

    const loc = inst.location || {};
    const locDisplay = this._formatLocation(loc);
    const contextCode = [
      inst.context?.parent,
      ...(inst.context?.siblings || [])
    ].filter(Boolean).join('\n').trim();

    body.innerHTML = `
      <div class="ui-section">
        <div class="ui-section__head">
          <span class="ui-section__label">Preview</span>
          <code class="ui-section__loc">${this._escHtml(locDisplay)}</code>
        </div>
        <div class="ui-preview-box">
          ${inst.html || '<em style="opacity:.4">No preview available</em>'}
        </div>
      </div>

      <div class="ui-section">
        <div class="ui-section__head">
          <span class="ui-section__label">Source</span>
          <button class="btn btn--ghost btn--xs" data-action="copy-source">Copy</button>
        </div>
        <pre class="ui-code"><code>${this._escHtml(inst.html || '')}</code></pre>
      </div>

      ${contextCode ? `
      <div class="ui-section">
        <div class="ui-section__head">
          <span class="ui-section__label">Context</span>
        </div>
        <pre class="ui-code ui-code--muted"><code>${this._escHtml(contextCode)}</code></pre>
      </div>
      ` : ''}

      <div class="ui-section">
        <div class="ui-section__head">
          <span class="ui-section__label">Classification</span>
        </div>
        <div class="ui-classification">
          <span class="ui-classification__type">${this._escHtml(inst.componentType || '')}</span>
          <span class="ui-classification__sep">/</span>
          <span class="ui-classification__variant">${this._escHtml(inst.variantName || 'default')}</span>
          ${loc.line ? `<span class="ui-classification__line">line ${loc.line}</span>` : ''}
        </div>
      </div>
    `;

    // Copy source
    body.querySelector('[data-action="copy-source"]')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(inst.html || '');
        this.onToast('Source copied');
      } catch {
        this.onToast('Copy failed', 'error');
      }
    });
  }

  // ----------------------------------------------------------------
  // Keyboard nav
  // ----------------------------------------------------------------

  _handleKeydown(e) {
    if (!this.drawerOpen) return;
    if (e.key === 'Escape')      { e.stopPropagation(); this._closeDrawer(); }
    if (e.key === 'ArrowLeft')   { e.preventDefault();  this._stepDrawer(-1); }
    if (e.key === 'ArrowRight')  { e.preventDefault();  this._stepDrawer(1); }
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  _formatLocation(loc) {
    if (!loc) return 'Unknown';
    if (loc.type === 'file') return loc.path + (loc.line ? `:${loc.line}` : '');
    if (loc.type === 'figma-frame') return `Figma › ${loc.path}`;
    return loc.path || 'Unknown';
  }

  /** Show a stripped-down, safe preview of raw HTML in the grid card. */
  _previewHtml(html) {
    // Escape so it renders as text-like code, not live HTML
    return this._escHtml(html.slice(0, 160));
  }

  _escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  _escAtr(str) {
    return String(str || '').replace(/"/g, '&quot;');
  }
}
