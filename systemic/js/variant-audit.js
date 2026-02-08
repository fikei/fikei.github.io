/**
 * VariantAudit — QA component variants with stoplight governance
 *
 * Usage:
 *   const qa = new VariantAudit({
 *     container: document.getElementById('qa-view'),
 *     systemId: 'ctrl',
 *     onToast: (msg) => systemicApp.showToast(msg)
 *   });
 *   qa.registerComponents(components);
 *   qa.show('widget-name');
 */

class VariantAudit {
  constructor({ container, systemId, onToast }) {
    this.container = container;
    this.systemId = systemId || 'default';
    this.onToast = onToast || (() => {});

    // DOM references (bound after container is populated)
    this.els = {};

    // State
    this.audit = {};
    this.components = [];
    this.currentComponent = null;
    this.currentAuditName = null;
    this.blockedSectionOpen = false;
    this.gridLinesOn = false;
    this.ctxMenu = null;
    this.lastFilter = 'component';

    // Constants
    this.ALL_SIZES = [
      'sm', 'med', 'wide', 'banner',
      'tall', 'lg', 'xl', 'pano',
      'col', 'poster', 'max', 'cinema',
      'board', 'wall', 'full'
    ];

    this.SIZE_LABELS = {
      sm: '1x1', med: '2x1', wide: '3x1', banner: '4x1',
      tall: '1x2', lg: '2x2', xl: '3x2', pano: '4x2',
      col: '1x3', poster: '2x3', max: '3x3', cinema: '4x3',
      board: '2x4', wall: '3x4', full: '4x4'
    };

    this.STATUS_LABELS = {
      green: 'No updates',
      yellow: 'To process',
      orange: 'Needs review',
      red: 'Blocked'
    };

    // Storage keys (namespaced by systemId)
    this.AUDIT_KEY = `variant-audit:${this.systemId}`;
    this.FILTER_KEY = `variant-filter:${this.systemId}`;

    this.loadAudit();
    this.bindGlobalEvents();
  }

  // ============================================
  // Audit state CRUD
  // ============================================

  loadAudit() {
    try {
      var saved = localStorage.getItem(this.AUDIT_KEY);
      if (saved) this.audit = JSON.parse(saved);
    } catch (e) {}
  }

  saveAudit() {
    try { localStorage.setItem(this.AUDIT_KEY, JSON.stringify(this.audit)); } catch (e) {}
  }

  auditKey(name, size) { return name + ':' + size; }

  getAuditEntry(name, size) {
    return this.audit[this.auditKey(name, size)] || {};
  }

  setFlag(name, size, flagged) {
    var key = this.auditKey(name, size);
    if (!this.audit[key]) this.audit[key] = {};
    this.audit[key].flagged = flagged;
    if (!flagged && !this.audit[key].note) delete this.audit[key];
    this.saveAudit();
  }

  setNote(name, size, text) {
    var key = this.auditKey(name, size);
    text = (text || '').trim();
    if (!this.audit[key]) this.audit[key] = {};
    if (text) {
      this.audit[key].note = text;
      this.audit[key].processed = false;
    } else {
      delete this.audit[key].note;
      delete this.audit[key].processed;
      if (!this.audit[key].flagged) delete this.audit[key];
    }
    this.saveAudit();
  }

  setProcessed(name, size, val) {
    var key = this.auditKey(name, size);
    if (!this.audit[key]) this.audit[key] = {};
    if (val) {
      this.audit[key].processed = true;
    } else {
      delete this.audit[key].processed;
    }
    this.saveAudit();
  }

  getStatus(name, size) {
    var entry = this.getAuditEntry(name, size);
    if (entry.flagged) return 'red';
    if (entry.note && !entry.processed) return 'yellow';
    if (entry.note && entry.processed) return 'orange';
    return 'green';
  }

  // ============================================
  // Component registration
  // ============================================

  /**
   * Register components for auditing.
   * Each component: { name, element, axes }
   * `element` is the HTML string or DOM node to clone for each variant.
   * `axes` defines variant dimensions: { size: [...], template: [...] }
   */
  registerComponents(components) {
    this.components = components;
    this.populateFilters();
  }

  /**
   * Register from a loaded design system (Systemic format)
   */
  registerFromDesignSystem(designSystem) {
    if (!designSystem || !designSystem.components) return;
    this.systemId = designSystem.id || this.systemId;
    this.AUDIT_KEY = `variant-audit:${this.systemId}`;
    this.FILTER_KEY = `variant-filter:${this.systemId}`;
    this.loadAudit();

    this.components = designSystem.components.map(comp => {
      const isTemplate = comp.type?.startsWith('template-');
      // For templates, build a size → HTML map so QA can render each size correctly
      const variantsBySize = {};
      if (isTemplate && comp.variants) {
        comp.variants.forEach(v => {
          const sizeMatch = v.name?.match(/@ (\w+)$/);
          if (sizeMatch) variantsBySize[sizeMatch[1]] = v.html;
        });
      }
      return {
        name: comp.type || comp.name,
        label: comp.name || comp.type,
        variants: comp.variants || [],
        element: comp.variants?.[0]?.html || null,
        isTemplate,
        variantsBySize,
        validSizes: isTemplate
          ? comp.variants?.map(v => v.name?.match(/@ (\w+)$/)?.[1]).filter(Boolean)
          : null
      };
    });

    this.populateFilters();
  }

  populateFilters() {
    var select = this.els.componentFilter;
    if (!select) return;
    select.innerHTML = '<option value="">— Select component —</option>';
    this.components.forEach(comp => {
      var opt = document.createElement('option');
      opt.value = comp.name;
      opt.textContent = comp.label || comp.name;
      select.appendChild(opt);
    });
  }

  // ============================================
  // Bind DOM elements from container
  // ============================================

  bindElements() {
    this.els = {
      componentFilter: this.container.querySelector('#qa-component-filter'),
      variantFilter: this.container.querySelector('#qa-variant-filter'),
      gridLinesBtn: this.container.querySelector('#qa-gridlines-btn'),
      stats: this.container.querySelector('#qa-stats'),
      content: this.container.querySelector('#qa-content'),
      grid: this.container.querySelector('#qa-grid'),
      blockedSection: this.container.querySelector('#qa-blocked-section'),
      blockedToggle: this.container.querySelector('#qa-blocked-toggle'),
      blockedGrid: this.container.querySelector('#qa-blocked-grid'),
      auditOutput: this.container.querySelector('#qa-audit-output'),
      desc: this.container.querySelector('#qa-desc'),
      // Grid test
      gridTestSection: this.container.querySelector('#qa-grid-test-section'),
      gridTest: this.container.querySelector('#qa-grid-test'),
      gridTestLinesBtn: this.container.querySelector('#qa-grid-test-lines-btn'),
      gridControls: this.container.querySelector('.qa-grid-controls')
    };
  }

  // ============================================
  // Global event listeners
  // ============================================

  bindGlobalEvents() {
    // Right-click → context menu
    document.addEventListener('contextmenu', (e) => {
      var item = e.target.closest('.qa-variant-item');
      if (!item) { this.closeContextMenu(); return; }
      if (e.target.tagName === 'TEXTAREA') return;
      // Only handle if inside our container
      if (!this.container.contains(item)) return;
      e.preventDefault();
      this.showContextMenu(e, item);
    });

    // Click outside menu → close
    document.addEventListener('click', (e) => {
      if (this.ctxMenu && !this.ctxMenu.contains(e.target)) this.closeContextMenu();
    });

    // Escape → close menu
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeContextMenu();
    });
  }

  // ============================================
  // Initialize view (called when QA route loads)
  // ============================================

  init() {
    // Guard against duplicate init
    if (this._initialized) {
      // Just refresh filters and data
      this.populateFilters();
      this.restoreFilterState();
      this.renderAuditTable();
      return;
    }
    this._initialized = true;

    this.bindElements();
    this.populateFilters();

    // Bind filter events
    if (this.els.componentFilter) {
      this.els.componentFilter.addEventListener('change', () => {
        this.lastFilter = 'component';
        this.showVariants();
      });
    }
    if (this.els.variantFilter) {
      this.els.variantFilter.addEventListener('change', () => {
        this.lastFilter = 'variant';
        this.showVariants();
      });
    }
    if (this.els.gridLinesBtn) {
      this.els.gridLinesBtn.addEventListener('click', () => this.toggleGridLines());
    }

    // Grid test controls
    if (this.els.gridControls) {
      this.els.gridControls.querySelectorAll('[data-cols]').forEach(btn => {
        btn.addEventListener('click', () => {
          this.setGridTestCols(btn.dataset.cols, btn);
        });
      });
    }
    if (this.els.gridTestLinesBtn) {
      this.els.gridTestLinesBtn.addEventListener('click', () => this.toggleGridTestLines());
    }

    this.restoreFilterState();
    this.renderAuditTable();
  }

  // ============================================
  // Grid lines toggle (Systemic viewer pattern)
  // ============================================

  toggleGridLines() {
    this.gridLinesOn = !this.gridLinesOn;
    this.els.gridLinesBtn?.classList.toggle('active', this.gridLinesOn);
    this.els.grid?.classList.toggle('qa-variant-grid--gridlines', this.gridLinesOn);
    this.els.blockedGrid?.classList.toggle('qa-variant-grid--gridlines', this.gridLinesOn);
  }

  // ============================================
  // Show variants for selected component
  // ============================================

  showVariants() {
    var componentVal = this.els.componentFilter?.value;
    var variantVal = this.els.variantFilter?.value;

    if (!componentVal) {
      this.els.grid.innerHTML = '';
      this.els.blockedSection.style.display = 'none';
      this.els.desc.textContent = 'Select a component to audit its variants.';
      this.currentComponent = null;
      this.currentAuditName = null;
      this.populateGridTest(null);
      this.saveFilterState();
      return;
    }

    var comp = this.components.find(c => c.name === componentVal);
    if (!comp) {
      this.els.grid.innerHTML = '<p class="qa-empty">Component not found.</p>';
      this.els.blockedSection.style.display = 'none';
      return;
    }

    this.currentComponent = comp;
    this.currentAuditName = comp.name;

    var grid = this.els.grid;
    var blockedGrid = this.els.blockedGrid;
    grid.innerHTML = '';
    blockedGrid.innerHTML = '';

    grid.classList.toggle('qa-variant-grid--gridlines', this.gridLinesOn);
    blockedGrid.classList.toggle('qa-variant-grid--gridlines', this.gridLinesOn);

    var activeCount = 0;
    var blockedCount = 0;

    // Determine which element to clone for rendering variants
    var sourceHtml = comp.element;
    var sourceNode = null;
    if (typeof sourceHtml === 'string' && sourceHtml) {
      var temp = document.createElement('div');
      temp.innerHTML = sourceHtml;
      sourceNode = temp.firstElementChild;
    } else if (sourceHtml instanceof HTMLElement) {
      sourceNode = sourceHtml;
    }

    // Use valid sizes for templates, all sizes otherwise
    var sizes = comp.validSizes || comp.axes?.size || this.ALL_SIZES;
    sizes.forEach(size => {
      var entry = this.getAuditEntry(this.currentAuditName, size);
      var isFlagged = !!entry.flagged;
      var wrapper = this.buildVariantItem(sourceNode, this.currentAuditName, size, comp);

      if (isFlagged) {
        blockedCount++;
        blockedGrid.appendChild(wrapper);
      } else {
        activeCount++;
        grid.appendChild(wrapper);
      }
    });

    // Update description
    this.els.desc.textContent = comp.name + ' — ' + activeCount + ' active' +
      (blockedCount > 0 ? ', ' + blockedCount + ' blocked' : '') + '. Hover for actions.';

    // Blocked section visibility
    if (blockedCount > 0) {
      this.els.blockedSection.style.display = '';
      this.updateBlockedToggle(blockedCount);
    } else {
      this.els.blockedSection.style.display = 'none';
      this.blockedSectionOpen = false;
    }

    this.updateStats();
    this.renderAuditTable();
    this.populateGridTest(comp);
    this.saveFilterState();
  }

  // ============================================
  // Build a single variant item
  // ============================================

  buildVariantItem(sourceNode, auditName, size, comp) {
    var entry = this.getAuditEntry(auditName, size);
    var isFlagged = !!entry.flagged;
    var hasNote = !!entry.note;
    var status = this.getStatus(auditName, size);

    var wrapper = document.createElement('div');
    wrapper.className = 'qa-variant-item qa-variant-item--' + size +
      (isFlagged ? ' qa-variant-item--flagged' : '');
    wrapper.dataset.auditName = auditName;
    wrapper.dataset.size = size;

    // Label with stoplight + comment count
    var lbl = document.createElement('div');
    lbl.className = 'qa-variant-label';

    var dot = document.createElement('span');
    dot.className = 'qa-stoplight qa-stoplight--' + status;
    dot.title = this.STATUS_LABELS[status];
    lbl.appendChild(dot);

    var lblText = document.createElement('span');
    lblText.textContent = size + ' (' + (this.SIZE_LABELS[size] || size) + ')';
    lbl.appendChild(lblText);

    if (hasNote) {
      var badge = document.createElement('span');
      badge.className = 'qa-comment-count';
      badge.textContent = '1';
      badge.title = entry.note;
      lbl.appendChild(badge);
    }

    // Action buttons (visible controls instead of right-click only)
    var actions = document.createElement('div');
    actions.className = 'qa-variant-actions';

    var commentBtn = document.createElement('button');
    commentBtn.className = 'qa-action-btn' + (hasNote ? ' qa-action-btn--active' : '');
    commentBtn.textContent = hasNote ? 'Edit' : 'Comment';
    commentBtn.title = hasNote ? 'Edit comment' : 'Add comment';
    commentBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openComment(wrapper, auditName, size);
    });
    actions.appendChild(commentBtn);

    // Status action (depends on current stoplight)
    if (status === 'yellow') {
      var processBtn = document.createElement('button');
      processBtn.className = 'qa-action-btn';
      processBtn.textContent = 'Mark processed';
      processBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setProcessed(auditName, size, true);
        this.refreshVariantStatus(wrapper, auditName, size);
        this.renderAuditTable();
        this.showVariants(); // rebuild to update action buttons
      });
      actions.appendChild(processBtn);
    } else if (status === 'orange') {
      var approveBtn = document.createElement('button');
      approveBtn.className = 'qa-action-btn';
      approveBtn.textContent = 'Approve';
      approveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setNote(auditName, size, '');
        this.setProcessed(auditName, size, false);
        this.refreshVariantStatus(wrapper, auditName, size);
        this.renderAuditTable();
        this.showVariants();
      });
      actions.appendChild(approveBtn);
    }

    var blockBtn = document.createElement('button');
    blockBtn.className = 'qa-action-btn qa-action-btn--block';
    blockBtn.textContent = isFlagged ? 'Unblock' : 'Block';
    blockBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleBlock(wrapper, auditName, size);
    });
    actions.appendChild(blockBtn);

    lbl.appendChild(actions);

    // Blocked overlay
    var blockedOverlay = document.createElement('div');
    blockedOverlay.className = 'qa-blocked-overlay';
    blockedOverlay.innerHTML = '<span>Blocked</span>';

    // Preview container
    var preview = document.createElement('div');
    preview.className = 'qa-variant-preview';

    // For templates, use the pre-rendered size-specific HTML
    if (comp?.isTemplate && comp.variantsBySize?.[size]) {
      preview.innerHTML = comp.variantsBySize[size];
    } else if (sourceNode) {
      var clone = sourceNode.cloneNode(true);
      // Strip existing size classes and apply the target size
      clone.className = clone.className.replace(/w-shell--\w+/g, '').trim();
      clone.style.cssText = '';
      clone.classList.add('w-shell--' + size);
      preview.appendChild(clone);
    } else {
      preview.innerHTML = '<div style="padding:var(--space-4);color:var(--fg-subtle);font-size:var(--text-xs);text-align:center">' +
        size + ' (' + (this.SIZE_LABELS[size] || size) + ')</div>';
    }

    wrapper.appendChild(lbl);
    wrapper.appendChild(blockedOverlay);
    wrapper.appendChild(preview);
    return wrapper;
  }

  // ============================================
  // Blocked section
  // ============================================

  updateBlockedToggle(count) {
    var btn = this.els.blockedToggle;
    if (!btn) return;
    btn.textContent = (this.blockedSectionOpen ? 'Hide' : 'Show') + ' ' + count + ' blocked';
    btn.classList.toggle('active', this.blockedSectionOpen);
  }

  toggleBlockedSection() {
    this.blockedSectionOpen = !this.blockedSectionOpen;
    this.els.blockedGrid.style.display = this.blockedSectionOpen ? '' : 'none';
    var count = this.els.blockedGrid.querySelectorAll('.qa-variant-item').length;
    this.updateBlockedToggle(count);
    this.saveFilterState();
  }

  // ============================================
  // Reflow variant between grids
  // ============================================

  reflowVariant(item, name, size) {
    var entry = this.getAuditEntry(name, size);
    var isFlagged = !!entry.flagged;
    var grid = this.els.grid;
    var blockedGrid = this.els.blockedGrid;

    if (isFlagged) {
      blockedGrid.appendChild(item);
    } else {
      // Insert in correct sort position
      var allItems = grid.querySelectorAll('.qa-variant-item');
      var sizeIdx = this.ALL_SIZES.indexOf(size);
      var inserted = false;
      for (var i = 0; i < allItems.length; i++) {
        var itemIdx = this.ALL_SIZES.indexOf(allItems[i].dataset.size);
        if (itemIdx > sizeIdx) {
          grid.insertBefore(item, allItems[i]);
          inserted = true;
          break;
        }
      }
      if (!inserted) grid.appendChild(item);
      item.classList.remove('qa-variant-item--flagged');
    }

    // Update counts
    var blockedCount = blockedGrid.querySelectorAll('.qa-variant-item').length;
    var activeCount = grid.querySelectorAll('.qa-variant-item').length;

    if (blockedCount > 0) {
      this.els.blockedSection.style.display = '';
      this.updateBlockedToggle(blockedCount);
    } else {
      this.els.blockedSection.style.display = 'none';
      this.blockedSectionOpen = false;
    }

    // Update description
    if (this.els.desc && this.currentAuditName) {
      this.els.desc.textContent = this.currentAuditName + ' — ' + activeCount + ' active' +
        (blockedCount > 0 ? ', ' + blockedCount + ' blocked' : '') + '. Right-click for options.';
    }
  }

  // ============================================
  // Context menu
  // ============================================

  showContextMenu(e, item) {
    this.closeContextMenu();
    var name = item.dataset.auditName;
    var size = item.dataset.size;
    var entry = this.getAuditEntry(name, size);
    var isFlagged = !!entry.flagged;

    var menu = document.createElement('div');
    menu.className = 'qa-ctx-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';

    // Block / Unblock
    var blockBtn = document.createElement('button');
    blockBtn.className = 'qa-ctx-menu__item' + (!isFlagged ? ' qa-ctx-menu__item--danger' : '');
    blockBtn.textContent = isFlagged ? 'Unblock' : 'Block';
    blockBtn.addEventListener('click', () => {
      this.toggleBlock(item, name, size);
      this.closeContextMenu();
    });
    menu.appendChild(blockBtn);

    // Divider
    var divider = document.createElement('div');
    divider.className = 'qa-ctx-menu__divider';
    menu.appendChild(divider);

    // Add / Edit comment
    var commentBtn = document.createElement('button');
    commentBtn.className = 'qa-ctx-menu__item';
    commentBtn.textContent = entry.note ? 'Edit comment' : 'Add comment';
    commentBtn.addEventListener('click', () => {
      this.openComment(item, name, size);
      this.closeContextMenu();
    });
    menu.appendChild(commentBtn);

    // Progress actions based on stoplight status
    var curStatus = this.getStatus(name, size);
    if (curStatus === 'yellow') {
      menu.appendChild(this.createDivider());
      var processBtn = document.createElement('button');
      processBtn.className = 'qa-ctx-menu__item';
      processBtn.textContent = 'Mark processed';
      processBtn.addEventListener('click', () => {
        this.setProcessed(name, size, true);
        this.refreshVariantStatus(item, name, size);
        this.renderAuditTable();
        this.closeContextMenu();
      });
      menu.appendChild(processBtn);
    }
    if (curStatus === 'orange') {
      menu.appendChild(this.createDivider());
      var approveBtn = document.createElement('button');
      approveBtn.className = 'qa-ctx-menu__item';
      approveBtn.textContent = 'Approve';
      approveBtn.addEventListener('click', () => {
        this.setNote(name, size, '');
        this.setProcessed(name, size, false);
        this.refreshVariantStatus(item, name, size);
        this.renderAuditTable();
        this.closeContextMenu();
      });
      menu.appendChild(approveBtn);
    }

    document.body.appendChild(menu);
    this.ctxMenu = menu;

    // Keep menu in viewport
    var rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = (e.clientX - rect.width) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top = (e.clientY - rect.height) + 'px';
  }

  createDivider() {
    var d = document.createElement('div');
    d.className = 'qa-ctx-menu__divider';
    return d;
  }

  closeContextMenu() {
    if (this.ctxMenu) { this.ctxMenu.remove(); this.ctxMenu = null; }
  }

  toggleBlock(item, name, size) {
    var entry = this.getAuditEntry(name, size);
    var nowFlagged = !entry.flagged;
    this.setFlag(name, size, nowFlagged);
    item.classList.toggle('qa-variant-item--flagged', nowFlagged);
    this.reflowVariant(item, name, size);
    this.refreshVariantStatus(item, name, size);
    this.renderAuditTable();
  }

  // ============================================
  // Status refresh
  // ============================================

  refreshVariantStatus(item, name, size) {
    var status = this.getStatus(name, size);
    var entry = this.getAuditEntry(name, size);

    // Update stoplight dot
    var dot = item.querySelector('.qa-stoplight');
    if (dot) {
      dot.className = 'qa-stoplight qa-stoplight--' + status;
      dot.title = this.STATUS_LABELS[status];
    }

    // Update comment count badge
    var lbl = item.querySelector('.qa-variant-label');
    var badge = item.querySelector('.qa-comment-count');
    if (entry.note && !badge && lbl) {
      badge = document.createElement('span');
      badge.className = 'qa-comment-count';
      badge.textContent = '1';
      badge.title = entry.note;
      lbl.appendChild(badge);
    } else if (!entry.note && badge) {
      badge.remove();
    } else if (entry.note && badge) {
      badge.title = entry.note;
    }

    this.updateStats();
  }

  updateNoteIndicator(name, size) {
    var items = this.container.querySelectorAll(
      '.qa-variant-item[data-audit-name="' + name + '"][data-size="' + size + '"]'
    );
    items.forEach(item => this.refreshVariantStatus(item, name, size));
  }

  // ============================================
  // Comment system
  // ============================================

  openComment(item, name, size) {
    this.closeComment();
    var entry = this.getAuditEntry(name, size);
    var div = document.createElement('div');
    div.className = 'qa-comment';
    div.id = 'qa-active-comment';
    div.innerHTML =
      '<textarea placeholder="How should this variant change?">' +
      (entry.note || '').replace(/</g, '&lt;') +
      '</textarea>' +
      '<div class="qa-comment__footer">' +
      '<span class="qa-comment__hint">Esc to close · auto-saves on blur</span>' +
      '</div>';

    item.appendChild(div);
    var ta = div.querySelector('textarea');
    ta.focus();

    ta.addEventListener('blur', () => {
      this.setNote(name, size, ta.value);
      this.updateNoteIndicator(name, size);
      this.renderAuditTable();
      setTimeout(() => this.closeComment(), 50);
    });

    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.setNote(name, size, ta.value);
        this.updateNoteIndicator(name, size);
        this.renderAuditTable();
        this.closeComment();
      }
    });
  }

  closeComment() {
    var el = document.getElementById('qa-active-comment');
    if (el) el.remove();
  }

  // ============================================
  // Stats counter
  // ============================================

  updateStats() {
    var stats = { red: 0, yellow: 0, orange: 0 };
    var keys = Object.keys(this.audit);
    keys.forEach(k => {
      var e = this.audit[k];
      if (e.flagged) stats.red++;
      else if (e.note && !e.processed) stats.yellow++;
      else if (e.note && e.processed) stats.orange++;
    });
    var parts = [];
    if (stats.red > 0) parts.push(stats.red + ' blocked');
    if (stats.yellow > 0) parts.push(stats.yellow + ' to process');
    if (stats.orange > 0) parts.push(stats.orange + ' needs review');
    if (this.els.stats) this.els.stats.textContent = parts.join(' · ');
  }

  // ============================================
  // Audit log table
  // ============================================

  renderAuditTable() {
    var output = this.els.auditOutput;
    if (!output) return;

    var keys = Object.keys(this.audit).sort();
    if (keys.length === 0) {
      output.innerHTML = '';
      return;
    }

    var html = '<h3 class="qa-log-heading">Audit Log</h3>';
    html += '<table class="data-table"><thead><tr>' +
      '<th>Component</th><th>Size</th><th>Grid</th><th>Status</th><th>Note</th>' +
      '</tr></thead><tbody>';

    keys.forEach(key => {
      var parts = key.split(':');
      var name = parts[0];
      var size = parts[1];
      var entry = this.audit[key];
      var status, statusClass;
      if (entry.flagged) { status = 'Blocked'; statusClass = 'status--blocked'; }
      else if (entry.note && entry.processed) { status = 'Needs review'; statusClass = 'status--review'; }
      else if (entry.note) { status = 'To process'; statusClass = 'status--todo'; }
      else { status = 'Clean'; statusClass = 'status--clean'; }

      var dotColor = entry.flagged ? '#ef4444'
        : entry.note && entry.processed ? '#f97316'
        : entry.note ? '#eab308' : '#22c55e';
      var dot = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle;background:' + dotColor + '"></span>';
      var note = entry.note ? '<span class="note-text">' + entry.note.replace(/</g, '&lt;') + '</span>' : '';

      html += '<tr><td>' + name + '</td><td>' + size + '</td><td>' +
        (this.SIZE_LABELS[size] || size) + '</td><td class="' + statusClass + '">' +
        dot + status + '</td><td>' + note + '</td></tr>';
    });

    html += '</tbody></table>';
    html += '<div class="qa-actions">';
    html += '<button id="qa-export-btn">Copy as JSON</button>';
    html += '<button id="qa-clear-btn">Clear all</button>';
    html += '</div>';

    output.innerHTML = html;

    // Bind export/clear buttons
    output.querySelector('#qa-export-btn')?.addEventListener('click', () => this.exportAudit());
    output.querySelector('#qa-clear-btn')?.addEventListener('click', () => this.clearAudit());
  }

  // ============================================
  // Export & clear
  // ============================================

  exportAudit() {
    var keys = Object.keys(this.audit).sort();
    var data = keys.map(key => {
      var parts = key.split(':');
      var entry = this.audit[key];
      var obj = { name: parts[0], size: parts[1], grid: this.SIZE_LABELS[parts[1]] || parts[1] };
      if (entry.flagged) obj.status = 'blocked';
      else if (entry.note && entry.processed) obj.status = 'needs-review';
      else if (entry.note) obj.status = 'to-process';
      else obj.status = 'clean';
      if (entry.note) obj.note = entry.note;
      return obj;
    });
    var json = JSON.stringify(data, null, 2);
    navigator.clipboard.writeText(json).then(() => {
      this.onToast('Audit data copied to clipboard');
      var btn = this.els.auditOutput?.querySelector('#qa-export-btn');
      if (btn) {
        var orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = orig; }, 1500);
      }
    });
  }

  clearAudit() {
    this.audit = {};
    this.saveAudit();
    this.renderAuditTable();
    this.showVariants();
    this.onToast('Audit data cleared');
  }

  // ============================================
  // Grid Test — column permutations
  // ============================================

  setGridTestCols(cols, btn) {
    var grid = this.els.gridTest;
    if (!grid) return;
    var hasLines = grid.classList.contains('qa-grid-test--lines');
    grid.className = 'qa-grid-test qa-grid-test--' + cols + 'col';
    if (hasLines) grid.classList.add('qa-grid-test--lines');
    // Update active button
    this.els.gridControls?.querySelectorAll('[data-cols]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }

  toggleGridTestLines() {
    var grid = this.els.gridTest;
    if (!grid) return;
    grid.classList.toggle('qa-grid-test--lines');
    this.els.gridTestLinesBtn?.classList.toggle('active');
  }

  populateGridTest(comp) {
    var section = this.els.gridTestSection;
    var grid = this.els.gridTest;
    if (!section || !grid) return;

    if (!comp) {
      section.style.display = 'none';
      return;
    }

    section.style.display = '';
    grid.innerHTML = '';

    var sizes = comp.validSizes || this.ALL_SIZES;
    sizes.forEach(size => {
      if (comp.isTemplate && comp.variantsBySize?.[size]) {
        // Template: use pre-rendered HTML wrapped in a shell-sized container
        var wrapper = document.createElement('div');
        wrapper.className = 'w-shell w-shell--' + size;
        wrapper.innerHTML = comp.variantsBySize[size];
        grid.appendChild(wrapper);
      } else if (comp.element) {
        // Non-template: clone the source element with size class
        var temp = document.createElement('div');
        temp.innerHTML = typeof comp.element === 'string' ? comp.element : comp.element.outerHTML;
        var clone = temp.firstElementChild;
        if (clone) {
          clone.className = clone.className.replace(/w-shell--\w+/g, '').trim();
          clone.classList.add('w-shell--' + size);
          grid.appendChild(clone);
        }
      }
    });
  }

  /**
   * Get a structured report of all audit entries
   */
  getReport() {
    return this.exportAuditData();
  }

  exportAuditData() {
    var keys = Object.keys(this.audit).sort();
    return keys.map(key => {
      var parts = key.split(':');
      var entry = this.audit[key];
      return {
        name: parts[0],
        size: parts[1],
        grid: this.SIZE_LABELS[parts[1]] || parts[1],
        status: entry.flagged ? 'blocked'
          : entry.note && entry.processed ? 'needs-review'
          : entry.note ? 'to-process' : 'clean',
        note: entry.note || null
      };
    });
  }

  // ============================================
  // Filter state persistence
  // ============================================

  saveFilterState() {
    try {
      localStorage.setItem(this.FILTER_KEY, JSON.stringify({
        component: this.els.componentFilter?.value || '',
        variant: this.els.variantFilter?.value || '',
        lastFilter: this.lastFilter,
        blockedOpen: this.blockedSectionOpen
      }));
    } catch (e) {}
  }

  restoreFilterState() {
    try {
      var saved = localStorage.getItem(this.FILTER_KEY);
      if (!saved) return;
      var state = JSON.parse(saved);
      if (state.component && this.els.componentFilter) this.els.componentFilter.value = state.component;
      if (state.variant && this.els.variantFilter) this.els.variantFilter.value = state.variant;
      if (state.lastFilter) this.lastFilter = state.lastFilter;
      if (state.component) {
        this.showVariants();
        if (state.blockedOpen) this.toggleBlockedSection();
      }
    } catch (e) {}
  }

  // ============================================
  // Deep link support: show(name)
  // ============================================

  show(componentName) {
    if (this.els.componentFilter) {
      this.els.componentFilter.value = componentName;
    }
    this.showVariants();
  }
}
