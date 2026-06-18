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

export interface EncoderConfig {
  format: StreamFormat
  bitrate: number
  sampleRate: number
  channels: 1 | 2
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
  uptime: number
  bytesSent: number
  bitrate: number
  format: StreamFormat
}

export interface LevelUpdate {
  left: number
  right: number
}

export type WSPayload =
  | { type: 'level'; payload: LevelUpdate }
  | { type: 'status'; payload: StreamStatus }
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
  format: 'mp3',
  bitrate: 192,
  sampleRate: 44100,
  channels: 2,
}
