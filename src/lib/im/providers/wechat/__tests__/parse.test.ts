import {
  MESSAGE_ITEM_FILE,
  MESSAGE_ITEM_IMAGE,
  MESSAGE_ITEM_TEXT,
  type MessageItem,
} from '../client';
import { extractInboundFiles, extractInboundImages } from '../parse';

describe('wechat/parse: extractInboundImages', () => {
  test('extracts image_item with hex aeskey on imageItem', () => {
    const items: MessageItem[] = [
      {
        type: MESSAGE_ITEM_IMAGE,
        image_item: {
          media: { encrypt_query_param: 'enc-abc', encrypt_type: 1 },
          aeskey: '0123456789abcdef0123456789abcdef',
        },
      },
    ];
    const tasks = extractInboundImages(items);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].encryptedQueryParam).toBe('enc-abc');
    expect(tasks[0].aesKey.toString('hex')).toBe('0123456789abcdef0123456789abcdef');
  });

  test('falls back to media.aes_key (base64-wrapped) when no aeskey hex', () => {
    const raw = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');
    const wrapped = Buffer.from(raw.toString('hex'), 'utf8').toString('base64');
    const items: MessageItem[] = [
      {
        type: MESSAGE_ITEM_IMAGE,
        image_item: {
          media: { encrypt_query_param: 'enc-x', aes_key: wrapped, encrypt_type: 1 },
        },
      },
    ];
    const tasks = extractInboundImages(items);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].aesKey).toEqual(raw);
  });

  test('skips items missing encrypt_query_param', () => {
    expect(extractInboundImages([{ type: MESSAGE_ITEM_IMAGE, image_item: {} }])).toHaveLength(0);
  });

  test('skips items missing both aes key sources', () => {
    const items: MessageItem[] = [
      { type: MESSAGE_ITEM_IMAGE, image_item: { media: { encrypt_query_param: 'x' } } },
    ];
    expect(extractInboundImages(items)).toHaveLength(0);
  });
});

describe('wechat/parse: extractInboundFiles', () => {
  function makeFileItem(name: string, len: string): MessageItem {
    const raw = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
    const wrapped = Buffer.from(raw.toString('hex'), 'utf8').toString('base64');
    return {
      type: MESSAGE_ITEM_FILE,
      file_item: {
        media: { encrypt_query_param: 'enc-file-1', aes_key: wrapped, encrypt_type: 1 },
        file_name: name,
        len,
      },
    };
  }

  test('extracts file_item with name + length', () => {
    const tasks = extractInboundFiles([makeFileItem('report.docx', '12345')], 'msg-1');
    expect(tasks).toHaveLength(1);
    expect(tasks[0].fileName).toBe('report.docx');
    expect(tasks[0].declaredLen).toBe(12345);
  });

  test('preserves Chinese filenames', () => {
    const tasks = extractInboundFiles([makeFileItem('季度报告.xlsx', '999')], 'msg-2');
    expect(tasks[0].fileName).toBe('季度报告.xlsx');
  });

  test('sanitizes path separators / control chars', () => {
    const tasks = extractInboundFiles([makeFileItem('../etc/passwd', '1')], 'msg-3');
    expect(tasks[0].fileName).not.toContain('..');
    expect(tasks[0].fileName).not.toContain('/');
  });

  test('falls back to fallbackPrefix when name is empty', () => {
    const tasks = extractInboundFiles([makeFileItem('', '1')], 'msg-4');
    expect(tasks[0].fileName).toMatch(/^msg-4-0\.bin$/);
  });

  test('skips text items / files without media', () => {
    const items: MessageItem[] = [
      { type: MESSAGE_ITEM_TEXT, text_item: { text: 'hi' } },
      { type: MESSAGE_ITEM_FILE, file_item: { file_name: 'x.zip' } }, // no media
    ];
    expect(extractInboundFiles(items, 'msg-5')).toHaveLength(0);
  });

  test('skips file_item with malformed aes_key', () => {
    const items: MessageItem[] = [
      {
        type: MESSAGE_ITEM_FILE,
        file_item: {
          media: { encrypt_query_param: 'x', aes_key: 'not-base64-or-wrong-length' },
          file_name: 'x.bin',
        },
      },
    ];
    expect(extractInboundFiles(items, 'msg-6')).toHaveLength(0);
  });
});
