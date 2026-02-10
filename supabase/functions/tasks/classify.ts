import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { TasksRequest, TasksResponse, ClassificationResult, EmailMetadata } from './types.ts'

const CLASSIFICATION_PROMPT = `You are an email triage assistant. Analyze the following email and determine if it requires the recipient to take action.

Return your classification as a JSON object using the classify_email tool.

Action types:
- pay_purchase: Bills, invoices, payment requests, subscription renewals
- schedule_rsvp: Meeting requests, event invites, availability requests, doodle polls
- confirm_approve: Order confirmations needing response, document approvals, sign-off requests
- reply_required: Someone is asking a direct question or reaching out personally
- review_read: Shared documents for review, reports to read, feedback requests
- action_required: Password resets, account verifications, form submissions, other actions

Rules:
- Return is_actionable: false for newsletters, marketing, social notifications, automated alerts, FYI-only messages, shipping tracking updates, and informational digests
- Only return is_actionable: true if the recipient specifically needs to DO something
- suggested_title should be a concise imperative phrase (e.g., "Pay electric bill by Feb 15", "Reply to Sarah about project timeline")
- due_date should be extracted if a deadline is mentioned, otherwise null
- confidence should reflect how certain you are (0.0 to 1.0)

Email to classify:
From: {from}
Subject: {subject}
Date: {date}
Body preview:
{body}`

export async function handleClassify(
  supabase: SupabaseClient,
  request: TasksRequest
): Promise<TasksResponse> {
  if (request.action !== 'classify:email') {
    return { success: false, error: `Unknown classify action: ${request.action}` }
  }

  const email = request.data as unknown as EmailMetadata
  if (!email?.messageId || !email?.from || !email?.subject) {
    return { success: false, error: 'Missing email metadata (messageId, from, subject required)' }
  }

  const result = await classifyEmail(email)
  if (!result) {
    return { success: false, error: 'Classification failed' }
  }

  return { success: true, data: result }
}

export async function classifyEmail(
  email: EmailMetadata
): Promise<ClassificationResult | null> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    console.error('[tasks:classify] ANTHROPIC_API_KEY not configured')
    return null
  }

  const prompt = CLASSIFICATION_PROMPT
    .replace('{from}', email.from)
    .replace('{subject}', email.subject)
    .replace('{date}', email.date)
    .replace('{body}', email.bodyPreview.slice(0, 2000))

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 256,
        tools: [
          {
            name: 'classify_email',
            description: 'Classify an email for actionability and extract task metadata',
            input_schema: {
              type: 'object',
              properties: {
                is_actionable: {
                  type: 'boolean',
                  description: 'Whether the email requires the recipient to take action',
                },
                action_type: {
                  type: 'string',
                  enum: [
                    'pay_purchase',
                    'schedule_rsvp',
                    'confirm_approve',
                    'reply_required',
                    'review_read',
                    'action_required',
                  ],
                  description: 'The category of action required',
                },
                urgency: {
                  type: 'string',
                  enum: ['high', 'medium', 'low'],
                  description: 'How urgent the action is',
                },
                suggested_title: {
                  type: 'string',
                  description:
                    'Concise imperative task title, max 120 chars (e.g., "Pay electric bill by Feb 15")',
                },
                due_date: {
                  type: 'string',
                  description: 'ISO date if a deadline is mentioned, or null',
                  nullable: true,
                },
                confidence: {
                  type: 'number',
                  description: 'Confidence score from 0.0 to 1.0',
                },
                reasoning: {
                  type: 'string',
                  description: 'Brief explanation of the classification decision',
                },
              },
              required: [
                'is_actionable',
                'action_type',
                'urgency',
                'suggested_title',
                'confidence',
                'reasoning',
              ],
            },
          },
        ],
        tool_choice: { type: 'tool', name: 'classify_email' },
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error('[tasks:classify] Claude API error:', response.status, errText)
      return null
    }

    const aiResponse = await response.json()

    // Extract tool use result
    const toolUse = aiResponse.content?.find(
      (block: { type: string }) => block.type === 'tool_use'
    )

    if (!toolUse?.input) {
      console.error('[tasks:classify] No tool_use in response')
      return null
    }

    const result = toolUse.input as ClassificationResult
    console.log(
      `[tasks:classify] ${email.subject} → actionable=${result.is_actionable}, type=${result.action_type}, confidence=${result.confidence}`
    )

    return result
  } catch (err) {
    console.error('[tasks:classify] Error:', err)
    return null
  }
}
