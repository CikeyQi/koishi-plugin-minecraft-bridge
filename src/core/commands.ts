import type { GroupApiCommand, GroupRequestError } from './types'

/** 将命令前缀转义为安全正则字符串，避免特殊字符破坏匹配规则。 */
const escapeRegex = (raw: string) => raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 构建统一的命令参数错误对象，便于上层统一发提示文案。 */
const errorReply = (
  errorKey: string,
  errorFallback: string,
  errorParams?: readonly unknown[],
): GroupRequestError => ({ errorKey, errorFallback, ...(errorParams ? { errorParams } : {}) })

export interface BuiltinMatchers {
  status: RegExp
  reconnect: RegExp
  groupApiCommands: GroupApiCommand[]
}

/**
 * 生成内置命令匹配器。
 * 这里集中维护所有正则，方便后续统一扩展命令。
 */
export const buildCmd = (commandPrefix = '#'): BuiltinMatchers => {
  const prefixRaw = commandPrefix || '#'
  const prefix = escapeRegex(prefixRaw)

  return {
    status: new RegExp(`^${prefix}mcs$`, 'i'),
    reconnect: new RegExp(`^${prefix}mcr$`, 'i'),
    groupApiCommands: [
      {
        pattern: new RegExp(`^${prefix}mct\\s+(.+)$`, 'i'),
        actionName: '发送标题',
        build: (match) => {
          const text = match[1]?.trim()
          if (!text) return errorReply('message.groupApi.titleRequired', '请输入要发送的标题内容')
          return { api: 'send_title', data: { title: { text, color: 'white' } } }
        },
      },
      {
        pattern: new RegExp(`^${prefix}mcst\\s+(.+)$`, 'i'),
        actionName: '发送副标题',
        build: (match) => {
          const text = match[1]?.trim()
          if (!text) return errorReply('message.groupApi.subtitleRequired', '请输入要发送的副标题内容')
          return { api: 'send_title', data: { subtitle: { text, color: 'white' } } }
        },
      },
      {
        pattern: new RegExp(`^${prefix}mcab\\s+(.+)$`, 'i'),
        actionName: '发送动作栏',
        build: (match) => {
          const text = match[1]?.trim()
          if (!text) return errorReply('message.groupApi.actionbarRequired', '请输入要发送的动作栏内容')
          return { api: 'send_actionbar', data: { message: [{ text, color: 'white' }] } }
        },
      },
      {
        pattern: new RegExp(`^${prefix}mcp\\s+(\\S+)\\s+(.+)$`, 'i'),
        actionName: '发送私聊',
        build: (match) => {
          const nickname = match[1]?.trim()
          const text = match[2]?.trim()
          if (!nickname || !text) {
            return errorReply(
              'message.groupApi.privateFormat',
              `请输入正确的私聊格式: ${prefixRaw}mcp <玩家> <内容>`,
              [prefixRaw],
            )
          }
          return { api: 'send_private_msg', data: { nickname, message: [{ text, color: 'white' }] } }
        },
      },
    ],
  }
}

export const buildBuiltinMatchers = buildCmd
