/**
 * CodeParser — GitHub repository static parser
 *
 * Fetches HTML/CSS files via GitHub Contents API and extracts
 * ComponentRecord[] with file + line attribution for instances[].
 *
 * Usage:
 *   const parser = new CodeParser({ token, onLog, onProgress });
 *   const results = await parser.parse('https://github.com/owner/repo');
 */
class CodeParser {
  constructor({ token, onLog, onProgress } = {}) {
    this.token = token || null;
    this.onLog = onLog || (() => {});
    this.onProgress = onProgress || (() => {});
    this.cancelled = false;

    // Component detection patterns: { type, tagPattern }
    this.COMPONENT_PATTERNS = [
      { type: 'button',   tagRe: /<button\b([^>]*)>([\s\S]*?)<\/button>/gi },
      { type: 'input',    tagRe: /<input\b([^>]*)>/gi },
      { type: 'select',   tagRe: /<select\b([^>]*)>([\s\S]*?)<\/select>/gi },
      { type: 'form',     tagRe: /<form\b([^>]*)>/gi },
      { type: 'nav',      tagRe: /<nav\b([^>]*)>/gi },
      { type: 'card',     tagRe: /class="[^"]*\bcard\b[^"]*"/gi },
      { type: 'modal',    tagRe: /class="[^"]*\bmodal\b[^"]*"/gi },
      { type: 'dropdown', tagRe: /class="[^"]*\bdropdown\b[^"]*"/gi },
      { type: 'link',     tagRe: /<a\b([^>]*)>/gi },
      { type: 'badge',    tagRe: /class="[^"]*\bbadge\b[^"]*"/gi },
    ];
  }

  // ----------------------------------------------------------------
  // GitHub API
  // ----------------------------------------------------------------

  /**
   * Parse a GitHub repo URL into { owner, repo }
   * Accepts: https://github.com/owner/repo, github.com/owner/repo, owner/repo
   */
  parseRepoUrl(url) {
    const cleaned = (url || '').trim()
      .replace(/^https?:\/\//i, '')
      .replace(/^github\.com\//i, '');
    const match = cleaned.match(/^([^/\s]+)\/([^/\s#?]+)/);
    if (!match) {
      throw new Error('Invalid GitHub repo URL. Expected: https://github.com/owner/repo');
    }
    return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
  }

  async _ghFetch(path) {
    if (this.cancelled) throw new Error('Cancelled');
    const headers = { 'Accept': 'application/vnd.github+json', 'User-Agent': 'Systemic/2' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const res = await fetch(`https://api.github.com${path}`, { headers });
    if (res.status === 403 || res.status === 429) {
      throw new Error('GitHub API rate limit reached. Add a Personal Access Token for higher limits.');
    }
    if (res.status === 404) throw new Error(`Not found: ${path}`);
    if (!res.ok) throw new Error(`GitHub API error ${res.status}: ${path}`);
    return res.json();
  }

  /**
   * Enumerate all HTML and CSS files in a repo using the git tree API.
   * Skips minified, vendor, and node_modules paths.
   */
  async _listFiles(owner, repo) {
    this.onLog({ type: 'info', message: `Fetching file tree for ${owner}/${repo}...` });
    const tree = await this._ghFetch(`/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`);
    const files = (tree.tree || [])
      .filter(f => f.type === 'blob' && /\.(html|htm|css)$/i.test(f.path))
      .filter(f => !/node_modules|\.min\.|\/vendor\/|dist\/|\.git\//i.test(f.path));
    this.onLog({ type: 'info', message: `Found ${files.length} HTML/CSS files to parse` });
    return files;
  }

  /**
   * Fetch a file's text content from the GitHub Contents API.
   */
  async _fetchFile(owner, repo, path) {
    const data = await this._ghFetch(`/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`);
    if (data.encoding === 'base64') {
      return atob(data.content.replace(/[\n\r]/g, ''));
    }
    return data.content || '';
  }

  // ----------------------------------------------------------------
  // HTML parsing
  // ----------------------------------------------------------------

  /**
   * Parse a single HTML file.
   * Returns { components: ComponentRawRecord[], tokens: [] }
   * Each component record carries an `instance` field with file+line.
   */
  _parseHTML(content, filePath) {
    const components = [];
    const lines = content.split('\n');

    for (const { type, tagRe } of this.COMPONENT_PATTERNS) {
      tagRe.lastIndex = 0;
      let match;
      while ((match = tagRe.exec(content)) !== null) {
        // Count newlines before match start to get 1-indexed line number
        const before = content.slice(0, match.index);
        const line = (before.match(/\n/g) || []).length + 1;

        // Extract class attribute from the matched tag
        const classMatch = match[0].match(/class="([^"]*)"/);
        const classes = classMatch ? classMatch[1].split(/\s+/).filter(Boolean) : [];

        // Surrounding context (3 lines of context window)
        const ctxStart = Math.max(0, line - 3);
        const ctxEnd = Math.min(lines.length, line + 2);
        const contextLines = lines.slice(ctxStart, ctxEnd).map(l => l.trim()).filter(Boolean);
        const parentHtml = lines.slice(Math.max(0, line - 3), line - 1).join('\n').trim();

        const rawHtml = match[0].length > 400 ? match[0].slice(0, 400) + '...' : match[0];

        components.push({
          type,
          html: rawHtml,
          classes,
          styles: {},
          states: [],
          usageCount: 1,
          instance: {
            location: { type: 'file', path: filePath, line },
            html: rawHtml,
            context: { parent: parentHtml, siblings: contextLines },
            thumbnailDataUrl: null
          }
        });
      }
    }

    return { components, tokens: [] };
  }

  // ----------------------------------------------------------------
  // CSS parsing
  // ----------------------------------------------------------------

  /**
   * Parse a single CSS file.
   * Returns { tokens: TokenRecord[], stateRules: StateRuleRecord[] }
   */
  _parseCSS(content, filePath) {
    const tokens = [];
    const stateRules = [];

    // CSS custom properties → design tokens
    const varRe = /--([a-z][a-z0-9-]*)\s*:\s*([^;}{]+);/gi;
    let m;
    while ((m = varRe.exec(content)) !== null) {
      const name = m[1];
      const value = m[2].trim();
      let category = 'other';
      if (/color|bg|fg|border|fill|stroke|surface/i.test(name)) category = 'color';
      else if (/font|text|size|weight|line-height|letter|tracking/i.test(name)) category = 'typography';
      else if (/space|gap|padding|margin/i.test(name)) category = 'spacing';
      else if (/shadow|elevation|z-index/i.test(name)) category = 'elevation';
      else if (/radius|round|corner/i.test(name)) category = 'shape';
      tokens.push({ name: `--${name}`, value, category, source: filePath });
    }

    // State pseudo-class rules
    const stateRe = /([^{}]+):(hover|focus|active|disabled|checked|error|invalid|focus-visible)[^{]*\{([^}]+)\}/gi;
    while ((m = stateRe.exec(content)) !== null) {
      stateRules.push({
        selector: m[1].trim(),
        state: m[2].toLowerCase(),
        styles: m[3].trim()
      });
    }

    return { tokens, stateRules };
  }

  // ----------------------------------------------------------------
  // Main entry point
  // ----------------------------------------------------------------

  /**
   * Parse a GitHub repository.
   * Returns results in the same shape as AgenticCrawler.getResults():
   * { components, tokens, stateRules, pages, pagesCrawled, source }
   */
  async parse(repoUrl) {
    this.cancelled = false;
    const { owner, repo } = this.parseRepoUrl(repoUrl);
    this.onLog({ type: 'info', message: `Analyzing github.com/${owner}/${repo}` });

    const files = await this._listFiles(owner, repo);
    if (files.length === 0) {
      throw new Error('No HTML or CSS files found in this repository.');
    }

    const allComponents = [];
    const allTokens = [];
    const allStateRules = [];
    const pages = [];
    const MAX_FILES = 150; // guard against very large repos

    const filesToProcess = files.slice(0, MAX_FILES);
    if (files.length > MAX_FILES) {
      this.onLog({ type: 'warning', message: `Large repo — analysing first ${MAX_FILES} files` });
    }

    for (let i = 0; i < filesToProcess.length; i++) {
      if (this.cancelled) break;
      const file = filesToProcess[i];

      this.onProgress({
        pagesCrawled: i,
        pagesTotal: filesToProcess.length,
        tokensExtracted: allTokens.length,
        componentsFound: allComponents.length,
        currentUrl: file.path
      });

      try {
        const content = await this._fetchFile(owner, repo, file.path);

        if (/\.(html|htm)$/i.test(file.path)) {
          const { components, tokens } = this._parseHTML(content, file.path);
          allComponents.push(...components);
          allTokens.push(...tokens);
          if (components.length > 0) {
            this.onLog({ type: 'success', message: `${file.path} — ${components.length} component${components.length !== 1 ? 's' : ''}` });
          }
          pages.push({
            url: `github:${owner}/${repo}/${file.path}`,
            components: components.length,
            tokens: tokens.length,
            crawledAt: new Date().toISOString()
          });
        } else if (/\.css$/i.test(file.path)) {
          const { tokens, stateRules } = this._parseCSS(content, file.path);
          allTokens.push(...tokens);
          allStateRules.push(...stateRules);
          if (tokens.length > 0) {
            this.onLog({ type: 'success', message: `${file.path} — ${tokens.length} token${tokens.length !== 1 ? 's' : ''}` });
          }
        }
      } catch (err) {
        this.onLog({ type: 'warning', message: `Skipped ${file.path}: ${err.message}` });
      }

      // Throttle to stay within GitHub rate limits (60 req/min unauthenticated)
      if (!this.token && i % 8 === 7) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    this.onProgress({
      pagesCrawled: filesToProcess.length,
      pagesTotal: filesToProcess.length,
      tokensExtracted: allTokens.length,
      componentsFound: allComponents.length,
      currentUrl: 'complete'
    });

    this.onLog({
      type: 'success',
      message: `Done — ${allComponents.length} component instances across ${pages.length} HTML files`
    });

    return {
      components: allComponents,
      tokens: allTokens,
      stateRules: allStateRules,
      pages,
      pagesCrawled: filesToProcess.length,
      source: { type: 'github', owner, repo, url: repoUrl }
    };
  }

  stop() {
    this.cancelled = true;
  }
}
