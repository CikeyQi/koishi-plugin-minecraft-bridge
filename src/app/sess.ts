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

/** 判断会话是否管理员。 */
export const isAdmin = (session: SessionLike) => {
  const level = Number(session?.user?.authority ?? session?.authority ?? 0)
  return level >= 4
}

/** 判断会话是否群聊。 */
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

/** 获取群组展示名。 */
const groupName = (session: SessionLike, t: TextFn) => (
  textOf(session?.event?.group_name)
  || textOf(session?.guildName)
  || textOf(session?.event?.guild?.name)
  || textOf(session?.channelName)
  || textOf(session?.channelId)
  || t('common.unknownGroup', '未知群组')
)

/** 获取用户展示名。 */
const userName = (session: SessionLike, t: TextFn) => (
  textOf(session?.author?.nick)
  || textOf(session?.author?.name)
  || textOf(session?.username)
  || textOf(session?.userId)
  || t('common.unknownUser', '未知用户')
)

/** 将群消息转换为 MC 可读组件。 */
export const toMcMessage = (
  session: SessionLike,
  config: BridgeConfig,
  ciImage: boolean,
  t: TextFn,
): Array<Record<string, unknown>> => {
  const messageList: Array<Record<string, unknown>> = []

  if (config.groupName) {
    messageList.push({ text: `[${groupName(session, t)}] `, color: 'aqua' })
  }

  const verbText = textOf(config.verb) || '说：'
  messageList.push(
    { text: userName(session, t), color: 'green' },
    { text: ` ${verbText} `, color: 'white' },
  )

  const elementList = Array.isArray(session?.elements) && session.elements.length
    ? session.elements
    : h.parse(String(session?.content || ''))

  for (const element of elementList as Array<{ type: string, attrs?: JsonRecord }>) {
    if (element.type === 'text') {
      messageList.push({
        text: String(element.attrs?.content || '').replace(/\r/g, '').replace(/\n/g, '\n * '),
        color: 'white',
      })
      continue
    }

    if (element.type === 'img') {
      const imageUrl = textOf(element.attrs?.src)
      const imageTag = t('message.imageTag', '图片')

      if (ciImage && imageUrl) {
        messageList.push({ text: `[[CICode,url=${imageUrl},name=${imageTag}]]` })
      } else if (imageUrl) {
        messageList.push({
          text: `[${imageTag}]`,
          color: 'light_purple',
          hoverEvent: {
            action: 'show_text',
            value: { text: t('message.imageHover', '点击跳转到浏览器查看'), color: 'light_purple' },
          },
          clickEvent: { action: 'open_url', value: imageUrl },
        })
      } else {
        messageList.push({ text: `[${imageTag}]`, color: 'light_purple' })
      }
      continue
    }

    if (element.type === 'at') {
      const atName = textOf(element.attrs?.name) || textOf(element.attrs?.id) || t('common.unknownUser', '未知用户')
      messageList.push({ text: `@[${atName}]`, color: 'white' })
      continue
    }

    messageList.push({ text: `[${element.type}]`, color: 'white' })
  }

  return messageList
}

export const toMc = toMcMessage
