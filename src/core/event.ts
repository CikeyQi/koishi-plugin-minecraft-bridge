import type { QueQiaoEvent } from '@cikeyqi/queqiao-node-sdk'
import type { BridgeConfig } from '../values'
import type { I18nTranslate } from './types'
import { plainRaw, textOf } from './utils'

const achievementTitle = (eventData: Extract<QueQiaoEvent, { sub_type: 'player_achievement' }>) => {
  const displayTitle = eventData.achievement.display?.title
  const displayText = typeof displayTitle === 'string'
    ? displayTitle
    : (displayTitle?.text || displayTitle?.key)

  return textOf(eventData.achievement.translate?.text)
    || textOf(eventData.achievement.text)
    || textOf(displayText)
}

export const toEvent = (
  eventData: QueQiaoEvent,
  config: BridgeConfig,
  translate?: I18nTranslate,
): string | null => {
  const t = (key: string, fallback: string, params: readonly unknown[] = []) =>
    translate ? translate(key, fallback, params) : fallback

  const playerName = textOf(eventData.player.nickname) || t('common.unknownPlayer', '未知玩家')
  const sayWord = textOf(config.verb) || '说：'

  let body = ''

  if (eventData.sub_type === 'player_join') {
    body = t('event.playerJoin', `${playerName} 加入了游戏`, [playerName])
  } else if (eventData.sub_type === 'player_quit') {
    body = t('event.playerQuit', `${playerName} 退出了游戏`, [playerName])
  } else if (eventData.sub_type === 'player_death') {
    body = textOf(eventData.death.text)
      || t('event.playerDeathFallback', `${playerName} 死亡了`, [playerName])
  } else if (eventData.sub_type === 'player_command') {
    const commandText = textOf(eventData.command)
    body = t('event.playerCommand', `${playerName} 使用命令 ${commandText}`.trim(), [playerName, commandText])
  } else if (eventData.sub_type === 'player_achievement') {
    const title = achievementTitle(eventData)
    if (!title) return null

    if (textOf(eventData.achievement.translate?.text) || textOf(eventData.achievement.text)) {
      body = title
    } else {
      body = t('event.playerAchievement', `${playerName} 达成了进度 ${title}`, [playerName, title])
    }
  } else if (eventData.sub_type === 'player_chat') {
    const content = textOf(eventData.message) || textOf(plainRaw(eventData.raw_message))
    if (!content) return null
    body = t('event.playerChat', `${playerName} ${sayWord} ${content}`.trim(), [playerName, sayWord, content])
  }

  if (!body) return null
  if (!config.serverName) return body

  const serverName = textOf(eventData.server_name) || t('common.unknownServer', '未知服务器')
  return t('event.serverPrefix', `[${serverName}] ${body}`, [serverName, body])
}
