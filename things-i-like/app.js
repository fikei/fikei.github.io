/**
 * Things I Like - Main Application
 * Swiss + Web 1.0 Link Curation Tool
 */

import { extractUrls, extractDomain, generateId } from './lib/parser.js';
import { fetchMetadata } from './lib/fetcher.js';
import { analyzeContent, detectClusters } from './lib/categorizer.js';
import * as storage from './lib/storage.js';

// ============================================
// State
// ============================================
let currentFilter = 'all';
let selectedLink = null;

// ============================================
// DOM Elements
// ============================================
const elements = {
  grid: document.getElementById('grid'),
  filters: document.getElementById('filters'),
  addBtn: document.getElementById('addBtn'),
  addModal: document.getElementById('addModal'),
  addForm: document.getElementById('addForm'),
  linkInput: document.getElementById('linkInput'),
  formStatus: document.getElementById('formStatus'),
  overlay: document.getElementById('overlay'),
  overlayImage: document.getElementById('overlayImage'),
  overlayTitle: document.getElementById('overlayTitle'),
  overlayDomain: document.getElementById('overlayDomain'),
  overlayDescription: document.getElementById('overlayDescription'),
  overlayCategory: document.getElementById('overlayCategory'),
  overlayDate: document.getElementById('overlayDate'),
  overlayLink: document.getElementById('overlayLink'),
  overlayRecategorize: document.getElementById('overlayRecategorize'),
  overlayDelete: document.getElementById('overlayDelete'),
  categoryModal: document.getElementById('categoryModal'),
  categoryList: document.getElementById('categoryList'),
  toastContainer: document.getElementById('toastContainer')
};

// ============================================
// Initialization
// ============================================
function init() {
  renderFilters();
  renderGrid();
  bindEvents();
  checkForClusters();
}

// ============================================
// Event Binding
// ============================================
function bindEvents() {
  // Add button
  elements.addBtn.addEventListener('click', () => openModal(elements.addModal));

  // Add form submission
  elements.addForm.addEventListener('submit', handleAddLinks);

  // Modal close buttons
  document.querySelectorAll('[data-close]').forEach(el => {
    el.addEventListener('click', (e) => {
      const modal = e.target.closest('.modal, .overlay');
      if (modal) closeModal(modal);
    });
  });

  // Overlay actions
  elements.overlayRecategorize.addEventListener('click', () => {
    closeModal(elements.overlay);
    openCategorySelect();
  });

  elements.overlayDelete.addEventListener('click', handleDelete);

  // Filter clicks
  elements.filters.addEventListener('click', (e) => {
    const token = e.target.closest('.filter-token');
    if (token) {
      const category = token.dataset.category;
      setFilter(category);
    }
  });

  // Grid item clicks
  elements.grid.addEventListener('click', (e) => {
    const item = e.target.closest('.grid-item');
    if (item) {
      const linkId = item.dataset.id;
      openLinkDetail(linkId);
    }
  });

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllModals();
    }
  });
}

// ============================================
// Link Management
// ============================================
async function handleAddLinks(e) {
  e.preventDefault();

  const input = elements.linkInput.value.trim();
  if (!input) return;

  const urls = extractUrls(input);

  if (urls.length === 0) {
    showFormStatus('No valid URLs found', 'error');
    return;
  }

  showFormStatus(`Processing ${urls.length} link${urls.length > 1 ? 's' : ''}...`, 'success');

  const results = { added: 0, failed: 0, errors: [] };

  for (const url of urls) {
    try {
      // Check for duplicate
      const existing = storage.findLinkByUrl(url);
      if (existing) {
        results.errors.push(`"${extractDomain(url)}" already exists in ${existing.category}`);
        results.failed++;
        continue;
      }

      // Fetch metadata
      const metadata = await fetchMetadata(url);

      // Analyze and categorize
      const categories = storage.getCategories();
      const categorization = analyzeContent(metadata, categories);

      // Ensure category exists
      if (categorization.category !== 'uncategorized' && !categories[categorization.category]) {
        storage.createCategory(categorization.category);
      }

      // Create link object
      const link = {
        id: generateId(url),
        url,
        title: metadata.title,
        description: metadata.description,
        image: metadata.image,
        domain: metadata.domain,
        category: categorization.category,
        confidence: categorization.confidence
      };

      // Save
      storage.addLink(link);
      results.added++;

    } catch (error) {
      results.errors.push(`Failed to add ${extractDomain(url)}: ${error.message}`);
      results.failed++;
    }
  }

  // Show results
  if (results.added > 0) {
    showFormStatus(`Added ${results.added} link${results.added > 1 ? 's' : ''}`, 'success');
    elements.linkInput.value = '';
    renderFilters();
    renderGrid();
    checkForClusters();

    // Close modal after delay
    setTimeout(() => {
      closeModal(elements.addModal);
      showFormStatus('', '');
    }, 1000);
  }

  if (results.errors.length > 0) {
    results.errors.forEach(err => showToast(err, 'error'));
  }
}

function handleDelete() {
  if (!selectedLink) return;

  const confirmed = confirm('Delete this link?');
  if (!confirmed) return;

  try {
    storage.deleteLink(selectedLink.id);
    closeModal(elements.overlay);
    renderFilters();
    renderGrid();
    showToast('Link deleted');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function handleRecategorize(newCategory) {
  if (!selectedLink) return;

  try {
    storage.updateLink(selectedLink.id, { category: newCategory, userVerified: true });
    closeModal(elements.categoryModal);
    renderFilters();
    renderGrid();
    showToast(`Moved to ${newCategory}`);
  } catch (error) {
    showToast(error.message, 'error');
  }
}

// ============================================
// Rendering
// ============================================
function renderFilters() {
  const categories = storage.getCategories();
  const links = storage.getAllLinks();

  // Count links per category
  const counts = { all: links.length };
  for (const link of links) {
    counts[link.category] = (counts[link.category] || 0) + 1;
  }

  // Build filter tokens
  let html = `
    <button class="filter-token ${currentFilter === 'all' ? 'filter-token--active' : ''}"
            data-category="all">
      All
    </button>
  `;

  // Sort categories: pinned first, then by count
  const sortedCategories = Object.entries(categories)
    .filter(([name]) => counts[name] > 0 || name === 'uncategorized')
    .sort((a, b) => {
      if (a[1].pinned && !b[1].pinned) return -1;
      if (!a[1].pinned && b[1].pinned) return 1;
      return (counts[b[0]] || 0) - (counts[a[0]] || 0);
    });

  for (const [name, data] of sortedCategories) {
    const count = counts[name] || 0;
    const displayName = name.charAt(0).toUpperCase() + name.slice(1);
    const isActive = currentFilter === name;
    const countBadge = name === 'uncategorized' && count > 0 ? ` (${count})` : '';

    html += `
      <button class="filter-token ${isActive ? 'filter-token--active' : ''}"
              data-category="${name}">
        ${displayName}${countBadge}
      </button>
    `;
  }

  elements.filters.innerHTML = html;
}

function renderGrid() {
  const links = currentFilter === 'all'
    ? storage.getAllLinks()
    : storage.getLinksByCategory(currentFilter);

  if (links.length === 0) {
    elements.grid.innerHTML = `
      <div class="empty-state">
        <h2 class="empty-state__title">No links yet</h2>
        <p class="empty-state__text">
          Tap the + button to add your first links
        </p>
      </div>
    `;
    return;
  }

  // Sort by date (newest first)
  const sorted = [...links].sort((a, b) =>
    new Date(b.addedAt) - new Date(a.addedAt)
  );

  let html = '';

  for (const link of sorted) {
    const hasImage = link.image && link.image.length > 0;
    const initial = link.title ? link.title.charAt(0).toUpperCase() : '?';
    const categoryDisplay = link.category.charAt(0).toUpperCase() + link.category.slice(1);

    if (hasImage) {
      html += `
        <article class="grid-item" data-id="${link.id}">
          <img class="grid-item__image" src="${link.image}" alt="" loading="lazy">
          <div class="grid-item__overlay">
            <h3 class="grid-item__title">${escapeHtml(link.title)}</h3>
            <p class="grid-item__domain">${escapeHtml(link.domain)}</p>
          </div>
          <span class="grid-item__category">${categoryDisplay}</span>
        </article>
      `;
    } else {
      html += `
        <article class="grid-item grid-item--placeholder" data-id="${link.id}">
          <span class="grid-item__initial">${initial}</span>
          <div class="grid-item__overlay">
            <h3 class="grid-item__title">${escapeHtml(link.title)}</h3>
            <p class="grid-item__domain">${escapeHtml(link.domain)}</p>
          </div>
          <span class="grid-item__category">${categoryDisplay}</span>
        </article>
      `;
    }
  }

  elements.grid.innerHTML = html;
}

function openLinkDetail(linkId) {
  const link = storage.getLinkById(linkId);
  if (!link) return;

  selectedLink = link;

  // Populate overlay
  elements.overlayImage.src = link.image || '';
  elements.overlayImage.style.display = link.image ? 'block' : 'none';
  elements.overlayTitle.textContent = link.title;
  elements.overlayDomain.textContent = link.domain;
  elements.overlayDescription.textContent = link.description || '';
  elements.overlayCategory.textContent = link.category.charAt(0).toUpperCase() + link.category.slice(1);
  elements.overlayDate.textContent = formatDate(link.addedAt);
  elements.overlayLink.href = link.url;

  openModal(elements.overlay);
}

function openCategorySelect() {
  const categories = storage.getCategories();

  let html = '';
  for (const name of Object.keys(categories)) {
    const displayName = name.charAt(0).toUpperCase() + name.slice(1);
    const isActive = selectedLink && selectedLink.category === name;

    html += `
      <button class="category-list__item ${isActive ? 'category-list__item--active' : ''}"
              data-category="${name}">
        ${displayName}
      </button>
    `;
  }

  // Add "Create new" option
  html += `
    <button class="category-list__item" data-category="__new__">
      + New category
    </button>
  `;

  elements.categoryList.innerHTML = html;

  // Bind category selection
  elements.categoryList.onclick = (e) => {
    const btn = e.target.closest('.category-list__item');
    if (!btn) return;

    const category = btn.dataset.category;

    if (category === '__new__') {
      const name = prompt('Enter category name:');
      if (name && name.trim()) {
        try {
          storage.createCategory(name.trim());
          handleRecategorize(name.trim().toLowerCase().replace(/\s+/g, '-'));
        } catch (error) {
          showToast(error.message, 'error');
        }
      }
    } else {
      handleRecategorize(category);
    }
  };

  openModal(elements.categoryModal);
}

// ============================================
// Cluster Detection
// ============================================
function checkForClusters() {
  const uncategorized = storage.getUncategorizedItems();
  const clusters = detectClusters(uncategorized);

  if (clusters.length > 0) {
    const cluster = clusters[0];
    // Delay the notification slightly
    setTimeout(() => {
      const create = confirm(
        `Found ${cluster.items.length} similar links.\n\nCreate "${cluster.suggestedName}" category?`
      );

      if (create) {
        try {
          storage.createCategory(cluster.suggestedName);
          const categoryName = cluster.suggestedName.toLowerCase().replace(/\s+/g, '-');
          storage.bulkMoveToCategory(
            cluster.items.map(i => i.id),
            categoryName
          );
          renderFilters();
          renderGrid();
          showToast(`Created "${cluster.suggestedName}" with ${cluster.items.length} links`);
        } catch (error) {
          showToast(error.message, 'error');
        }
      }
    }, 500);
  }
}

// ============================================
// Modal Helpers
// ============================================
function openModal(modal) {
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeModal(modal) {
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function closeAllModals() {
  document.querySelectorAll('.modal, .overlay').forEach(modal => {
    closeModal(modal);
  });
}

// ============================================
// UI Helpers
// ============================================
function showFormStatus(message, type) {
  elements.formStatus.textContent = message;
  elements.formStatus.className = 'add-form__status';
  if (type) {
    elements.formStatus.classList.add(`add-form__status--${type}`);
  }
}

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type === 'error' ? 'toast--error' : ''}`;
  toast.textContent = message;

  elements.toastContainer.appendChild(toast);

  // Auto-remove after 4 seconds
  setTimeout(() => {
    toast.remove();
  }, 4000);
}

function setFilter(category) {
  currentFilter = category;
  renderFilters();
  renderGrid();

  // Update URL
  const url = new URL(window.location);
  if (category === 'all') {
    url.searchParams.delete('category');
  } else {
    url.searchParams.set('category', category);
  }
  window.history.replaceState({}, '', url);
}

function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================
// URL State
// ============================================
function initFromUrl() {
  const url = new URL(window.location);
  const category = url.searchParams.get('category');
  if (category) {
    currentFilter = category;
  }
}

// ============================================
// Start
// ============================================
initFromUrl();
init();
