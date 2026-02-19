import type { ServerItemConfig } from '../values'
import { textOf, uniqTexts } from '../core/utils'

export class Route {
  private byName = new Map<string, ServerItemConfig>()
  private byChan = new Map<string, ServerItemConfig[]>()

  /**
   * 重建路由索引。
   * 启动时一次构建，后续查询就能常量时间命中。
   */
  reset(servers: ServerItemConfig[]) {
    this.byName.clear()
    this.byChan.clear()

    for (const srv of servers) {
      const name = textOf(srv.name)
      if (!name) continue

      this.byName.set(name, srv)
      for (const chan of uniqTexts(srv.channels || [])) {
        const list = this.byChan.get(chan)
        if (list) list.push(srv)
        else this.byChan.set(chan, [srv])
      }
    }
  }

  /**
   * 按服务器名获取配置。
   * 用于处理 MC 事件回推时快速定位目标服务器。
   */
  one(name: string) {
    return this.byName.get(textOf(name))
  }

  /**
   * 按群聊定位关联服务器。
   * 同时支持 `platform:channel` 和纯 `channel` 两种写法。
   */
  list(platform: string, channel: string) {
    const p = textOf(platform)
    const c = textOf(channel)
    if (!c) return []

    return [...new Set([
      ...(this.byChan.get(`${p}:${c}`) || []),
      ...(this.byChan.get(c) || []),
    ])]
  }
}
