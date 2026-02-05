// Sync State Manager for Notion Bidirectional Sync
// Epic 1.1: State Tracking Layer

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export interface SyncState {
  page_path: string
  notion_page_id: string | null
  github_hash: string | null
  notion_last_edited: string | null
  last_synced_at: string | null
  sync_direction: 'bidirectional' | 'github-only' | 'notion-only'
  block_count: number
  source: 'ai' | 'human'
}

export class SyncStateManager {
  private supabase: SupabaseClient

  constructor(supabaseUrl: string, supabaseKey: string) {
    this.supabase = createClient(supabaseUrl, supabaseKey)
  }

  // Compute SHA-256 hash of content (Web Crypto API)
  async computeHash(content: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(content)
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  }

  // Get sync state for a page
  async getState(pagePath: string): Promise<SyncState | null> {
    const { data, error } = await this.supabase
      .from('sync_state')
      .select('*')
      .eq('page_path', pagePath)
      .single()

    if (error || !data) return null
    return data as SyncState
  }

  // Get all sync states
  async getAllStates(): Promise<SyncState[]> {
    const { data, error } = await this.supabase
      .from('sync_state')
      .select('*')

    if (error || !data) return []
    return data as SyncState[]
  }

  // Update or create sync state
  async upsertState(state: Partial<SyncState> & { page_path: string }): Promise<void> {
    const { error } = await this.supabase
      .from('sync_state')
      .upsert({
        ...state,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'page_path'
      })

    if (error) {
      console.error('Failed to update sync state:', error)
    }
  }

  // Check if content has changed (compare hash)
  async hasContentChanged(pagePath: string, currentContent: string): Promise<boolean> {
    const state = await this.getState(pagePath)
    if (!state || !state.github_hash) return true

    const currentHash = await this.computeHash(currentContent)
    return currentHash !== state.github_hash
  }

  // Log a sync operation
  async logSync(
    operation: 'structure' | 'content' | 'conflict' | 'cleanup',
    pagePath: string | null,
    direction: 'github_to_notion' | 'notion_to_github' | 'structure_only',
    status: 'success' | 'failed' | 'skipped' | 'conflict',
    blocksChanged: number = 0,
    details: Record<string, any> = {}
  ): Promise<void> {
    const { error } = await this.supabase
      .from('sync_log')
      .insert({
        operation,
        page_path: pagePath,
        direction,
        status,
        blocks_changed: blocksChanged,
        details
      })

    if (error) {
      console.error('Failed to log sync:', error)
    }
  }

  // Get structure hash
  async getStructureHash(): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('structure_state')
      .select('structure_hash')
      .eq('id', 1)
      .single()

    if (error || !data) return null
    return data.structure_hash
  }

  // Update structure hash
  async updateStructureHash(hash: string, pageCount: number): Promise<void> {
    const { error } = await this.supabase
      .from('structure_state')
      .upsert({
        id: 1,
        structure_hash: hash,
        last_synced_at: new Date().toISOString(),
        page_count: pageCount,
        updated_at: new Date().toISOString()
      })

    if (error) {
      console.error('Failed to update structure hash:', error)
    }
  }

  // Get pages that need syncing (changed since last sync)
  async getDirtyPages(currentHashes: Map<string, string>): Promise<string[]> {
    const states = await this.getAllStates()
    const dirtyPages: string[] = []

    for (const state of states) {
      const currentHash = currentHashes.get(state.page_path)

      // Page is dirty if:
      // 1. We have new content and hash is different
      // 2. Never synced before
      // 3. Notion was edited since last sync
      if (!state.last_synced_at) {
        dirtyPages.push(state.page_path)
      } else if (currentHash && currentHash !== state.github_hash) {
        dirtyPages.push(state.page_path)
      } else if (state.notion_last_edited && state.last_synced_at &&
                 new Date(state.notion_last_edited) > new Date(state.last_synced_at)) {
        dirtyPages.push(state.page_path)
      }
    }

    return dirtyPages
  }
}
