// Documentation Agent - Structured Logger
// Matches pattern from notion-sync/logger.ts

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogEntry {
  level: LogLevel
  message: string
  context?: string
  data?: Record<string, unknown>
  timestamp: string
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

class Logger {
  private context: string
  private minLevel: LogLevel
  private entries: LogEntry[] = []

  constructor(context: string, minLevel: LogLevel = 'info') {
    this.context = context
    this.minLevel = minLevel
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.minLevel]
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>) {
    const entry: LogEntry = {
      level,
      message,
      context: this.context,
      data,
      timestamp: new Date().toISOString(),
    }
    this.entries.push(entry)

    if (!this.shouldLog(level)) return

    const prefix = `[${this.context}]`
    const dataStr = data ? ` ${JSON.stringify(data)}` : ''

    switch (level) {
      case 'debug':
        console.log(`${prefix} ${message}${dataStr}`)
        break
      case 'info':
        console.log(`${prefix} ${message}${dataStr}`)
        break
      case 'warn':
        console.warn(`${prefix} ${message}${dataStr}`)
        break
      case 'error':
        console.error(`${prefix} ${message}${dataStr}`)
        break
    }
  }

  debug(message: string, data?: Record<string, unknown>) { this.log('debug', message, data) }
  info(message: string, data?: Record<string, unknown>) { this.log('info', message, data) }
  warn(message: string, data?: Record<string, unknown>) { this.log('warn', message, data) }
  error(message: string, data?: Record<string, unknown>) { this.log('error', message, data) }

  child(subContext: string): Logger {
    return new Logger(`${this.context}:${subContext}`, this.minLevel)
  }

  getEntries(): LogEntry[] {
    return [...this.entries]
  }

  getSummary(): { total: number; byLevel: Record<LogLevel, number> } {
    const byLevel: Record<LogLevel, number> = { debug: 0, info: 0, warn: 0, error: 0 }
    for (const entry of this.entries) {
      byLevel[entry.level]++
    }
    return { total: this.entries.length, byLevel }
  }
}

export function createLogger(context: string, minLevel?: LogLevel): Logger {
  return new Logger(context, minLevel)
}

export type { Logger, LogLevel, LogEntry }
