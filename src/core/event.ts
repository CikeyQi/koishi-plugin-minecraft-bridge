import type { BridgeConfig } from '../values'
import type { I18nTranslate, JsonRecord } from './types'
import { isRecord, plainRaw, textOf } from './utils'

/**
 * 将 QueQiao 事件转换成群可读文本。
 * 输出为 null 表示该事件不需要同步到群里。
 */
export const toEvent = (
  eventData: JsonRecord,
  config: BridgeConfig,
  translate?: I18nTranslate,
): string | null => {
  const t = (key: string, fallback: string, params: readonly unknown[] = []) =>
    translate ? translate(key, fallback, params) : fallback

  const postType = textOf(eventData.post_type)
  if (postType && postType !== 'message' && postType !== 'notice') return null

  const player = isRecord(eventData.player) ? eventData.player : {}
  const playerName = textOf(player.nickname) || t('common.unknownPlayer', '未知玩家')
  const sayWord = textOf(config.verb) || '说：'
  const subType = textOf(eventData.sub_type)

  let body = ''

  if (subType === 'player_join') {
    body = t('event.playerJoin', `${playerName} 加入了游戏`, [playerName])
  } else if (subType === 'player_quit') {
    body = t('event.playerQuit', `${playerName} 退出了游戏`, [playerName])
  } else if (subType === 'player_death') {
    const death = isRecord(eventData.death) ? eventData.death : {}
    body = textOf(death.text)
      || textOf(isRecord(death.translate) ? death.translate.text : '')
      || t('event.playerDeathFallback', `${playerName} 死亡了`, [playerName])
  } else if (subType === 'player_command') {
    const commandText = textOf(eventData.command)
    body = t('event.playerCommand', `${playerName} 使用命令 ${commandText}`.trim(), [playerName, commandText])
  } else if (subType === 'player_achievement') {
    const achievement = isRecord(eventData.achievement) ? eventData.achievement : {}
    const display = isRecord(achievement.display) ? achievement.display : {}
    const displayTitle = isRecord(display.title) ? display.title : {}

    const title = textOf(isRecord(achievement.translate) ? achievement.translate.text : '')
      || textOf(achievement.text)
      || textOf(displayTitle.text)
      || textOf(isRecord(displayTitle.translate) ? displayTitle.translate.text : '')
      || textOf(display.title)

    if (!title) return null

    if (textOf(isRecord(achievement.translate) ? achievement.translate.text : '') || textOf(achievement.text)) {
      body = title
    } else {
      body = t('event.playerAchievement', `${playerName} 达成了进度 ${title}`, [playerName, title])
    }
  } else if (subType === 'player_chat') {
    const content = textOf(eventData.message) || textOf(plainRaw(eventData.raw_message))
    if (!content) return null
    body = t('event.playerChat', `${playerName} ${sayWord} ${content}`.trim(), [playerName, sayWord, content])
  }

  if (!body) return null
  if (!config.serverName) return body

  const serverName = textOf(eventData.server_name) || t('common.unknownServer', '未知服务器')
  return t('event.serverPrefix', `[${serverName}] ${body}`, [serverName, body])
}

export const formatEvent = toEvent
