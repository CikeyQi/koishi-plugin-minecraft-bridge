import { h } from 'koishi'
import type { BridgeConfig } from '../values'
import type { JsonRecord, SessionLike } from '../core/types'
import { textOf } from '../core/utils'

export interface BotLike {
  selfId?: string
  platform?: string
  broadcast: (channels: string[], content: string, options?: number) => Promise<unknown>
}

type TextFn = (key: string, fallback: string, args?: readonly unknown[]) => string

/** 判断当前会话是否管理员。 */
export const isAdmin = (session: SessionLike) => {
  const level = Number(session?.user?.authority ?? session?.authority ?? 0)
  return level >= 4
}

/** 判断是否群聊会话。 */
export const isGroup = (session: SessionLike) => {
  if (!session?.channelId) return false
  if (session.subtype === 'private') return false
  if (!session.guildId && String(session.channelId) === String(session.userId)) return false
  return true
}

/** 判断消息是否来自机器人自己。 */
export const isBot = (session: SessionLike, bots: BotLike[]) => {
  const userId = textOf(session.userId)
  if (!userId) return false

  const platform = textOf(session.platform)
  return bots.some((bot) => {
    if (textOf(bot.selfId) !== userId) return false
    return !platform || !textOf(bot.platform) || textOf(bot.platform) === platform
  })
}

/** 取群名展示文本。 */
export const grp = (session: SessionLike, t: TextFn) => (
  textOf(session?.event?.group_name)
  || textOf(session?.guildName)
  || textOf(session?.event?.guild?.name)
  || textOf(session?.channelName)
  || textOf(session?.channelId)
  || t('common.unknownGroup', '未知群组')
)

/** 取昵称展示文本。 */
export const nick = (session: SessionLike, t: TextFn) => (
  textOf(session?.author?.nick)
  || textOf(session?.author?.name)
  || textOf(session?.username)
  || textOf(session?.userId)
  || t('common.unknownUser', '未知用户')
)

/** 将群消息组装成 MC 可读组件数组。 */
export const toMc = (
  session: SessionLike,
  cfg: BridgeConfig,
  ciImage: boolean,
  t: TextFn,
): Array<Record<string, unknown>> => {
  const nodes: Array<Record<string, unknown>> = []

  if (cfg.groupName) {
    nodes.push({ text: `[${grp(session, t)}] `, color: 'aqua' })
  }

  const verb = textOf(cfg.verb) || '说：'
  nodes.push(
    { text: nick(session, t), color: 'green' },
    { text: ` ${verb} `, color: 'white' },
  )

  const parts = Array.isArray(session?.elements) && session.elements.length
    ? session.elements
    : h.parse(String(session?.content || ''))

  for (const part of parts as Array<{ type: string, attrs?: JsonRecord }>) {
    if (part.type === 'text') {
      nodes.push({
        text: String(part.attrs?.content || '').replace(/\r/g, '').replace(/\n/g, '\n * '),
        color: 'white',
      })
      continue
    }

    if (part.type === 'img') {
      const url = textOf(part.attrs?.src)
      const tag = t('message.imageTag', '图片')
      if (ciImage && url) {
        nodes.push({ text: `[[CICode,url=${url},name=${tag}]]` })
      } else if (url) {
        nodes.push({
          text: `[${tag}]`,
          color: 'light_purple',
          hoverEvent: {
            action: 'show_text',
            value: { text: t('message.imageHover', '点击跳转到浏览器查看'), color: 'light_purple' },
          },
          clickEvent: { action: 'open_url', value: url },
        })
      } else {
        nodes.push({ text: `[${tag}]`, color: 'light_purple' })
      }
      continue
    }

    if (part.type === 'at') {
      const at = textOf(part.attrs?.name) || textOf(part.attrs?.id) || 'unknown'
      nodes.push({ text: `@[${at}]`, color: 'white' })
      continue
    }

    nodes.push({ text: `[${part.type}]`, color: 'white' })
  }

  return nodes
}
