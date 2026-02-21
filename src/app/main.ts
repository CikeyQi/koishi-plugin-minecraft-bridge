import type { QueQiaoEvent, RequestOptions } from '@cikeyqi/queqiao-node-sdk'
import type { Context, Logger } from 'koishi'
import { bridgeConfigSchema, type BridgeConfig } from '../values'
import { ClientRuntime } from '../core/client-runtime'
import { makeLog } from '../core/log'
import { textOf, toError } from '../core/utils'
import { MC_BRIDGE_ERR, MC_BRIDGE_EVENT, makeMcBridgeError } from '../service'
import { CommandCenter, type CommandSession } from './command'
import { Lang } from './lang'
import { RelayCenter } from './relay'
import { Route } from './route'
import { type BotLike, isBot, isGroup } from './sess'

/**
 * 桥接主流程编排器。
 * 负责运行时初始化、生命周期绑定与服务请求入口。
 */
export class Bridge {
  private config: BridgeConfig
  private readonly language: Lang
  private readonly route = new Route()
  private readonly runtime: ClientRuntime
  private readonly logger: ReturnType<typeof makeLog>
  private readonly command: CommandCenter
  private readonly relay: RelayCenter
  private stopped = false

  constructor(
    private readonly context: Context,
    config: BridgeConfig | undefined,
    rawLogger: Logger,
  ) {
    this.config = bridgeConfigSchema(config)
    this.language = new Lang(context)
    this.logger = makeLog(rawLogger)

    this.runtime = new ClientRuntime({
      logger: rawLogger,
      getConfig: () => this.config,
      onEvent: (eventData) => this.onEvent(eventData),
      onReconnect: (serverName, retryCount) => this.onReconnect(serverName, retryCount),
      translate: (key, fallback, args = []) => this.language.root(key, fallback, args),
    })

    const deps = {
      context: this.context,
      getConfig: () => this.config,
      route: this.route,
      runtime: this.runtime,
      language: this.language,
      logger: this.logger,
    }

    this.command = new CommandCenter(deps)
    this.relay = new RelayCenter(deps)

    this.language.load()
    this.route.reset(this.config.servers)
    this.bind()
  }

  /** 提供统一请求入口，供 mcBridge 服务调用。 */
  public request(api: string, data: Record<string, unknown>, options: RequestOptions = {}) {
    const serverName = textOf(options.selfName)
    if (serverName) return this.runtime.request(serverName, api, data, options)

    const onlineList = this.runtime.connectedNames()
    if (onlineList.length === 1) {
      return this.runtime.request(onlineList[0], api, data, options)
    }

    if (!onlineList.length) {
      throw makeMcBridgeError(
        MC_BRIDGE_ERR.EMPTY_SERVER,
        this.language.root('error.request.noOnlineServer', '当前没有在线服务器可供请求'),
      )
    }

    throw makeMcBridgeError(
      MC_BRIDGE_ERR.NEED_SELF_NAME,
      this.language.root('error.request.needSelfName', '多服务器模式下请求必须传入 options.selfName'),
    )
  }

  private logText(key: string, fallback: string, args: readonly unknown[] = []) {
    return this.language.root(`log.${key}`, fallback, args)
  }

  private onReconnect(serverName: string, retryCount: number) {
    const server = this.route.one(serverName)
    const maxRetry = Number(server?.retries || 0)

    if (maxRetry > 0 && retryCount >= maxRetry) {
      this.logger.warn(
        'network',
        this.logText('network.reconnectLimitReached', '服务器 {0} 已达到重连上限（{1}），将关闭该连接', [serverName, maxRetry]),
      )
      void this.runtime.closeConnection(serverName)
    }
  }

  private emitBridgeEvent(eventData: QueQiaoEvent) {
    try {
      const emit = this.context.emit as unknown as (eventName: string, payload: unknown) => void
      emit(MC_BRIDGE_EVENT, eventData)
    } catch (error) {
      this.logger.error(
        'event',
        this.logText('event.emitFailed', '触发事件 {0} 失败：{1}', [MC_BRIDGE_EVENT, toError(error)]),
      )
    }
  }

  private onEvent(eventData: QueQiaoEvent) {
    this.emitBridgeEvent(eventData)
    this.relay.onEvent(eventData)
  }

  private bind() {
    this.command.bind()
    this.onReady()
    this.onMessage()
    this.onDispose()
  }

  private onReady() {
    this.context.on('ready', () => {
      if (this.stopped) return
      void this.runtime.boot()
    })
  }

  private onMessage() {
    this.context.on('message', async (rawSession) => {
      if (this.stopped) return

      const session = rawSession as unknown as CommandSession
      if (isBot(session, this.context.bots as BotLike[])) return

      if (typeof session.execute === 'function') {
        const handled = await this.command.runDash(session)
        if (handled) return
      }

      if (!isGroup(session)) return
      await this.relay.onGroup(session)
    })
  }

  private onDispose() {
    this.context.on('dispose', async () => {
      this.stopped = true
      await this.runtime.close()
    })
  }
}
