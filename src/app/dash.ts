import { textOf } from '../core/utils'
import { DASH } from './const'

const serverPart = (serverName: string) => {
  const name = textOf(serverName)
  return name ? ` --server ${name}` : ''
}

const splitServer = (input: string) => {
  const text = textOf(input)
  const match = text.match(/^(.*?)(?:\s+-s\s+(\S+))?$/i)
  return {
    body: textOf(match?.[1]),
    serverName: textOf(match?.[2]),
  }
}

/**
 * 读取 Dash 命令正文。
 * 例如 prefix=mc, content=mc -q 时返回 -q。
 */
export const dashBody = (prefix: string, content: string) => {
  const head = textOf(prefix)
  const text = textOf(content)
  if (!head || !text.startsWith(head)) return ''
  return textOf(text.slice(head.length))
}

/** 判断输入是否为 Dash 风格命令。 */
export const isDashMessage = (prefix: string, content: string) => {
  const body = dashBody(prefix, content)
  return body.startsWith('-')
}

/**
 * 将 Dash 风格命令转换为内部命令。
 * - matched: 已识别并转换成功
 * - invalid: 是已支持命令，但参数格式错误
 * - unknown: 不是本插件支持的 Dash 子命令，交由其他插件处理
 */
export type DashExecResult =
  | { kind: 'matched'; commandText: string }
  | { kind: 'invalid' }
  | { kind: 'unknown' }

export const buildDashExec = (input: string): DashExecResult => {
  const text = textOf(input)

  const statusMatch = text.match(/^-q(?:\s+-s\s+(\S+))?$/i)
  if (statusMatch) return { kind: 'matched', commandText: `${DASH.status}${serverPart(statusMatch[1])}` }
  if (/^-q(?:\s+|$)/i.test(text)) return { kind: 'invalid' }

  const reconnectMatch = text.match(/^-r(?:\s+-s\s+(\S+))?$/i)
  if (reconnectMatch) return { kind: 'matched', commandText: `${DASH.reconnect}${serverPart(reconnectMatch[1])}` }
  if (/^-r(?:\s+|$)/i.test(text)) return { kind: 'invalid' }

  const privateMatch = text.match(/^-p\s+(\S+)\s+([\s\S]+)$/i)
  if (privateMatch) {
    const { body, serverName } = splitServer(privateMatch[2])
    if (!body) return { kind: 'invalid' }
    return { kind: 'matched', commandText: `${DASH.private} ${textOf(privateMatch[1])} ${body}${serverPart(serverName)}` }
  }
  if (/^-p(?:\s+|$)/i.test(text)) return { kind: 'invalid' }

  const actionMatch = text.match(/^-([btuac])\s+([\s\S]+)$/i)
  if (!actionMatch) {
    if (/^-([btuac])(?:\s+|$)/i.test(text)) return { kind: 'invalid' }
    return { kind: 'unknown' }
  }

  const action = actionMatch[1].toLowerCase()
  const { body, serverName } = splitServer(actionMatch[2])
  if (!body) return { kind: 'invalid' }

  if (action === 'b') return { kind: 'matched', commandText: `${DASH.broadcast} ${body}${serverPart(serverName)}` }
  if (action === 't') return { kind: 'matched', commandText: `${DASH.title} ${body}${serverPart(serverName)}` }
  if (action === 'u') return { kind: 'matched', commandText: `${DASH.subtitle} ${body}${serverPart(serverName)}` }
  if (action === 'a') return { kind: 'matched', commandText: `${DASH.actionbar} ${body}${serverPart(serverName)}` }
  if (action === 'c') return { kind: 'matched', commandText: `${DASH.rcon} ${body}${serverPart(serverName)}` }
  return { kind: 'unknown' }
}
