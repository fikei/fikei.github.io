/**
 * FigmaParser — Figma REST API client + document tree walker
 *
 * Reads component definitions, design tokens, and component instances
 * from a Figma file. Returns normalized results compatible with the
 * Systemic processing pipeline (same shape as CodeParser / AgenticCrawler).
 *
 * Usage:
 *   const parser = new FigmaParser({ token, onLog, onProgress });
 *   const results = await parser.parse('https://www.figma.com/design/KEY/...');
 */
class FigmaParser {
  constructor({ token, onLog, onProgress } = {}) {
    this.token = token || '';
    this.onLog = onLog || (() => {});
    this.onProgress = onProgress || (() => {});
    this.cancelled = false;

    // Component type keywords — first match wins
    this.TYPE_KEYWORDS = [
      'button', 'btn',
      'input', 'field', 'textfield', 'textarea',
      'select', 'dropdown', 'menu',
      'card',
      'modal', 'dialog', 'sheet',
      'nav', 'navigation', 'navbar',
      'header',
      'footer',
      'icon',
      'badge', 'chip', 'tag', 'label',
      'toggle', 'switch',
      'checkbox', 'radio',
      'table', 'row',
      'list', 'listitem',
      'form',
      'search',
      'avatar', 'profile',
      'tooltip', 'popover',
      'tab', 'tabs',
      'accordion', 'collapse',
      'banner', 'alert', 'toast',
      'progress', 'spinner', 'loader',
    ];
  }

  // ----------------------------------------------------------------
  // Figma API
  // ----------------------------------------------------------------

  /**
   * Extract the file key from a Figma URL.
   * Handles both /design/ and /file/ URL patterns.
   */
  parseFileKey(url) {
    const match = (url || '').match(/figma\.com\/(?:design|file|proto)\/([a-zA-Z0-9]+)/);
    if (!match) {
      throw new Error('Invalid Figma URL. Expected: https://www.figma.com/design/KEY/title');
    }
    return match[1];
  }

  async _figmaFetch(path) {
    if (this.cancelled) throw new Error('Cancelled');
    if (!this.token) throw new Error('A Figma Personal Access Token is required.');
    const res = await fetch(`https://api.figma.com${path}`, {
      headers: { 'X-Figma-Token': this.token }
    });
    if (res.status === 403) throw new Error('Figma: invalid token or insufficient permissions.');
    if (res.status === 404) throw new Error('Figma: file not found. Check the URL and token permissions.');
    if (res.status === 429) throw new Error('Figma API rate limit reached. Try again shortly.');
    if (!res.ok) throw new Error(`Figma API error ${res.status}: ${path}`);
    return res.json();
  }

  // ----------------------------------------------------------------
  // Document tree traversal
  // ----------------------------------------------------------------

  /**
   * Walk a Figma node tree depth-first and call visitor(node, depth, ancestors).
   */
  _walkTree(node, visitor, depth = 0, ancestors = []) {
    if (!node || depth > 30) return;
    visitor(node, depth, ancestors);
    if (Array.isArray(node.children)) {
      const nextAncestors = [...ancestors, node];
      for (const child of node.children) {
        this._walkTree(child, visitor, depth + 1, nextAncestors);
      }
    }
  }

  // ----------------------------------------------------------------
  // Token extraction
  // ----------------------------------------------------------------

  /**
   * Extract design tokens from the Figma styles endpoint response
   * and supplement with any discovered in the document node styles.
   */
  _extractTokens(stylesData, fileData) {
    const tokens = [];
    const seen = new Set();

    const add = (name, value, category) => {
      if (seen.has(name)) return;
      seen.add(name);
      tokens.push({ name, value, category, source: 'figma' });
    };

    // Published styles from /styles endpoint
    const published = stylesData?.meta?.styles || [];
    for (const style of published) {
      const cat = this._styleTypeToCategory(style.style_type);
      if (cat) add(style.name, null, cat);
    }

    // Styles map in the file document (nodeId → style metadata)
    const stylesMap = fileData?.styles || {};
    for (const [, style] of Object.entries(stylesMap)) {
      const cat = this._styleTypeToCategory(style.styleType);
      if (cat && style.name) add(style.name, null, cat);
    }

    return tokens;
  }

  _styleTypeToCategory(styleType) {
    switch ((styleType || '').toUpperCase()) {
      case 'FILL': return 'color';
      case 'TEXT': return 'typography';
      case 'EFFECT': return 'elevation';
      case 'GRID': return 'spacing';
      default: return null;
    }
  }

  // ----------------------------------------------------------------
  // Component extraction
  // ----------------------------------------------------------------

  /**
   * Extract component definitions from the document tree and published
   * components endpoint, then collect instance locations.
   */
  _extractComponents(fileData, componentsData) {
    const componentMap = {}; // type → ComponentRecord

    const ensure = (type, name) => {
      if (!componentMap[type]) {
        componentMap[type] = {
          type,
          name,
          variants: [],
          totalUsage: 0,
          states: []
        };
      }
      return componentMap[type];
    };

    const ensureVariant = (record, variantName, node) => {
      let variant = record.variants.find(v => v.name === variantName);
      if (!variant) {
        variant = {
          name: variantName,
          html: `<!-- Figma: ${variantName} -->`,
          classes: [],
          styles: this._extractNodeStyles(node),
          states: this._inferStatesFromName(variantName),
          usageCount: 0,
          instances: []
        };
        record.variants.push(variant);
      }
      return variant;
    };

    // Walk document tree: collect COMPONENT (definitions) and INSTANCE nodes
    const instancesByComponentId = {};

    this._walkTree(fileData.document, (node, _depth, ancestors) => {
      if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
        const type = this._inferType(node.name);
        const record = ensure(type, node.name.split('/')[0]);
        ensureVariant(record, node.name, node);
      }

      if (node.type === 'INSTANCE' && node.componentId) {
        const id = node.componentId;
        if (!instancesByComponentId[id]) instancesByComponentId[id] = [];
        // Find the top-level frame this instance lives in
        const frameName = ancestors.slice().reverse().find(
          a => a.type === 'FRAME' || a.type === 'CANVAS' || a.type === 'PAGE'
        )?.name || 'Unknown frame';
        instancesByComponentId[id].push({ node, frameName });
      }
    });

    // Supplement from published components list
    const published = componentsData?.meta?.components || [];
    for (const comp of published) {
      const type = this._inferType(comp.name);
      const record = ensure(type, comp.name.split('/')[0]);
      ensureVariant(record, comp.name, null);
    }

    // Attach instance records to variants
    for (const [componentId, instances] of Object.entries(instancesByComponentId)) {
      // Find which component record owns this componentId
      // Walk tree again to match COMPONENT node id
      let ownerRecord = null;
      let ownerVariant = null;
      this._walkTree(fileData.document, (node) => {
        if ((node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') && node.id === componentId) {
          const type = this._inferType(node.name);
          ownerRecord = componentMap[type];
          if (ownerRecord) {
            ownerVariant = ownerRecord.variants.find(v => v.name === node.name);
          }
        }
      });

      if (!ownerRecord || !ownerVariant) continue;

      for (const { node: instanceNode, frameName } of instances) {
        ownerVariant.usageCount++;
        ownerRecord.totalUsage++;
        ownerVariant.instances.push({
          location: {
            type: 'figma-frame',
            path: frameName,
            line: null
          },
          html: `<!-- Figma instance: ${instanceNode.name} in "${frameName}" -->`,
          context: { parent: frameName, siblings: [] },
          thumbnailDataUrl: null
        });
      }
    }

    // Recalculate totalUsage and sort variants by usage descending
    for (const record of Object.values(componentMap)) {
      record.totalUsage = record.variants.reduce((sum, v) => sum + v.usageCount, 0);
      record.variants.sort((a, b) => b.usageCount - a.usageCount);
    }

    return Object.values(componentMap);
  }

  /**
   * Infer a canonical component type slug from a Figma component name.
   * e.g. "Button/Primary/Large" → "button"
   *      "Form / Text Input"    → "input"
   */
  _inferType(name) {
    if (!name) return 'unknown';
    const lower = name.toLowerCase().replace(/[^a-z0-9 ]/g, ' ');
    for (const kw of this.TYPE_KEYWORDS) {
      if (lower.includes(kw)) return kw;
    }
    // Fallback: use first path segment, slugified
    return name.split(/[/\\|]/, 1)[0].trim().toLowerCase().replace(/\s+/g, '-') || 'component';
  }

  /**
   * Extract visual style properties from a Figma node.
   */
  _extractNodeStyles(node) {
    if (!node) return {};
    const styles = {};
    const bb = node.absoluteBoundingBox;
    if (bb) {
      styles.width = `${Math.round(bb.width)}px`;
      styles.height = `${Math.round(bb.height)}px`;
    }
    if (node.cornerRadius) styles.borderRadius = `${node.cornerRadius}px`;
    const fill = (node.fills || []).find(f => f.type === 'SOLID' && f.visible !== false);
    if (fill?.color) styles.backgroundColor = this._colorToHex(fill.color);
    const stroke = (node.strokes || []).find(s => s.type === 'SOLID');
    if (stroke?.color) styles.borderColor = this._colorToHex(stroke.color);
    if (node.strokeWeight) styles.borderWidth = `${node.strokeWeight}px`;
    return styles;
  }

  _colorToHex({ r = 0, g = 0, b = 0 }) {
    const h = v => Math.round(v * 255).toString(16).padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}`;
  }

  /**
   * Infer interaction states from a Figma component variant name.
   * e.g. "Button/Primary/Disabled" → ['disabled']
   */
  _inferStatesFromName(name) {
    const states = [];
    const lower = (name || '').toLowerCase();
    if (lower.includes('hover'))    states.push('hover');
    if (lower.includes('focus'))    states.push('focus');
    if (lower.includes('pressed') || lower.includes('active')) states.push('active');
    if (lower.includes('disabled')) states.push('disabled');
    if (lower.includes('error') || lower.includes('invalid')) states.push('error');
    if (lower.includes('loading'))  states.push('loading');
    if (lower.includes('checked') || lower.includes('selected')) states.push('checked');
    return states;
  }

  // ----------------------------------------------------------------
  // Main entry point
  // ----------------------------------------------------------------

  /**
   * Parse a Figma file.
   * Returns results in the same shape as CodeParser and AgenticCrawler:
   * { components, tokens, pages, pagesCrawled, source }
   */
  async parse(figmaUrl) {
    this.cancelled = false;
    const fileKey = this.parseFileKey(figmaUrl);
    this.onLog({ type: 'info', message: `Connecting to Figma file ${fileKey}...` });

    this.onProgress({ pagesCrawled: 0, pagesTotal: 3, tokensExtracted: 0, componentsFound: 0, currentUrl: 'Fetching file...' });

    // Parallel: fetch document, styles, and published components
    const [fileData, stylesData, componentsData] = await Promise.all([
      this._figmaFetch(`/v1/files/${fileKey}`),
      this._figmaFetch(`/v1/files/${fileKey}/styles`).catch(() => ({})),
      this._figmaFetch(`/v1/files/${fileKey}/components`).catch(() => ({}))
    ]);

    this.onLog({ type: 'success', message: `Loaded: "${fileData.name}"` });
    this.onProgress({ pagesCrawled: 3, pagesTotal: 3, tokensExtracted: 0, componentsFound: 0, currentUrl: 'Processing...' });

    const tokens = this._extractTokens(stylesData, fileData);
    const components = this._extractComponents(fileData, componentsData);

    this.onLog({
      type: 'success',
      message: `Found ${components.length} component type${components.length !== 1 ? 's' : ''}, ${tokens.length} design token${tokens.length !== 1 ? 's' : ''}`
    });

    // Count total instances for progress
    const totalInstances = components.reduce((n, c) => n + (c.totalUsage || 0), 0);
    if (totalInstances > 0) {
      this.onLog({ type: 'info', message: `${totalInstances} component instances mapped to Figma frames` });
    }

    return {
      components,
      tokens,
      pages: [{
        url: figmaUrl,
        components: components.length,
        tokens: tokens.length,
        crawledAt: new Date().toISOString()
      }],
      pagesCrawled: 1,
      source: { type: 'figma', fileKey, fileName: fileData.name, url: figmaUrl }
    };
  }

  stop() {
    this.cancelled = true;
  }
}
