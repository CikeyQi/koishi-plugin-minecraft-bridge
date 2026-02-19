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

/**
 * 判断当前会话是否管理员。
 * 这里同时兼容 user / author / session 三处权限字段。
 */
export const isAdmin = (session: SessionLike) => {
  const level = Number(session?.user?.authority ?? session?.author?.authority ?? session?.authority ?? 0)
  return level >= 4
}

/**
 * 判断是否群聊会话。
 * 私聊和机器人私信场景会被过滤，避免把私聊误同步到 MC。
 */
export const isGroup = (session: SessionLike) => {
  if (!session?.channelId) return false
  if (session.subtype === 'private') return false
  if (!session.guildId && String(session.channelId) === String(session.userId)) return false
  return true
}

/**
 * 判断消息是否来自机器人自己。
 * 用于阻止“机器人发出 -> 又被插件回读”的循环同步。
 */
export const isBot = (session: SessionLike, bots: BotLike[]) => {
  const userId = textOf(session.userId)
  if (!userId) return false

  const platform = textOf(session.platform)
  return bots.some((bot) => {
    if (textOf(bot.selfId) !== userId) return false
    return !platform || !textOf(bot.platform) || textOf(bot.platform) === platform
  })
}

/**
 * 取群名展示文本。
 * 优先读取平台提供的群名，没有时回退到频道名或频道号。
 */
export const grp = (session: SessionLike, t: TextFn) => (
  textOf(session?.event?.group_name)
  || textOf(session?.guildName)
  || textOf(session?.event?.guild?.name)
  || textOf(session?.channelName)
  || textOf(session?.channelId)
  || t('common.unknownGroup', '未知群组')
)

/**
 * 取昵称展示文本。
 * 优先使用群昵称，其次使用用户名，最后回退到用户 ID。
 */
export const nick = (session: SessionLike, t: TextFn) => (
  textOf(session?.author?.nick)
  || textOf(session?.author?.name)
  || textOf(session?.username)
  || textOf(session?.userId)
  || t('common.unknownUser', '未知用户')
)

/**
 * 将群消息组装成 MC 可读的组件数组。
 * 这个函数只负责内容整形，不负责发送，方便单元测试与复用。
 */
export const toMc = (session: SessionLike, cfg: BridgeConfig, t: TextFn): Array<Record<string, unknown>> => {
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
      if (cfg.ciImage && url) {
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
