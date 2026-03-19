/**
 * ctrl-auth.js — Shared auth module for ctrl.rodeo
 * Provides login (email magic link + Google OAuth), session management,
 * and username onboarding for any app on ctrl.rodeo.
 *
 * Usage:
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *   <script src="/auth/ctrl-auth.js"></script>
 *   <script>
 *     CtrlAuth.init({
 *       supabaseUrl: 'https://xxx.supabase.co',
 *       supabaseAnonKey: '...',
 *       redirectTo: window.location.origin + '/boards/',
 *       adminEmails: ['admin@example.com']
 *     });
 *     document.addEventListener('ctrl:auth:signedin', e => { ... });
 *     document.addEventListener('ctrl:auth:signedout', e => { ... });
 *   </script>
 */

(function () {
  'use strict';

  // ============================================
  // State
  // ============================================
  let _supabase = null;
  let _config = {};
  let _currentUser = null;
  let _currentUsername = null;
  let _authStorageKey = null;
  let _countdownInterval = null;
  let _usernameCheckTimeout = null;
  let _initialized = false;

  // DOM refs (set during inject)
  let _els = {};

  // ============================================
  // Public API
  // ============================================
  window.CtrlAuth = {
    /**
     * Initialize the auth module.
     * @param {Object} config
     * @param {string} config.supabaseUrl
     * @param {string} config.supabaseAnonKey
     * @param {string} [config.redirectTo] - URL to return to after auth (default: current page)
     * @param {string[]} [config.adminEmails] - admin email addresses
     * @param {string} [config.mountTo] - CSS selector for mount point (default: 'body')
     * @param {boolean} [config.skipUsername] - skip username onboarding modal (default: false)
     * @param {string} [config.flowType] - auth flow type: 'pkce' (default on desktop) or 'implicit'
     */
    init(config) {
      if (_initialized) return;
      _initialized = true;
      _config = config;

      // Derive the storage key from the supabase URL project ref
      const ref = config.supabaseUrl.match(/\/\/([^.]+)\./)?.[1] || '';
      _authStorageKey = `sb-${ref}-auth-token`;

      // Detect mobile browsers where PKCE code-verifier can be lost during
      // the OAuth redirect chain, causing silent auth failures on mobile Safari.
      // Use implicit flow on mobile — tokens arrive in the URL hash which the
      // iOS Auth Token Capture script in boards/index.html already handles.
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
        (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));

      // Create Supabase client
      _supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: {
          detectSessionInUrl: true,
          flowType: config.flowType || (isMobile ? 'implicit' : 'pkce'),
          autoRefreshToken: true,
          persistSession: true
        }
      });

      // Inject DOM
      injectDOM(config.mountTo || 'body');

      // Listen for auth state changes
      _supabase.auth.onAuthStateChange(handleAuthStateChange);

      // Fast restore from localStorage (avoids waiting for Supabase client)
      const stored = getStoredSession();
      if (stored?.user) {
        _currentUser = stored.user;
        updateBarUI();
        // Fetch profile in background
        fetchProfile(stored.user.id).then(profile => {
          if (profile && profile.username) {
            _currentUsername = profile.username;
            updateBarUI();
            dispatch('ctrl:auth:signedin', { user: _currentUser, username: _currentUsername, session: stored });
          }
          // Don't show username modal here — the token may be expired causing
          // fetchProfile to return null. Let onAuthStateChange handle it with
          // a fresh token instead.
        });
      }
    },

    /** Returns the current session from localStorage */
    getSession() {
      return getStoredSession();
    },

    /** Returns the current username */
    getUsername() {
      return _currentUsername;
    },

    /** Returns the current user object */
    getUser() {
      return _currentUser;
    },

    /** Signs out */
    async signOut() {
      await _supabase.auth.signOut();
      _currentUser = null;
      _currentUsername = null;
      updateBarUI();
      dispatch('ctrl:auth:signedout', {});
    },

    /** Opens the login modal */
    openLoginModal() {
      showLoginModal();
    },

    /** Checks if current user is admin */
    isAdmin() {
      return _currentUser && (_config.adminEmails || []).includes(_currentUser.email);
    },

    /** Returns the supabase client instance */
    getSupabaseClient() {
      return _supabase;
    }
  };

  // ============================================
  // DOM Injection
  // ============================================
  function injectDOM(mountSelector) {
    const mount = document.querySelector(mountSelector) || document.body;

    const root = document.createElement('div');
    root.id = 'ctrl-auth-root';
    root.innerHTML = `
      <!-- Auth Bar -->
      <div class="ctrl-auth-bar" id="ctrlAuthBar">
        <button class="ctrl-auth-bar__btn" id="ctrlAuthLoginBtn">Login</button>
        <div class="ctrl-auth-menu" id="ctrlAuthMenu" style="display:none;">
          <button class="ctrl-auth-menu__trigger" id="ctrlAuthMenuTrigger">
            <span class="ctrl-auth-menu__name" id="ctrlAuthMenuName"></span>
          </button>
          <div class="ctrl-auth-menu__dropdown" id="ctrlAuthMenuDropdown">
            <div class="ctrl-auth-menu__header">
              <div class="ctrl-auth-menu__header-email" id="ctrlAuthMenuEmail"></div>
              <span class="ctrl-auth-menu__header-badge" id="ctrlAuthMenuBadge" style="display:none;">Admin</span>
            </div>
            <button class="ctrl-auth-menu__item" id="ctrlAuthMenuAccount">Account</button>
            <button class="ctrl-auth-menu__item" id="ctrlAuthMenuSettings">Settings</button>
            <button class="ctrl-auth-menu__item ctrl-auth-menu__item--danger" id="ctrlAuthMenuLogout">Logout</button>
          </div>
        </div>
      </div>

      <!-- Login Modal -->
      <div class="ctrl-auth-modal" id="ctrlAuthModal">
        <div class="ctrl-auth-modal__content">
          <button class="ctrl-auth-modal__close" id="ctrlAuthModalClose">&times;</button>

          <!-- Step 1: Method Select -->
          <div class="ctrl-auth-step ctrl-auth-step--active" id="ctrlAuthStepMethod">
            <div class="ctrl-auth-modal__title">Sign In</div>
            <button class="ctrl-auth-btn ctrl-auth-btn--google" id="ctrlAuthGoogleBtn">
              <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
              Continue with Google
            </button>
            <div class="ctrl-auth-divider">or</div>
            <button class="ctrl-auth-btn ctrl-auth-btn--secondary" id="ctrlAuthEmailMethodBtn">Continue with Email</button>
          </div>

          <!-- Step 2: Email Input -->
          <div class="ctrl-auth-step" id="ctrlAuthStepEmail">
            <div class="ctrl-auth-modal__title">Email</div>
            <form id="ctrlAuthEmailForm">
              <input type="email" class="ctrl-auth-input" id="ctrlAuthEmailInput" placeholder="you@example.com" required autocomplete="email">
              <button type="submit" class="ctrl-auth-btn" id="ctrlAuthEmailSubmit">Send Magic Link</button>
            </form>
            <button class="ctrl-auth-back" id="ctrlAuthEmailBack">&larr; Back</button>
            <div class="ctrl-auth-status" id="ctrlAuthEmailStatus"></div>
          </div>

          <!-- Step 3: Check Email -->
          <div class="ctrl-auth-step" id="ctrlAuthStepCheckEmail">
            <div class="ctrl-auth-modal__title">Check Your Inbox</div>
            <p class="ctrl-auth-status">We sent a magic link to your email. Click the link to sign in.</p>
            <div class="ctrl-auth-status" id="ctrlAuthCheckEmailStatus"></div>
          </div>
        </div>
      </div>

      <!-- Username Onboarding Modal (blocking) -->
      <div class="ctrl-auth-username-modal" id="ctrlAuthUsernameModal">
        <div class="ctrl-auth-username-modal__content">
          <div class="ctrl-auth-username-modal__title">Choose Your Username</div>
          <div class="ctrl-auth-username-modal__subtitle">This cannot be changed later</div>
          <div class="ctrl-auth-username-row">
            <span class="ctrl-auth-username-row__prefix">@</span>
            <input type="text" class="ctrl-auth-username-row__input" id="ctrlAuthUsernameInput" placeholder="username" maxlength="20" autocomplete="off" autocapitalize="off" spellcheck="false">
          </div>
          <div class="ctrl-auth-username-status" id="ctrlAuthUsernameStatus"></div>
          <button class="ctrl-auth-btn" id="ctrlAuthUsernameSave" disabled>Save Username</button>
        </div>
      </div>
    `;

    mount.appendChild(root);
    cacheEls();
    bindEvents();
  }

  function cacheEls() {
    const ids = [
      'ctrlAuthBar', 'ctrlAuthLoginBtn', 'ctrlAuthMenu', 'ctrlAuthMenuTrigger',
      'ctrlAuthMenuName', 'ctrlAuthMenuDropdown', 'ctrlAuthMenuEmail', 'ctrlAuthMenuBadge',
      'ctrlAuthMenuAccount', 'ctrlAuthMenuSettings', 'ctrlAuthMenuLogout',
      'ctrlAuthModal', 'ctrlAuthModalClose',
      'ctrlAuthStepMethod', 'ctrlAuthStepEmail', 'ctrlAuthStepCheckEmail',
      'ctrlAuthGoogleBtn', 'ctrlAuthEmailMethodBtn',
      'ctrlAuthEmailForm', 'ctrlAuthEmailInput', 'ctrlAuthEmailSubmit', 'ctrlAuthEmailBack', 'ctrlAuthEmailStatus',
      'ctrlAuthCheckEmailStatus',
      'ctrlAuthUsernameModal', 'ctrlAuthUsernameInput', 'ctrlAuthUsernameStatus', 'ctrlAuthUsernameSave'
    ];
    ids.forEach(id => { _els[id] = document.getElementById(id); });
  }

  function bindEvents() {
    // Login button opens modal
    _els.ctrlAuthLoginBtn.addEventListener('click', showLoginModal);

    // Close modal
    _els.ctrlAuthModalClose.addEventListener('click', hideLoginModal);
    _els.ctrlAuthModal.addEventListener('click', (e) => {
      if (e.target === _els.ctrlAuthModal) hideLoginModal();
    });

    // Google sign-in
    _els.ctrlAuthGoogleBtn.addEventListener('click', handleGoogleLogin);

    // Email method
    _els.ctrlAuthEmailMethodBtn.addEventListener('click', () => showStep('email'));
    _els.ctrlAuthEmailBack.addEventListener('click', () => showStep('method'));

    // Email form submit
    _els.ctrlAuthEmailForm.addEventListener('submit', (e) => {
      e.preventDefault();
      handleEmailLogin(_els.ctrlAuthEmailInput.value.trim());
    });

    // User menu toggle
    _els.ctrlAuthMenuTrigger.addEventListener('click', () => {
      _els.ctrlAuthMenuDropdown.classList.toggle('ctrl-auth-menu__dropdown--visible');
    });

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
      if (!_els.ctrlAuthMenu.contains(e.target)) {
        _els.ctrlAuthMenuDropdown.classList.remove('ctrl-auth-menu__dropdown--visible');
      }
    });

    // Account button dispatches event for the app to handle
    _els.ctrlAuthMenuAccount.addEventListener('click', () => {
      _els.ctrlAuthMenuDropdown.classList.remove('ctrl-auth-menu__dropdown--visible');
      dispatch('ctrl:auth:accountclick', { user: _currentUser, username: _currentUsername });
    });

    // Settings button dispatches event for the app to handle
    _els.ctrlAuthMenuSettings.addEventListener('click', () => {
      _els.ctrlAuthMenuDropdown.classList.remove('ctrl-auth-menu__dropdown--visible');
      dispatch('ctrl:auth:settingsclick', {});
    });

    // Logout
    _els.ctrlAuthMenuLogout.addEventListener('click', () => {
      _els.ctrlAuthMenuDropdown.classList.remove('ctrl-auth-menu__dropdown--visible');
      window.CtrlAuth.signOut();
    });

    // Username input — live validation
    _els.ctrlAuthUsernameInput.addEventListener('input', (e) => {
      // Force lowercase, strip invalid chars
      let val = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '');
      e.target.value = val;
      handleUsernameInput(val);
    });

    // Username save
    _els.ctrlAuthUsernameSave.addEventListener('click', handleUsernameSave);
  }

  // ============================================
  // Auth State Handler
  // ============================================
  let _wasSignedIn = false;

  async function handleAuthStateChange(event, session) {
    if (event === 'SIGNED_IN' && session?.user) {
      _currentUser = session.user;

      // Ensure profile row exists (backfill for existing users)
      await ensureProfile(session.user);

      // Fetch profile for username
      const profile = await fetchProfile(session.user.id);

      if (profile?.username) {
        _currentUsername = profile.username;
        updateBarUI();
        hideLoginModal();
        dispatch('ctrl:auth:signedin', { user: _currentUser, username: _currentUsername, session });
      } else if (!_currentUsername && !_config.skipUsername) {
        // No username in DB and not already set — show onboarding
        updateBarUI();
        hideLoginModal();
        showUsernameModal();
      } else if (!_currentUsername && _config.skipUsername) {
        // Username not required — sign in without it
        updateBarUI();
        hideLoginModal();
        dispatch('ctrl:auth:signedin', { user: _currentUser, username: null, session });
      }

      _wasSignedIn = true;

    } else if (event === 'SIGNED_OUT') {
      _currentUser = null;
      _currentUsername = null;
      updateBarUI();
      if (_wasSignedIn) {
        dispatch('ctrl:auth:signedout', {});
        _wasSignedIn = false;
      }

    } else if (event === 'TOKEN_REFRESHED' && session?.user) {
      _currentUser = session.user;
    }
  }

  // ============================================
  // Auth Methods
  // ============================================
  async function handleEmailLogin(email) {
    clearCountdown();
    _els.ctrlAuthEmailSubmit.disabled = true;
    setEmailStatus('Sending magic link...', false);

    try {
      const redirectTo = _config.redirectTo || window.location.href;
      const { error } = await _supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo }
      });
      if (error) throw error;

      _els.ctrlAuthEmailInput.value = '';
      _els.ctrlAuthEmailSubmit.disabled = false;
      showStep('check-email');
    } catch (e) {
      const msg = e.message || 'Failed to send magic link';
      // Rate limit countdown
      const secMatch = msg.match(/after\s+(\d+)\s+second/i);
      if (secMatch) {
        startCountdown(parseInt(secMatch[1], 10));
      } else {
        setEmailStatus(msg, true);
        _els.ctrlAuthEmailSubmit.disabled = false;
      }
    }
  }

  async function handleGoogleLogin() {
    try {
      const redirectTo = _config.redirectTo || window.location.href;
      const { error } = await _supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo }
      });
      if (error) throw error;
    } catch (e) {
      setEmailStatus(e.message || 'Google login failed', true);
    }
  }

  // ============================================
  // Rate Limit Countdown
  // ============================================
  function startCountdown(seconds) {
    _els.ctrlAuthEmailSubmit.disabled = true;
    let remaining = seconds;
    setEmailStatus(`Wait ${remaining}s`, true);
    _countdownInterval = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearCountdown();
        setEmailStatus('', false);
        _els.ctrlAuthEmailSubmit.disabled = false;
      } else {
        setEmailStatus(`Wait ${remaining}s`, true);
      }
    }, 1000);
  }

  function clearCountdown() {
    if (_countdownInterval) {
      clearInterval(_countdownInterval);
      _countdownInterval = null;
    }
  }

  // ============================================
  // Profile Management
  // ============================================
  async function fetchProfile(userId) {
    try {
      const token = getAccessToken();
      const resp = await fetch(`${_config.supabaseUrl}/rest/v1/profiles?id=eq.${userId}&select=username,display_name,avatar_url`, {
        headers: {
          'apikey': _config.supabaseAnonKey,
          'Authorization': `Bearer ${token}`
        }
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      return data[0] || null;
    } catch {
      return null;
    }
  }

  async function ensureProfile(user) {
    // Check if profile exists; if not, create one (backfill for pre-migration users)
    const profile = await fetchProfile(user.id);
    if (profile) return profile;

    try {
      const token = getAccessToken();
      const username = user.user_metadata?.username || null;
      await fetch(`${_config.supabaseUrl}/rest/v1/profiles`, {
        method: 'POST',
        headers: {
          'apikey': _config.supabaseAnonKey,
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          id: user.id,
          username: username
        })
      });
      if (username) return { username };
      return null;
    } catch {
      return null;
    }
  }

  async function checkUsernameAvailable(username) {
    try {
      const token = getAccessToken();
      const resp = await fetch(`${_config.supabaseUrl}/rest/v1/profiles?username=eq.${encodeURIComponent(username)}&select=id`, {
        headers: {
          'apikey': _config.supabaseAnonKey,
          'Authorization': `Bearer ${token}`
        }
      });
      if (!resp.ok) return false;
      const data = await resp.json();
      // If no rows returned, it's available. If the only row is us, also available.
      return data.length === 0 || (data.length === 1 && data[0].id === _currentUser?.id);
    } catch {
      return false;
    }
  }

  async function saveUsername(username) {
    const token = getAccessToken();
    const resp = await fetch(`${_config.supabaseUrl}/rest/v1/profiles?id=eq.${_currentUser.id}`, {
      method: 'PATCH',
      headers: {
        'apikey': _config.supabaseAnonKey,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ username })
    });

    if (!resp.ok) {
      const text = await resp.text();
      // Check for unique constraint violation
      if (text.includes('duplicate') || text.includes('unique') || resp.status === 409) {
        throw new Error('Username already taken');
      }
      throw new Error('Failed to save username');
    }

    // Also store in user_metadata for backward compat
    await _supabase.auth.updateUser({ data: { username } });
  }

  // ============================================
  // Username Validation
  // ============================================
  function validateUsername(val) {
    if (!val) return { valid: false, error: '' };
    if (val.length < 3) return { valid: false, error: 'At least 3 characters' };
    if (val.length > 20) return { valid: false, error: 'Max 20 characters' };
    if (!/^[a-z]/.test(val)) return { valid: false, error: 'Must start with a letter' };
    if (!/^[a-z][a-z0-9_]*$/.test(val)) return { valid: false, error: 'Only letters, numbers, underscores' };
    return { valid: true };
  }

  function handleUsernameInput(val) {
    const result = validateUsername(val);
    clearTimeout(_usernameCheckTimeout);
    _els.ctrlAuthUsernameSave.disabled = true;

    if (!val) {
      setUsernameStatus('', '');
      return;
    }

    if (!result.valid) {
      setUsernameStatus(result.error, 'error');
      return;
    }

    setUsernameStatus('Checking...', 'checking');
    _usernameCheckTimeout = setTimeout(async () => {
      const available = await checkUsernameAvailable(val);
      // Re-check the input hasn't changed
      if (_els.ctrlAuthUsernameInput.value !== val) return;
      if (available) {
        setUsernameStatus('Available', 'success');
        _els.ctrlAuthUsernameSave.disabled = false;
      } else {
        setUsernameStatus('Already taken', 'error');
        _els.ctrlAuthUsernameSave.disabled = true;
      }
    }, 400);
  }

  async function handleUsernameSave() {
    const username = _els.ctrlAuthUsernameInput.value.trim();
    if (!username || !validateUsername(username).valid) return;

    _els.ctrlAuthUsernameSave.disabled = true;
    setUsernameStatus('Saving...', 'checking');

    try {
      await saveUsername(username);
      _currentUsername = username;
      hideUsernameModal();
      updateBarUI();
      dispatch('ctrl:auth:usernameSet', { username });
      dispatch('ctrl:auth:signedin', {
        user: _currentUser,
        username: _currentUsername,
        session: getStoredSession()
      });
    } catch (e) {
      setUsernameStatus(e.message || 'Failed to save', 'error');
      _els.ctrlAuthUsernameSave.disabled = false;
    }
  }

  // ============================================
  // UI Helpers
  // ============================================
  function showLoginModal() {
    showStep('method');
    _els.ctrlAuthModal.classList.add('ctrl-auth-modal--visible');
    clearCountdown();
    setEmailStatus('', false);
  }

  function hideLoginModal() {
    _els.ctrlAuthModal.classList.remove('ctrl-auth-modal--visible');
    clearCountdown();
  }

  function showUsernameModal() {
    _els.ctrlAuthUsernameModal.classList.add('ctrl-auth-username-modal--visible');
    _els.ctrlAuthUsernameInput.value = '';
    _els.ctrlAuthUsernameInput.focus();
    setUsernameStatus('', '');
    _els.ctrlAuthUsernameSave.disabled = true;
  }

  function hideUsernameModal() {
    _els.ctrlAuthUsernameModal.classList.remove('ctrl-auth-username-modal--visible');
  }

  function showStep(name) {
    const steps = {
      'method': 'ctrlAuthStepMethod',
      'email': 'ctrlAuthStepEmail',
      'check-email': 'ctrlAuthStepCheckEmail'
    };
    Object.values(steps).forEach(id => {
      _els[id].classList.remove('ctrl-auth-step--active');
    });
    if (steps[name]) {
      _els[steps[name]].classList.add('ctrl-auth-step--active');
    }
    // Focus email input when showing email step
    if (name === 'email') {
      setTimeout(() => _els.ctrlAuthEmailInput.focus(), 100);
    }
  }

  function updateBarUI() {
    if (_currentUser) {
      _els.ctrlAuthLoginBtn.style.display = 'none';
      _els.ctrlAuthMenu.style.display = '';
      const displayName = _currentUsername ? '@' + _currentUsername : _currentUser.email;
      _els.ctrlAuthMenuName.textContent = displayName;
      _els.ctrlAuthMenuEmail.textContent = _currentUser.email;
      if (window.CtrlAuth.isAdmin()) {
        _els.ctrlAuthMenuBadge.style.display = '';
      } else {
        _els.ctrlAuthMenuBadge.style.display = 'none';
      }
    } else {
      _els.ctrlAuthLoginBtn.style.display = '';
      _els.ctrlAuthMenu.style.display = 'none';
    }
  }

  function setEmailStatus(text, isError) {
    _els.ctrlAuthEmailStatus.textContent = text;
    _els.ctrlAuthEmailStatus.className = 'ctrl-auth-status' + (isError ? ' ctrl-auth-status--error' : '');
  }

  function setUsernameStatus(text, type) {
    _els.ctrlAuthUsernameStatus.textContent = text;
    _els.ctrlAuthUsernameStatus.className = 'ctrl-auth-username-status' +
      (type ? ' ctrl-auth-username-status--' + type : '');
  }

  // ============================================
  // Session Helpers (same localStorage key as Supabase default)
  // ============================================
  function getStoredSession() {
    try {
      const raw = localStorage.getItem(_authStorageKey);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function getAccessToken() {
    const session = getStoredSession();
    return session?.access_token || null;
  }

  // ============================================
  // Event Dispatch
  // ============================================
  function dispatch(name, detail) {
    document.dispatchEvent(new CustomEvent(name, { detail }));
  }

})();
