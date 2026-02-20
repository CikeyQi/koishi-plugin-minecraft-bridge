import type { QueQiaoEvent, RequestOptions } from '@cikeyqi/queqiao-node-sdk'
import { Context, Service } from 'koishi'

export type McBridgeEventPayload = QueQiaoEvent

export const MC_BRIDGE_EVENT = 'mc-bridge/event' as const

export const MC_BRIDGE_ERR = {
  EMPTY_SERVER: 'MC_BRIDGE_EMPTY_SERVER',
  NEED_SELF_NAME: 'MC_BRIDGE_NEED_SELF_NAME',
} as const

export type McBridgeErrorCode = (typeof MC_BRIDGE_ERR)[keyof typeof MC_BRIDGE_ERR]

export interface McBridgeError extends Error {
  code: McBridgeErrorCode
}

export function makeMcBridgeError(code: McBridgeErrorCode, message: string): McBridgeError {
  const err = new Error(message) as McBridgeError
  err.name = 'McBridgeError'
  err.code = code
  return err
}

export interface McBridgeApi {
  request: (api: string, data: Record<string, unknown>, options?: RequestOptions) => Promise<unknown>
}

declare module 'koishi' {
  interface Context {
    mcBridge: McBridgeService
  }

  interface Events {
    'mc-bridge/event'(payload: McBridgeEventPayload): void
  }
}

export class McBridgeService extends Service {
  constructor(ctx: Context, private readonly api: McBridgeApi) {
    super(ctx, 'mcBridge', true)
  }

  request(api: string, data: Record<string, unknown>, options: RequestOptions = {}) {
    return this.api.request(api, data, options)
  }
}
