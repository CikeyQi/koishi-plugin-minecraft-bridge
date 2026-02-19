import type { BridgeConfig, ServerConfig } from '../values'
import { isRecord, textOf, uniqTexts } from '../core/utils'

const DEF = {
  path: '/minecraft/ws',
  port: 8080,
  prefix: '#',
  verb: '说：',
  url: 'ws://127.0.0.1:8081',
  rcon: '/',
}

/**
 * 将未知值安全转成布尔值。
 * 这里只接收真正的 boolean，避免把字符串误判成 true。
 */
const toFlag = (...vals: unknown[]) => {
  for (const val of vals) {
    if (typeof val === 'boolean') return val
  }
}

/**
 * 将未知值安全转成端口号。
 * 非数字或超出端口范围时，回退到默认值。
 */
const toPort = (val: unknown, fallback = DEF.port) => {
  const num = Number(val)
  if (!Number.isInteger(num) || num < 1 || num > 65535) return fallback
  return num
}

/**
 * 将未知值安全转成重连次数。
 * 小于 0 的值会被回退为默认值，最终只保留整数。
 */
const toRetry = (val: unknown, fallback = 3) => {
  const num = Number(val)
  if (!Number.isFinite(num) || num < 0) return fallback
  return Math.floor(num)
}

/**
 * 将未知值安全转成去重字符串数组。
 * 只有数组才会进入处理，其他类型直接返回空数组。
 */
const toList = (val: unknown) => Array.isArray(val) ? uniqTexts(val) : []

/**
 * 归一化单个服务器配置。
 * 同时兼容新旧 key，保证老配置可继续使用。
 */
const fixSrv = (raw: unknown): ServerConfig | null => {
  if (!isRecord(raw)) return null

  const name = textOf(raw.name)
  if (!name) return null

  return {
    name,
    forward: toFlag(raw.forward, raw.enableForwardWs) !== false,
    url: textOf(raw.url ?? raw.forwardWsUrl) || DEF.url,
    token: textOf(raw.token ?? raw.forwardWsToken),
    retries: toRetry(raw.retries ?? raw.maxReconnectAttempts),
    channels: toList(raw.channels),
    bots: toList(raw.bots ?? raw.botSelfIds),
    rcon: textOf(raw.rcon ?? raw.rconPrefix) || DEF.rcon,
    users: toList(raw.users ?? raw.allowedCommandUsers),
    mask: textOf(raw.mask ?? raw.maskRegex),
  }
}

/**
 * 归一化插件总配置。
 * 这里统一补默认值并兼容旧字段，避免因为配置缺项导致启动失败。
 */
export const fixCfg = (rawCfg: unknown): BridgeConfig => {
  const raw = isRecord(rawCfg) ? rawCfg : {}
  const servers = Array.isArray(raw.servers)
    ? raw.servers.map(fixSrv).filter(Boolean) as ServerConfig[]
    : []

  return {
    reverse: toFlag(raw.reverse, raw.enableReverseWs) !== false,
    path: textOf(raw.path ?? raw.reverseWsPath) || DEF.path,
    port: toPort(raw.port ?? raw.reverseWsPort),
    token: textOf(raw.token ?? raw.reverseWsToken),
    prefix: textOf(raw.prefix ?? raw.commandPrefix) || DEF.prefix,
    groupName: toFlag(raw.groupName, raw.includeGroupName) !== false,
    serverName: toFlag(raw.serverName, raw.includeServerName) !== false,
    verb: textOf(raw.verb ?? raw.speechVerb) || DEF.verb,
    ciImage: toFlag(raw.ciImage, raw.enableCiImage) === true,
    servers,
    debug: toFlag(raw.debug, raw.debugMode) === true,
  }
}
