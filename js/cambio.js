/**
 * Cambio Portfolio — Interactive filtering
 */

(function() {
	'use strict';

	// Wait for DOM to be ready
	document.addEventListener('DOMContentLoaded', function() {
		initProjectFilters();
		initAnalytics();
	});

	/**
	 * Initialize project filtering system
	 */
	function initProjectFilters() {
		const filterButtons = document.querySelectorAll('.filter-btn');
		const projectCards = document.querySelectorAll('.project-card');

		if (filterButtons.length === 0 || projectCards.length === 0) {
			return;
		}

		filterButtons.forEach(function(button) {
			button.addEventListener('click', function() {
				const filter = this.getAttribute('data-filter');

				// Update active state
				filterButtons.forEach(function(btn) {
					btn.classList.remove('active');
				});
				this.classList.add('active');

				// Filter projects
				filterProjects(filter, projectCards);

				// Track filter usage
				trackEvent('Project Filter', { filter: filter });
			});
		});
	}

	/**
	 * Filter project cards based on selected filter
	 */
	function filterProjects(filter, cards) {
		cards.forEach(function(card) {
			const status = card.getAttribute('data-status');

			if (filter === 'all') {
				card.classList.remove('hidden');
				// Stagger animation
				setTimeout(function() {
					card.style.opacity = '1';
				}, 50);
			} else if (status === filter) {
				card.classList.remove('hidden');
				setTimeout(function() {
					card.style.opacity = '1';
				}, 50);
			} else {
				card.style.opacity = '0';
				setTimeout(function() {
					card.classList.add('hidden');
				}, 300);
			}
		});
	}

	/**
	 * Initialize analytics tracking
	 */
	function initAnalytics() {
		// Track page view (already handled by Segment snippet)

		// Track scroll depth
		let scrollTracked = {
			'25': false,
			'50': false,
			'75': false,
			'100': false
		};

		window.addEventListener('scroll', function() {
			const scrollPercent = (window.scrollY / (document.documentElement.scrollHeight - window.innerHeight)) * 100;

			if (scrollPercent >= 25 && !scrollTracked['25']) {
				scrollTracked['25'] = true;
				trackEvent('Scroll Depth', { depth: '25%' });
			} else if (scrollPercent >= 50 && !scrollTracked['50']) {
				scrollTracked['50'] = true;
				trackEvent('Scroll Depth', { depth: '50%' });
			} else if (scrollPercent >= 75 && !scrollTracked['75']) {
				scrollTracked['75'] = true;
				trackEvent('Scroll Depth', { depth: '75%' });
			} else if (scrollPercent >= 100 && !scrollTracked['100']) {
				scrollTracked['100'] = true;
				trackEvent('Scroll Depth', { depth: '100%' });
			}
		});

		// Track project card interactions
		const projectCards = document.querySelectorAll('.project-card');
		projectCards.forEach(function(card) {
			card.addEventListener('click', function() {
				const projectTitle = this.querySelector('.project-title').textContent;
				const projectStatus = this.getAttribute('data-status');
				trackEvent('Project Click', {
					title: projectTitle,
					status: projectStatus
				});
			});
		});
	}

	/**
	 * Track custom events via Segment
	 */
	function trackEvent(eventName, properties) {
		if (window.analytics && typeof window.analytics.track === 'function') {
			window.analytics.track(eventName, properties);
		}
	}

	/**
	 * Optional: Hide filters in development
	 * Uncomment this if you want to hide filters based on environment
	 */
	/*
	function hideFiltersInDev() {
		const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
		if (isDev) {
			const filterControls = document.querySelector('.filter-controls');
			if (filterControls) {
				filterControls.style.display = 'none';
			}
		}
	}
	*/

})();
