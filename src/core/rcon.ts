import type { I18nTranslate } from './types'
import { isRecord, parseJson, toJson } from './utils'

/**
 * 归一化 RCON 返回内容。
 * 无论返回是字符串、对象还是空值，都尽量整理成用户可直接阅读的一句话。
 */
export const toRcon = (rawReply: unknown, translate?: I18nTranslate): string => {
  const t = (key: string, fallback: string, params: readonly unknown[] = []) =>
    translate ? translate(key, fallback, params) : fallback

  if (rawReply === null || rawReply === undefined || rawReply === '') {
    return t('message.rconSuccess', '命令执行成功')
  }

  if (typeof rawReply === 'string') {
    const parsed = parseJson(rawReply)
    return parsed ? toRcon(parsed, translate) : rawReply
  }

  if (!isRecord(rawReply)) return String(rawReply)

  if (rawReply.data !== null && rawReply.data !== undefined && rawReply.data !== '') {
    return typeof rawReply.data === 'string' ? rawReply.data : toJson(rawReply.data)
  }

  const status = String(rawReply.status || '').trim().toUpperCase()
  const message = String(rawReply.message || '').trim()
  if (status && status !== 'SUCCESS') {
    return message || t('message.rconFailed', `命令执行失败 (${status})`, [status])
  }

  return message || t('message.rconSuccess', '命令执行成功')
}

export const formatRconResult = toRcon
