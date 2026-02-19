import { Schema } from 'koishi'

export interface ServerConfig {
  name: string
  forward: boolean
  url: string
  token: string
  retries: number
  channels: string[]
  bots: string[]
  rcon: string
  users: string[]
  mask: string
}

export interface BridgeConfig {
  reverse: boolean
  path: string
  port: number
  token: string
  prefix: string
  groupName: boolean
  serverName: boolean
  verb: string
  ciImage: boolean
  servers: ServerConfig[]
  debug: boolean
}

export type ServerItemConfig = ServerConfig

/**
 * 生成字符串数组配置项。
 * 使用表格控件编辑，比单行文本更不容易写错。
 */
const textList = (desc: string) => (
  Schema.array(Schema.string().required())
    .role('table')
    .default([])
    .description(desc)
)

const mapSchema = Schema.object({
  name: Schema.string().required().description('服务器名（需和 QueQiao 的 server_name 一致）'),
  channels: textList('群聊列表，格式为 平台名:群组Id，例如 sandbox:djbup13icuk:#'),
  bots: textList('发送群消息用的机器人 自身Id 列表'),
}).description('基础映射')

const wsSchema = Schema.object({
  forward: Schema.boolean().default(true).description('是否启用该服务器的正向 WebSocket'),
  url: Schema.string().role('link').default('ws://127.0.0.1:8081').description('正向 WebSocket 地址'),
  token: Schema.string().role('secret').default('').description('正向连接 token（access_token）'),
  retries: Schema.natural().default(3).description('重连次数上限（0 表示不限）'),
}).description('连接设置').collapse()

const cmdSchema = Schema.object({
  rcon: Schema.string().default('/').description('RCON 前缀（例如 /list）'),
  users: textList('允许执行 RCON 的用户 ID 列表（空列表仅管理员可用）'),
}).description('命令与权限').collapse()

const msgSchema = Schema.object({
  mask: Schema.string().default('').description('转发到群前的屏蔽正则（不需要写 /.../g）'),
}).description('消息处理').collapse()

// 单个服务器配置
export const serverConfigSchema: Schema<ServerConfig> = Schema.intersect([
  mapSchema,
  wsSchema,
  cmdSchema,
  msgSchema,
]).description('服务器配置').collapse()

const appSchema = Schema.object({
  prefix: Schema.string().default('#').description('内置命令前缀（例如 #mcs）'),
  groupName: Schema.boolean().default(true).description('群聊消息向MC同步时附带群名'),
  serverName: Schema.boolean().default(true).description('MC消息向群聊同步时附带服务器名'),
  verb: Schema.string().default('说：').description('玩家名和消息之间的连接词'),
  ciImage: Schema.boolean().default(false).description('是否将图片转成 CICode 再发到 MC'),
}).description('全局行为')

const reverseSchema = Schema.object({
  reverse: Schema.boolean().default(true).description('是否启用反向 WebSocket'),
  path: Schema.string().default('/minecraft/ws').description('反向 WebSocket 路径'),
  port: Schema.natural().min(1).max(65535).default(8080).description('反向 WebSocket 端口'),
  token: Schema.string().role('secret').default('').description('反向连接 token（access_token）'),
}).description('反向连接').collapse()

const listSchema = Schema.object({
  servers: Schema.array(serverConfigSchema).default([]).description('服务器列表'),
}).description('服务器列表')

const debugSchema = Schema.object({
  debug: Schema.boolean().default(false).description('调试模式（会输出更多日志）'),
}).description('调试').collapse()

// 插件总配置
export const bridgeConfigSchema: Schema<BridgeConfig> = Schema.intersect([
  appSchema,
  reverseSchema,
  listSchema,
  debugSchema,
])
