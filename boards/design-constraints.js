// ============================================
// Design Constraints — Runtime Engine for Boards
// ============================================
// Loads the design system manifest and template registry at runtime,
// exposes constraint validation APIs, and annotates rendered components
// so they know what's valid for them.
//
// Usage:
//   DS_CONSTRAINTS.init()           — auto-called on load
//   DS_CONSTRAINTS.validate(el)     — validate a single element
//   DS_CONSTRAINTS.auditDOM(root)   — audit all elements in subtree
//   DS_CONSTRAINTS.getConstraints(templateName) — get template rules
//   DS_CONSTRAINTS.annotate(root)   — stamp data-ds-* attrs on elements
// ============================================

(function () {
  'use strict';

  var DS_CONSTRAINTS = {
    // ---- State ----
    manifest: null,
    templates: null,
    violations: [],
    ready: false,

    // ---- Indexes (built from manifest) ----
    componentIndex: {},    // className → { name, modifiers: Set, states: Set }
    widgetAtomIndex: {},   // className → { name, modifiers: Set }
    widgetMoleculeIndex: {},
    templateSizeIndex: {}, // bodyModifier className → { name, validSizes: Set }
    validShellSizes: null, // Set of valid w-shell size tokens
    tokens: null,

    // ============================================
    // Initialization
    // ============================================
    async init() {
      try {
        var responses = await Promise.all([
          fetch('/design-system/manifest.json'),
          fetch('/design-system/template-registry.json')
        ]);
        this.manifest = await responses[0].json();
        this.templates = await responses[1].json();
        this.ready = true;
        this._buildIndex();
        console.log(
          '[design-constraints] Ready — %d components, %d widget atoms, %d templates',
          Object.keys(this.manifest.components).length,
          Object.keys(this.manifest.widgets.atoms).length,
          Object.keys(this.templates.templates).length
        );
        window.dispatchEvent(new CustomEvent('design-constraints-ready', { detail: this }));
      } catch (e) {
        console.warn('[design-constraints] Failed to load:', e.message);
      }
    },

    // ============================================
    // Index Builder
    // ============================================
    _buildIndex: function () {
      var m = this.manifest;

      // Components
      this.componentIndex = {};
      for (var cName in m.components) {
        var c = m.components[cName];
        this.componentIndex[c.className] = {
          name: cName,
          modifiers: new Set(c.modifiers || []),
          states: new Set(c.states || [])
        };
      }

      // Widget atoms
      this.widgetAtomIndex = {};
      for (var aName in m.widgets.atoms) {
        var a = m.widgets.atoms[aName];
        this.widgetAtomIndex[a.className] = {
          name: aName,
          modifiers: new Set(a.modifiers || [])
        };
      }

      // Widget molecules
      this.widgetMoleculeIndex = {};
      for (var mName in m.widgets.molecules) {
        var mol = m.widgets.molecules[mName];
        this.widgetMoleculeIndex[mol.className] = {
          name: mName,
          modifiers: new Set(mol.modifiers || [])
        };
      }

      // Body modifiers → valid sizes
      this.templateSizeIndex = {};
      for (var tName in m.widgets.bodyModifiers) {
        var bm = m.widgets.bodyModifiers[tName];
        this.templateSizeIndex[bm.className] = {
          name: tName,
          validSizes: new Set(bm.validSizes || [])
        };
      }

      // Valid shell sizes
      this.validShellSizes = new Set(m.widgets.shell.modifiers);

      // Token values
      this.tokens = m.tokens;
    },

    // ============================================
    // Validation: Widget size vs template
    // ============================================
    validateWidgetSize: function (bodyModifierClass, sizeClass) {
      if (!this.ready) return { valid: true, skipped: true };

      var tmpl = this.templateSizeIndex[bodyModifierClass];
      if (!tmpl) return { valid: true, unknown: 'template' };

      if (!this.validShellSizes.has(sizeClass)) {
        return {
          valid: false,
          reason: 'invalid-shell-size',
          message: 'Size "' + sizeClass + '" is not a valid shell size.',
          allowed: Array.from(this.validShellSizes)
        };
      }

      if (tmpl.validSizes.size > 0 && !tmpl.validSizes.has(sizeClass)) {
        return {
          valid: false,
          reason: 'size-not-allowed-for-template',
          message: 'Size "' + sizeClass + '" is not valid for "' + tmpl.name + '".',
          allowed: Array.from(tmpl.validSizes)
        };
      }

      return { valid: true };
    },

    // ============================================
    // Validation: Component modifiers
    // ============================================
    validateComponent: function (className, modifiers) {
      if (!this.ready) return { valid: true, skipped: true };

      var comp = this.componentIndex[className];
      if (!comp) return { valid: true, unknown: 'component' };

      var invalid = (modifiers || []).filter(function (m) { return !comp.modifiers.has(m); });
      if (invalid.length > 0) {
        return {
          valid: false,
          reason: 'invalid-modifier',
          message: 'Invalid modifier(s) "' + invalid.join(', ') + '" on "' + className + '".',
          allowed: Array.from(comp.modifiers)
        };
      }
      return { valid: true };
    },

    // ============================================
    // Validation: Widget atom/molecule modifiers
    // ============================================
    validateWidgetElement: function (className, modifiers) {
      if (!this.ready) return { valid: true, skipped: true };

      var def = this.widgetAtomIndex[className] || this.widgetMoleculeIndex[className];
      if (!def) return { valid: true, unknown: 'widget-element' };

      var invalid = (modifiers || []).filter(function (m) { return !def.modifiers.has(m); });
      if (invalid.length > 0) {
        return {
          valid: false,
          reason: 'invalid-widget-modifier',
          message: 'Invalid modifier(s) "' + invalid.join(', ') + '" on "' + className + '".',
          allowed: Array.from(def.modifiers)
        };
      }
      return { valid: true };
    },

    // ============================================
    // Validation: Template structure (required atoms)
    // ============================================
    validateTemplateStructure: function (templateName, html) {
      if (!this.ready || !this.templates) return { valid: true, skipped: true };

      var tmpl = this.templates.templates[templateName];
      if (!tmpl) return { valid: true, unknown: 'template' };

      var missing = (tmpl.requiredAtoms || []).filter(function (atom) {
        return html.indexOf(atom) === -1;
      });

      if (missing.length > 0) {
        return {
          valid: false,
          reason: 'missing-required-atoms',
          message: 'Template "' + templateName + '" is missing: ' + missing.join(', '),
          missing: missing
        };
      }
      return { valid: true };
    },

    // ============================================
    // Query: Get constraint metadata for a template
    // ============================================
    getConstraints: function (templateName) {
      if (!this.ready || !this.templates) return null;
      var tmpl = this.templates.templates[templateName];
      if (!tmpl) return null;

      return {
        name: templateName,
        bodyModifier: tmpl.bodyModifier,
        validSizes: tmpl.validSizes || [],
        requiredAtoms: tmpl.requiredAtoms || [],
        optionalAtoms: tmpl.optionalAtoms || [],
        structure: tmpl.structure || null,
        description: tmpl.description,
        boardsTemplate: tmpl.boardsTemplate || null,
        boardsStatus: tmpl.boardsStatus || null
      };
    },

    // ============================================
    // Query: Get valid modifiers for a component
    // ============================================
    getComponentConstraints: function (className) {
      if (!this.ready) return null;

      var comp = this.componentIndex[className];
      if (comp) return { type: 'component', name: comp.name, modifiers: Array.from(comp.modifiers), states: Array.from(comp.states) };

      var atom = this.widgetAtomIndex[className];
      if (atom) return { type: 'widget-atom', name: atom.name, modifiers: Array.from(atom.modifiers) };

      var mol = this.widgetMoleculeIndex[className];
      if (mol) return { type: 'widget-molecule', name: mol.name, modifiers: Array.from(mol.modifiers) };

      return null;
    },

    // ============================================
    // Query: Get token values by category
    // ============================================
    getTokens: function (category) {
      if (!this.ready) return null;
      return this.tokens[category] || null;
    },

    // ============================================
    // Annotate: Stamp data-ds-* attributes onto DOM
    // ============================================
    annotate: function (root) {
      if (!this.ready) return;
      root = root || document;
      var self = this;

      // Annotate widget shells
      root.querySelectorAll('.w-shell').forEach(function (shell) {
        var sizeClass = self._extractShellSize(shell);
        var bodyEl = shell.querySelector('[class*="w-body--"]');
        var bodyMod = bodyEl ? self._extractBodyModifier(bodyEl) : null;

        if (sizeClass) shell.setAttribute('data-ds-size', sizeClass);
        if (bodyMod) {
          shell.setAttribute('data-ds-template', bodyMod.replace('w-body--', ''));
          var tmplName = bodyMod.replace('w-body--', '');
          var constraints = self.getConstraints(tmplName);
          if (constraints) {
            shell.setAttribute('data-ds-valid-sizes', constraints.validSizes.join(','));
            shell.setAttribute('data-ds-required-atoms', constraints.requiredAtoms.join(','));
          }
        }
      });

      // Annotate design system components
      for (var className in this.componentIndex) {
        var comp = this.componentIndex[className];
        root.querySelectorAll('.' + className).forEach(function (el) {
          el.setAttribute('data-ds-component', comp.name);
          if (comp.modifiers.size > 0) {
            el.setAttribute('data-ds-valid-modifiers', Array.from(comp.modifiers).join(','));
          }
          if (comp.states.size > 0) {
            el.setAttribute('data-ds-valid-states', Array.from(comp.states).join(','));
          }
        });
      }

      // Annotate widget atoms
      for (var atomClass in this.widgetAtomIndex) {
        var atom = this.widgetAtomIndex[atomClass];
        root.querySelectorAll('.' + atomClass).forEach(function (el) {
          el.setAttribute('data-ds-widget', atom.name);
          if (atom.modifiers.size > 0) {
            el.setAttribute('data-ds-valid-modifiers', Array.from(atom.modifiers).join(','));
          }
        });
      }

      // Annotate widget molecules
      for (var molClass in this.widgetMoleculeIndex) {
        var mol = this.widgetMoleculeIndex[molClass];
        root.querySelectorAll('.' + molClass).forEach(function (el) {
          el.setAttribute('data-ds-widget', mol.name);
          if (mol.modifiers.size > 0) {
            el.setAttribute('data-ds-valid-modifiers', Array.from(mol.modifiers).join(','));
          }
        });
      }
    },

    // ============================================
    // Audit: Validate all elements under root
    // ============================================
    auditDOM: function (root) {
      if (!this.ready) return [];
      root = root || document;
      var issues = [];
      var self = this;

      // Audit widget shells: size × template validity
      root.querySelectorAll('.w-shell').forEach(function (shell) {
        var sizeClass = self._extractShellSize(shell);
        var bodyEl = shell.querySelector('[class*="w-body--"]');
        if (!bodyEl || !sizeClass) return;

        var bodyMod = self._extractBodyModifier(bodyEl);
        if (!bodyMod) return;

        var result = self.validateWidgetSize(bodyMod, sizeClass);
        if (!result.valid) {
          issues.push({ element: shell, type: 'widget-size', severity: 'error', detail: result });
          self._logViolation('widget-size', result.message, { shell: shell, bodyMod: bodyMod, size: sizeClass });
        }

        // Check required atoms
        var tmplName = bodyMod.replace('w-body--', '');
        var structResult = self.validateTemplateStructure(tmplName, shell.innerHTML);
        if (!structResult.valid) {
          issues.push({ element: shell, type: 'template-structure', severity: 'warning', detail: structResult });
          self._logViolation('template-structure', structResult.message, { shell: shell, template: tmplName });
        }
      });

      // Audit design system components: modifier validity
      for (var className in this.componentIndex) {
        root.querySelectorAll('.' + className).forEach(function (el) {
          var modifiers = self._extractModifiers(el, className);
          var result = self.validateComponent(className, modifiers);
          if (!result.valid) {
            issues.push({ element: el, type: 'component-modifier', severity: 'warning', detail: result });
            self._logViolation('component-modifier', result.message, { element: el });
          }
        });
      }

      // Audit widget atoms: modifier validity
      var allWidgetDefs = Object.assign({}, this.widgetAtomIndex, this.widgetMoleculeIndex);
      for (var wClass in allWidgetDefs) {
        root.querySelectorAll('.' + wClass).forEach(function (el) {
          var modifiers = self._extractModifiers(el, wClass);
          var result = self.validateWidgetElement(wClass, modifiers);
          if (!result.valid) {
            issues.push({ element: el, type: 'widget-modifier', severity: 'warning', detail: result });
            self._logViolation('widget-modifier', result.message, { element: el });
          }
        });
      }

      return issues;
    },

    // ============================================
    // Violations
    // ============================================
    _logViolation: function (type, message, context) {
      var v = { type: type, message: message, context: context, timestamp: Date.now() };
      this.violations.push(v);
      console.warn('[design-constraint] %s: %s', type, message);
      window.dispatchEvent(new CustomEvent('design-constraint-violation', { detail: v }));
    },

    getViolations: function (limit) {
      return this.violations.slice(-(limit || 50));
    },

    clearViolations: function () {
      this.violations = [];
    },

    // ============================================
    // Helpers
    // ============================================
    _extractShellSize: function (shell) {
      var classes = shell.className.split(/\s+/);
      for (var i = 0; i < classes.length; i++) {
        var s = classes[i].replace('w-shell--', '');
        if (s !== 'w-shell' && s !== classes[i] && this.validShellSizes.has(s)) {
          return s;
        }
        // Also check bare size class on shell (common pattern)
        if (this.validShellSizes.has(classes[i])) return classes[i];
      }
      return null;
    },

    _extractBodyModifier: function (bodyEl) {
      var classes = bodyEl.className.split(/\s+/);
      for (var i = 0; i < classes.length; i++) {
        if (classes[i].indexOf('w-body--') === 0) return classes[i];
      }
      return null;
    },

    _extractModifiers: function (el, baseClass) {
      var prefix = baseClass + '--';
      var result = [];
      var classes = el.className.split(/\s+/);
      for (var i = 0; i < classes.length; i++) {
        if (classes[i].indexOf(prefix) === 0) {
          result.push(classes[i].substring(prefix.length));
        }
      }
      return result;
    }
  };

  // ============================================
  // Expose globally
  // ============================================
  window.DS_CONSTRAINTS = DS_CONSTRAINTS;

  // Auto-initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { DS_CONSTRAINTS.init(); });
  } else {
    DS_CONSTRAINTS.init();
  }
})();
