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
  commands: string[]
  ciImage: boolean
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
  servers: ServerConfig[]
  debug: boolean
}

export type ServerItemConfig = ServerConfig
