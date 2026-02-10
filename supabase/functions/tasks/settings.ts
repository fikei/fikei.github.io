import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { TasksRequest, TasksResponse } from './types.ts'

// Free tier limits
const TIER_LIMITS = {
  free: { max_rules: 0, max_categories: 3, max_emails_per_day: 25 },
  pro: { max_rules: 10, max_categories: 6, max_emails_per_day: Infinity },
  team: { max_rules: Infinity, max_categories: 6, max_emails_per_day: Infinity },
}

// Free tier allowed categories
const FREE_CATEGORIES = ['pay_purchase', 'reply_required', 'confirm_approve']

export async function handleSettings(
  supabase: SupabaseClient,
  request: TasksRequest
): Promise<TasksResponse> {
  switch (request.action) {
    case 'settings:get':
      return getSettings(supabase, request)
    case 'settings:update':
      return updateSettings(supabase, request)
    case 'rules:list':
      return listRules(supabase, request)
    case 'rules:create':
      return createRule(supabase, request)
    case 'rules:delete':
      return deleteRule(supabase, request)
    default:
      return { success: false, error: `Unknown settings action: ${request.action}` }
  }
}

async function getSettings(
  supabase: SupabaseClient,
  request: TasksRequest
): Promise<TasksResponse> {
  const userId = request.userId
  if (!userId) return { success: false, error: 'Missing userId' }

  const { data: user, error } = await supabase
    .from('tasks_users')
    .select('email, task_list_id, settings, created_at')
    .eq('id', userId)
    .single()

  if (error || !user) {
    return { success: false, error: 'User not found' }
  }

  return { success: true, data: user }
}

async function updateSettings(
  supabase: SupabaseClient,
  request: TasksRequest
): Promise<TasksResponse> {
  const userId = request.userId
  const updates = request.data?.settings as Record<string, unknown>
  if (!userId || !updates) {
    return { success: false, error: 'Missing userId or settings' }
  }

  // Get current settings to merge
  const { data: user } = await supabase
    .from('tasks_users')
    .select('settings')
    .eq('id', userId)
    .single()

  if (!user) return { success: false, error: 'User not found' }

  const currentSettings = user.settings || {}
  const tier = currentSettings.tier || 'free'
  const limits = TIER_LIMITS[tier as keyof typeof TIER_LIMITS]

  // Enforce category limits for free tier
  if (updates.categories_enabled && tier === 'free') {
    const categories = updates.categories_enabled as string[]
    const validCategories = categories.filter((c) => FREE_CATEGORIES.includes(c))
    if (validCategories.length !== categories.length) {
      updates.categories_enabled = validCategories
    }
  }

  // Enforce notification limits for free tier
  if (tier === 'free') {
    updates.realtime_notifications = false
  }

  const merged = { ...currentSettings, ...updates }

  const { error } = await supabase
    .from('tasks_users')
    .update({ settings: merged, updated_at: new Date().toISOString() })
    .eq('id', userId)

  if (error) {
    return { success: false, error: 'Failed to update settings', details: error.message }
  }

  return { success: true, data: { settings: merged } }
}

async function listRules(
  supabase: SupabaseClient,
  request: TasksRequest
): Promise<TasksResponse> {
  const userId = request.userId
  if (!userId) return { success: false, error: 'Missing userId' }

  const { data: rules, error } = await supabase
    .from('tasks_rules')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) {
    return { success: false, error: 'Failed to fetch rules', details: error.message }
  }

  return { success: true, data: { rules: rules || [] } }
}

async function createRule(
  supabase: SupabaseClient,
  request: TasksRequest
): Promise<TasksResponse> {
  const userId = request.userId
  const ruleData = request.data as {
    rule_type: string
    match_value: string
    action: Record<string, unknown>
  }

  if (!userId || !ruleData?.rule_type || !ruleData?.match_value) {
    return { success: false, error: 'Missing userId, rule_type, or match_value' }
  }

  // Check rule limits
  const { data: user } = await supabase
    .from('tasks_users')
    .select('settings')
    .eq('id', userId)
    .single()

  const tier = (user?.settings?.tier || 'free') as keyof typeof TIER_LIMITS
  const limits = TIER_LIMITS[tier]

  if (limits.max_rules === 0) {
    return { success: false, error: 'Custom rules require Pro plan' }
  }

  const { count } = await supabase
    .from('tasks_rules')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)

  if (count !== null && count >= limits.max_rules) {
    return {
      success: false,
      error: `Rule limit reached (${limits.max_rules} for ${tier} plan)`,
    }
  }

  const { data: rule, error } = await supabase
    .from('tasks_rules')
    .insert({
      user_id: userId,
      rule_type: ruleData.rule_type,
      match_value: ruleData.match_value,
      action: ruleData.action || {},
    })
    .select()
    .single()

  if (error) {
    return { success: false, error: 'Failed to create rule', details: error.message }
  }

  return { success: true, data: { rule } }
}

async function deleteRule(
  supabase: SupabaseClient,
  request: TasksRequest
): Promise<TasksResponse> {
  const userId = request.userId
  const ruleId = request.data?.ruleId as string
  if (!userId || !ruleId) {
    return { success: false, error: 'Missing userId or ruleId' }
  }

  const { error } = await supabase
    .from('tasks_rules')
    .delete()
    .eq('id', ruleId)
    .eq('user_id', userId)

  if (error) {
    return { success: false, error: 'Failed to delete rule', details: error.message }
  }

  return { success: true }
}
