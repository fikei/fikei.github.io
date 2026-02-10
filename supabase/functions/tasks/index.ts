import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { TaskAction, TasksRequest, TasksResponse } from './types.ts'
import { handleAuth } from './auth.ts'
import { handleWebhook } from './webhook.ts'
import { handleClassify } from './classify.ts'
import { handleGoogleTasks } from './google-tasks.ts'
import { handleSettings } from './settings.ts'
import { handleHistory } from './history.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(data: TasksResponse, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, supabaseKey)

  try {
    const request: TasksRequest = await req.json()
    const { action } = request

    if (!action) {
      return json({ success: false, error: 'Missing action parameter' }, 400)
    }

    console.log(`[tasks] Action: ${action}`)

    // Route to handler based on action prefix
    const prefix = action.split(':')[0]

    switch (prefix) {
      case 'auth':
        return json(await handleAuth(supabase, request))

      case 'webhook':
        return json(await handleWebhook(supabase, request))

      case 'classify':
        return json(await handleClassify(supabase, request))

      case 'tasks':
        return json(await handleGoogleTasks(supabase, request))

      case 'settings':
      case 'rules':
        return json(await handleSettings(supabase, request))

      case 'history':
        return json(await handleHistory(supabase, request))

      case 'watch':
        return json(await handleWebhook(supabase, request))

      default:
        return json({
          success: false,
          error: `Unknown action: ${action}`,
          details: 'Valid prefixes: auth, webhook, classify, tasks, settings, rules, history, watch',
        }, 400)
    }
  } catch (error) {
    console.error('[tasks] Error:', error)
    return json(
      { success: false, error: 'Internal server error', details: error.message },
      500
    )
  }
})
