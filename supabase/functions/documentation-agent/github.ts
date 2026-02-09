// Documentation Agent - GitHub API Client
// Reads repository content, commits, and diffs via GitHub REST API

import { createLogger } from './logger.ts'
import type { GitHubFile, GitHubCommit } from './types.ts'

export class GitHubClient {
  private token: string
  private owner: string
  private repo: string
  private log = createLogger('github-api')
  apiCalls = 0

  constructor(token: string, repository: string) {
    this.token = token
    const [owner, repo] = repository.split('/')
    this.owner = owner
    this.repo = repo
  }

  private async request(endpoint: string, options: RequestInit = {}): Promise<unknown> {
    this.apiCalls++
    const url = `https://api.github.com${endpoint}`
    this.log.debug(`API call: ${options.method || 'GET'} ${endpoint}`)

    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...options.headers,
      },
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`GitHub API error: ${response.status} - ${error}`)
    }

    return response.json()
  }

  // ═══════════════════════════════════════════════════════════════
  // FILE OPERATIONS
  // ═══════════════════════════════════════════════════════════════

  async getFile(path: string, ref = 'master'): Promise<GitHubFile | null> {
    try {
      const data = await this.request(
        `/repos/${this.owner}/${this.repo}/contents/${path}?ref=${ref}`
      ) as { content: string; sha: string; path: string }

      // Decode base64 → binary string → UTF-8
      const binaryString = atob(data.content.replace(/\n/g, ''))
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }
      const content = new TextDecoder().decode(bytes)
      return { path: data.path, content, sha: data.sha }
    } catch (e) {
      if (String(e).includes('404')) return null
      throw e
    }
  }

  async getDirectory(path: string, ref = 'master'): Promise<string[]> {
    try {
      const data = await this.request(
        `/repos/${this.owner}/${this.repo}/contents/${path}?ref=${ref}`
      ) as Array<{ path: string; type: string }>

      return data
        .filter((item) => item.type === 'file')
        .map((item) => item.path)
    } catch {
      return []
    }
  }

  async getMultipleFiles(paths: string[], ref = 'master'): Promise<GitHubFile[]> {
    const files: GitHubFile[] = []
    for (const path of paths) {
      const file = await this.getFile(path, ref)
      if (file) files.push(file)
      // Rate limit protection
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return files
  }

  // ═══════════════════════════════════════════════════════════════
  // COMMIT OPERATIONS
  // ═══════════════════════════════════════════════════════════════

  async getCommits(options: {
    path?: string
    since?: string
    limit?: number
    branch?: string
  } = {}): Promise<GitHubCommit[]> {
    const params = new URLSearchParams()
    if (options.path) params.set('path', options.path)
    if (options.since) params.set('since', options.since)
    if (options.branch) params.set('sha', options.branch)
    params.set('per_page', String(options.limit || 50))

    const data = await this.request(
      `/repos/${this.owner}/${this.repo}/commits?${params}`
    ) as Array<{ sha: string; commit: { message: string; author: { date: string } }; files?: Array<{ filename: string }> }>

    return data.map((c) => ({
      sha: c.sha,
      message: c.commit.message,
      date: c.commit.author.date,
      files: c.files?.map((f) => f.filename) || [],
    }))
  }

  async getCommitFiles(sha: string): Promise<string[]> {
    const data = await this.request(
      `/repos/${this.owner}/${this.repo}/commits/${sha}`
    ) as { files: Array<{ filename: string }> }

    return data.files.map((f) => f.filename)
  }

  async getLastCommitDate(path: string, ref = 'master'): Promise<string | null> {
    try {
      const commits = await this.getCommits({ path, limit: 1, branch: ref })
      return commits[0]?.date || null
    } catch {
      return null
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // DIFF OPERATIONS
  // ═══════════════════════════════════════════════════════════════

  async compareBranches(base: string, head: string): Promise<{
    files: Array<{ filename: string; status: string; patch?: string }>
    totalCommits: number
  }> {
    const data = await this.request(
      `/repos/${this.owner}/${this.repo}/compare/${base}...${head}`
    ) as { files: Array<{ filename: string; status: string; patch?: string }>; total_commits: number }

    return {
      files: data.files,
      totalCommits: data.total_commits,
    }
  }

  async getDocFiles(ref = 'master'): Promise<string[]> {
    const docs = await this.getDirectory('docs', ref)
    const techDesign = await this.getDirectory('docs/infrastructure/technical-design', ref)
    const plans = await this.getDirectory('docs/execution/project-plan', ref)
    const ux = await this.getDirectory('docs/ux', ref)
    return [...docs, ...techDesign, ...plans, ...ux]
  }

  // ═══════════════════════════════════════════════════════════════
  // WRITE OPERATIONS (via GitHub API)
  // ═══════════════════════════════════════════════════════════════

  async updateFile(path: string, content: string, message: string, branch = 'master'): Promise<void> {
    // Get current file to get sha
    const existing = await this.getFile(path, branch)

    const body: Record<string, unknown> = {
      message,
      content: btoa(content),
      branch,
    }
    if (existing) {
      body.sha = existing.sha
    }

    await this.request(`/repos/${this.owner}/${this.repo}/contents/${path}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    })

    this.log.info(`Updated file: ${path}`, { branch })
  }

  async createFile(path: string, content: string, message: string, branch = 'master'): Promise<void> {
    await this.request(`/repos/${this.owner}/${this.repo}/contents/${path}`, {
      method: 'PUT',
      body: JSON.stringify({
        message,
        content: btoa(content),
        branch,
      }),
    })

    this.log.info(`Created file: ${path}`, { branch })
  }
}
