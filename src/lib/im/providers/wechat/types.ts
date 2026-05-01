/**
 * WeChat Provider — ilink JSON Types
 *
 * 复刻自 cc-connect/platform/weixin/types.go (MIT)。
 * 字段命名与 ilink HTTP API 严格对齐（snake_case）。
 */

// ---- Message type / item type / state constants ----------------------------

export const MESSAGE_TYPE_USER = 1;
export const MESSAGE_TYPE_BOT = 2;

export const MESSAGE_ITEM_TEXT = 1;
export const MESSAGE_ITEM_IMAGE = 2;
export const MESSAGE_ITEM_VOICE = 3;
export const MESSAGE_ITEM_FILE = 4;
export const MESSAGE_ITEM_VIDEO = 5;

export const MESSAGE_STATE_FINISH = 2;

export const ERR_SESSION_EXPIRED = -14;

// ---- JSON shapes -----------------------------------------------------------

export interface BaseInfo {
  channel_version?: string;
}

export interface TextItem {
  text?: string;
}

export interface CdnMedia {
  encrypt_query_param?: string;
  aes_key?: string;       // base64-wrapped: either 16 raw bytes, or 32-char hex ASCII inside base64
  encrypt_type?: number;
}

export interface ImageItem {
  media?: CdnMedia;
  thumb_media?: CdnMedia;
  aeskey?: string;        // 32-char hex; takes precedence over media.aes_key
  mid_size?: number;
}

export interface VoiceItem {
  media?: CdnMedia;
  text?: string;          // ASR transcript
  encode_type?: number;
}

export interface FileItem {
  media?: CdnMedia;
  file_name?: string;
  len?: string;
}

export interface VideoItem {
  media?: CdnMedia;
  thumb_media?: CdnMedia;
  video_size?: number;
}

export interface MessageItem {
  type?: number;
  text_item?: TextItem;
  image_item?: ImageItem;
  voice_item?: VoiceItem;
  file_item?: FileItem;
  video_item?: VideoItem;
  ref_msg?: { message_item?: MessageItem; title?: string };
}

export interface WeixinInboundMsg {
  seq?: number;
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  client_id?: string;
  create_time_ms?: number;
  session_id?: string;
  message_type?: number;
  message_state?: number;
  item_list?: MessageItem[];
  context_token?: string;
}

export interface GetUpdatesResp {
  ret: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinInboundMsg[];
  get_updates_buf: string;
  longpolling_timeout_ms?: number;
}

export interface SendMessageResp {
  ret: number;
  errcode?: number;
  errmsg?: string;
}

export interface OutboundMsg {
  from_user_id: string;
  to_user_id: string;
  client_id: string;
  message_type: number;
  message_state: number;
  item_list: MessageItem[];
  context_token: string;
}
