import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { TasksRequest, TasksResponse, EmailMetadata, ProcessedStatus } from './types.ts'
import { getValidAccessToken } from './auth.ts'
import { prefilterEmail, getSenderOverrides } from './prefilter.ts'
import { classifyEmail } from './classify.ts'

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me'

export async function handleWebhook(
  supabase: SupabaseClient,
  request: TasksRequest
): Promise<TasksResponse> {
  switch (request.action) {
    case 'webhook:receive':
      return receiveWebhook(supabase, request)
    case 'watch:renew':
      return renewWatches(supabase)
    default:
      return { success: false, error: `Unknown webhook action: ${request.action}` }
  }
}

// Receive Pub/Sub push notification from Gmail
async function receiveWebhook(
  supabase: SupabaseClient,
  request: TasksRequest
): Promise<TasksResponse> {
  // Pub/Sub delivers base64-encoded data with emailAddress and historyId
  const message = request.data?.message as { data?: string }
  if (!message?.data) {
    return { success: false, error: 'Missing Pub/Sub message data' }
  }

  const decoded = JSON.parse(atob(message.data))
  const emailAddress = decoded.emailAddress as string
  const historyId = decoded.historyId as string

  if (!emailAddress || !historyId) {
    return { success: false, error: 'Invalid Pub/Sub payload' }
  }

  console.log(`[tasks:webhook] Notification for ${emailAddress}, historyId=${historyId}`)

  // Find user by email
  const { data: user } = await supabase
    .from('tasks_users')
    .select('id, task_list_id, settings')
    .eq('email', emailAddress)
    .single()

  if (!user) {
    console.log(`[tasks:webhook] No user found for ${emailAddress}`)
    return { success: true, data: { skipped: true, reason: 'User not found' } }
  }

  // Get stored history ID
  const { data: watch } = await supabase
    .from('tasks_watches')
    .select('history_id')
    .eq('user_id', user.id)
    .single()

  const startHistoryId = watch?.history_id || historyId

  // Get valid access token
  const accessToken = await getValidAccessToken(supabase, user.id)
  if (!accessToken) {
    return { success: false, error: 'No valid access token' }
  }

  // Fetch new messages since last history ID
  const emails = await fetchNewMessages(accessToken, startHistoryId)
  console.log(`[tasks:webhook] Found ${emails.length} new messages for ${emailAddress}`)

  // Update stored history ID
  await supabase
    .from('tasks_watches')
    .upsert({
      user_id: user.id,
      history_id: historyId,
      watch_expiration: watch?.watch_expiration || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })

  // Process each email
  const results = []
  const settings = user.settings || {}
  const threshold = settings.auto_create_threshold ?? 0.7

  for (const email of emails) {
    const result = await processEmail(supabase, user.id, user.task_list_id, email, threshold)
    results.push(result)
  }

  return {
    success: true,
    data: {
      processed: results.length,
      results,
    },
  }
}

// Process a single email through the full pipeline
async function processEmail(
  supabase: SupabaseClient,
  userId: string,
  taskListId: string | null,
  email: EmailMetadata,
  threshold: number
): Promise<{ messageId: string; status: string; reason?: string }> {
  // Pre-filter
  const filter = await prefilterEmail(supabase, userId, email)
  if (filter.skip) {
    console.log(`[tasks:webhook] Skipped: ${email.subject} — ${filter.reason}`)
    return { messageId: email.messageId, status: 'skipped', reason: filter.reason }
  }

  // Classify with LLM
  const classification = await classifyEmail(email)
  if (!classification) {
    return { messageId: email.messageId, status: 'error', reason: 'Classification failed' }
  }

  // Apply sender overrides
  const overrides = await getSenderOverrides(supabase, userId, email.from)
  if (overrides?.urgency) {
    classification.urgency = overrides.urgency as 'high' | 'medium' | 'low'
  }

  // Determine status based on confidence
  let status: ProcessedStatus = 'skipped'
  let googleTaskId: string | null = null

  if (classification.is_actionable) {
    if (classification.confidence >= threshold) {
      status = 'auto_created'

      // Create Google Task
      if (taskListId) {
        const accessToken = await getValidAccessToken(supabase, userId)
        if (accessToken) {
          const taskResult = await createGoogleTask(
            accessToken,
            taskListId,
            classification,
            email
          )
          googleTaskId = taskResult
        }
      }
    } else {
      status = 'review'
    }
  }

  // Save to processed log
  await supabase.from('tasks_processed').insert({
    user_id: userId,
    gmail_message_id: email.messageId,
    gmail_thread_id: email.threadId,
    sender: email.from,
    subject: email.subject,
    action_type: classification.action_type,
    urgency: classification.urgency,
    confidence: classification.confidence,
    suggested_title: classification.suggested_title,
    due_date: classification.due_date || null,
    google_task_id: googleTaskId,
    status,
    reasoning: classification.reasoning,
  })

  console.log(
    `[tasks:webhook] Processed: ${email.subject} → ${status} (${classification.action_type}, confidence=${classification.confidence})`
  )

  return { messageId: email.messageId, status }
}

// Fetch new messages from Gmail history
async function fetchNewMessages(
  accessToken: string,
  startHistoryId: string
): Promise<EmailMetadata[]> {
  try {
    const historyResponse = await fetch(
      `${GMAIL_API_BASE}/history?startHistoryId=${startHistoryId}&historyTypes=messageAdded`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )

    if (!historyResponse.ok) {
      console.error('[tasks:webhook] History fetch failed:', historyResponse.status)
      return []
    }

    const history = await historyResponse.json()
    const messageIds = new Set<string>()

    for (const record of history.history || []) {
      for (const added of record.messagesAdded || []) {
        messageIds.add(added.message.id)
      }
    }

    // Fetch full metadata for each message
    const emails: EmailMetadata[] = []
    for (const messageId of messageIds) {
      const email = await fetchEmailMetadata(accessToken, messageId)
      if (email) emails.push(email)
    }

    return emails
  } catch (err) {
    console.error('[tasks:webhook] Error fetching history:', err)
    return []
  }
}

// Fetch email metadata from Gmail API
async function fetchEmailMetadata(
  accessToken: string,
  messageId: string
): Promise<EmailMetadata | null> {
  try {
    const response = await fetch(
      `${GMAIL_API_BASE}/messages/${messageId}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )

    if (!response.ok) return null
    const msg = await response.json()

    const headers = msg.payload?.headers || []
    const getHeader = (name: string) =>
      headers.find((h: { name: string }) => h.name.toLowerCase() === name.toLowerCase())?.value || ''

    // Get body preview (snippet from Gmail API)
    const bodyPreview = msg.snippet || ''

    return {
      messageId: msg.id,
      threadId: msg.threadId,
      from: getHeader('From'),
      subject: getHeader('Subject'),
      bodyPreview,
      date: getHeader('Date'),
      labelIds: msg.labelIds || [],
    }
  } catch (err) {
    console.error(`[tasks:webhook] Error fetching message ${messageId}:`, err)
    return null
  }
}

// Create a Google Task directly (used by webhook pipeline)
async function createGoogleTask(
  accessToken: string,
  taskListId: string,
  classification: { action_type: string; suggested_title: string; due_date: string | null },
  email: EmailMetadata
): Promise<string | null> {
  const CATEGORY_LABELS: Record<string, string> = {
    pay_purchase: 'PAY',
    schedule_rsvp: 'SCHEDULE',
    confirm_approve: 'CONFIRM',
    reply_required: 'REPLY',
    review_read: 'REVIEW',
    action_required: 'ACTION',
  }

  const label = CATEGORY_LABELS[classification.action_type] || 'ACTION'
  const emailLink = `https://mail.google.com/mail/u/0/#inbox/${email.messageId}`

  const task: Record<string, unknown> = {
    title: `[${label}] ${classification.suggested_title}`,
    notes: `From: ${email.from}\nSubject: ${email.subject}\n\nOpen email: ${emailLink}`,
    status: 'needsAction',
  }

  if (classification.due_date) {
    task.due = new Date(classification.due_date).toISOString()
  }

  try {
    const response = await fetch(
      `https://tasks.googleapis.com/tasks/v1/lists/${taskListId}/tasks`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(task),
      }
    )

    if (!response.ok) return null
    const created = await response.json()
    return created.id || null
  } catch {
    return null
  }
}

// Renew Gmail watch for all users (called by cron)
async function renewWatches(supabase: SupabaseClient): Promise<TasksResponse> {
  const topicName = Deno.env.get('GOOGLE_PUBSUB_TOPIC')
  if (!topicName) {
    return { success: false, error: 'GOOGLE_PUBSUB_TOPIC not configured' }
  }

  // Find watches expiring in the next 24 hours
  const cutoff = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  const { data: expiringWatches } = await supabase
    .from('tasks_watches')
    .select('user_id')
    .lt('watch_expiration', cutoff)

  if (!expiringWatches || expiringWatches.length === 0) {
    return { success: true, data: { renewed: 0 } }
  }

  let renewed = 0
  for (const watch of expiringWatches) {
    const accessToken = await getValidAccessToken(supabase, watch.user_id)
    if (!accessToken) continue

    try {
      const response = await fetch(`${GMAIL_API_BASE}/watch`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          topicName,
          labelIds: ['INBOX'],
        }),
      })

      if (response.ok) {
        const result = await response.json()
        await supabase
          .from('tasks_watches')
          .update({
            history_id: result.historyId,
            watch_expiration: new Date(parseInt(result.expiration)).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', watch.user_id)
        renewed++
      }
    } catch (err) {
      console.error(`[tasks:watch] Failed to renew for user ${watch.user_id}:`, err)
    }
  }

  console.log(`[tasks:watch] Renewed ${renewed}/${expiringWatches.length} watches`)
  return { success: true, data: { renewed } }
}
