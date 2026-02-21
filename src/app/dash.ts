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
 * 转换失败时返回 null。
 */
export const buildDashExec = (input: string): string | null => {
  const text = textOf(input)

  const statusMatch = text.match(/^-q(?:\s+-s\s+(\S+))?$/i)
  if (statusMatch) return `${DASH.status}${serverPart(statusMatch[1])}`

  const reconnectMatch = text.match(/^-r(?:\s+-s\s+(\S+))?$/i)
  if (reconnectMatch) return `${DASH.reconnect}${serverPart(reconnectMatch[1])}`

  const privateMatch = text.match(/^-p\s+(\S+)\s+([\s\S]+)$/i)
  if (privateMatch) {
    const { body, serverName } = splitServer(privateMatch[2])
    if (!body) return null
    return `${DASH.private} ${textOf(privateMatch[1])} ${body}${serverPart(serverName)}`
  }

  const actionMatch = text.match(/^-([btuac])\s+([\s\S]+)$/i)
  if (!actionMatch) return null

  const action = actionMatch[1].toLowerCase()
  const { body, serverName } = splitServer(actionMatch[2])
  if (!body) return null

  if (action === 'b') return `${DASH.broadcast} ${body}${serverPart(serverName)}`
  if (action === 't') return `${DASH.title} ${body}${serverPart(serverName)}`
  if (action === 'u') return `${DASH.subtitle} ${body}${serverPart(serverName)}`
  if (action === 'a') return `${DASH.actionbar} ${body}${serverPart(serverName)}`
  if (action === 'c') return `${DASH.rcon} ${body}${serverPart(serverName)}`
  return null
}
