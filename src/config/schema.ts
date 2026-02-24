import { Schema } from 'koishi'
import type { BridgeConfig, ServerConfig } from './types'

/**
 * 生成字符串列表配置。
 * 统一使用表格编辑，避免手动输入时遗漏分隔符。
 */
const textArray = (description: string) => (
  Schema.array(Schema.string().required())
    .role('table')
    .default([])
    .description(description)
)

const mapSchema = Schema.object({
  name: Schema.string().required().description('服务器名，必须与 QueQiao 的 server_name 完全一致'),
  channels: textArray('群聊列表，支持 platform:channelId 或纯 channelId'),
  bots: textArray('负责发送群消息的机器人 selfId 列表'),
}).description('路由映射')

const linkSchema = Schema.object({
  forward: Schema.boolean().default(true).description('是否启用该服务器的正向连接'),
  url: Schema.string().role('link').default('ws://127.0.0.1:8081').description('正向 WebSocket 地址'),
  token: Schema.string().role('secret').default('').description('正向连接 access_token'),
  retries: Schema.natural().default(3).description('最大重连次数，0 表示不限次数'),
}).description('连接设置').collapse()

const cmdSchema = Schema.object({
  rcon: Schema.string().default('/').description('群内 RCON 前缀，例如 /list'),
  users: textArray('群内前缀 RCON 白名单'),
  commands: textArray('群内前缀 RCON 命令白名单'),
}).description('命令设置').collapse()

const syncSchema = Schema.object({
  ciImage: Schema.boolean().default(false).description('是否将图片转换为 CICode 再发送到 MC'),
  mask: Schema.string().default('').description('转发到群前的过滤正则（无需写 /.../g）'),
}).description('同步设置').collapse()

/** 单个服务器配置。 */
export const serverConfigSchema: Schema<ServerConfig> = Schema.intersect([
  mapSchema,
  linkSchema,
  cmdSchema,
  syncSchema,
]).description('服务器配置').collapse()

const appSchema = Schema.object({
  prefix: Schema.string().default('mc').description('内置命令前缀，例如 mc -q'),
  groupName: Schema.boolean().default(true).description('群消息转发到 MC 时是否携带群名'),
  serverName: Schema.boolean().default(true).description('MC 消息转发到群时是否显示服务器名'),
  verb: Schema.string().default('说：').description('玩家名与消息之间的连接词'),
}).description('全局行为')

const reverseSchema = Schema.object({
  reverse: Schema.boolean().default(true).description('是否启用反向 WebSocket'),
  path: Schema.string().default('/minecraft/ws').description('反向 WebSocket 路径'),
  port: Schema.natural().min(1).max(65535).default(8080).description('反向 WebSocket 端口'),
  token: Schema.string().role('secret').default('').description('反向连接 access_token'),
}).description('反向连接').collapse()

const listSchema = Schema.object({
  servers: Schema.array(serverConfigSchema).default([]).description('服务器列表'),
}).description('服务器列表')

const debugSchema = Schema.object({
  debug: Schema.boolean().default(false).description('是否输出调试日志'),
}).description('调试').collapse()

/** 插件总配置。 */
export const bridgeConfigSchema: Schema<BridgeConfig> = Schema.intersect([
  appSchema,
  reverseSchema,
  listSchema,
  debugSchema,
])
