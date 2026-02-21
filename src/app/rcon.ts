import type { makeLog } from '../core/log'
import { toRcon } from '../core/rcon'
import type { SessionLike } from '../core/types'
import { textOf, toError } from '../core/utils'
import type { ClientRuntime } from '../core/client-runtime'
import type { Lang } from './lang'

type BridgeLog = ReturnType<typeof makeLog>

interface RconTask {
  runtime: ClientRuntime
  language: Lang
  logger: BridgeLog
  debug: boolean
  session: SessionLike
  serverName: string
  commandText: string
}

/**
 * 执行 RCON 命令并统一处理返回与错误。
 * 该函数被群消息前缀命令和 Dash 命令复用。
 */
export const runRcon = async (task: RconTask) => {
  const commandText = textOf(task.commandText)
  if (!commandText) {
    await task.session.send(task.language.sess(task.session, 'message.commandInputRequired', '请输入要执行的命令'))
    return
  }

  try {
    const result = await task.runtime.request(
      task.serverName,
      'send_rcon_command',
      { command: commandText },
      { timeoutMs: 5000 },
    )

    await task.session.send(toRcon(result, task.language.pick(task.session)))

    task.logger.debug(
      task.debug,
      'command',
      task.language.root('log.command.sent', '已向 {0} 发送命令：{1}', [task.serverName, commandText]),
    )
  } catch (error) {
    const errorText = toError(error)
    task.logger.error(
      'command',
      task.language.root('log.command.sendFailed', '向 {0} 发送命令失败：{1}', [task.serverName, errorText]),
    )

    await task.session.send(
      task.language.sess(task.session, 'message.commandSendFailed', '向 {0} 发送命令失败：{1}', [task.serverName, errorText]),
    )
  }
}
