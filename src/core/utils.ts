import type { JsonRecord } from './types'

/** 将任意值转成去空白字符串。 */
export const textOf = (value: unknown) => String(value ?? '').trim()

/** 去重并清洗字符串列表，常用于配置数组字段。 */
export const uniqTexts = (values: Iterable<unknown>): string[] => {
  const unique = new Set<string>()
  for (const value of values) {
    const text = textOf(value)
    if (text) unique.add(text)
  }
  return [...unique]
}

/** 判断值是否是普通对象（非 null，非数组）。 */
export const isRecord = (value: unknown): value is JsonRecord => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
)

/** 统一提取错误文案，避免日志出现 [object Object]。 */
export const toError = (error: unknown) => (
  error instanceof Error
    ? error.message
    : (isRecord(error) && typeof error.message === 'string')
      ? error.message
      : String(error || 'unknown error')
)

/** 安全序列化为 JSON 字符串，失败时回退为 String()。 */
export const toJson = (value: unknown) => {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/** 安全解析 JSON 字符串，只返回对象类型。 */
export const parseJson = (raw: unknown): JsonRecord | null => {
  if (isRecord(raw)) return raw
  if (typeof raw !== 'string') return null

  try {
    const parsed = JSON.parse(raw)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** 递归提取富文本节点中的可读文本。 */
const walkText = (node: unknown): string => {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return String(node)
  if (Array.isArray(node)) return node.map(walkText).join('')
  if (!isRecord(node)) return ''

  return [
    typeof node.text === 'string' ? node.text : '',
    typeof node.translate === 'string' ? node.translate : '',
    typeof node.key === 'string' ? node.key : '',
    Array.isArray(node.extra) ? node.extra.map(walkText).join('') : '',
    Array.isArray(node.with) ? node.with.map(walkText).join('') : '',
  ].join('')
}

/** 将原始富文本（json/string）尽量转成纯文本。 */
export const plainRaw = (raw: unknown): string => {
  if (raw === null || raw === undefined) return ''
  if (typeof raw !== 'string') return walkText(raw)

  const text = raw.trim()
  if (!text.startsWith('{') && !text.startsWith('[')) return raw

  const parsed = parseJson(text)
  const plain = parsed ? walkText(parsed) : ''
  return plain || raw
}

/** 从文本里提取 CICode 图片地址，并返回去除图片后的纯文本。 */
export const imageOf = (text: string) => {
  const match = text.match(/\[\[CICode,.*?url=([^,\]]+).*?\]\]/i)
  return match
    ? { text: text.replace(/\[\[CICode,.*?\]\]/i, '').trim(), url: match[1] }
    : { text, url: null as string | null }
}

/** 解析 channel 引用，支持 `platform:channelId` 与纯 channelId。 */
export const parseChannelRef = (raw: string) => {
  const value = textOf(raw)
  const idx = value.lastIndexOf(':')
  if (idx < 0) return { platform: '', channelId: value }

  return {
    platform: value.slice(0, idx),
    channelId: value.slice(idx + 1),
  }
}
