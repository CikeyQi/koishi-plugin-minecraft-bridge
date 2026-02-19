import type { Logger } from 'koishi'

export type LogScope = 'system' | 'network' | 'event' | 'sync' | 'command'

const prefix = (scope: LogScope, message: string) => `[Minecraft Bridge] [${scope}] ${message}`

/**
 * 生成带作用域前缀的日志方法集合。
 * 这样日志在控制台里更容易按 system/network/event 分类查看。
 */
export const makeLog = (logger: Logger) => ({
  info: (scope: LogScope, message: string) => logger.info(prefix(scope, message)),
  warn: (scope: LogScope, message: string) => logger.warn(prefix(scope, message)),
  error: (scope: LogScope, message: string) => logger.error(prefix(scope, message)),
  debug: (enabled: boolean, scope: LogScope, message: string) => {
    if (enabled) logger.debug(prefix(scope, message))
  },
})

export const scopedLog = makeLog
