import type { QueQiaoEvent } from '@cikeyqi/queqiao-node-sdk'
import type { Context, Logger } from 'koishi'
import type { BridgeConfig, ServerItemConfig } from '../values'
import { ClientRuntime } from '../core/client-runtime'
import { buildCmd } from '../core/commands'
import { toEvent } from '../core/event'
import { makeLog } from '../core/log'
import { toRcon } from '../core/rcon'
import type { GroupApiCommand, I18nTranslate, JsonRecord, SessionLike } from '../core/types'
import { imageOf, isRecord, parseChannelRef, parseJson, textOf, toError, toJson, uniqTexts } from '../core/utils'
import { fixCfg } from './conf'
import { Lang } from './lang'
import { Route } from './route'
import { type BotLike, isAdmin, isBot, isGroup, toMc } from './sess'

const U_SERVER = '未命名服务器'

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

  constructor(private ctx: Context, raw: unknown, logger: Logger) {
    this.cfg = fixCfg(raw)
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
   * 统一绑定生命周期事件。
   * 入口只要初始化一次，就能接管 ready/message/dispose 三类流程。
   */
  private bind() {
    this.onReady()
    this.onMsg()
    this.onStop()
  }

  /**
   * 获取翻译函数。
   * 有会话就按会话语言输出，没有会话就走全局语言。
   */
  private t(session?: SessionLike): I18nTranslate {
    return this.lang.pick(session)
  }

  /**
   * 处理重连上限。
   * 当同一服务器连续重连达到上限时，主动关闭该连接，避免刷日志。
   */
  private retry(name: string, count: number) {
    const srv = this.route.one(name)
    const max = Number(srv?.retries || 0)
    if (max > 0 && count >= max) {
      this.log.warn('network', `服务器 ${name} 重连次数已到上限（${max}），先暂停这个连接。`)
      void this.run.closeConnection(name)
    }
  }

  /**
   * 统一解包入站事件。
   * 兼容 SDK 多种事件封装，并在单连接场景补齐 server_name。
   */
  private unpack(rawEvt: QueQiaoEvent | JsonRecord | string) {
    let raw: unknown = rawEvt
    if (isRecord(rawEvt) && isRecord(rawEvt.data)) {
      const data = rawEvt.data
      if ('post_type' in data || 'event_name' in data || 'sub_type' in data) {
        raw = data
      }
    }

    const evt = parseJson(raw)
    if (!evt) return null

    if (!textOf(evt.server_name)) {
      const online = this.run.connectedNames()
      if (online.length === 1) return { ...evt, server_name: online[0] }
    }

    return evt
  }

  /**
   * 处理 MC -> 群 的事件入口。
   * 只做三件事：解包、格式化、分发。
   */
  private onEvt(rawEvt: QueQiaoEvent | JsonRecord | string) {
    try {
      const evt = this.unpack(rawEvt)
      if (!evt) return

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

  /**
   * 构建机器人索引。
   * 先按 selfId 分组，后续推送消息时可以少做很多遍历。
   */
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

  /**
   * 编译并缓存屏蔽正则。
   * 同一条规则只编译一次，避免高频消息场景重复创建 RegExp。
   */
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

  /**
   * 安全发送单条群消息。
   * 发送失败只记录日志，不抛异常，避免影响其他目标群。
   */
  private async send(botId: string, bot: BotLike, chan: string, msg: string) {
    const platform = textOf(bot.platform) || 'unknown'
    try {
      await bot.broadcast([chan], msg, 0)
      this.log.debug(this.cfg.debug, 'sync', `已发送到 ${platform}:${chan}（机器人 ${botId}）`)
    } catch (err) {
      this.log.error('sync', `发到 ${platform}:${chan} 失败（机器人 ${botId}）：${toError(err)}`)
    }
  }

  /**
   * 将 MC 消息分发到配置的群。
   * 这里会处理屏蔽词、机器人筛选、平台筛选和并发发送。
   */
  private async sendGroup(rawMsg: string, srv: ServerItemConfig) {
    const name = textOf(srv.name) || U_SERVER
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

  /**
   * 获取当前群关联的服务器列表。
   * 优先按 platform:channel 匹配，再按 channel 兜底。
   */
  private srvs(session: SessionLike) {
    const channel = textOf(session.channelId)
    if (!channel) return []
    return this.route.list(textOf(session.platform), channel)
  }

  /**
   * 在关联服务器上并发执行任务。
   * 某个服务器失败不会中断其余服务器，保证整体可用性。
   */
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

  /**
   * 读取 RCON 命令正文。
   * 命中前缀则返回命令，不命中返回 null。
   */
  private readCmd(msg: string, srv: ServerItemConfig) {
    const head = textOf(srv.rcon || '/')
    const text = String(msg || '')
    return head && text.startsWith(head) ? text.slice(head.length).trim() : null
  }

  /**
   * 判断用户是否可执行命令。
   * 管理员始终放行；普通用户需命中服务器白名单。
   */
  private canCmd(srv: ServerItemConfig, session: SessionLike) {
    if (isAdmin(session)) return true

    let set = this.users.get(srv)
    if (!set) {
      set = new Set(uniqTexts(srv.users || []))
      this.users.set(srv, set)
    }
    return set.has(textOf(session.userId))
  }

  /**
   * 执行 RCON 命令并回显结果。
   * 出错时直接给群里返回友好提示，避免“无响应”体验。
   */
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

  /**
   * 处理普通群消息同步。
   * 命中 RCON 前缀走命令，不命中则走聊天转发。
   */
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
        const msg = toMc(session, this.cfg, this.t(session))
        await this.run.request(name, 'broadcast', { message: msg })
      } catch (err) {
        this.log.debug(this.cfg.debug, 'sync', `同步群聊到 ${name} 失败：${toError(err)}`)
      }
    })
  }

  /**
   * 处理状态查询命令。
   * 输出每个服务器当前连接情况，方便快速判断是否在线。
   */
  private async runStat(session: SessionLike) {
    try {
      const online = new Set(this.run.connectedNames())
      const lines: string[] = [this.lang.sess(session, 'message.statusHeader', '当前连接情况：')]

      for (const srv of this.cfg.servers) {
        const name = textOf(srv.name) || this.lang.sess(session, 'common.unknownServer', U_SERVER)
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

  /**
   * 处理重连命令。
   * 仅管理员可用，执行后会返回当前已连接服务器列表。
   */
  private async runLink(session: SessionLike) {
    if (!isAdmin(session)) {
      await session.send(this.lang.sess(session, 'message.reconnectNoPermission', '权限不够，只有管理员可以用。'))
      return
    }

    await session.send(this.lang.sess(session, 'message.reconnectStarting', '正在重连全部服务器，请稍候...'))
    try {
      await this.run.reconnect()
      const online = this.run.connectedNames()
      await session.send(
        online.length
          ? this.lang.sess(session, 'message.reconnectDone', `重连完成，已连接：${online.join(', ')}`, [online.join(', ')])
          : this.lang.sess(session, 'message.reconnectDoneEmpty', '重连完成，但当前没有可用连接。'),
      )
    } catch (err) {
      const msg = toError(err)
      this.log.error('command', `重连失败：${msg}`)
      await session.send(this.lang.sess(session, 'message.reconnectFailed', `重连失败：${msg}`, [msg]))
    }
  }

  /**
   * 处理群 API 命令（标题/副标题/动作栏/私聊）。
   * 统一命令解析和错误提示，减少重复逻辑。
   */
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

  /**
   * 处理内置系统命令。
   * 命令没命中时返回 false，让后续流程继续处理普通消息。
   */
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

  /**
   * 绑定消息事件。
   * 这里把“过滤机器人消息、系统命令、普通同步”三段流程串起来。
   */
  private onMsg() {
    this.ctx.on('message', async (session) => {
      const cur = session as unknown as SessionLike
      if (this.stop) return
      if (isBot(cur, this.ctx.bots as BotLike[])) return
      if (await this.runSys(cur)) return
      await this.runChat(cur)
    })
  }

  /**
   * 绑定 ready 事件。
   * Koishi 完成启动后再去建立网络连接，能减少初始化时序问题。
   */
  private onReady() {
    this.ctx.on('ready', () => {
      if (this.stop) return
      void this.run.boot()
    })
  }

  /**
   * 绑定 dispose 事件。
   * 插件卸载时主动关掉连接，避免出现“已卸载但仍在转发”的残留行为。
   */
  private onStop() {
    this.ctx.on('dispose', async () => {
      this.stop = true
      await this.run.close()
    })
  }
}
