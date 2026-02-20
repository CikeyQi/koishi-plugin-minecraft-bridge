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
## 使用前准备

1. 前往 [Modrinth - QueQiao](https://modrinth.com/plugin/queqiao) 下载并安装与你当前服务端对应的 Mod/插件。
2. 在 QueQiao 侧先完成基础配置，确认可用信息：\`server_name\` \`access_token\`
3. 回到本插件配置页，按下表填写关键配置。

## 配置项说明

无论正向 WebSocket 还是反向 WebSocket 均需要在服务器列表中添加服务器，\`name\`与 QueQiao 的 \`server_name\` 一致

如果不知道 \`channels\` 和 \`bots\` 填什么，使用 \`inspect\` 命令可以查看

### 反向 WebSocket（MC 主动连接 Koishi）

| 配置项 | 说明 |
| --- | --- |
| \`reverse\` | 是否启用反向 WebSocket |
| \`path\` | 反向 WebSocket 路径，默认 \`/minecraft/ws\` |
| \`port\` | 反向 WebSocket 端口，默认 \`8080\` |
| \`token\` | 反向连接 \`access_token\` |

### 正向 WebSocket（Koishi 主动连接 MC）

| 配置项 | 说明 |
| --- | --- |
| \`forward\` | 是否启用该服务器正向 WebSocket |
| \`url\` | 正向 WebSocket 地址 |
| \`token\` | 正向连接 \`access_token\` |

## 命令与功能

| 命令 | 功能 |
| --- | --- |
| \`mcs\` | 查看当前各服务器连接状态 |
| \`mcr\` | 重连全部服务器（仅管理员） |
| \`mct <文本>\` | 向绑定服务器发送标题 |
| \`mcst <文本>\` | 向绑定服务器发送副标题 |
| \`mcab <文本>\` | 向绑定服务器发送动作栏 |
| \`mcp <玩家> <文本>\` | 向指定玩家发送私聊 |

开头需要带上对应 \`prefix\` 配置项，默认值为 \`#\`。
`

/**
 * 插件入口函数。
 * 这里只负责创建主流程对象，所有业务逻辑都放在 app/main.ts 中。
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
