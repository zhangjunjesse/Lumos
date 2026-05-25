export const TOOLS = [
  {
    name: 'transcribe_audio',
    description:
      'Transcribe an audio file to text using Lumos cloud ASR via the configured Speech provider. Supports wav/mp3/m4a/ogg/aac/amr/silk/flac/webm/opus. Provide either file_path (local absolute path under home or /tmp) or base64 (raw audio bytes). RETURNS A FILE PATH, NOT THE TEXT: the result contains `transcript_file` (absolute path under ~/.lumos/transcripts/), `char_count`, and audio metadata — call the Read tool on `transcript_file` to obtain the transcribed text. This keeps the model context flat regardless of recording length.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute local path to the audio file. Must be under user home or /tmp.',
        },
        base64: {
          type: 'string',
          description: 'Raw audio bytes encoded as base64. Use when caller has bytes in memory and no path on disk.',
        },
        mime_type: {
          type: 'string',
          description: 'Optional mime type override (e.g. audio/wav, audio/amr). Detected from extension when omitted.',
        },
        name: {
          type: 'string',
          description: 'Optional display name; helps the ASR provider when no path is given.',
        },
      },
    },
  },
];
