import { createClient, createReverseClient, type QueQiaoClient, type QueQiaoEvent, type RequestOptions } from '@cikeyqi/queqiao-node-sdk'
import type { Logger } from 'koishi'
import type { BridgeConfig } from '../values'
import { scopedLog } from './log'
import { isRecord, textOf, toError } from './utils'

interface ClientRuntimeOptions {
  logger: Logger
  getConfig: () => BridgeConfig
  onEvent: (eventData: QueQiaoEvent) => void
  onReconnect: (serverName: string, retryCount: number) => void
}

export class ClientRuntime {
  private readonly getConfig: () => BridgeConfig
  private readonly onEvent: (eventData: QueQiaoEvent) => void
  private readonly onReconnect: (serverName: string, retryCount: number) => void
  private readonly log: ReturnType<typeof scopedLog>

  private forwardClient: QueQiaoClient | null = null
  private reverseClient: QueQiaoClient | null = null
  private booted = false
  private bootTask: Promise<void> | null = null

  constructor(options: ClientRuntimeOptions) {
    this.getConfig = options.getConfig
    this.onEvent = options.onEvent
    this.onReconnect = options.onReconnect
    this.log = scopedLog(options.logger)
  }

  /**
   * 启动连接（支持幂等调用）。
   * 重复调用不会重复启动，除非显式传入 force。
   */
  async boot(force = false) {
    if (!force && this.booted) return
    if (!force && this.bootTask) return this.bootTask
    if (force && this.bootTask) await this.bootTask

    this.bootTask = this.start()
      .then(() => { this.booted = true })
      .catch((error) => {
        this.booted = false
        this.log.error('system', `连接初始化失败，请检查地址和 token：${toError(error)}`)
      })
      .finally(() => { this.bootTask = null })

    return this.bootTask
  }

  /** 手动触发重连，常用于管理命令。 */
  async reconnect() {
    this.booted = false
    await this.boot(true)
  }

  /** 关闭全部连接并清理事件监听。 */
  async close() {
    const forward = this.forwardClient
    const reverse = this.reverseClient
    await this.closeClients()
    forward?.removeAllListeners()
    reverse?.removeAllListeners()
  }

  /** 关闭指定服务器连接，用于触发“暂停重连”。 */
  async closeConnection(serverName: string) {
    const targetName = textOf(serverName)
    if (!targetName) return

    const clients = [this.reverseClient, this.forwardClient].filter(Boolean) as QueQiaoClient[]
    if (!clients.length) return

    await Promise.allSettled(clients.map(async (client) => {
      try {
        await client.close({ selfName: targetName, code: 1000, reason: 'max retry reached' })
      } catch {
        // noop
      }
    }))
  }

  /** 获取当前在线服务器名列表。 */
  connectedNames(): string[] {
    const statusList = [
      ...this.statusOf(this.reverseClient),
      ...this.statusOf(this.forwardClient),
    ]

    if (statusList.length) {
      return [...new Set(statusList.filter(item => item.open).map(item => item.selfName))].sort()
    }

    return [...new Set([
      ...this.namesOf(this.reverseClient),
      ...this.namesOf(this.forwardClient),
    ])].sort()
  }

  /**
   * 向指定服务器发送请求。
   * 会自动选择可用连接，并在多连接场景做顺序降级重试。
   */
  async request(serverName: string, api: string, data: Record<string, unknown>, options: RequestOptions = {}) {
    await this.boot()

    const targetName = textOf(serverName)
    if (!targetName) throw new Error('缺少服务器名，无法发送请求。')
    if (!textOf(api)) throw new Error('请求接口不能为空。')
    if (!isRecord(data)) throw new Error('请求参数格式不对。')

    const clients = this.clientQueue(targetName)
    if (!clients.length) throw new Error(`服务器 ${targetName} 当前没有可用连接。`)

    const requestOptions = { ...options, selfName: targetName }

    let lastError: unknown = null
    for (const client of clients) {
      try {
        return await client.request(api.trim() as any, data as any, requestOptions)
      } catch (error) {
        lastError = error
      }
    }

    throw lastError || new Error(`服务器 ${targetName} 请求失败，请稍后再试。`)
  }

  /** 按当前配置拉起连接。 */
  private async start() {
    const config = this.getConfig()
    await this.closeClients()

    if (config.reverse) {
      await this.startReverse(config)
    }

    await this.startForward(config)
  }

  /** 关闭现有客户端并重置内部引用。 */
  private async closeClients() {
    const clients = [this.forwardClient, this.reverseClient].filter(Boolean) as QueQiaoClient[]
    for (const client of clients) {
      client.removeAllListeners()
    }
    const jobs = clients.map(client => Promise.resolve(client.close()).catch(() => undefined))

    await Promise.allSettled(jobs)
    this.forwardClient = null
    this.reverseClient = null
  }

  /** 生成正向连接配置列表。 */
  private buildForward(config: BridgeConfig) {
    const unique = new Map<string, { url: string, selfName: string, accessToken?: string }>()

    for (const item of config.servers) {
      if (!item.forward) continue

      const selfName = textOf(item.name)
      const url = textOf(item.url)
      if (!selfName || !url) {
        this.log.warn('network', `服务器 ${selfName || '未命名'} 的正向连接配置不完整，已跳过。`)
        continue
      }

      const token = textOf(item.token)
      unique.set(selfName, {
        url,
        selfName,
        ...(token ? { accessToken: token } : {}),
      })
    }

    return [...unique.values()]
  }

  /** 启动正向连接客户端。 */
  private async startForward(config: BridgeConfig) {
    const connections = this.buildForward(config)
    if (!connections.length) {
      this.log.debug(config.debug, 'network', '未找到可用的正向连接配置。')
      return
    }

    this.forwardClient = createClient(connections)
    this.bindClientEvents(this.forwardClient, 'forward')

    try {
      await this.forwardClient.connect()
    } catch (error) {
      this.log.error('network', `正向连接启动失败：${toError(error)}`)
    }
  }

  /** 启动反向连接客户端。 */
  private async startReverse(config: BridgeConfig) {
    const port = Number(config.port)
    const path = textOf(config.path)
    if (!port || !path) {
      this.log.error('network', '反向连接缺少端口或路径，无法启动。')
      return
    }

    this.reverseClient = createReverseClient(
      { port, path },
      textOf(config.token) ? { accessToken: textOf(config.token) } : undefined,
    )

    this.bindClientEvents(this.reverseClient, 'reverse')

    try {
      await this.reverseClient.connect()
      this.log.info('network', `反向连接已启动：ws://localhost:${port}${path}`)
    } catch (error) {
      this.log.error('network', `反向连接启动失败：${toError(error)}`)
    }
  }

  /** 绑定连接生命周期事件。 */
  private bindClientEvents(client: QueQiaoClient, mode: 'forward' | 'reverse') {
    const modeLabel = mode === 'forward' ? '正向连接' : '反向连接'

    client.on('connection_open', (serverName) => {
      this.log.info('network', `服务器 ${serverName} 已连上（${modeLabel}）。`)
    })

    client.on('connection_close', (serverName, code, reason) => {
      const closeReason = textOf(reason) || '-'
      this.log.info('network', `服务器 ${serverName} 断开了（${modeLabel}，code=${code}，reason=${closeReason}）。`)
    })

    client.on('connection_reconnect', (serverName, retryCount, delayMs) => {
      const count = Number(retryCount || 0)
      const delay = Number(delayMs || 0)
      this.log.info('network', `服务器 ${serverName} 正在重连（${modeLabel}，第 ${count} 次，${delay}ms 后重试）。`)
      this.onReconnect(serverName, retryCount)
    })

    client.on('connection_error', (serverName, error) => {
      const server = textOf(serverName) || '未知服务器'
      this.log.error('network', `服务器 ${server} 连接出错（${modeLabel}）：${toError(error)}`)
    })

    client.on('event', this.onEvent)
  }

  /** 从客户端读取已知服务器名。 */
  private namesOf(client: QueQiaoClient | null): string[] {
    if (!client) return []

    try {
      const names = client.list()
      return Array.isArray(names)
        ? [...new Set(names.map(name => textOf(name)).filter(Boolean))]
        : []
    } catch {
      return []
    }
  }

  /** 从客户端读取连接状态并做按名聚合。 */
  private statusOf(client: QueQiaoClient | null): Array<{ selfName: string, open: boolean }> {
    if (!client) return []

    try {
      const statusList = client.status()
      if (!Array.isArray(statusList)) return []

      const statusMap = new Map<string, { selfName: string, open: boolean }>()
      for (const item of statusList) {
        const selfName = textOf((item as any)?.selfName)
        if (!selfName) continue

        const prev = statusMap.get(selfName)
        statusMap.set(selfName, {
          selfName,
          open: Boolean((item as any)?.open) || Boolean(prev?.open),
        })
      }

      return [...statusMap.values()]
    } catch {
      return []
    }
  }

  /** 获取可用于路由判断的服务器名列表。 */
  private namesForRoute(client: QueQiaoClient): string[] {
    const names = this.namesOf(client)
    if (names.length) return names
    return this.statusOf(client).map(item => item.selfName)
  }

  /** 构建请求路由队列：优先命中目标服务器，再降级其他连接。 */
  private clientQueue(serverName: string): QueQiaoClient[] {
    const base = [this.reverseClient, this.forwardClient].filter(Boolean) as QueQiaoClient[]
    const hit = base.filter(client => this.namesForRoute(client).includes(serverName))
    return [...hit, ...base.filter(client => !hit.includes(client))]
  }
}
