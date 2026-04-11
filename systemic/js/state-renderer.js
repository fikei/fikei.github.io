/**
 * StateRenderer — multi-state component showcase
 *
 * Takes a component (type + variants + CSS state rules) and renders
 * all its interaction states simultaneously with realistic placeholder
 * content. Replaces the single static example per variant.
 *
 * Usage:
 *   const renderer = new StateRenderer();
 *   const html = renderer.buildComponentStateGrid(component);
 *   previewEl.innerHTML = html;
 */
class StateRenderer {
  constructor() {
    // Normalize crawler / parser type strings to canonical CONTENT keys.
    // detectComponentType may return e.g. "text-input" while CONTENT uses "input".
    this.TYPE_ALIASES = {
      'text-input': 'input',
      'textfield':  'input',
      'field':      'input',
      'textarea':   'input',
      'btn':        'button',
      'navigation': 'nav',
      'navbar':     'nav',
      'header':     'nav',
      'sidebar':    'nav',
      'dialog':     'modal',
      'overlay':    'modal',
      'drawer':     'modal',
      'sheet':      'modal',
      'snackbar':   'alert',
      'notification': 'alert',
      'toast':      'alert',
      'chip':       'badge',
      'tag':        'badge',
      'label':      'badge',
      'token':      'badge',
      'pill':       'badge',
      'status':     'badge',
      'switch':     'toggle',
      'loader':     'spinner',
      'loading':    'spinner',
      'dropdown':   'select',
      'picker':     'select',
      'listbox':    'select',
      'profile-pic':'avatar',
    };

    // Contextual placeholder content keyed by component type
    this.CONTENT = {
      button: {
        labels: ['Save Changes', 'Submit', 'Continue', 'Confirm', 'Sign In'],
        loading: 'Saving...',
        states: ['default', 'hover', 'active', 'disabled', 'loading']
      },
      btn: {
        labels: ['Save Changes', 'Submit', 'Continue'],
        loading: 'Loading...',
        states: ['default', 'hover', 'active', 'disabled', 'loading']
      },
      input: {
        labels: ['Email address', 'Full name', 'Search', 'Password'],
        filledValues: { default: '', filled: 'jane@example.com', focused: '', error: 'invalid@', disabled: '' },
        errorMsg: 'Please enter a valid email',
        states: ['default', 'filled', 'focused', 'error', 'disabled']
      },
      field: {
        labels: ['Label', 'Field'],
        filledValues: { default: '', filled: 'Sample value' },
        states: ['default', 'filled', 'focused', 'error', 'disabled']
      },
      select: {
        placeholder: 'Select an option',
        options: ['Analytics', 'Reports', 'Settings', 'Library', 'Help'],
        states: ['closed', 'open', 'disabled']
      },
      dropdown: {
        placeholder: 'Choose...',
        options: ['Option one', 'Option two', 'Option three', 'Option four', 'Option five'],
        states: ['closed', 'open', 'disabled']
      },
      menu: {
        placeholder: 'Open menu',
        options: ['Edit', 'Duplicate', 'Archive', 'Delete'],
        states: ['closed', 'open']
      },
      card: {
        title: 'Discovering Patterns in Design',
        body: 'A thoughtful exploration of how design systems evolve to meet real user needs across contexts.',
        action: 'Read more',
        states: ['default', 'hover', 'selected']
      },
      modal: {
        title: 'Confirm Action',
        body: 'Are you sure you want to continue? This action cannot be undone.',
        states: ['default']
      },
      nav: {
        items: ['Dashboard', 'Analytics', 'Library', 'Settings', 'Profile'],
        states: ['default', 'active', 'hover']
      },
      navigation: {
        items: ['Dashboard', 'Analytics', 'Library', 'Settings', 'Profile'],
        states: ['default', 'active', 'hover']
      },
      navbar: {
        items: ['Home', 'Products', 'Pricing', 'Docs', 'Blog'],
        states: ['default', 'scrolled']
      },
      checkbox: {
        label: 'Remember me on this device',
        states: ['unchecked', 'checked', 'indeterminate', 'disabled']
      },
      radio: {
        label: 'Email notifications',
        states: ['unchecked', 'checked', 'disabled']
      },
      toggle: {
        label: 'Enable dark mode',
        states: ['off', 'on', 'disabled']
      },
      switch: {
        label: 'Auto-save',
        states: ['off', 'on', 'disabled']
      },
      badge: {
        labels: { default: 'New', success: 'Active', warning: '12', error: 'Blocked', info: 'Beta' },
        states: ['default', 'success', 'warning', 'error', 'info']
      },
      chip: {
        label: 'Design',
        states: ['default', 'selected', 'disabled']
      },
      tag: {
        label: 'Frontend',
        states: ['default', 'selected']
      },
      avatar: {
        initials: 'JD',
        states: ['default', 'online', 'offline']
      },
      tooltip: {
        label: 'Tooltip content',
        states: ['default']
      },
      banner: {
        message: 'Your changes have been saved.',
        states: ['default', 'success', 'warning', 'error']
      },
      alert: {
        message: 'Something needs your attention.',
        states: ['default', 'success', 'warning', 'error']
      },
      progress: {
        states: ['0%', '35%', '70%', '100%']
      },
      spinner: {
        states: ['default']
      },
      link: {
        labels: ['View details', 'Learn more', 'Read article', 'Visit page'],
        states: ['default', 'hover', 'visited', 'disabled']
      },
      tabs: {
        items: ['Overview', 'Details', 'Reviews', 'Related'],
        states: ['default', 'active', 'hover', 'disabled']
      },
      table: {
        states: ['default', 'striped', 'hover']
      },
      form: {
        states: ['default', 'submitting', 'error', 'success']
      },
      heading: {
        states: ['default']
      },
      image: {
        states: ['default', 'loading', 'error']
      },
      icon: {
        states: ['default', 'active']
      },
      list: {
        states: ['default']
      },
      container: {
        states: ['default']
      },
    };

    // Default state set when type is unknown
    this.DEFAULT_STATES = ['default', 'hover', 'disabled'];
  }

  // ----------------------------------------------------------------
  // Public API
  // ----------------------------------------------------------------

  /**
   * Normalize a component type string to a canonical key that matches
   * this.CONTENT and the switch cases in _renderState.
   *
   * Resolution order:
   *  1. Exact match in TYPE_ALIASES
   *  2. Strip common prefixes (w-, widget-, template-) and re-check
   *  3. Fuzzy: scan known CONTENT keys for a substring match
   *  4. Infer from the type name using keyword patterns
   *  5. Fall back to the raw (lowercased) string → hits _generic renderer
   */
  _normalizeType(rawType) {
    const t = String(rawType || '').toLowerCase().trim();

    // 1. Exact alias
    if (this.TYPE_ALIASES[t]) return this.TYPE_ALIASES[t];

    // 2. Already a known CONTENT key
    if (this.CONTENT[t]) return t;

    // 3. Strip prefixes and retry
    const stripped = t
      .replace(/^(w-|widget-|template-|filter-)/, '')   // common prefixes
      .replace(/^.*__/, '');                              // BEM element (user-menu__trigger → trigger)
    if (this.TYPE_ALIASES[stripped]) return this.TYPE_ALIASES[stripped];
    if (this.CONTENT[stripped]) return stripped;

    // 4. Keyword scan — does the type contain a known component word?
    const keywords = Object.keys(this.CONTENT);
    for (const kw of keywords) {
      // Match "icon-btn" → "button", "tag-group" → "badge", etc.
      if (kw.length >= 3 && stripped.includes(kw)) return kw;
    }
    // Also check alias keys (catches "btn" inside "icon-btn", "loader" inside "w-loader")
    for (const [alias, canonical] of Object.entries(this.TYPE_ALIASES)) {
      if (alias.length >= 3 && stripped.includes(alias)) return canonical;
    }

    // 5. Structural inference — match on suffix so "account-section" → container, etc.
    if (t.startsWith('template-') || t.startsWith('widget-')) return 'card';
    const tail = stripped.split('-').pop(); // last segment: "account-section" → "section"
    const suffixMap = {
      'section': 'container', 'row': 'container', 'column': 'container',
      'items': 'container', 'divider': 'container', 'group': 'container',
      'grid': 'table',
      'text': 'heading', 'headline': 'heading', 'label': 'heading', 'value': 'heading',
      'trigger': 'button',
      'option': 'list', 'item': 'list',
      'stat': 'badge',
      'axis': 'progress', 'bar': 'progress',
      'range': 'input', 'filters': 'form',
      'tab': 'tabs',
      'img': 'image', 'photo': 'image',
    };
    if (suffixMap[tail]) return suffixMap[tail];
    if (suffixMap[stripped]) return suffixMap[stripped];

    // 6. Fallback — raw type, will hit _generic
    return t;
  }

  /**
   * Build the full multi-state grid HTML for a component.
   * Rendered into the component stage preview area.
   */
  buildComponentStateGrid(component) {
    if (!component?.variants?.length) return '';

    const type = this._normalizeType(component.type);

    const rows = component.variants.map(variant => `
      <div class="variant-state-row">
        <div class="variant-state-row__name">${this._escHtml(variant.name || 'Default')}</div>
        ${this._buildStateStrip(type, variant)}
      </div>
    `).join('');

    return `
      <div class="component-state-grid">
        <h3 class="component-state-grid__title">States &amp; Variants</h3>
        ${rows}
      </div>
    `;
  }

  // ----------------------------------------------------------------
  // Private helpers
  // ----------------------------------------------------------------

  /**
   * Determine the ordered list of states to render for a component.
   * Merges type-default states with CSS-detected states.
   */
  _getStates(componentType, variant) {
    const content = this.CONTENT[componentType];
    const typeStates = content?.states || this.DEFAULT_STATES;

    // Collect any additional CSS-detected states from the variant
    const cssStates = (variant?.states || []);
    const merged = [...typeStates];
    for (const s of cssStates) {
      if (!merged.includes(s)) merged.push(s);
    }
    return merged;
  }

  _buildStateStrip(componentType, variant) {
    const states = this._getStates(componentType, variant);
    const cards = states.map(state => `
      <div class="state-example">
        <div class="state-example__preview">
          ${this._renderState(componentType, variant, state)}
        </div>
        <div class="state-example__label">${state}</div>
      </div>
    `).join('');

    return `<div class="state-strip">${cards}</div>`;
  }

  /**
   * Dispatch to type-specific renderers.
   */
  _renderState(type, variant, state) {
    const c = this.CONTENT[type] || {};
    const classes = (variant?.classes || []).join(' ');

    switch (type) {
      case 'button':
      case 'btn':
        return this._button(classes, state, c);
      case 'input':
      case 'text-input':
      case 'field':
      case 'textfield':
      case 'textarea':
        return this._input(classes, state, c);
      case 'select':
      case 'dropdown':
      case 'menu':
      case 'listbox':
      case 'picker':
        return this._select(classes, state, c);
      case 'card':
        return this._card(classes, state, c);
      case 'checkbox':
        return this._check(classes, state, c, 'checkbox');
      case 'radio':
        return this._check(classes, state, c, 'radio');
      case 'toggle':
      case 'switch':
        return this._toggle(classes, state, c);
      case 'badge':
      case 'chip':
      case 'tag':
      case 'label':
        return this._badge(classes, type, state, c);
      case 'nav':
      case 'navigation':
      case 'navbar':
      case 'header':
      case 'sidebar':
        return this._nav(classes, state, c);
      case 'banner':
      case 'alert':
      case 'toast':
      case 'notification':
      case 'snackbar':
        return this._alert(classes, state, c);
      case 'avatar':
        return this._avatar(classes, state, c);
      case 'progress':
        return this._progress(state);
      case 'spinner':
      case 'loader':
      case 'loading':
        return this._spinner(classes);
      case 'link':
        return this._link(classes, state, c);
      case 'tabs':
        return this._tabs(classes, state, c);
      case 'modal':
      case 'dialog':
      case 'drawer':
      case 'sheet':
        return this._modal(classes, state, c);
      case 'table':
        return this._table(classes, state);
      case 'form':
        return this._form(classes, state);
      case 'image':
      case 'img':
        return this._image(classes, state);
      default:
        return this._generic(variant?.html || '', state);
    }
  }

  // ----------------------------------------------------------------
  // Type renderers
  // ----------------------------------------------------------------

  _button(classes, state, c) {
    const label = state === 'loading' ? (c.loading || 'Loading...') : (c.labels?.[0] || 'Button');
    const disabled = state === 'disabled' ? 'disabled' : '';
    const stateAttr = `data-state="${state}"`;
    return `<button class="${classes}" ${disabled} ${stateAttr} style="pointer-events:none">${this._escHtml(label)}</button>`;
  }

  _input(classes, state, c) {
    const label = c.labels?.[0] || 'Label';
    const value = c.filledValues?.[state] ?? '';
    const disabled = state === 'disabled' ? 'disabled' : '';
    const readonly = state === 'filled' ? 'readonly' : '';
    const placeholder = (state === 'default' || state === 'focused') ? label : '';
    const stateAttr = `data-state="${state}"`;
    return `
      <div style="display:flex;flex-direction:column;gap:3px;min-width:160px">
        <span style="font-size:10px;opacity:.6;text-transform:uppercase;letter-spacing:.5px">${this._escHtml(label)}</span>
        <input class="${classes}" value="${this._escHtml(value)}"
          placeholder="${this._escHtml(placeholder)}" ${disabled} ${readonly}
          ${stateAttr} style="pointer-events:none" />
        ${state === 'error' ? `<span style="font-size:10px;color:#e44">${this._escHtml(c.errorMsg || 'Invalid value')}</span>` : ''}
      </div>
    `;
  }

  _select(classes, state, c) {
    const disabled = state === 'disabled' ? 'disabled' : '';
    const stateAttr = `data-state="${state}"`;
    if (state === 'open') {
      const opts = (c.options || ['Option 1', 'Option 2', 'Option 3'])
        .map((o, i) => `<option ${i === 1 ? 'selected' : ''}>${this._escHtml(o)}</option>`)
        .join('');
      return `<select class="${classes}" ${disabled} ${stateAttr} style="pointer-events:none;min-width:140px" size="4">
        <option value="">${this._escHtml(c.placeholder || 'Select...')}</option>${opts}
      </select>`;
    }
    return `<select class="${classes}" ${disabled} ${stateAttr} style="pointer-events:none;min-width:140px">
      <option>${this._escHtml(c.placeholder || 'Select...')}</option>
    </select>`;
  }

  _card(classes, state, c) {
    const stateAttr = `data-state="${state}"`;
    return `
      <div class="${classes}" ${stateAttr} style="max-width:220px;pointer-events:none;padding:12px">
        <div style="width:100%;height:90px;background:var(--bg-elevated,rgba(255,255,255,.06));border-radius:4px;margin-bottom:10px"></div>
        <strong style="display:block;font-size:12px;margin-bottom:4px;line-height:1.3">${this._escHtml(c.title || 'Card Title')}</strong>
        <p style="font-size:11px;opacity:.65;margin:0 0 8px;line-height:1.4">${this._escHtml(c.body || 'Body text.')}</p>
        <a style="font-size:11px;cursor:default">${this._escHtml(c.action || 'Learn more')}</a>
      </div>
    `;
  }

  _check(classes, state, c, inputType) {
    const checked = (state === 'checked') ? 'checked' : '';
    const indeterminate = state === 'indeterminate' ? 'data-indeterminate="true"' : '';
    const disabled = state === 'disabled' ? 'disabled' : '';
    const stateAttr = `data-state="${state}"`;
    return `
      <label style="display:flex;align-items:center;gap:6px;cursor:default;pointer-events:none">
        <input type="${inputType}" class="${classes}" ${checked} ${disabled} ${indeterminate} ${stateAttr} style="pointer-events:none" />
        <span style="font-size:12px">${this._escHtml(c.label || inputType)}</span>
      </label>
    `;
  }

  _toggle(classes, state, c) {
    const checked = state === 'on' ? 'checked' : '';
    const disabled = state === 'disabled' ? 'disabled' : '';
    const stateAttr = `data-state="${state}"`;
    return `
      <label style="display:flex;align-items:center;gap:8px;cursor:default;pointer-events:none">
        <input type="checkbox" role="switch" class="${classes}" ${checked} ${disabled} ${stateAttr} style="pointer-events:none" />
        <span style="font-size:12px">${this._escHtml(c.label || 'Toggle')}</span>
      </label>
    `;
  }

  _badge(classes, type, state, c) {
    const label = c.labels?.[state] ?? c.label ?? state;
    const stateAttr = `data-state="${state}"`;
    return `<span class="${classes} ${type}-${state}" ${stateAttr} style="pointer-events:none">${this._escHtml(label)}</span>`;
  }

  _nav(classes, state, c) {
    const items = c.items || ['Home', 'About', 'Contact'];
    const links = items.map((item, i) => {
      const isActive = state === 'active' && i === 1;
      const isDisabled = state === 'disabled' && i === 2;
      return `<a style="font-size:12px;padding:4px 8px;${isActive ? 'font-weight:600' : ''}${isDisabled ? ';opacity:.4' : ''};cursor:default">${this._escHtml(item)}</a>`;
    }).join('');
    return `<nav class="${classes}" data-state="${state}" style="display:flex;gap:4px;pointer-events:none">${links}</nav>`;
  }

  _alert(classes, state, c) {
    const colors = { success: '#1a7', warning: '#d80', error: '#e44', default: 'var(--fg-muted)' };
    const color = colors[state] || colors.default;
    return `
      <div class="${classes}" data-state="${state}"
        style="padding:10px 14px;border-left:3px solid ${color};font-size:12px;max-width:220px;pointer-events:none">
        ${this._escHtml(c.message || 'Notification message')}
      </div>
    `;
  }

  _avatar(classes, state, c) {
    const dotColor = state === 'online' ? '#2d2' : state === 'offline' ? '#888' : 'transparent';
    return `
      <div style="position:relative;display:inline-block;pointer-events:none">
        <div class="${classes}" data-state="${state}"
          style="width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:600;font-size:13px;background:var(--bg-elevated,#333)">
          ${this._escHtml(c.initials || 'AB')}
        </div>
        ${state !== 'default' ? `<span style="position:absolute;bottom:0;right:0;width:10px;height:10px;border-radius:50%;background:${dotColor};border:2px solid var(--bg,#111)"></span>` : ''}
      </div>
    `;
  }

  _progress(state) {
    const widths = { '0%': 0, '35%': 35, '70%': 70, '100%': 100 };
    const pct = widths[state] ?? 50;
    return `
      <div style="width:160px;pointer-events:none">
        <div style="height:4px;background:var(--bg-elevated,rgba(255,255,255,.1));border-radius:2px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:var(--fg,#fff);transition:none"></div>
        </div>
        <span style="font-size:10px;opacity:.5;margin-top:4px;display:block">${state}</span>
      </div>
    `;
  }

  _spinner(classes) {
    return `
      <div class="${classes}" style="pointer-events:none;display:flex;align-items:center;gap:8px">
        <div style="width:18px;height:18px;border:2px solid rgba(255,255,255,.15);border-top-color:var(--fg,#fff);border-radius:50%;animation:none;opacity:.7"></div>
        <span style="font-size:12px;opacity:.6">Loading</span>
      </div>
    `;
  }

  _link(classes, state, c) {
    const label = c.labels?.[0] || 'Learn more';
    const style = [
      'font-size:12px',
      'text-decoration:underline',
      'cursor:default',
      'pointer-events:none',
      state === 'hover' ? 'opacity:1' : '',
      state === 'visited' ? 'opacity:.65' : '',
      state === 'disabled' ? 'opacity:.35;text-decoration:none' : '',
    ].filter(Boolean).join(';');
    return `<a class="${classes}" data-state="${state}" style="${style}">${this._escHtml(label)}</a>`;
  }

  _tabs(classes, state, c) {
    const items = c.items || ['Tab 1', 'Tab 2', 'Tab 3'];
    const links = items.map((item, i) => {
      const isActive = (state === 'active' && i === 0) || (state === 'hover' && i === 1);
      const isDisabled = state === 'disabled' && i === items.length - 1;
      const s = [
        'font-size:12px', 'padding:6px 12px', 'cursor:default',
        isActive ? 'border-bottom:2px solid var(--fg,#fff);font-weight:600' : 'border-bottom:2px solid transparent',
        isDisabled ? 'opacity:.35' : '',
      ].filter(Boolean).join(';');
      return `<span style="${s}">${this._escHtml(item)}</span>`;
    }).join('');
    return `<div class="${classes}" data-state="${state}" style="display:flex;gap:2px;pointer-events:none">${links}</div>`;
  }

  _modal(classes, state, c) {
    return `
      <div class="${classes}" data-state="${state}" style="pointer-events:none;max-width:200px;padding:14px;background:var(--bg-surface,#1a1a1a);border:1px solid var(--border-subtle,#333);border-radius:6px">
        <strong style="display:block;font-size:13px;margin-bottom:6px">${this._escHtml(c.title || 'Dialog Title')}</strong>
        <p style="font-size:11px;opacity:.6;margin:0 0 10px;line-height:1.4">${this._escHtml(c.body || 'Dialog content goes here.')}</p>
        <div style="display:flex;gap:6px;justify-content:flex-end">
          <button style="font-size:11px;padding:4px 10px;cursor:default;opacity:.6">Cancel</button>
          <button style="font-size:11px;padding:4px 10px;cursor:default">Confirm</button>
        </div>
      </div>
    `;
  }

  _table(classes, state) {
    const headerRow = '<tr><th style="text-align:left;padding:4px 8px;font-size:10px;opacity:.5">Name</th><th style="text-align:left;padding:4px 8px;font-size:10px;opacity:.5">Status</th></tr>';
    const rows = ['Alice — Active', 'Bob — Pending', 'Carol — Done'].map((row, i) => {
      const [name, status] = row.split(' — ');
      const bg = (state === 'striped' && i % 2 === 1) ? 'background:rgba(255,255,255,.03)' : '';
      const hover = (state === 'hover' && i === 1) ? 'background:rgba(255,255,255,.06)' : '';
      return `<tr style="${bg || hover}"><td style="padding:4px 8px;font-size:11px">${name}</td><td style="padding:4px 8px;font-size:11px;opacity:.65">${status}</td></tr>`;
    }).join('');
    return `<table class="${classes}" data-state="${state}" style="pointer-events:none;border-collapse:collapse;min-width:160px">${headerRow}${rows}</table>`;
  }

  _form(classes, state) {
    const disabled = state === 'submitting' || state === 'success' ? 'opacity:.5' : '';
    const btnLabel = state === 'submitting' ? 'Sending...' : state === 'success' ? 'Sent!' : state === 'error' ? 'Retry' : 'Submit';
    return `
      <div class="${classes}" data-state="${state}" style="pointer-events:none;display:flex;flex-direction:column;gap:6px;max-width:180px;${disabled}">
        <input style="font-size:11px;padding:4px 8px;pointer-events:none" placeholder="Email" />
        ${state === 'error' ? '<span style="font-size:10px;color:#e44">Please fill in all fields</span>' : ''}
        <button style="font-size:11px;padding:4px 10px;cursor:default">${btnLabel}</button>
      </div>
    `;
  }

  _image(classes, state) {
    if (state === 'loading') {
      return `<div class="${classes}" data-state="${state}" style="width:120px;height:80px;background:var(--bg-elevated,#222);border-radius:4px;display:flex;align-items:center;justify-content:center;pointer-events:none"><span style="font-size:10px;opacity:.4">Loading…</span></div>`;
    }
    if (state === 'error') {
      return `<div class="${classes}" data-state="${state}" style="width:120px;height:80px;background:var(--bg-elevated,#222);border:1px dashed rgba(255,255,255,.1);border-radius:4px;display:flex;align-items:center;justify-content:center;pointer-events:none"><span style="font-size:10px;opacity:.4">Failed</span></div>`;
    }
    return `<div class="${classes}" data-state="${state}" style="width:120px;height:80px;background:var(--bg-elevated,#222);border-radius:4px;display:flex;align-items:center;justify-content:center;pointer-events:none"><span style="font-size:10px;opacity:.3">IMG</span></div>`;
  }

  _generic(baseHtml, state) {
    if (!baseHtml) {
      return `<div data-state="${state}" style="padding:6px 10px;font-size:11px;opacity:.5;border:1px dashed rgba(255,255,255,.1)">${state}</div>`;
    }
    // Inject state attribute into the outermost tag
    return baseHtml.replace(/^<([a-zA-Z][a-zA-Z0-9]*)/, `<$1 data-state="${state}" style="pointer-events:none"`);
  }

  _escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
