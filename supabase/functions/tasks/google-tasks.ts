import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { TasksRequest, TasksResponse, GoogleTask, ClassificationResult } from './types.ts'
import { getValidAccessToken } from './auth.ts'

const TASKS_API_BASE = 'https://tasks.googleapis.com/tasks/v1'

// Category label prefixes for task titles
const CATEGORY_LABELS: Record<string, string> = {
  pay_purchase: 'PAY',
  schedule_rsvp: 'SCHEDULE',
  confirm_approve: 'CONFIRM',
  reply_required: 'REPLY',
  review_read: 'REVIEW',
  action_required: 'ACTION',
}

export async function handleGoogleTasks(
  supabase: SupabaseClient,
  request: TasksRequest
): Promise<TasksResponse> {
  switch (request.action) {
    case 'tasks:create':
      return createFromClassification(supabase, request)
    case 'tasks:dismiss':
      return dismissTask(supabase, request)
    case 'tasks:confirm':
      return confirmTask(supabase, request)
    default:
      return { success: false, error: `Unknown tasks action: ${request.action}` }
  }
}

// Create a Google Task from a classification result
async function createFromClassification(
  supabase: SupabaseClient,
  request: TasksRequest
): Promise<TasksResponse> {
  const userId = request.userId
  const data = request.data as {
    classification: ClassificationResult
    sender: string
    subject: string
    messageId: string
  }

  if (!userId || !data?.classification) {
    return { success: false, error: 'Missing userId or classification data' }
  }

  const { classification, sender, subject, messageId } = data

  // Get user's task list ID and access token
  const { data: user } = await supabase
    .from('tasks_users')
    .select('task_list_id')
    .eq('id', userId)
    .single()

  if (!user?.task_list_id) {
    return { success: false, error: 'No task list configured' }
  }

  const accessToken = await getValidAccessToken(supabase, userId)
  if (!accessToken) {
    return { success: false, error: 'Could not get valid Google access token' }
  }

  // Build task
  const label = CATEGORY_LABELS[classification.action_type] || 'ACTION'
  const senderName = extractSenderName(sender)
  const emailLink = `https://mail.google.com/mail/u/0/#inbox/${messageId}`

  const task: GoogleTask = {
    title: `[${label}] ${classification.suggested_title}`,
    notes: `From: ${sender}\nSubject: ${subject}\n\nOpen email: ${emailLink}`,
    status: 'needsAction',
  }

  if (classification.due_date) {
    task.due = new Date(classification.due_date).toISOString()
  }

  // Create task via Google Tasks API
  try {
    const response = await fetch(
      `${TASKS_API_BASE}/lists/${user.task_list_id}/tasks`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(task),
      }
    )

    if (!response.ok) {
      const errText = await response.text()
      console.error('[tasks:create] Google Tasks API error:', response.status, errText)
      return { success: false, error: 'Failed to create Google Task', details: errText }
    }

    const createdTask = await response.json()
    console.log(`[tasks:create] Created task: ${createdTask.id} — ${task.title}`)

    return {
      success: true,
      data: { taskId: createdTask.id, title: task.title },
    }
  } catch (err) {
    console.error('[tasks:create] Error:', err)
    return { success: false, error: 'Failed to create Google Task', details: err.message }
  }
}

// Dismiss: update status in DB, optionally delete Google Task
async function dismissTask(
  supabase: SupabaseClient,
  request: TasksRequest
): Promise<TasksResponse> {
  const processedId = request.data?.processedId as string
  const userId = request.userId
  if (!processedId || !userId) {
    return { success: false, error: 'Missing processedId or userId' }
  }

  // Get the processed record
  const { data: record } = await supabase
    .from('tasks_processed')
    .select('google_task_id')
    .eq('id', processedId)
    .eq('user_id', userId)
    .single()

  // Delete Google Task if it was created
  if (record?.google_task_id) {
    const { data: user } = await supabase
      .from('tasks_users')
      .select('task_list_id')
      .eq('id', userId)
      .single()

    const accessToken = await getValidAccessToken(supabase, userId)
    if (accessToken && user?.task_list_id) {
      await fetch(
        `${TASKS_API_BASE}/lists/${user.task_list_id}/tasks/${record.google_task_id}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      )
    }
  }

  // Update status
  await supabase
    .from('tasks_processed')
    .update({ status: 'dismissed' })
    .eq('id', processedId)
    .eq('user_id', userId)

  return { success: true }
}

// Confirm: mark as confirmed (task stays in Google Tasks)
async function confirmTask(
  supabase: SupabaseClient,
  request: TasksRequest
): Promise<TasksResponse> {
  const processedId = request.data?.processedId as string
  const userId = request.userId
  if (!processedId || !userId) {
    return { success: false, error: 'Missing processedId or userId' }
  }

  await supabase
    .from('tasks_processed')
    .update({ status: 'confirmed' })
    .eq('id', processedId)
    .eq('user_id', userId)

  return { success: true }
}

// Extract display name from "Name <email>" format
function extractSenderName(from: string): string {
  const match = from.match(/^([^<]+)\s*</)
  return match ? match[1].trim().replace(/"/g, '') : from.split('@')[0]
}
