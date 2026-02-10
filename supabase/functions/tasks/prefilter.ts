import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { EmailMetadata } from './types.ts'

// Gmail categories that are almost never actionable
const SKIP_CATEGORIES = [
  'CATEGORY_PROMOTIONS',
  'CATEGORY_SOCIAL',
  'CATEGORY_UPDATES',
  'CATEGORY_FORUMS',
]

// Common no-reply / automated sender patterns
const AUTOMATED_PATTERNS = [
  /^no-?reply@/i,
  /^noreply@/i,
  /^do-?not-?reply@/i,
  /^mailer-daemon@/i,
  /^postmaster@/i,
  /^notifications?@/i,
  /^alerts?@/i,
  /^bounce[s]?@/i,
]

// Default blocklisted domains (common newsletter/marketing senders)
const DEFAULT_DOMAIN_BLOCKLIST = [
  'linkedin.com',
  'facebookmail.com',
  'twitter.com',
  'x.com',
  'instagram.com',
  'medium.com',
  'substack.com',
  'mailchimp.com',
  'sendgrid.net',
  'constantcontact.com',
  'hubspot.com',
  'campaign-archive.com',
]

// Extract domain from email address
function extractDomain(email: string): string {
  const match = email.match(/<([^>]+)>/)
  const addr = match ? match[1] : email
  return addr.split('@')[1]?.toLowerCase() || ''
}

// Extract email address from "Display Name <email@domain.com>" format
function extractAddress(from: string): string {
  const match = from.match(/<([^>]+)>/)
  return (match ? match[1] : from).toLowerCase()
}

// Check if sender matches automated patterns
function isAutomatedSender(from: string): boolean {
  const address = extractAddress(from)
  return AUTOMATED_PATTERNS.some((pattern) => pattern.test(address))
}

/**
 * Pre-filter: determine if an email should be sent to LLM classification.
 * Returns { skip: true, reason } if email should be skipped.
 * Returns { skip: false } if email should be classified.
 */
export async function prefilterEmail(
  supabase: SupabaseClient,
  userId: string,
  email: EmailMetadata
): Promise<{ skip: boolean; reason?: string }> {
  // 1. Skip Gmail category-filtered emails
  if (email.labelIds.some((l) => SKIP_CATEGORIES.includes(l))) {
    return { skip: true, reason: `Gmail category: ${email.labelIds.join(', ')}` }
  }

  // 2. Skip automated/no-reply senders
  if (isAutomatedSender(email.from)) {
    return { skip: true, reason: `Automated sender: ${email.from}` }
  }

  // 3. Skip default blocklisted domains
  const domain = extractDomain(email.from)
  if (DEFAULT_DOMAIN_BLOCKLIST.includes(domain)) {
    return { skip: true, reason: `Blocklisted domain: ${domain}` }
  }

  // 4. Check user-defined block rules
  const { data: blockRules } = await supabase
    .from('tasks_rules')
    .select('rule_type, match_value')
    .eq('user_id', userId)
    .in('rule_type', ['sender_block', 'domain_block'])

  if (blockRules) {
    for (const rule of blockRules) {
      if (rule.rule_type === 'sender_block') {
        const address = extractAddress(email.from)
        if (address === rule.match_value.toLowerCase()) {
          return { skip: true, reason: `User rule: blocked sender ${rule.match_value}` }
        }
      }
      if (rule.rule_type === 'domain_block') {
        if (domain === rule.match_value.toLowerCase()) {
          return { skip: true, reason: `User rule: blocked domain ${rule.match_value}` }
        }
      }
    }
  }

  // 5. Check thread dedup — skip if thread already processed
  const { data: existing } = await supabase
    .from('tasks_processed')
    .select('id')
    .eq('user_id', userId)
    .eq('gmail_thread_id', email.threadId)
    .limit(1)

  if (existing && existing.length > 0) {
    return { skip: true, reason: `Thread already processed: ${email.threadId}` }
  }

  return { skip: false }
}

/**
 * Get user-defined priority overrides for a sender/domain.
 * Returns override config or null.
 */
export async function getSenderOverrides(
  supabase: SupabaseClient,
  userId: string,
  from: string
): Promise<Record<string, unknown> | null> {
  const address = extractAddress(from)
  const domain = extractDomain(from)

  const { data: rules } = await supabase
    .from('tasks_rules')
    .select('rule_type, match_value, action')
    .eq('user_id', userId)
    .in('rule_type', ['sender_priority', 'category_override'])

  if (!rules) return null

  // Check sender-specific rules first, then domain rules
  for (const rule of rules) {
    if (rule.match_value.toLowerCase() === address) {
      return rule.action as Record<string, unknown>
    }
    if (rule.match_value.toLowerCase() === domain) {
      return rule.action as Record<string, unknown>
    }
  }

  return null
}
