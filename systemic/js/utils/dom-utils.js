/**
 * Systemic - DOM Utilities
 * Helper functions for DOM manipulation and style extraction
 */

const DOMUtils = {
  /**
   * Query selector shorthand
   */
  $(selector, context = document) {
    return context.querySelector(selector);
  },

  /**
   * Query selector all shorthand
   */
  $$(selector, context = document) {
    return Array.from(context.querySelectorAll(selector));
  },

  /**
   * Create element with attributes and children
   */
  createElement(tag, attrs = {}, children = []) {
    const el = document.createElement(tag);

    Object.entries(attrs).forEach(([key, value]) => {
      if (key === 'className') {
        el.className = value;
      } else if (key === 'style' && typeof value === 'object') {
        Object.assign(el.style, value);
      } else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key === 'data' && typeof value === 'object') {
        Object.entries(value).forEach(([dataKey, dataValue]) => {
          el.dataset[dataKey] = dataValue;
        });
      } else {
        el.setAttribute(key, value);
      }
    });

    children.forEach(child => {
      if (typeof child === 'string') {
        el.appendChild(document.createTextNode(child));
      } else if (child instanceof Node) {
        el.appendChild(child);
      }
    });

    return el;
  },

  /**
   * Get all computed styles for an element
   */
  getComputedStyles(element) {
    const computed = window.getComputedStyle(element);
    const styles = {};

    // Get all CSS properties
    for (let i = 0; i < computed.length; i++) {
      const prop = computed[i];
      styles[prop] = computed.getPropertyValue(prop);
    }

    return styles;
  },

  /**
   * Get specific style properties
   */
  getStyleProperties(element, properties) {
    const computed = window.getComputedStyle(element);
    const styles = {};

    properties.forEach(prop => {
      styles[prop] = computed.getPropertyValue(prop);
    });

    return styles;
  },

  /**
   * Extract design-relevant styles from an element
   * Works with both live DOM and DOMParser-parsed documents
   */
  extractDesignStyles(element) {
    const relevantProps = [
      // Colors
      'color', 'background-color', 'border-color', 'outline-color',
      // Typography
      'font-family', 'font-size', 'font-weight', 'line-height',
      'letter-spacing', 'text-transform', 'text-decoration',
      // Spacing
      'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
      'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
      'gap',
      // Layout
      'display', 'flex-direction', 'align-items', 'justify-content',
      'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
      // Borders
      'border-width', 'border-style', 'border-radius',
      // Effects
      'box-shadow', 'opacity', 'transform',
      // Transitions
      'transition'
    ];

    // Try computed styles first (for live DOM)
    if (typeof window !== 'undefined' && element.ownerDocument === document) {
      try {
        return this.getStyleProperties(element, relevantProps);
      } catch (e) {
        // Fall through to inline style extraction
      }
    }

    // For parsed documents, extract from inline styles
    return this.extractInlineStyles(element, relevantProps);
  },

  /**
   * Extract styles from inline style attribute
   */
  extractInlineStyles(element, properties) {
    const styles = {};
    const inlineStyle = element.getAttribute('style') || '';

    properties.forEach(prop => {
      // Convert property name to regex-safe pattern
      const propPattern = prop.replace(/-/g, '\\-');
      const regex = new RegExp(`${propPattern}\\s*:\\s*([^;]+)`, 'i');
      const match = inlineStyle.match(regex);
      styles[prop] = match ? match[1].trim() : '';
    });

    // Also check for class-based hints
    const classes = Array.from(element.classList);
    styles._classHints = this.extractClassHints(classes);

    return styles;
  },

  /**
   * Extract styling hints from class names
   */
  extractClassHints(classes) {
    const hints = {};

    classes.forEach(cls => {
      // Color hints
      if (cls.includes('primary')) hints.colorRole = 'primary';
      if (cls.includes('secondary')) hints.colorRole = 'secondary';
      if (cls.includes('error') || cls.includes('danger')) hints.colorRole = 'error';
      if (cls.includes('success')) hints.colorRole = 'success';
      if (cls.includes('warning')) hints.colorRole = 'warning';

      // Size hints
      if (cls.includes('-sm') || cls.includes('small')) hints.size = 'small';
      if (cls.includes('-md') || cls.includes('medium')) hints.size = 'medium';
      if (cls.includes('-lg') || cls.includes('large')) hints.size = 'large';
      if (cls.includes('-xl')) hints.size = 'xlarge';

      // Variant hints
      if (cls.includes('outlined') || cls.includes('outline')) hints.variant = 'outlined';
      if (cls.includes('filled')) hints.variant = 'filled';
      if (cls.includes('text') || cls.includes('ghost')) hints.variant = 'text';

      // Layout hints
      if (cls.includes('flex')) hints.display = 'flex';
      if (cls.includes('grid')) hints.display = 'grid';
      if (cls.includes('block')) hints.display = 'block';
      if (cls.includes('inline')) hints.display = 'inline';

      // Spacing hints
      if (cls.match(/[pm][tblrxy]?-\d/)) hints.hasSpacingClass = true;
      if (cls.match(/gap-\d/)) hints.hasGapClass = true;
    });

    return hints;
  },

  /**
   * Generate a hash for an element's structure
   */
  generateElementHash(element) {
    const structure = {
      tag: element.tagName.toLowerCase(),
      classes: Array.from(element.classList).sort(),
      childCount: element.children.length,
      textContent: element.textContent.trim().slice(0, 100)
    };

    return this.hashString(JSON.stringify(structure));
  },

  /**
   * Simple string hashing function
   */
  hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  },

  /**
   * Check if element is visible
   */
  isVisible(element) {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);

    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== 'hidden' &&
      style.display !== 'none' &&
      style.opacity !== '0'
    );
  },

  /**
   * Get element's bounding box relative to document
   */
  getBoundingBox(element) {
    const rect = element.getBoundingClientRect();
    return {
      top: rect.top + window.scrollY,
      left: rect.left + window.scrollX,
      width: rect.width,
      height: rect.height,
      bottom: rect.bottom + window.scrollY,
      right: rect.right + window.scrollX
    };
  },

  /**
   * Find all interactive elements
   */
  findInteractiveElements(context = document) {
    const selectors = [
      'button', 'a', 'input', 'select', 'textarea',
      '[role="button"]', '[role="link"]', '[role="checkbox"]',
      '[role="radio"]', '[role="switch"]', '[role="tab"]',
      '[onclick]', '[tabindex]:not([tabindex="-1"])'
    ];

    return this.$$(selectors.join(', '), context);
  },

  /**
   * Find all text elements
   */
  findTextElements(context = document) {
    const selectors = [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'p', 'span', 'label', 'a', 'li',
      '[role="heading"]'
    ];

    return this.$$(selectors.join(', '), context)
      .filter(el => el.textContent.trim().length > 0);
  },

  /**
   * Find all container elements
   */
  findContainerElements(context = document) {
    const selectors = [
      'div', 'section', 'article', 'aside', 'main', 'header', 'footer', 'nav',
      '[role="region"]', '[role="main"]', '[role="navigation"]'
    ];

    return this.$$(selectors.join(', '), context)
      .filter(el => el.children.length > 0);
  },

  /**
   * Detect component type from element
   */
  detectComponentType(element) {
    const tag = element.tagName.toLowerCase();
    const role = element.getAttribute('role');
    const classes = Array.from(element.classList);
    const type = element.getAttribute('type');

    // Button detection
    if (tag === 'button' || role === 'button' ||
        classes.some(c => c.includes('btn') || c.includes('button'))) {
      return 'button';
    }

    // Input detection
    if (tag === 'input') {
      if (type === 'checkbox' || type === 'radio') return type;
      if (type === 'text' || type === 'email' || type === 'password' ||
          type === 'number' || type === 'search' || type === 'tel' || type === 'url') {
        return 'text-input';
      }
      return 'input';
    }

    // Select detection
    if (tag === 'select' || role === 'listbox') return 'select';

    // Textarea
    if (tag === 'textarea') return 'textarea';

    // Link detection
    if (tag === 'a' || role === 'link') return 'link';

    // Card detection
    if (classes.some(c => c.includes('card'))) return 'card';

    // Modal detection
    if (role === 'dialog' || classes.some(c => c.includes('modal'))) return 'modal';

    // Navigation detection
    if (tag === 'nav' || role === 'navigation' ||
        classes.some(c => c.includes('nav'))) return 'navigation';

    // Tab detection
    if (role === 'tab' || role === 'tablist' ||
        classes.some(c => c.includes('tab'))) return 'tabs';

    // Heading detection
    if (/^h[1-6]$/.test(tag) || role === 'heading') return 'heading';

    // List detection
    if (tag === 'ul' || tag === 'ol' || role === 'list') return 'list';

    // Default to container
    if (element.children.length > 0) return 'container';

    return 'unknown';
  },

  /**
   * Get pseudo-element styles
   */
  getPseudoStyles(element, pseudo = '::before') {
    return window.getComputedStyle(element, pseudo);
  },

  /**
   * Clone element without scripts
   */
  cloneClean(element) {
    const clone = element.cloneNode(true);

    // Remove scripts
    clone.querySelectorAll('script').forEach(s => s.remove());

    // Remove event handlers
    const attrs = clone.attributes;
    for (let i = attrs.length - 1; i >= 0; i--) {
      if (attrs[i].name.startsWith('on')) {
        clone.removeAttribute(attrs[i].name);
      }
    }

    return clone;
  },

  /**
   * Convert element to minimal HTML
   */
  toMinimalHTML(element) {
    const clone = this.cloneClean(element);

    // Remove data attributes
    const removeDataAttrs = (el) => {
      const attrs = el.attributes;
      for (let i = attrs.length - 1; i >= 0; i--) {
        if (attrs[i].name.startsWith('data-') ||
            attrs[i].name.startsWith('ng-') ||
            attrs[i].name.startsWith('v-')) {
          el.removeAttribute(attrs[i].name);
        }
      }
      Array.from(el.children).forEach(removeDataAttrs);
    };

    removeDataAttrs(clone);

    // Format HTML
    return clone.outerHTML
      .replace(/>\s+</g, '>\n<')
      .replace(/^\s+/gm, (match) => '  '.repeat(match.length / 2));
  },

  /**
   * Wait for element to appear
   */
  waitForElement(selector, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const el = this.$(selector);
      if (el) {
        resolve(el);
        return;
      }

      const observer = new MutationObserver((mutations, obs) => {
        const el = this.$(selector);
        if (el) {
          obs.disconnect();
          resolve(el);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });

      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Element ${selector} not found within ${timeout}ms`));
      }, timeout);
    });
  },

  /**
   * Debounce function calls
   */
  debounce(fn, delay) {
    let timeout;
    return function(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn.apply(this, args), delay);
    };
  },

  /**
   * Throttle function calls
   */
  throttle(fn, limit) {
    let inThrottle;
    return function(...args) {
      if (!inThrottle) {
        fn.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }
};

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DOMUtils;
}
