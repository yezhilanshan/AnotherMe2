import { describe, expect, it } from 'vitest';
import { detectAudioMimeType } from '@/lib/audio/asr-providers';

describe('detectAudioMimeType', () => {
  it.each([
    ['wav', Buffer.from('RIFF\x00\x00\x00\x00WAVE', 'binary'), 'audio/wav'],
    ['webm', Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), 'audio/webm'],
    ['ogg', Buffer.from('OggS', 'ascii'), 'audio/ogg'],
    ['aac', Buffer.from([0xff, 0xf1, 0x50, 0x80]), 'audio/aac'],
    ['mp3', Buffer.from('ID3\x04', 'binary'), 'audio/mpeg'],
    ['m4a/mp4', Buffer.from('\x00\x00\x00\x18ftypM4A ', 'binary'), 'audio/mp4'],
  ])('recognizes %s headers', (_label, buffer, expected) => {
    expect(detectAudioMimeType(buffer)).toBe(expected);
  });

  it('does not pretend unknown audio is wav', () => {
    expect(detectAudioMimeType(Buffer.from([0x00, 0x01, 0x02]))).toBe(
      'application/octet-stream',
    );
  });
});
