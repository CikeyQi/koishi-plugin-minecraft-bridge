import { Context, Logger, Schema } from 'koishi'
import { bridgeConfigSchema, type BridgeConfig } from './values'
import { Bridge } from './app/main'
import { McBridgeService } from './service'

export const name = 'minecraft-bridge'
export const inject = { optional: ['i18n'] }

const logger = new Logger(name)

export type Config = BridgeConfig
export const Config: Schema<Config> = bridgeConfigSchema

export const usage = `

## 插件 & 服务器配置
请参考 [👉 README.md](https://github.com/CikeyQi/koishi-plugin-minecraft-bridge#readme) 进行配置

## 命令
- \`mc -q [-s 服务器名]\`：查询连接状态（authority >= 2）。
- \`mc -r [-s 服务器名]\`：重连连接（authority >= 4）。
- \`mc -b <文本> [-s 服务器名]\`：发送广播（authority >= 2）。
- \`mc -t <文本> [-s 服务器名]\`：发送标题（authority >= 2）。
- \`mc -u <文本> [-s 服务器名]\`：发送副标题（authority >= 2）。
- \`mc -a <文本> [-s 服务器名]\`：发送动作栏（authority >= 2）。
- \`mc -p <玩家> <文本> [-s 服务器名]\`：发送私聊（authority >= 2）。
- \`mc -c <命令> [-s 服务器名]\`：发送 RCON（authority >= 4）。

默认前缀为 \`mc\`，可在下方修改 \`prefix\` 来调整

可使用 \`commands\` 插件调整指令权限等级
`

/**
 * 插件入口函数。
 * 入口只负责创建桥接对象，业务逻辑在 app 层分文件实现。
 */
export function apply(ctx: Context, config?: Config) {
  const bridge = new Bridge(ctx, config, logger)
  ctx.plugin(McBridgeService, bridge)
}

export * from './service'

const plugin = {
  name,
  inject,
  Config,
  usage,
  apply,
}

export default plugin
