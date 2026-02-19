import type { Context } from 'koishi'
import type { I18nTranslate, SessionLike } from '../core/types'
import zhCN from '../locale/zh-CN'
import enUS from '../locale/en-US'

const NS = 'minecraft-bridge'

export class Lang {
  constructor(private ctx: Context) {}

  /**
   * 注册中英文文案。
   * 这样插件在没有手动配置语言时也能输出可读提示。
   */
  load() {
    this.ctx.i18n?.define('zh-CN', zhCN)
    this.ctx.i18n?.define('en-US', enUS)
  }

  /**
   * 渲染全局文案。
   * 当没有会话对象时，用它兜底输出系统消息。
   */
  root(key: string, fallback: string, args: readonly unknown[] = []) {
    const path = `${NS}.${key}`
    try {
      const out = this.ctx.i18n?.render([], [path], args as unknown as object).join('')
      return out && out !== path ? out : fallback
    } catch {
      return fallback
    }
  }

  /**
   * 渲染会话文案。
   * 优先跟随当前会话语言，提升群内提示的可读性。
   */
  sess(session: SessionLike, key: string, fallback: string, args: readonly unknown[] = []) {
    const path = `${NS}.${key}`
    try {
      const out = session.text?.(path, args)
      return out && out !== path ? out : fallback
    } catch {
      return fallback
    }
  }

  /**
   * 返回统一翻译函数。
   * 调用方只需关心 key 与默认文案，不需要再判断有无会话。
   */
  pick(session?: SessionLike): I18nTranslate {
    return (key, fallback, args = []) => {
      if (session) return this.sess(session, key, fallback, args)
      return this.root(key, fallback, args)
    }
  }
}
