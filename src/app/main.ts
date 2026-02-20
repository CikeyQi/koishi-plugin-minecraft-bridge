import type { QueQiaoEvent, RequestOptions } from '@cikeyqi/queqiao-node-sdk'
import type { Context, Logger } from 'koishi'
import { bridgeConfigSchema, type BridgeConfig, type ServerItemConfig } from '../values'
import { ClientRuntime } from '../core/client-runtime'
import { buildCmd } from '../core/commands'
import { toEvent } from '../core/event'
import { makeLog } from '../core/log'
import { toRcon } from '../core/rcon'
import type { GroupApiCommand, I18nTranslate, SessionLike } from '../core/types'
import { imageOf, parseChannelRef, textOf, toError, toJson, uniqTexts } from '../core/utils'
import { Lang } from './lang'
import { Route } from './route'
import { type BotLike, isAdmin, isBot, isGroup, toMc } from './sess'
import { MC_BRIDGE_ERR, MC_BRIDGE_EVENT, makeMcBridgeError } from '../service'

const UNKNOWN_SERVER = '未命名服务器'

export class Bridge {
  private cfg: BridgeConfig
  private lang: Lang
  private route = new Route()
  private run: ClientRuntime
  private log: ReturnType<typeof makeLog>
  private cmd: ReturnType<typeof buildCmd>
  private users = new WeakMap<ServerItemConfig, Set<string>>()
  private masks = new Map<string, RegExp | null>()
  private stop = false

  constructor(private ctx: Context, config: BridgeConfig | undefined, logger: Logger) {
    this.cfg = bridgeConfigSchema(config)
    this.lang = new Lang(ctx)
    this.log = makeLog(logger)
    this.cmd = buildCmd(this.cfg.prefix)
    this.run = new ClientRuntime({
      logger,
      getConfig: () => this.cfg,
      onEvent: evt => this.onEvt(evt),
      onReconnect: (name, count) => this.retry(name, count),
    })

    this.lang.load()
    this.route.reset(this.cfg.servers)
    this.bind()
  }

  /**
   * 提供给外部 service 调用的统一请求入口。
   * 多连接时要求显式传 selfName，避免误发到错误服务器。
   */
  public request(api: string, data: Record<string, unknown>, options: RequestOptions = {}) {
    const selfName = textOf(options.selfName)
    if (selfName) return this.run.request(selfName, api, data, options)

    const online = this.run.connectedNames()
    if (online.length === 1) return this.run.request(online[0], api, data, options)
    if (!online.length) throw makeMcBridgeError(MC_BRIDGE_ERR.EMPTY_SERVER, '当前没有在线服务器，无法调用 request')

    throw makeMcBridgeError(MC_BRIDGE_ERR.NEED_SELF_NAME, '多服务器连接时，request 需要 options.selfName')
  }

  /** 统一绑定生命周期事件。 */
  private bind() {
    this.onReady()
    this.onMsg()
    this.onStop()
  }

  private t(session?: SessionLike): I18nTranslate {
    return this.lang.pick(session)
  }

  /** 处理重连上限。 */
  private retry(name: string, count: number) {
    const srv = this.route.one(name)
    const max = Number(srv?.retries || 0)
    if (max > 0 && count >= max) {
      this.log.warn('network', `服务器 ${name} 重连次数已到上限（${max}），先暂停这个连接。`)
      void this.run.closeConnection(name)
    }
  }

  /** 广播原始事件给外部插件监听。 */
  private emitEvent(rawEvt: QueQiaoEvent) {
    try {
      const emit = this.ctx.emit as unknown as (name: string, payload: unknown) => void
      emit(MC_BRIDGE_EVENT, rawEvt)
    } catch (err) {
      this.log.error('event', `处理 ${MC_BRIDGE_EVENT} 监听器失败：${toError(err)}`)
    }
  }

  /** 处理 MC -> 群 的事件入口。 */
  private onEvt(rawEvt: QueQiaoEvent) {
    this.emitEvent(rawEvt)

    try {
      const evt = textOf(rawEvt.server_name)
        ? rawEvt
        : (() => {
            const online = this.run.connectedNames()
            return online.length === 1 ? { ...rawEvt, server_name: online[0] } : rawEvt
          })()

      this.log.debug(this.cfg.debug, 'event', `收到事件：${toJson(evt)}`)

      const msg = toEvent(evt, this.cfg, this.t())
      if (!msg) return

      const name = textOf(evt.server_name)
      const srv = this.route.one(name)
      if (!srv) {
        this.log.debug(this.cfg.debug, 'event', '收到未配置服务器的消息，已忽略。')
        return
      }

      void this.sendGroup(msg, srv)
    } catch (err) {
      this.log.error('event', `处理事件失败：${toError(err)}`)
    }
  }

  /** 按 selfId 构建机器人索引。 */
  private bots() {
    const map = new Map<string, BotLike[]>()
    for (const bot of this.ctx.bots as BotLike[]) {
      const id = textOf(bot.selfId)
      if (!id) continue
      const list = map.get(id)
      if (list) list.push(bot)
      else map.set(id, [bot])
    }
    return map
  }

  private reg(word: string) {
    const key = textOf(word)
    if (!key) return null
    if (this.masks.has(key)) return this.masks.get(key) || null

    try {
      const reg = new RegExp(key, 'g')
      this.masks.set(key, reg)
      return reg
    } catch {
      this.masks.set(key, null)
      return null
    }
  }

  /** 安全发送单条群消息。 */
  private async send(botId: string, bot: BotLike, chan: string, msg: string) {
    const platform = textOf(bot.platform) || '未知平台'
    try {
      await bot.broadcast([chan], msg, 0)
      this.log.debug(this.cfg.debug, 'sync', `已发送到 ${platform}:${chan}（机器人 ${botId}）`)
    } catch (err) {
      this.log.error('sync', `发到 ${platform}:${chan} 失败（机器人 ${botId}）：${toError(err)}`)
    }
  }

  /** 将 MC 消息分发到配置群。 */
  private async sendGroup(rawMsg: string, srv: ServerItemConfig) {
    const name = textOf(srv.name) || UNKNOWN_SERVER
    const botIds = uniqTexts(srv.bots || [])
    const refs = uniqTexts(srv.channels || [])
    if (!botIds.length || !refs.length) {
      this.log.debug(this.cfg.debug, 'sync', `服务器 ${name} 没配置 bots 或 channels，已跳过。`)
      return
    }

    let msg = textOf(rawMsg)
    if (!msg) return

    const reg = this.reg(srv.mask)
    if (textOf(srv.mask) && !reg) {
      this.log.warn('sync', `服务器 ${name} 的屏蔽规则写错了，已忽略这条规则。`)
    }
    if (reg) {
      msg = msg.replace(reg, '').trim()
      if (!msg) return
    }

    const { text, url } = imageOf(msg)
    const out = url ? `${text}${text ? ' ' : ''}<img src="${url}" />` : text
    const botMap = this.bots()
    const jobs: Promise<void>[] = []

    for (const botId of botIds) {
      const list = botMap.get(botId)
      if (!list?.length) {
        this.log.error('sync', `机器人 ${botId} 不在线，没法发消息。`)
        continue
      }

      for (const ref of refs) {
        const target = parseChannelRef(ref)
        if (!target.channelId) continue

        for (const bot of list) {
          if (target.platform && target.platform !== textOf(bot.platform)) continue
          jobs.push(this.send(botId, bot, target.channelId, out))
        }
      }
    }

    if (jobs.length) await Promise.allSettled(jobs)
  }

  /** 获取当前群关联的服务器列表。 */
  private srvs(session: SessionLike) {
    const channel = textOf(session.channelId)
    if (!channel) return []
    return this.route.list(textOf(session.platform), channel)
  }

  /** 在关联服务器上并发执行任务。 */
  private async forSrv(session: SessionLike, task: (srv: ServerItemConfig, name: string) => Promise<void>) {
    if (!isGroup(session)) return false

    const list = this.srvs(session)
    if (!list.length) {
      this.log.debug(this.cfg.debug, 'sync', `当前群 ${session.platform}:${session.channelId} 未关联服务器。`)
      return false
    }

    await Promise.allSettled(list.map(async (srv) => {
      const name = textOf(srv.name)
      if (!name) return
      try {
        await task(srv, name)
      } catch (err) {
        this.log.error('sync', `服务器 ${name} 处理失败：${toError(err)}`)
      }
    }))

    return true
  }

  /** 读取 RCON 命令正文。 */
  private readCmd(msg: string, srv: ServerItemConfig) {
    const head = textOf(srv.rcon || '/')
    const text = String(msg || '')
    return head && text.startsWith(head) ? text.slice(head.length).trim() : null
  }

  private canCmd(srv: ServerItemConfig, session: SessionLike) {
    if (isAdmin(session)) return true

    let set = this.users.get(srv)
    if (!set) {
      set = new Set(uniqTexts(srv.users || []))
      this.users.set(srv, set)
    }
    return set.has(textOf(session.userId))
  }

  /** 执行 RCON 命令并回显结果。 */
  private async runCmd(session: SessionLike, name: string, cmd: string) {
    if (!cmd) {
      await session.send(this.lang.sess(session, 'message.commandInputRequired', '请输入要执行的命令。'))
      return
    }

    try {
      const res = await this.run.request(name, 'send_rcon_command', { command: cmd }, { timeoutMs: 5000 })
      await session.send(toRcon(res, this.t(session)))
      this.log.debug(this.cfg.debug, 'command', `已向 ${name} 发送命令：${cmd}`)
    } catch (err) {
      const msg = toError(err)
      this.log.error('command', `向 ${name} 发送命令失败：${msg}`)
      await session.send(this.lang.sess(session, 'message.commandSendFailed', `向 ${name} 发送命令失败：${msg}`, [name, msg]))
    }
  }

  /** 处理普通群消息同步。 */
  private async runChat(session: SessionLike) {
    await this.forSrv(session, async (srv, name) => {
      const cmd = this.readCmd(session.content || '', srv)
      if (cmd !== null) {
        if (this.canCmd(srv, session)) {
          await this.runCmd(session, name, cmd)
        } else {
          await session.send(this.lang.sess(session, 'message.noPermission', '你没有权限执行这个命令。'))
        }
        return
      }

      try {
        const msg = toMc(session, this.cfg, srv.ciImage, this.t(session))
        await this.run.request(name, 'broadcast', { message: msg })
      } catch (err) {
        this.log.debug(this.cfg.debug, 'sync', `同步群聊到 ${name} 失败：${toError(err)}`)
      }
    })
  }

  /** 处理状态查询命令。 */
  private async runStat(session: SessionLike) {
    try {
      const online = new Set(this.run.connectedNames())
      const lines: string[] = [this.lang.sess(session, 'message.statusHeader', '当前连接情况：')]

      for (const srv of this.cfg.servers) {
        const name = textOf(srv.name) || this.lang.sess(session, 'common.unknownServer', UNKNOWN_SERVER)
        const status = online.has(name)
          ? this.lang.sess(session, 'message.statusConnected', '已连接')
          : this.lang.sess(session, 'message.statusDisconnected', '未连接')
        lines.push(
          this.lang.sess(session, 'message.statusServerName', '- 服务器：{0}', [name]),
          this.lang.sess(session, 'message.statusConnection', '- 状态：{0}', [status]),
          '',
        )
      }

      await session.send(lines.join('\n').trim())
    } catch {
      await session.send(this.lang.sess(session, 'message.statusFailed', '查询失败，请检查配置。'))
    }
  }

  /** 处理重连命令。 */
  private async runLink(session: SessionLike) {
    if (!isAdmin(session)) {
      await session.send(this.lang.sess(session, 'message.reconnectNoPermission', '权限不足，只有管理员可以用。'))
      return
    }

    await session.send(this.lang.sess(session, 'message.reconnectStarting', '正在重连全部服务器，请稍候...'))
    try {
      await this.run.reconnect()
      const online = this.run.connectedNames()
      await session.send(
        online.length
          ? this.lang.sess(session, 'message.reconnectDone', `重连完成，已连接：{0}`, [online.join(', ')])
          : this.lang.sess(session, 'message.reconnectDoneEmpty', '重连完成，但当前没有可用连接。'),
      )
    } catch (err) {
      const msg = toError(err)
      this.log.error('command', `重连失败：${msg}`)
      await session.send(this.lang.sess(session, 'message.reconnectFailed', `重连失败：${msg}`, [msg]))
    }
  }

  /** 处理群 API 命令（标题/副标题/动作栏/私聊）。 */
  private async runApi(session: SessionLike, cmd: GroupApiCommand): Promise<boolean> {
    if (!isGroup(session)) return false

    const match = String(session.content || '').match(cmd.pattern)
    if (!match) return false

    let body: ReturnType<GroupApiCommand['build']>
    try {
      body = cmd.build(match)
    } catch (err) {
      this.log.error('command', `命令参数解析失败：${toError(err)}`)
      await session.send(this.lang.sess(session, 'message.invalidCommandArgs', '命令参数格式不对，请检查后重试。'))
      return true
    }

    if (!body) return true
    if ('errorKey' in body) {
      await session.send(this.lang.sess(session, body.errorKey, body.errorFallback, body.errorParams || []))
      return true
    }

    const ok = await this.forSrv(session, async (_, name) => {
      try {
        await this.run.request(name, body.api, body.data, body.options)
      } catch (err) {
        this.log.debug(this.cfg.debug, 'command', `${cmd.actionName} 在 ${name} 执行失败：${toError(err)}`)
      }
    })

    if (!ok) {
      await session.send(this.lang.sess(session, 'message.noServerAvailable', '当前群没有可用的目标服务器。'))
    }
    return true
  }

  /** 处理内置系统命令。 */
  private async runSys(session: SessionLike): Promise<boolean> {
    const text = String(session.content || '').trim()
    const head = textOf(this.cfg.prefix)
    if (head && !text.startsWith(head)) return false

    if (this.cmd.status.test(text)) {
      await this.runStat(session)
      return true
    }

    if (this.cmd.reconnect.test(text)) {
      await this.runLink(session)
      return true
    }

    for (const cmd of this.cmd.groupApiCommands) {
      if (await this.runApi(session, cmd)) return true
    }

    return false
  }

  /** 绑定消息事件。 */
  private onMsg() {
    this.ctx.on('message', async (session) => {
      const cur = session as unknown as SessionLike
      if (this.stop) return
      if (isBot(cur, this.ctx.bots as BotLike[])) return
      if (await this.runSys(cur)) return
      await this.runChat(cur)
    })
  }

  /** 绑定 ready 事件。 */
  private onReady() {
    this.ctx.on('ready', () => {
      if (this.stop) return
      void this.run.boot()
    })
  }

  /** 绑定 dispose 事件。 */
  private onStop() {
    this.ctx.on('dispose', async () => {
      this.stop = true
      await this.run.close()
    })
  }
}
