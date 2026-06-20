export type AudioAPI = 'WASAPI' | 'ASIO' | 'DirectSound'
export type DeviceState = 'active' | 'disabled' | 'unplugged' | 'notpresent'
export type StreamFormat = 'mp3' | 'aac' | 'ogg'
export type IcecastProtocol = 'icecast2' | 'shoutcast'

export interface AudioDevice {
  id: string
  name: string
  api: AudioAPI
  state: DeviceState
  maxInputChannels: number
  defaultSampleRate: number
}

export interface ServerConfig {
  host: string
  port: number
  username: string
  password: string
  mountPoint: string
  protocol: IcecastProtocol
  useSSL: boolean
  name: string
  description: string
  genre: string
  url: string
  public: boolean
}

export type EncoderMode   = 'cbr' | 'vbr'
export type StereoMode    = 'auto' | 'stereo' | 'joint' | 'mono'

export interface EncoderConfig {
  format:     StreamFormat
  bitrate:    number
  sampleRate: number
  channels:   number
  mode:       EncoderMode
  quality:    number
  stereoMode: StereoMode
}

export interface StreamConfig {
  deviceId: string
  sampleRate: number
  channels: number
  format: StreamFormat
  bitrate: number
  server: ServerConfig
}

export interface StreamStatus {
  running: boolean
  connected: boolean
  reconnecting: boolean
  uptime: number
  bytesSent: number
  bitrate: number
  format: StreamFormat
}

export interface LevelUpdate {
  left: number
  right: number
}

// AllStreamStatus maps server-entry IDs to their live stream status.
// Only running streams appear in the map.
export type AllStreamStatus = Record<string, StreamStatus>

export type WSPayload =
  | { type: 'level'; payload: LevelUpdate }
  | { type: 'status'; payload: AllStreamStatus }
  | { type: 'error'; payload: { message: string } }

export interface FormatInfo {
  id: StreamFormat
  name: string
  codec: string
  bitrates: number[]
}

export const SAMPLE_RATES = [22050, 32000, 44100, 48000] as const
export const DEFAULT_SERVER: ServerConfig = {
  host: 'localhost',
  port: 8000,
  username: 'source',
  password: 'hackme',
  mountPoint: '/stream',
  protocol: 'icecast2',
  useSSL: false,
  name: 'Opencast Stream',
  description: '',
  genre: '',
  url: '',
  public: false,
}
export const DEFAULT_ENCODER: EncoderConfig = {
  format:     'mp3',
  bitrate:    192,
  sampleRate: 44100,
  channels:   2,
  mode:       'cbr',
  quality:    4,
  stereoMode: 'auto',
}

export interface ServerEntry {
  id: string
  label: string
  config: ServerConfig
}

export function makeServerEntry(label = 'Neuer Server'): ServerEntry {
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    label,
    config: { ...DEFAULT_SERVER },
  }
}

export interface LogEntry {
  id: string
  time: string
  event: string
  details: string
  type: 'ok' | 'warn' | 'error' | 'info'
  streamId: string
}

export interface ChartPoint {
  time: number
  value: number
}

export type ChartHistory = Record<string, { bitrate: ChartPoint[]; listeners: ChartPoint[] }>

export type NavPage = 'streams' | 'aufnahmen' | 'statistiken' | 'protokolle' | 'einstellungen'
