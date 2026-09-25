import { describe, it, expect } from 'vitest';
import { buildFileAttachmentMessage } from './executor';

describe('buildFileAttachmentMessage', () => {
  it('returns null when the action result did not request live injection', () => {
    expect(buildFileAttachmentMessage({ success: true, data: { id: '1', name: 'a.png' } })).toBeNull();
  });

  it('returns null when injectLive is set but rawContent or mediaType is missing', () => {
    expect(buildFileAttachmentMessage({ success: true, data: { id: '1', injectLive: true, mediaType: 'image/png' } })).toBeNull();
    expect(buildFileAttachmentMessage({ success: true, data: { id: '1', injectLive: true, rawContent: 'aGVsbG8=' } })).toBeNull();
  });

  it('returns null when there is no data at all', () => {
    expect(buildFileAttachmentMessage({ success: true })).toBeNull();
  });

  it('builds a hidden user message with the file as a content part', () => {
    const msg = buildFileAttachmentMessage({
      success: true,
      data: { id: 'res_1', name: 'test.png', mediaType: 'image/png', content: 'a description', rawContent: 'aGVsbG8=', injectLive: true },
    });
    expect(msg).not.toBeNull();
    expect(msg.role).toBe('user');
    expect(msg.isFileAttachment).toBe(true);
    expect(msg.sourceActionId).toBe('res_1');
    expect(msg.content).toEqual([
      { type: 'text', text: '[Attached file: test.png]' },
      { type: 'file', data: 'aGVsbG8=', mediaType: 'image/png' },
    ]);
    expect(typeof msg.timestamp).toBe('string');
  });

  it('falls back to id in the text part label when name is missing', () => {
    const msg = buildFileAttachmentMessage({
      success: true,
      data: { id: 'res_2', mediaType: 'application/pdf', rawContent: 'cGRm', injectLive: true },
    });
    expect(msg.content[0]).toEqual({ type: 'text', text: '[Attached file: res_2]' });
  });

  it('stamps stepIndex fields from indexPath, matching the prismMessage convention', () => {
    const msg = buildFileAttachmentMessage(
      { success: true, data: { id: 'res_3', mediaType: 'image/png', rawContent: 'YQ==', injectLive: true } },
      [2, 0],
    );
    expect(msg.stepIndex).toBe(3);
    expect(msg.stepIndex2).toBe(1);
  });

  it('does not inject when the action itself failed', () => {
    // success:false results never carry injectLive (attachFileActionHandler only
    // sets it in the success branch), but guard the helper's own behavior too.
    expect(buildFileAttachmentMessage({ success: false, error: 'nope' })).toBeNull();
  });
});
