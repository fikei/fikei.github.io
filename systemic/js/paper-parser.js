/**
 * PaperParser — converts Paper MCP extracted data into Systemic's standard format.
 *
 * Paper is a design tool accessible only through the Claude Code agent via MCP.
 * This parser accepts a `PaperExtract` object (written by the agent to localStorage
 * under the key `systemic-paper-import`) and produces the same shape as
 * CodeParser / FigmaParser / AgenticCrawler.
 *
 * PaperExtract shape (written by agent):
 * {
 *   name:      string,          // file/artboard name
 *   tree:      object,          // get_tree_summary() output
 *   jsx:       string,          // get_jsx() output (optional)
 *   styles:    object[],        // get_computed_styles() per-node results
 *   meta:      object,          // get_basic_info() output
 *   extractedAt: string,        // ISO timestamp
 * }
 */
class PaperParser {
  constructor({ onLog, onProgress } = {}) {
    this.onLog    = onLog     || (() => {});
    this.onProgress = onProgress || (() => {});
    this._stopped = false;
  }

  stop() { this._stopped = true; }

  // ─────────────────────────────────────────────────────────────
  // Public entry point
  // ─────────────────────────────────────────────────────────────

  /**
   * Parse a PaperExtract object into the standard design system format.
   * @param {object} extract — from localStorage 'systemic-paper-import'
   * @returns {{ components, tokens, pages, pagesCrawled, source }}
   */
  parse(extract) {
    if (!extract || typeof extract !== 'object') {
      throw new Error('Invalid Paper extract — expected an object');
    }

    this._log(`Parsing Paper file: ${extract.name || 'Untitled'}`);
    this._progress(5);

    const tree    = extract.tree  || {};
    const jsx     = extract.jsx   || '';
    const styles  = extract.styles || [];

    // Build a flat index of nodes for quick lookup
    const nodeIndex = {};
    this._indexNodes(tree, nodeIndex);
    this._progress(15);

    // Extract tokens (colors, typography, spacing)
    const tokens = this._extractTokens(nodeIndex, styles, extract.meta || {});
    this._progress(35);

    // Extract components (COMPONENT / COMPONENT_SET / reusable FRAMEs)
    const rawComponents = this._extractComponents(nodeIndex, tokens);
    this._progress(65);

    // Parse JSX for additional class/token clues
    if (jsx) {
      this._enrichFromJsx(rawComponents, jsx);
    }
    this._progress(85);

    // Build pages list
    const pages = this._extractPages(tree);

    this._progress(100);
    this._log(`Done — ${rawComponents.length} components, ${tokens.colors ? Object.keys(tokens.colors).length : 0} color tokens`);

    return {
      components:   rawComponents,
      tokens,
      pages,
      pagesCrawled: pages.length,
      source: {
        type:    'paper',
        name:    extract.name || 'Paper File',
        url:     null,
        extractedAt: extract.extractedAt || new Date().toISOString(),
      },
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Tree indexing
  // ─────────────────────────────────────────────────────────────

  _indexNodes(node, index, depth = 0) {
    if (!node || depth > 40) return;
    if (node.id) index[node.id] = node;
    (node.children || []).forEach(child => this._indexNodes(child, index, depth + 1));
  }

  // ─────────────────────────────────────────────────────────────
  // Token extraction
  // ─────────────────────────────────────────────────────────────

  _extractTokens(nodeIndex, stylesArray, meta) {
    const colors     = {};
    const typography = {};
    const cssVars    = {};

    // Walk all nodes looking for fill colors and text styles
    Object.values(nodeIndex).forEach(node => {
      // Color fills
      if (node.fills) {
        (node.fills || []).forEach(fill => {
          if (fill.type === 'SOLID' && fill.color) {
            const hex = this._rgbaToHex(fill.color);
            const role = this._guessColorRole(node.name || '', hex);
            if (role && !colors[role]) {
              colors[role] = { hex, opacity: fill.opacity ?? 1 };
              cssVars[`--color-${role}`] = hex;
            }
          }
        });
      }

      // Text styles
      if (node.type === 'TEXT' && node.style) {
        const s = node.style;
        const key = `${s.fontFamily || 'unknown'}-${s.fontSize || 0}`;
        if (!typography[key]) {
          typography[key] = {
            fontFamily: s.fontFamily,
            fontSize:   s.fontSize,
            fontWeight: s.fontWeight,
            lineHeight: s.lineHeightPx,
          };
        }
      }
    });

    // Derive primary font from most-used text style
    const fontEntries = Object.values(typography);
    const fontPrimary = fontEntries.length > 0
      ? fontEntries.sort((a, b) => (b.fontSize || 0) - (a.fontSize || 0))[0]?.fontFamily
      : null;

    return {
      colors,
      typography: { primary: fontPrimary, scale: fontEntries },
      spacing:    { baseUnit: this._guessSpacingBase(nodeIndex) },
      elevation:  { levels: [] },
      shape:      { values: this._gatherBorderRadius(nodeIndex) },
      cssVariables: cssVars,
    };
  }

  _rgbaToHex({ r = 0, g = 0, b = 0 } = {}) {
    const toHex = v => Math.round(v * 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  _guessColorRole(name, hex) {
    const n = (name || '').toLowerCase();
    if (n.includes('primary'))   return 'primary';
    if (n.includes('secondary')) return 'secondary';
    if (n.includes('tertiary'))  return 'tertiary';
    if (n.includes('error') || n.includes('danger')) return 'error';
    if (n.includes('success') || n.includes('green')) return 'success';
    if (n.includes('warning') || n.includes('warn'))  return 'warning';
    if (n.includes('background') || n.includes('bg')) return 'background';
    if (n.includes('surface'))   return 'surface';
    // Unnamed — guess from value
    if (!hex) return null;
    return null; // Skip unnamed fills to avoid noise
  }

  _guessSpacingBase(nodeIndex) {
    // Collect all padding/gap values from auto-layout frames
    const values = [];
    Object.values(nodeIndex).forEach(node => {
      if (node.layoutMode && node.itemSpacing) values.push(node.itemSpacing);
      if (node.paddingLeft)  values.push(node.paddingLeft);
      if (node.paddingRight) values.push(node.paddingRight);
      if (node.paddingTop)   values.push(node.paddingTop);
    });
    if (values.length === 0) return 8;
    // Find GCD-like base unit
    const sorted = [...new Set(values)].filter(v => v > 0).sort((a, b) => a - b);
    return sorted[0] || 8;
  }

  _gatherBorderRadius(nodeIndex) {
    const radii = new Set();
    Object.values(nodeIndex).forEach(node => {
      if (node.cornerRadius) radii.add(node.cornerRadius);
      if (node.rectangleCornerRadii) {
        node.rectangleCornerRadii.forEach(r => radii.add(r));
      }
    });
    return [...radii].filter(r => r > 0).sort((a, b) => a - b);
  }

  // ─────────────────────────────────────────────────────────────
  // Component extraction
  // ─────────────────────────────────────────────────────────────

  _extractComponents(nodeIndex, tokens) {
    const componentDefs  = {};  // id → node
    const instancesByDef = {};  // componentId → [instanceNode, ...]

    Object.values(nodeIndex).forEach(node => {
      if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
        componentDefs[node.id] = node;
      }
      if (node.type === 'INSTANCE' && node.componentId) {
        (instancesByDef[node.componentId] = instancesByDef[node.componentId] || []).push(node);
      }
    });

    // Also include prominent FRAMEs that look component-like (named with component keywords)
    Object.values(nodeIndex).forEach(node => {
      if (node.type === 'FRAME' && this._inferType(node.name || '') !== 'unknown' && !componentDefs[node.id]) {
        componentDefs[node.id] = node;
      }
    });

    const components = [];
    const typeGroups = {};

    Object.values(componentDefs).forEach(def => {
      const type = this._inferType(def.name || '');
      if (!typeGroups[type]) typeGroups[type] = [];
      typeGroups[type].push(def);
    });

    Object.entries(typeGroups).forEach(([type, defs]) => {
      const variants = defs.map(def => {
        const instances = (instancesByDef[def.id] || []);
        return {
          name:       def.name || type,
          html:       this._nodeToHtmlSummary(def),
          classes:    this._gatherClasses(def),
          usageCount: instances.length,
          instances:  instances.map(inst => ({
            location: {
              type: 'design',
              path: this._getNodePath(inst, nodeIndex),
              line: null,
            },
            html:    this._nodeToHtmlSummary(inst),
            context: {},
          })),
        };
      });

      const totalUsage = variants.reduce((n, v) => n + (v.usageCount || 0), 0);

      components.push({
        type,
        name:         this._formatName(type),
        variants,
        totalUsage,
        states:       this._inferStates(defs),
        classes:      [...new Set(variants.flatMap(v => v.classes))],
        source:       'paper',
      });
    });

    return components;
  }

  _inferType(name) {
    const n = name.toLowerCase().replace(/[-_/\s]+/g, ' ');
    const map = [
      [/\b(btn|button)\b/,                 'button'],
      [/\b(input|text.?field|text.?box|field)\b/, 'input'],
      [/\b(card|tile|panel)\b/,            'card'],
      [/\b(nav|navigation|navbar|menu|header)\b/, 'nav'],
      [/\b(modal|dialog|overlay|drawer|sheet)\b/, 'modal'],
      [/\b(select|dropdown|picker)\b/,     'select'],
      [/\b(checkbox|check)\b/,             'checkbox'],
      [/\b(radio|radio.?button)\b/,        'radio'],
      [/\b(toggle|switch)\b/,              'toggle'],
      [/\b(badge|tag|chip|label)\b/,       'badge'],
      [/\b(avatar|profile.?pic)\b/,        'avatar'],
      [/\b(alert|toast|notification|snackbar)\b/, 'alert'],
      [/\b(tab|tabs)\b/,                   'tabs'],
      [/\b(tooltip|popover)\b/,            'tooltip'],
      [/\b(table|data.?grid|grid)\b/,      'table'],
      [/\b(form)\b/,                       'form'],
      [/\b(icon)\b/,                       'icon'],
      [/\b(image|img|photo)\b/,            'image'],
      [/\b(link|anchor)\b/,               'link'],
      [/\b(progress|spinner|loading|loader)\b/, 'progress'],
    ];
    for (const [re, type] of map) {
      if (re.test(n)) return type;
    }
    return 'component';
  }

  _formatName(type) {
    return type.charAt(0).toUpperCase() + type.slice(1);
  }

  _gatherClasses(node) {
    // Paper doesn't use CSS classes, but we can derive them from node name tokens
    const name  = (node.name || '').toLowerCase().replace(/\s+/g, '-');
    const type  = this._inferType(node.name || '');
    const classes = [type];
    if (name && name !== type) classes.push(name.slice(0, 40));
    return [...new Set(classes)];
  }

  _nodeToHtmlSummary(node) {
    const type  = node.type || 'div';
    const name  = node.name ? ` data-name="${node.name}"` : '';
    const w     = node.absoluteBoundingBox?.width  ? ` data-w="${Math.round(node.absoluteBoundingBox.width)}"` : '';
    const h     = node.absoluteBoundingBox?.height ? ` data-h="${Math.round(node.absoluteBoundingBox.height)}"` : '';
    return `<div class="${this._inferType(node.name || '')}"${name}${w}${h}>[${type}]</div>`;
  }

  _getNodePath(node, nodeIndex) {
    // Walk up via parentId to build a breadcrumb path
    const parts = [node.name || node.id];
    let current = node;
    let depth   = 0;
    while (current.parentId && depth < 6) {
      const parent = nodeIndex[current.parentId];
      if (!parent) break;
      parts.unshift(parent.name || parent.id);
      current = parent;
      depth++;
    }
    return parts.join(' / ');
  }

  _inferStates(defs) {
    const states = new Set(['default']);
    defs.forEach(def => {
      const n = (def.name || '').toLowerCase();
      if (n.includes('hover'))    states.add('hover');
      if (n.includes('focus'))    states.add('focus');
      if (n.includes('active'))   states.add('active');
      if (n.includes('disabled')) states.add('disabled');
      if (n.includes('error'))    states.add('error');
      if (n.includes('loading'))  states.add('loading');
      if (n.includes('selected')) states.add('selected');
      if (n.includes('checked'))  states.add('checked');
      if (n.includes('empty'))    states.add('empty');
    });
    return [...states];
  }

  // ─────────────────────────────────────────────────────────────
  // JSX enrichment
  // ─────────────────────────────────────────────────────────────

  _enrichFromJsx(components, jsx) {
    // Extract class names from JSX (className="..." or class="...")
    const classRe = /class(?:Name)?=["']([^"']+)["']/g;
    const foundClasses = new Set();
    let m;
    while ((m = classRe.exec(jsx)) !== null) {
      m[1].split(/\s+/).forEach(c => c && foundClasses.add(c));
    }
    if (foundClasses.size === 0) return;

    // Match discovered classes to components by keyword overlap
    components.forEach(comp => {
      const matching = [...foundClasses].filter(cls => {
        const cl = cls.toLowerCase();
        return cl.includes(comp.type) || comp.type.includes(cl.split('-')[0]);
      });
      if (matching.length > 0) {
        const existing = new Set(comp.classes || []);
        matching.forEach(c => existing.add(c));
        comp.classes = [...existing];
      }
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Pages
  // ─────────────────────────────────────────────────────────────

  _extractPages(tree) {
    // Top-level children of the document are pages
    if (tree.type === 'DOCUMENT') {
      return (tree.children || []).map(p => ({ url: p.name || 'Page', title: p.name || 'Page' }));
    }
    // If tree IS a page, return it
    return [{ url: tree.name || 'Main', title: tree.name || 'Main' }];
  }

  // ─────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────

  _log(msg)      { this.onLog(`[Paper] ${msg}`); }
  _progress(pct) { this.onProgress(pct); }
}
