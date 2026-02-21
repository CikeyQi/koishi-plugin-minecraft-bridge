import type { Context } from 'koishi'
import type { BridgeConfig } from '../values'
import type { ClientRuntime } from '../core/client-runtime'
import type { makeLog } from '../core/log'
import type { SessionLike } from '../core/types'
import { textOf, toError, uniqTexts } from '../core/utils'
import { DASH } from './const'
import { buildDashExec, dashBody, isDashMessage } from './dash'
import type { Lang } from './lang'
import { runRcon } from './rcon'
import type { Route } from './route'
import { isGroup } from './sess'

type BridgeLog = ReturnType<typeof makeLog>

export interface CommandSession extends SessionLike {
  execute: (content: string) => Promise<unknown>
}

interface CommandDeps {
  context: Context
  getConfig: () => BridgeConfig
  route: Route
  runtime: ClientRuntime
  language: Lang
  logger: BridgeLog
}

interface TextAction {
  dash: string
  key: string
  description: string
  action: string
  api: string
  requiredKey: string
  requiredText: string
  payload: (text: string) => Record<string, unknown>
}

/**
 * 统一管理插件内部命令。
 * 包含 Dash 输入解析、命令注册、目标服务器解析与执行。
 */
export class CommandCenter {
  constructor(private readonly deps: CommandDeps) {}

  private get config() {
    return this.deps.getConfig()
  }

  /** 注册全部内部命令。 */
  public bind() {
    this.bindStatus()
    this.bindReconnect()
    this.bindTextActions()
    this.bindPrivate()
    this.bindRcon()
  }

  /**
   * 执行 Dash 风格命令。
   * 例如 `mc -q` 会转换为 `mcbridge.status` 内部命令。
   */
  public async runDash(session: CommandSession): Promise<boolean> {
    const content = textOf(session.content)
    const prefix = textOf(this.config.prefix)
    if (!isDashMessage(prefix, content)) return false

    const body = dashBody(prefix, content)
    const commandText = buildDashExec(body)
    if (!commandText) {
      await session.send(this.deps.language.sess(session, 'message.invalidCommandArgs', '命令参数格式不正确'))
      return true
    }

    await session.execute(commandText)
    return true
  }

  private commandText(key: string, fallback: string, args: readonly unknown[] = []) {
    return this.deps.language.root(`command.${key}`, fallback, args)
  }

  private logText(key: string, fallback: string, args: readonly unknown[] = []) {
    return this.deps.language.root(`log.command.${key}`, fallback, args)
  }

  private dashSession(input: unknown) {
    const session = input as SessionLike | undefined
    if (!session) return null

    const content = textOf(session.content)
    if (!isDashMessage(this.config.prefix, content)) return null
    return session
  }

  private optionServer(options: unknown) {
    return textOf((options as any)?.server)
  }

  private description(key: string, fallback: string) {
    return this.commandText(`description.${key}`, fallback)
  }

  private resolveAction(key: string, fallback: string) {
    return this.commandText(`action.${key}`, fallback)
  }

  private async resolveTargets(session: SessionLike, serverName: string) {
    const name = textOf(serverName)

    if (name) {
      if (!this.deps.route.one(name)) {
        await session.send(this.deps.language.sess(session, 'message.serverNotFound', '找不到目标服务器：{0}', [name]))
        return [] as string[]
      }
      return [name]
    }

    if (isGroup(session)) {
      const serverList = this.deps.route.list(textOf(session.platform), textOf(session.channelId))
      const nameList = uniqTexts(serverList.map(item => textOf(item.name)))
      if (!nameList.length) {
        await session.send(this.deps.language.sess(session, 'message.noServerAvailable', '没有可用的目标服务器'))
      }
      return nameList
    }

    const onlineList = this.deps.runtime.connectedNames()
    if (!onlineList.length) {
      await session.send(this.deps.language.sess(session, 'message.noServerAvailable', '没有可用的目标服务器'))
      return []
    }

    if (onlineList.length > 1) {
      await session.send(this.deps.language.sess(session, 'message.privateNeedServer', '私聊场景有多个在线服务器，请使用 -s'))
      return []
    }

    return onlineList
  }

  private async runStatus(session: SessionLike, serverName = '') {
    try {
      const onlineSet = new Set(this.deps.runtime.connectedNames())
      const output: string[] = [this.deps.language.sess(session, 'message.statusHeader', '当前连接状态：')]

      const name = textOf(serverName)
      const serverList = name
        ? this.config.servers.filter(item => textOf(item.name) === name)
        : this.config.servers

      if (name && !serverList.length) {
        await session.send(this.deps.language.sess(session, 'message.serverNotFound', '找不到目标服务器：{0}', [name]))
        return
      }

      for (const server of serverList) {
        const currentName = textOf(server.name) || this.deps.language.sess(session, 'common.unknownServer', '未知服务器')
        const statusText = onlineSet.has(currentName)
          ? this.deps.language.sess(session, 'message.statusConnected', '已连接')
          : this.deps.language.sess(session, 'message.statusDisconnected', '未连接')

        output.push(
          this.deps.language.sess(session, 'message.statusServerName', '- 服务器名称：{0}', [currentName]),
          this.deps.language.sess(session, 'message.statusConnection', '- 连接状态：{0}', [statusText]),
          '',
        )
      }

      await session.send(output.join('\n').trim())
    } catch {
      await session.send(this.deps.language.sess(session, 'message.statusFailed', '状态查询失败，请检查配置'))
    }
  }

  private async runReconnect(session: SessionLike, serverName = '') {
    const name = textOf(serverName)
    if (!name) {
      await session.send(this.deps.language.sess(session, 'message.reconnectStarting', '正在重连全部服务器，请稍候...'))

      try {
        await this.deps.runtime.reconnect()
        const onlineList = this.deps.runtime.connectedNames()
        await session.send(
          onlineList.length
            ? this.deps.language.sess(session, 'message.reconnectDone', '重连完成，当前已连接：{0}', [onlineList.join(', ')])
            : this.deps.language.sess(session, 'message.reconnectDoneEmpty', '重连完成，当前没有可用连接'),
        )
      } catch (error) {
        const errorText = toError(error)
        this.deps.logger.error('command', this.logText('reconnectAllFailed', '重连全部服务器失败：{0}', [errorText]))
        await session.send(this.deps.language.sess(session, 'message.reconnectFailed', '重连失败：{0}', [errorText]))
      }

      return
    }

    if (!this.deps.route.one(name)) {
      await session.send(this.deps.language.sess(session, 'message.serverNotFound', '找不到目标服务器：{0}', [name]))
      return
    }

    await session.send(this.deps.language.sess(session, 'message.reconnectOneStarting', '正在重连服务器 {0}，请稍候...', [name]))

    try {
      await this.deps.runtime.reconnectConnection(name)
      await session.send(this.deps.language.sess(session, 'message.reconnectOneDone', '服务器 {0} 重连请求已发送', [name]))
    } catch (error) {
      const errorText = toError(error)
      this.deps.logger.error('command', this.logText('reconnectOneFailed', '重连服务器 {0} 失败：{1}', [name, errorText]))
      await session.send(this.deps.language.sess(session, 'message.reconnectOneFailed', '服务器 {0} 重连失败：{1}', [name, errorText]))
    }
  }

  private async sendAction(
    session: SessionLike,
    serverName: string,
    actionName: string,
    api: string,
    data: Record<string, unknown>,
  ) {
    const nameList = await this.resolveTargets(session, serverName)
    if (!nameList.length) return

    await Promise.allSettled(nameList.map(async (name) => {
      try {
        await this.deps.runtime.request(name, api, data)
      } catch (error) {
        this.deps.logger.debug(
          this.config.debug,
          'command',
          this.logText('actionFailed', '{0} 在服务器 {1} 执行失败：{2}', [actionName, name, toError(error)]),
        )
      }
    }))
  }

  private bindStatus() {
    this.deps.context.command(DASH.status, this.description('status', '查询桥接状态'), { authority: 2, slash: false })
      .option('server -s <server:string>', this.commandText('option.server', '目标服务器'))
      .action(async ({ session, options }) => {
        const current = this.dashSession(session)
        if (!current) return
        await this.runStatus(current, this.optionServer(options))
      })
  }

  private bindReconnect() {
    this.deps.context.command(DASH.reconnect, this.description('reconnect', '重连桥接连接'), { authority: 4, slash: false })
      .option('server -s <server:string>', this.commandText('option.server', '目标服务器'))
      .action(async ({ session, options }) => {
        const current = this.dashSession(session)
        if (!current) return
        await this.runReconnect(current, this.optionServer(options))
      })
  }

  private bindTextActions() {
    const actionList: TextAction[] = [
      {
        dash: DASH.broadcast,
        key: 'broadcast',
        description: '发送普通广播',
        action: '广播',
        api: 'broadcast',
        requiredKey: 'message.commandInputRequired',
        requiredText: '请输入要发送的内容',
        payload: text => ({ message: [{ text, color: 'white' }] }),
      },
      {
        dash: DASH.title,
        key: 'title',
        description: '发送标题',
        action: '标题',
        api: 'send_title',
        requiredKey: 'message.groupApi.titleRequired',
        requiredText: '请输入要发送的标题内容',
        payload: text => ({ title: { text, color: 'white' } }),
      },
      {
        dash: DASH.subtitle,
        key: 'subtitle',
        description: '发送副标题',
        action: '副标题',
        api: 'send_title',
        requiredKey: 'message.groupApi.subtitleRequired',
        requiredText: '请输入要发送的副标题内容',
        payload: text => ({ subtitle: { text, color: 'white' } }),
      },
      {
        dash: DASH.actionbar,
        key: 'actionbar',
        description: '发送动作栏',
        action: '动作栏',
        api: 'send_actionbar',
        requiredKey: 'message.groupApi.actionbarRequired',
        requiredText: '请输入要发送的动作栏内容',
        payload: text => ({ message: [{ text, color: 'white' }] }),
      },
    ]

    for (const action of actionList) {
      this.bindTextAction(action)
    }
  }

  private bindTextAction(action: TextAction) {
    this.deps.context.command(`${action.dash} <text:text>`, this.description(action.key, action.description), { authority: 2, slash: false })
      .option('server -s <server:string>', this.commandText('option.server', '目标服务器'))
      .action(async ({ session, options }, text) => {
        const current = this.dashSession(session)
        if (!current) return

        const body = textOf(text)
        if (!body) {
          await current.send(this.deps.language.sess(current, action.requiredKey, action.requiredText))
          return
        }

        await this.sendAction(
          current,
          this.optionServer(options),
          this.resolveAction(action.key, action.action),
          action.api,
          action.payload(body),
        )
      })
  }

  private bindPrivate() {
    this.deps.context.command(`${DASH.private} <player:string> <text:text>`, this.description('private', '发送私聊消息'), { authority: 2, slash: false })
      .option('server -s <server:string>', this.commandText('option.server', '目标服务器'))
      .action(async ({ session, options }, player, text) => {
        const current = this.dashSession(session)
        if (!current) return

        const playerName = textOf(player)
        const messageText = textOf(text)
        if (!playerName || !messageText) {
          await current.send(
            this.deps.language.sess(
              current,
              'message.groupApi.privateFormat',
              '请输入正确的私聊格式：{0} -p <玩家> <内容>',
              [this.config.prefix],
            ),
          )
          return
        }

        await this.sendAction(
          current,
          this.optionServer(options),
          this.resolveAction('private', '私聊'),
          'send_private_msg',
          { nickname: playerName, message: [{ text: messageText, color: 'white' }] },
        )
      })
  }

  private bindRcon() {
    this.deps.context.command(`${DASH.rcon} <command:text>`, this.description('rcon', '发送 RCON 命令'), { authority: 4, slash: false })
      .option('server -s <server:string>', this.commandText('option.server', '目标服务器'))
      .action(async ({ session, options }, command) => {
        const current = this.dashSession(session)
        if (!current) return

        const nameList = await this.resolveTargets(current, this.optionServer(options))
        if (!nameList.length) return

        for (const name of nameList) {
          await runRcon({
            runtime: this.deps.runtime,
            language: this.deps.language,
            logger: this.deps.logger,
            debug: this.config.debug,
            session: current,
            serverName: name,
            commandText: textOf(command),
          })
        }
      })
  }
}
