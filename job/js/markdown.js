// markdown.js — render KB markdown to safe HTML, with [[wiki-link]] support.
// Loads marked + DOMPurify from CDN as ES modules.

import { marked } from 'https://esm.run/marked@13';
import DOMPurify from 'https://esm.run/dompurify@3';

// Map a wiki-link slug to an in-app route.
// Heuristic for v1: slug shapes determine the destination directory.
//   role-*           → /job/history/roles/{slug}/
//   project-* / *-project → /job/history/projects/{slug}/
//   skill-*          → /job/history/skills/{slug}/
//   win-*            → /job/history/wins/{slug}/
//   otherwise        → /job/history/companies/{slug}/  (best-effort)
// A future PR replaces this with a real manifest fetched from kb-read.
export function resolveSlug(slug) {
  const s = slug.toLowerCase().trim();
  if (s.startsWith('role-')) return `/job/history/roles/${s}/`;
  if (s.startsWith('project-') || s.endsWith('-project')) return `/job/history/projects/${s}/`;
  if (s.startsWith('skill-')) return `/job/history/skills/${s}/`;
  if (s.startsWith('win-')) return `/job/history/wins/${s}/`;
  return `/job/history/companies/${s}/`;
}

// Coerce non-string inputs to a markdown string. Claude sometimes returns
// arrays of bullets where we asked for a single markdown string.
function toMd(input) {
  if (input == null) return '';
  if (typeof input === 'string') return input;
  if (Array.isArray(input)) return input.map(toMd).map(s => s.startsWith('-') ? s : '- ' + s).join('\n');
  if (typeof input === 'object') return JSON.stringify(input, null, 2);
  return String(input);
}

// Pre-process [[slug]] and [[slug|label]] before marked sees the text.
function expandWikiLinks(md) {
  return toMd(md).replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, slug, label) => {
    const href = resolveSlug(slug);
    const text = (label || slug).trim();
    return `[${text}](${href})`;
  });
}

const renderer = new marked.Renderer();
// Force external links open in new tab (heuristic: anything starting with http).
const origLink = renderer.link.bind(renderer);
renderer.link = (href, title, text) => {
  const html = origLink(href, title, text);
  return /^https?:/.test(href || '')
    ? html.replace('<a ', '<a target="_blank" rel="noopener noreferrer" ')
    : html;
};

export function renderMarkdown(md) {
  const expanded = expandWikiLinks(md);
  const html = marked.parse(expanded, { renderer, breaks: false, gfm: true });
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['target', 'rel'],
  });
}
