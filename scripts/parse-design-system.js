#!/usr/bin/env node
/**
 * Design System Manifest Parser
 * Reads tokens.css, components.css, and widgets.css and produces manifest.json
 *
 * Usage: node scripts/parse-design-system.js
 * Output: design-system/manifest.json
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DS_DIR = path.join(ROOT, 'design-system');

// --- CSS Parsers ---

function readFile(filePath) {
  return fs.readFileSync(filePath, 'utf-8');
}

/**
 * Extract CSS custom properties from :root blocks
 */
function parseTokens(css) {
  const tokens = {
    colors: {},
    typography: {},
    spacing: {},
    animation: {},
    layout: {}
  };

  // Match all --property: value pairs in :root blocks
  const rootBlocks = css.match(/:root(?:\.light)?\s*\{[^}]+\}/g) || [];

  for (const block of rootBlocks) {
    const isLight = block.includes(':root.light');
    const props = [...block.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)];

    for (const [, name, rawValue] of props) {
      const value = rawValue.trim();

      // Categorize by prefix/name
      if (name.startsWith('color-') || name.startsWith('gray-') ||
          name.startsWith('overlay-') || name.startsWith('bg') ||
          name.startsWith('fg') || name.match(/^border(?!-)/) ||
          name === 'border-subtle' ||
          name.startsWith('interactive')) {
        const group = isLight ? 'light' : 'dark';
        if (!tokens.colors[group]) tokens.colors[group] = {};
        tokens.colors[group][`--${name}`] = value;
      } else if (name.startsWith('font-') || name.startsWith('text-') ||
                 name.startsWith('leading-') || name.startsWith('tracking-')) {
        tokens.typography[`--${name}`] = value;
      } else if (name.startsWith('space-')) {
        tokens.spacing[`--${name}`] = value;
      } else if (name.startsWith('duration-') || name.startsWith('ease-')) {
        tokens.animation[`--${name}`] = value;
      } else if (name.startsWith('radius-') || name.startsWith('border-thin') ||
                 name.startsWith('border-medium') || name.startsWith('border-thick') ||
                 name.startsWith('z-')) {
        tokens.layout[`--${name}`] = value;
      }
    }
  }

  return tokens;
}

/**
 * Extract component classes from components.css
 */
function parseComponents(css) {
  const components = {};

  // Match class selectors: .class-name { ... }
  const classRegex = /\.([\w-]+)\s*(?:\{|,|:)/g;
  let match;
  while ((match = classRegex.exec(css)) !== null) {
    const className = match[1];

    // Skip pseudo-elements, utilities, and resets
    if (className.startsWith('is-') || className === 'light') continue;

    // Determine component base and modifier
    const parts = className.split('--');
    const base = parts[0];
    const modifier = parts.length > 1 ? parts.slice(1).join('--') : null;

    if (!components[base]) {
      components[base] = { className: base, modifiers: [], states: [] };
    }

    if (modifier && !components[base].modifiers.includes(modifier)) {
      components[base].modifiers.push(modifier);
    }
  }

  // Detect states from pseudo-selectors
  const stateRegex = /\.([\w-]+):(\w+)/g;
  while ((match = stateRegex.exec(css)) !== null) {
    const [, className, state] = match;
    const base = className.split('--')[0];
    if (components[base] && !components[base].states.includes(state)) {
      components[base].states.push(state);
    }
  }

  // Filter to actual components (not single-property utilities)
  const meaningfulComponents = {};
  for (const [name, comp] of Object.entries(components)) {
    // Keep components with modifiers, states, or known component names
    const isKnownComponent = ['btn', 'input', 'card', 'token', 'modal', 'toast',
      'progress', 'grid', 'toggle', 'range', 'status', 'tabs', 'tab',
      'user-menu', 'account-section', 'account-label', 'account-value',
      'filters', 'filter-token', 'spinner', 'textarea', 'select'].includes(name);

    if (isKnownComponent || comp.modifiers.length > 0 || comp.states.length > 0) {
      meaningfulComponents[name] = comp;
    }
  }

  return meaningfulComponents;
}

/**
 * Extract widget system from widgets.css
 */
function parseWidgets(css) {
  const widgets = {
    atoms: {},
    molecules: {},
    shell: { className: 'w-shell', modifiers: [] },
    bodyModifiers: {},
    sizes: {},
    containerBreakpoints: []
  };

  // --- Parse size classes ---
  const sizeRegex = /\.w-shell--([\w-]+)\s*\{\s*grid-column:\s*span\s+(\d+);\s*grid-row:\s*span\s+(\d+)/g;
  let match;
  while ((match = sizeRegex.exec(css)) !== null) {
    const [, sizeName, cols, rows] = match;
    widgets.sizes[sizeName] = {
      gridColumn: parseInt(cols),
      gridRow: parseInt(rows)
    };
  }

  // --- Parse w-* classes ---
  const classRegex = /\.(w-[\w-]+)/g;
  const allClasses = new Set();
  while ((match = classRegex.exec(css)) !== null) {
    allClasses.add(match[1]);
  }

  // Categorize w-* classes
  for (const cls of allClasses) {
    // Skip shell size classes (already parsed)
    if (cls.startsWith('w-shell--') && widgets.sizes[cls.replace('w-shell--', '')]) {
      widgets.shell.modifiers.push(cls.replace('w-shell--', ''));
      continue;
    }

    // Body modifiers
    if (cls.startsWith('w-body--')) {
      const modName = cls.replace('w-body--', '');
      if (modName !== 'loading') {
        widgets.bodyModifiers[modName] = { className: cls };
      }
      continue;
    }

    // Determine if atom or molecule by prefix
    const base = cls.split('--')[0];
    const modifier = cls.includes('--') ? cls.split('--').slice(1).join('--') : null;

    const atoms = ['w-text', 'w-badge', 'w-bar', 'w-icon', 'w-icon-btn', 'w-img',
                   'w-divider', 'w-checkbox', 'w-btn', 'w-loader'];
    const molecules = ['w-headline', 'w-tag-group', 'w-stat', 'w-row',
                       'w-axis', 'w-option', 'w-section', 'w-column'];
    const structure = ['w-shell', 'w-header', 'w-body', 'w-footer',
                       'w-action-bar', 'w-actions'];

    if (atoms.includes(base)) {
      if (!widgets.atoms[base]) widgets.atoms[base] = { className: base, modifiers: [] };
      if (modifier && !widgets.atoms[base].modifiers.includes(modifier)) {
        widgets.atoms[base].modifiers.push(modifier);
      }
    } else if (molecules.includes(base)) {
      if (!widgets.molecules[base]) widgets.molecules[base] = { className: base, modifiers: [] };
      if (modifier && !widgets.molecules[base].modifiers.includes(modifier)) {
        widgets.molecules[base].modifiers.push(modifier);
      }
    }
    // Structure classes are captured in shell
  }

  // --- Parse container query breakpoints ---
  const cqRegex = /@container\s*\((min|max)-width:\s*(\d+)px\)/g;
  const breakpoints = new Set();
  while ((match = cqRegex.exec(css)) !== null) {
    breakpoints.add(parseInt(match[2]));
  }
  widgets.containerBreakpoints = [...breakpoints].sort((a, b) => a - b);

  // --- Parse valid sizes per template from comment block ---
  const sizeCommentRegex = /(\w+):\s+((?:[\w]+(?:,\s*)?)+)\s*(?:\(|$)/gm;
  const commentBlock = css.match(/Valid sizes per template[\s\S]*?={3,}/);
  if (commentBlock) {
    const lines = commentBlock[0].split('\n');
    for (const line of lines) {
      const templateMatch = line.match(/^\s*(\w+):\s+([\w\s,]+?)(?:\s*\(|$)/);
      if (templateMatch) {
        const template = templateMatch[1].trim();
        const sizes = templateMatch[2].split(',').map(s => s.trim()).filter(Boolean);
        if (widgets.bodyModifiers[template]) {
          widgets.bodyModifiers[template].validSizes = sizes;
        }
      }
    }
  }

  return widgets;
}

// --- Main ---

function buildManifest() {
  const tokensCSS = readFile(path.join(DS_DIR, 'tokens.css'));
  const componentsCSS = readFile(path.join(DS_DIR, 'components.css'));
  const widgetsCSS = readFile(path.join(DS_DIR, 'widgets.css'));

  const tokens = parseTokens(tokensCSS);
  const components = parseComponents(componentsCSS);
  const widgets = parseWidgets(widgetsCSS);

  const manifest = {
    version: new Date().toISOString(),
    source: 'design-system/',
    files: ['tokens.css', 'components.css', 'widgets.css'],
    tokens,
    components,
    widgets
  };

  return manifest;
}

const manifest = buildManifest();
const outputPath = path.join(DS_DIR, 'manifest.json');
fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2));

console.log(`Manifest written to ${outputPath}`);
console.log(`  Tokens: ${Object.keys(manifest.tokens.colors.dark || {}).length} colors (dark), ${Object.keys(manifest.tokens.typography).length} typography, ${Object.keys(manifest.tokens.spacing).length} spacing`);
console.log(`  Components: ${Object.keys(manifest.components).length} component classes`);
console.log(`  Widgets: ${Object.keys(manifest.widgets.atoms).length} atoms, ${Object.keys(manifest.widgets.molecules).length} molecules`);
console.log(`  Sizes: ${Object.keys(manifest.widgets.sizes).length} widget sizes`);
console.log(`  Body modifiers: ${Object.keys(manifest.widgets.bodyModifiers).length} templates`);
console.log(`  Container breakpoints: ${manifest.widgets.containerBreakpoints.join(', ')}px`);
