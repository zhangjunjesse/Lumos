import {
  buildAudioTranscriptionInstruction,
  inferAudioMimeFromFilename,
  isAudioFileLike,
} from '../audio-attachments';

describe('chat audio attachment helpers', () => {
  test('detects audio by MIME type or filename extension', () => {
    expect(isAudioFileLike({ mediaType: 'audio/mp4', filename: 'recording.m4a' })).toBe(true);
    expect(isAudioFileLike({ mediaType: '', filename: 'voice.silk' })).toBe(true);
    expect(isAudioFileLike({ type: 'application/octet-stream', name: 'clip.opus' })).toBe(true);
    expect(isAudioFileLike({ type: 'application/pdf', name: 'report.pdf' })).toBe(false);
  });

  test('infers MIME type for cloud ASR formats', () => {
    expect(inferAudioMimeFromFilename('voice.amr')).toBe('audio/amr');
    expect(inferAudioMimeFromFilename('voice.silk')).toBe('audio/silk');
    expect(inferAudioMimeFromFilename('meeting.flac')).toBe('audio/flac');
    expect(inferAudioMimeFromFilename('unknown.bin')).toBe('application/octet-stream');
  });

  test('builds prompt instruction with file_path for transcription', () => {
    const instruction = buildAudioTranscriptionInstruction([
      {
        filePath: '/Users/test/.lumos/.lumos-uploads/voice.m4a',
        name: 'voice.m4a',
        type: 'audio/mp4',
        size: 1024 * 1024,
      },
    ]);

    expect(instruction).toContain('transcribe_audio');
    expect(instruction).toContain('file_path: /Users/test/.lumos/.lumos-uploads/voice.m4a');
    expect(instruction).toContain('Do not use Read/Bash/ffmpeg/local whisper');
  });
});
