![koishi-plugin-minecraft-bridge](
https://socialify.git.ci/CikeyQi/koishi-plugin-minecraft-bridge/image?description=1&font=Raleway&forks=1&issues=1&language=1&logo=https%3A%2F%2Fraw.githubusercontent.com%2FCikeyQi%2Fkoishi-plugin-minecraft-bridge%2Frefs%2Fheads%2Fmain%2Fpublic%2Flogo.png&name=1&owner=1&pattern=Circuit+Board&pulls=1&stargazers=1&theme=Auto)
<div align="center">

# Minecraft Bridge

基于 Koishi 的 Minecraft 消息互通插件，使用面向鹊桥 Protocol V2 的 Node.js SDK 实现群聊与服务器双向通信。

</div>

## ✨ 功能概览

- 群消息自动同步到 Minecraft。
- Minecraft 事件自动同步到群聊（聊天、进服、离服、死亡、成就等）。
- 支持多服务器、多群、多机器人路由。
- 支持正向连接（Koishi -> MC）与反向连接（MC -> Koishi）。
- 支持 Dash 风格命令与群内 RCON 前缀命令。
- 提供 `mcBridge` 服务，可在其他插件中直接监听事件或调用接口。

## 📦 安装

```sh
# pnpm
pnpm add koishi-plugin-minecraft-bridge

# yarn
yarn add koishi-plugin-minecraft-bridge

# npm
npm i koishi-plugin-minecraft-bridge
```

## 🚀 快速开始

1. 在 Minecraft 服务端安装 QueQiao：
   - https://modrinth.com/plugin/queqiao
2. 完成 QueQiao 基础配置，记录：
   - `server_name`
   - `access_token`
3. 在 Koishi 中配置本插件：
   - 至少添加一个 `servers[]`
   - `servers[].name` 必须与 `server_name` 完全一致
4. 将群聊与机器人映射到 `channels` 和 `bots`。

提示：如果不清楚 `channelId` 或 `bots`如何填写，可在群内使用 `inspect` 获取。

## ⚙️ 配置说明

### 全局配置

| 字段 | 说明 | 默认值 |
| --- | --- | --- |
| `prefix` | Dash 命令前缀，例如 `mc -q` | `mc` |
| `groupName` | 群消息同步到 MC 时是否附带群名 | `true` |
| `serverName` | MC 消息同步到群时是否附带服务器名 | `true` |
| `verb` | 玩家名与消息之间连接词 | `说：` |
| `debug` | 是否输出调试日志 | `false` |

### 反向连接配置

| 字段 | 说明 | 默认值 |
| --- | --- | --- |
| `reverse` | 是否启用反向连接（MC -> Koishi） | `true` |
| `path` | 反向 WebSocket 路径 | `/minecraft/ws` |
| `port` | 反向 WebSocket 端口 | `8080` |
| `token` | 反向连接 token（QueQiao `access_token`） | `''` |

### `servers[]` 配置

| 字段 | 说明 | 默认值 |
| --- | --- | --- |
| `name` | 服务器名，必须与 QueQiao `server_name` 一致 | 必填 |
| `channels` | 群目标列表，支持 `platform:channelId` 或纯 `channelId` | `[]` |
| `bots` | 发送群消息所使用的机器人 `selfId` 列表 | `[]` |
| `forward` | 是否启用正向连接（Koishi -> MC） | `true` |
| `url` | 正向 WebSocket 地址 | `ws://127.0.0.1:8081` |
| `token` | 正向连接 token（QueQiao `access_token`） | `''` |
| `retries` | 最大重连次数，`0` 表示不限 | `3` |
| `rcon` | 群内 RCON 前缀 | `/` |
| `users` | 保留字段（当前版本 RCON 仅允许 authority >= 4） | `[]` |
| `ciImage` | 图片是否转 CICode 后再发到 MC | `false` |
| `mask` | MC -> 群消息过滤正则（无需写 `/.../g`） | `''` |

## 🤖 命令说明

默认命令前缀是 `mc`。

| 命令 | 权限 | 说明 |
| --- | --- | --- |
| `mc -q [-s 服务器名]` | `authority >= 2` | 查询连接状态 |
| `mc -r [-s 服务器名]` | `authority >= 4` | 重连连接 |
| `mc -b <文本> [-s 服务器名]` | `authority >= 2` | 发送广播 |
| `mc -t <文本> [-s 服务器名]` | `authority >= 2` | 发送标题 |
| `mc -u <文本> [-s 服务器名]` | `authority >= 2` | 发送副标题 |
| `mc -a <文本> [-s 服务器名]` | `authority >= 2` | 发送动作栏 |
| `mc -p <玩家> <文本> [-s 服务器名]` | `authority >= 2` | 发送私聊 |
| `mc -c <命令> [-s 服务器名]` | `authority >= 4` | 发送 RCON |

## 🔄 同步机制

- 群 -> MC：普通群消息自动同步到绑定服务器。
- MC -> 群：事件自动同步到绑定群。
- 群内 RCON：发送 `rcon` 前缀（默认 `/`）命令，且用户 `authority >= 4` 时执行。

## 🧩 服务接口

可在其他 Koishi 插件中直接注入 `mcBridge`：

```ts
import { Context } from 'koishi'

export const inject = ['mcBridge']

export function apply(ctx: Context) {
  ctx.on('mc-bridge/event', async (eventData) => {
    if (eventData.sub_type !== 'player_join') return
    if (!eventData.server_name) return

    await ctx.mcBridge.request(
      'broadcast',
      { message: `欢迎 ${eventData.player.nickname || '玩家'} 加入游戏` },
      { selfName: eventData.server_name },
    )
  })
}
```

请求规则：

- 单服务器在线时可省略 `options.selfName`。
- 多服务器在线时必须传 `options.selfName`。

## 4️⃣ 常见排查

### `mc -q` 显示未连接

检查：

- `servers[].name` 是否与 `server_name` 完全一致（区分大小写）。
- token 是否与 QueQiao 一致。
- 正向模式下 `forward + url` 是否可访问。
- 反向模式下 `reverse/path/port/token` 是否匹配。

### MC 消息没有同步到群

检查：

- 是否配置了 `channels` 与 `bots`。
- 机器人是否在线。
- `mask` 是否误过滤全部内容。

### 群消息没有同步到 MC

检查：

- 当前是否群聊消息（私聊不会自动转发）。
- 群 `channelId` 是否已绑定到目标服务器。
- 是否误用 RCON 前缀导致消息被当作命令执行。

## 📄 License

    Copyright (c) 2026-present CikeyQi

    Licensed under the GNU Affero General Public License v3.0.
    You may not use this file except in compliance with the License.
    You may obtain a copy of the License at

    https://www.gnu.org/licenses/agpl-3.0.html
