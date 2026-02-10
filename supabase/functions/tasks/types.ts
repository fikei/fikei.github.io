// ============================================
// Tasks System - Type Definitions
// ============================================

// --- Action types ---

export type TaskAction =
  | 'auth:connect'
  | 'auth:callback'
  | 'auth:refresh'
  | 'auth:disconnect'
  | 'webhook:receive'
  | 'classify:email'
  | 'tasks:create'
  | 'tasks:dismiss'
  | 'tasks:confirm'
  | 'settings:get'
  | 'settings:update'
  | 'rules:list'
  | 'rules:create'
  | 'rules:delete'
  | 'history:list'
  | 'history:stats'
  | 'watch:renew'

// --- Request/Response ---

export interface TasksRequest {
  action: TaskAction
  userId?: string
  data?: Record<string, unknown>
}

export interface TasksResponse {
  success: boolean
  data?: unknown
  error?: string
  details?: string
}

// --- User ---

export interface TasksUser {
  id: string
  supabase_user_id: string
  email: string
  google_access_token: string | null
  google_refresh_token: string | null
  google_token_expires_at: string | null
  task_list_id: string | null
  settings: UserSettings
  created_at: string
  updated_at: string
}

export interface UserSettings {
  auto_create_threshold: number
  daily_digest_enabled: boolean
  daily_digest_time: string
  realtime_notifications: boolean
  categories_enabled: ActionType[]
  tier: 'free' | 'pro' | 'team'
}

// --- Classification ---

export type ActionType =
  | 'pay_purchase'
  | 'schedule_rsvp'
  | 'confirm_approve'
  | 'reply_required'
  | 'review_read'
  | 'action_required'

export type Urgency = 'high' | 'medium' | 'low'

export type ProcessedStatus =
  | 'auto_created'
  | 'confirmed'
  | 'dismissed'
  | 'review'
  | 'skipped'

export interface ClassificationResult {
  is_actionable: boolean
  action_type: ActionType
  urgency: Urgency
  suggested_title: string
  due_date: string | null
  confidence: number
  reasoning: string
}

// --- Email ---

export interface EmailMetadata {
  messageId: string
  threadId: string
  from: string
  subject: string
  bodyPreview: string
  date: string
  labelIds: string[]
}

// --- Processed record ---

export interface ProcessedEmail {
  id: string
  user_id: string
  gmail_message_id: string
  gmail_thread_id: string
  sender: string
  subject: string
  action_type: ActionType
  urgency: Urgency
  confidence: number
  suggested_title: string
  due_date: string | null
  google_task_id: string | null
  status: ProcessedStatus
  reasoning: string
  processed_at: string
}

// --- Rules ---

export type RuleType =
  | 'sender_priority'
  | 'sender_block'
  | 'domain_block'
  | 'category_override'

export interface TaskRule {
  id: string
  user_id: string
  rule_type: RuleType
  match_value: string
  action: Record<string, unknown>
  created_at: string
}

// --- Google OAuth ---

export interface GoogleTokens {
  access_token: string
  refresh_token?: string
  expires_in: number
  token_type: string
  scope: string
}

// --- Google Task ---

export interface GoogleTask {
  id?: string
  title: string
  notes?: string
  due?: string
  status?: 'needsAction' | 'completed'
}

// --- Stats ---

export interface ProcessingStats {
  total_processed: number
  auto_created: number
  confirmed: number
  dismissed: number
  review: number
  by_category: Record<ActionType, number>
  by_urgency: Record<Urgency, number>
  dismiss_rate: number
  avg_confidence: number
}
