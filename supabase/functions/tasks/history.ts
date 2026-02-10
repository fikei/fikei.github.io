import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { TasksRequest, TasksResponse, ActionType, Urgency, ProcessingStats } from './types.ts'

export async function handleHistory(
  supabase: SupabaseClient,
  request: TasksRequest
): Promise<TasksResponse> {
  switch (request.action) {
    case 'history:list':
      return listHistory(supabase, request)
    case 'history:stats':
      return getStats(supabase, request)
    default:
      return { success: false, error: `Unknown history action: ${request.action}` }
  }
}

async function listHistory(
  supabase: SupabaseClient,
  request: TasksRequest
): Promise<TasksResponse> {
  const userId = request.userId
  if (!userId) return { success: false, error: 'Missing userId' }

  const page = (request.data?.page as number) || 0
  const pageSize = (request.data?.pageSize as number) || 50
  const status = request.data?.status as string | undefined
  const category = request.data?.category as string | undefined
  const search = request.data?.search as string | undefined

  let query = supabase
    .from('tasks_processed')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .order('processed_at', { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1)

  if (status) {
    query = query.eq('status', status)
  }

  if (category) {
    query = query.eq('action_type', category)
  }

  if (search) {
    query = query.or(`subject.ilike.%${search}%,sender.ilike.%${search}%,suggested_title.ilike.%${search}%`)
  }

  const { data, count, error } = await query

  if (error) {
    return { success: false, error: 'Failed to fetch history', details: error.message }
  }

  return {
    success: true,
    data: {
      items: data || [],
      total: count || 0,
      page,
      pageSize,
      hasMore: (count || 0) > (page + 1) * pageSize,
    },
  }
}

async function getStats(
  supabase: SupabaseClient,
  request: TasksRequest
): Promise<TasksResponse> {
  const userId = request.userId
  if (!userId) return { success: false, error: 'Missing userId' }

  // Default to last 7 days
  const days = (request.data?.days as number) || 7
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  const { data: records, error } = await supabase
    .from('tasks_processed')
    .select('action_type, urgency, status, confidence')
    .eq('user_id', userId)
    .gte('processed_at', since)

  if (error) {
    return { success: false, error: 'Failed to fetch stats', details: error.message }
  }

  const items = records || []

  // Calculate stats
  const byCategory: Record<string, number> = {}
  const byUrgency: Record<string, number> = {}
  let totalConfidence = 0
  let autoCreated = 0
  let confirmed = 0
  let dismissed = 0
  let review = 0

  for (const item of items) {
    // Category counts
    byCategory[item.action_type] = (byCategory[item.action_type] || 0) + 1

    // Urgency counts
    byUrgency[item.urgency] = (byUrgency[item.urgency] || 0) + 1

    // Status counts
    if (item.status === 'auto_created') autoCreated++
    if (item.status === 'confirmed') confirmed++
    if (item.status === 'dismissed') dismissed++
    if (item.status === 'review') review++

    // Confidence sum
    totalConfidence += item.confidence || 0
  }

  const actionableCount = autoCreated + confirmed + dismissed + review
  const dismissRate = actionableCount > 0 ? dismissed / actionableCount : 0

  const stats: ProcessingStats = {
    total_processed: items.length,
    auto_created: autoCreated,
    confirmed,
    dismissed,
    review,
    by_category: byCategory as Record<ActionType, number>,
    by_urgency: byUrgency as Record<Urgency, number>,
    dismiss_rate: Math.round(dismissRate * 100) / 100,
    avg_confidence:
      items.length > 0 ? Math.round((totalConfidence / items.length) * 100) / 100 : 0,
  }

  return { success: true, data: { stats, period_days: days } }
}
