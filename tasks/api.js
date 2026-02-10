// ============================================
// Tasks API Client
// Connects web dashboard to Supabase edge functions
// ============================================

const TasksAPI = (() => {
  // Configuration — set these for your environment
  const SUPABASE_URL = window.TASKS_CONFIG?.supabaseUrl || ''
  const SUPABASE_ANON_KEY = window.TASKS_CONFIG?.supabaseAnonKey || ''
  const FUNCTION_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/tasks` : ''

  // State
  let currentUser = null
  let sessionToken = null

  // --- HTTP helpers ---

  async function apiCall(action, data = {}, userId = null) {
    if (!FUNCTION_URL) {
      console.warn('[tasks:api] No SUPABASE_URL configured — running in demo mode')
      return { success: false, error: 'Not configured' }
    }

    const body = {
      action,
      userId: userId || currentUser?.id,
      data,
    }

    const headers = {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
    }

    if (sessionToken) {
      headers.Authorization = `Bearer ${sessionToken}`
    }

    try {
      const response = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })

      const result = await response.json()
      if (!result.success) {
        console.error(`[tasks:api] ${action} failed:`, result.error)
      }
      return result
    } catch (err) {
      console.error(`[tasks:api] ${action} error:`, err)
      return { success: false, error: err.message }
    }
  }

  // --- Auth ---

  async function connectGoogle() {
    const result = await apiCall('auth:connect')
    if (result.success && result.data?.authUrl) {
      window.location.href = result.data.authUrl
    }
    return result
  }

  async function handleCallback(code) {
    const result = await apiCall('auth:callback', { code })
    if (result.success && result.data) {
      currentUser = {
        id: result.data.userId,
        email: result.data.email,
        taskListId: result.data.taskListId,
      }
      localStorage.setItem('tasks_user', JSON.stringify(currentUser))
    }
    return result
  }

  async function disconnect() {
    const result = await apiCall('auth:disconnect')
    if (result.success) {
      currentUser = null
      localStorage.removeItem('tasks_user')
    }
    return result
  }

  function getUser() {
    if (!currentUser) {
      const stored = localStorage.getItem('tasks_user')
      if (stored) {
        try {
          currentUser = JSON.parse(stored)
        } catch {
          // ignore
        }
      }
    }
    return currentUser
  }

  function isAuthenticated() {
    return !!getUser()
  }

  // --- Feed ---

  async function getFeed(category = null, status = null) {
    const data = {}
    if (category && category !== 'all') data.category = category
    if (status) data.status = status
    // Feed shows recent actionable items (auto_created + review)
    return apiCall('history:list', {
      ...data,
      pageSize: 50,
      status: status || undefined,
    })
  }

  // --- Actions ---

  async function confirmItem(processedId) {
    return apiCall('tasks:confirm', { processedId })
  }

  async function dismissItem(processedId) {
    return apiCall('tasks:dismiss', { processedId })
  }

  // --- History ---

  async function getHistory(params = {}) {
    return apiCall('history:list', params)
  }

  // --- Stats ---

  async function getStats(days = 7) {
    return apiCall('history:stats', { days })
  }

  // --- Settings ---

  async function getSettings() {
    return apiCall('settings:get')
  }

  async function updateSettings(settings) {
    return apiCall('settings:update', { settings })
  }

  // --- Rules ---

  async function getRules() {
    return apiCall('rules:list')
  }

  async function createRule(ruleType, matchValue, action) {
    return apiCall('rules:create', {
      rule_type: ruleType,
      match_value: matchValue,
      action,
    })
  }

  async function deleteRule(ruleId) {
    return apiCall('rules:delete', { ruleId })
  }

  // --- Public API ---

  return {
    connectGoogle,
    handleCallback,
    disconnect,
    getUser,
    isAuthenticated,
    getFeed,
    confirmItem,
    dismissItem,
    getHistory,
    getStats,
    getSettings,
    updateSettings,
    getRules,
    createRule,
    deleteRule,
  }
})()
