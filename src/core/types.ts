export type JsonRecord = Record<string, unknown>

export interface SessionElementLike {
  type: string
  attrs?: JsonRecord
}

export interface SessionLike {
  platform?: string | undefined
  subtype?: string | undefined
  channelId?: string | undefined
  channelName?: string | undefined
  guildId?: string | undefined
  guildName?: string | undefined
  userId?: string | undefined
  username?: string | undefined
  authority?: number | undefined
  content?: string | undefined
  elements?: SessionElementLike[] | undefined
  user?: { authority?: number | undefined } | undefined
  author?: {
    nick?: string | undefined
    name?: string | undefined
  } | undefined
  event?: JsonRecord & {
    group_name?: string | undefined
    guild?: { name?: string | undefined } | undefined
  } | undefined
  text?: (path: string, params?: readonly unknown[]) => string
  send: (content: string) => Promise<unknown>
}

export type I18nTranslate = (key: string, fallback: string, params?: readonly unknown[]) => string
