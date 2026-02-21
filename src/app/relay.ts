import type { QueQiaoEvent } from '@cikeyqi/queqiao-node-sdk'
import type { Context } from 'koishi'
import type { BridgeConfig, ServerItemConfig } from '../values'
import type { ClientRuntime } from '../core/client-runtime'
import { toEvent } from '../core/event'
import type { makeLog } from '../core/log'
import type { SessionLike } from '../core/types'
import { imageOf, parseChannelRef, textOf, toError, toJson, uniqTexts } from '../core/utils'
import type { Lang } from './lang'
import { runRcon } from './rcon'
import type { Route } from './route'
import { type BotLike, isAdmin, isGroup, toMcMessage } from './sess'

type BridgeLog = ReturnType<typeof makeLog>

interface RelayDeps {
  context: Context
  getConfig: () => BridgeConfig
  route: Route
  runtime: ClientRuntime
  language: Lang
  logger: BridgeLog
}

/**
 * 统一管理消息同步。
 * 包含 MC 事件转发到群、群消息转发到 MC、群内 RCON 前缀命令。
 */
export class RelayCenter {
  private readonly maskMap = new Map<string, RegExp | null>()

  constructor(private readonly deps: RelayDeps) {}

  private get config() {
    return this.deps.getConfig()
  }

  private logText(key: string, fallback: string, args: readonly unknown[] = []) {
    return this.deps.language.root(`log.${key}`, fallback, args)
  }

  /** 处理来自 QueQiao 的事件并转发到群。 */
  public onEvent(rawEvent: QueQiaoEvent) {
    try {
      const eventData = textOf(rawEvent.server_name)
        ? rawEvent
        : (() => {
            const onlineList = this.deps.runtime.connectedNames()
            return onlineList.length === 1 ? { ...rawEvent, server_name: onlineList[0] } : rawEvent
          })()

      this.deps.logger.debug(
        this.config.debug,
        'event',
        this.logText('event.received', '收到事件：{0}', [toJson(eventData)]),
      )

      const groupText = toEvent(eventData, this.config, this.deps.language.pick())
      if (!groupText) return

      const serverName = textOf(eventData.server_name)
      const server = this.deps.route.one(serverName)
      if (!server) {
        this.deps.logger.debug(
          this.config.debug,
          'event',
          this.logText('event.unknownServerIgnored', '收到未知服务器事件，已忽略'),
        )
        return
      }

      void this.sendGroup(groupText, server)
    } catch (error) {
      this.deps.logger.error('event', this.logText('event.handleFailed', '处理事件失败：{0}', [toError(error)]))
    }
  }

  /** 处理群消息并同步到 MC。 */
  public async onGroup(session: SessionLike) {
    if (!isGroup(session)) return

    await this.eachServer(session, async (server, serverName) => {
      const commandText = this.rconText(session.content || '', server)
      if (commandText !== null) {
        if (isAdmin(session)) {
          await runRcon({
            runtime: this.deps.runtime,
            language: this.deps.language,
            logger: this.deps.logger,
            debug: this.config.debug,
            session,
            serverName,
            commandText,
          })
        } else {
          await session.send(this.deps.language.sess(session, 'message.noPermission', '你没有权限执行该命令'))
        }
        return
      }

      try {
        const message = toMcMessage(session, this.config, server.ciImage, this.deps.language.pick(session))
        await this.deps.runtime.request(serverName, 'broadcast', { message })
      } catch (error) {
        this.deps.logger.debug(
          this.config.debug,
          'sync',
          this.logText('sync.groupMessageFailed', '同步群消息到服务器 {0} 失败：{1}', [serverName, toError(error)]),
        )
      }
    })
  }

  private botMap() {
    const botMap = new Map<string, BotLike[]>()

    for (const bot of this.deps.context.bots as BotLike[]) {
      const selfId = textOf(bot.selfId)
      if (!selfId) continue

      const currentList = botMap.get(selfId)
      if (currentList) currentList.push(bot)
      else botMap.set(selfId, [bot])
    }

    return botMap
  }

  private maskOf(rawMask: string) {
    const mask = textOf(rawMask)
    if (!mask) return null

    if (this.maskMap.has(mask)) {
      return this.maskMap.get(mask) || null
    }

    try {
      const regExp = new RegExp(mask, 'g')
      this.maskMap.set(mask, regExp)
      return regExp
    } catch {
      this.maskMap.set(mask, null)
      return null
    }
  }

  private async sendChannel(botId: string, bot: BotLike, channelId: string, content: string) {
    const platform = textOf(bot.platform) || this.deps.language.root('common.unknownPlatform', '未知平台')

    try {
      await bot.broadcast([channelId], content, 0)
      this.deps.logger.debug(
        this.config.debug,
        'sync',
        this.logText('sync.sent', '已使用机器人 {2} 向 {0}:{1} 发送消息', [platform, channelId, botId]),
      )
    } catch (error) {
      this.deps.logger.error(
        'sync',
        this.logText('sync.sendFailed', '使用机器人 {2} 向 {0}:{1} 发送失败：{3}', [platform, channelId, botId, toError(error)]),
      )
    }
  }

  private async sendGroup(rawText: string, server: ServerItemConfig) {
    const serverName = textOf(server.name) || this.deps.language.root('common.unknownServer', '未知服务器')
    const botIdList = uniqTexts(server.bots || [])
    const channelList = uniqTexts(server.channels || [])

    if (!botIdList.length || !channelList.length) {
      this.deps.logger.debug(
        this.config.debug,
        'sync',
        this.logText('sync.noRoute', '服务器 {0} 未配置 bots/channels，已跳过', [serverName]),
      )
      return
    }

    let content = textOf(rawText)
    if (!content) return

    const regExp = this.maskOf(server.mask)
    if (textOf(server.mask) && !regExp) {
      this.deps.logger.warn('sync', this.logText('sync.invalidMask', '服务器 {0} 的屏蔽正则无效，已忽略', [serverName]))
    }

    if (regExp) {
      content = content.replace(regExp, '').trim()
      if (!content) return
    }

    const imageData = imageOf(content)
    const output = imageData.url
      ? `${imageData.text}${imageData.text ? ' ' : ''}<img src="${imageData.url}" />`
      : imageData.text

    const botMap = this.botMap()
    const sendJobs: Promise<void>[] = []

    for (const botId of botIdList) {
      const botList = botMap.get(botId)
      if (!botList?.length) {
        this.deps.logger.error('sync', this.logText('sync.botOffline', '机器人 {0} 当前离线', [botId]))
        continue
      }

      for (const channelRef of channelList) {
        const target = parseChannelRef(channelRef)
        if (!target.channelId) continue

        for (const bot of botList) {
          if (target.platform && target.platform !== textOf(bot.platform)) continue
          sendJobs.push(this.sendChannel(botId, bot, target.channelId, output))
        }
      }
    }

    if (sendJobs.length) {
      await Promise.allSettled(sendJobs)
    }
  }

  private serverList(session: SessionLike) {
    const channelId = textOf(session.channelId)
    if (!channelId) return []
    return this.deps.route.list(textOf(session.platform), channelId)
  }

  private async eachServer(session: SessionLike, task: (server: ServerItemConfig, serverName: string) => Promise<void>) {
    const serverList = this.serverList(session)
    if (!serverList.length) {
      this.deps.logger.debug(
        this.config.debug,
        'sync',
        this.logText('sync.groupNoBoundServer', '群组 {0}:{1} 没有绑定服务器', [session.platform, session.channelId]),
      )
      return false
    }

    await Promise.allSettled(serverList.map(async (server) => {
      const serverName = textOf(server.name)
      if (!serverName) return

      try {
        await task(server, serverName)
      } catch (error) {
        this.deps.logger.error('sync', this.logText('sync.serverTaskFailed', '服务器 {0} 执行任务失败：{1}', [serverName, toError(error)]))
      }
    }))

    return true
  }

  private rconText(content: string, server: ServerItemConfig) {
    const prefix = textOf(server.rcon || '/')
    const text = String(content || '')
    return prefix && text.startsWith(prefix) ? text.slice(prefix.length).trim() : null
  }
}
