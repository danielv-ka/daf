import { describe, it, expect } from 'vitest';
import { resolveDataReferences, DataReferenceError, dataReferenceSupport } from './dataReferences';

const PNG_ID = 'cmpng000000000000000png01';
const PDF_ID = 'cmpdf000000000000000pdf01';
const XLSX_ID = 'cmxls000000000000000xls01';
const TXT_ID = 'cmtxt000000000000000txt01';
const LOOSE_ID = 'cmloose00000000000000lose';

const resources: Record<string, any> = {
  [PNG_ID]: { id: PNG_ID, name: 'chart.png', type: 'data', metadata: { content: Buffer.from('png-bytes').toString('base64'), mediaType: 'image/png' } },
  [PDF_ID]: { id: PDF_ID, name: 'report.pdf', type: 'data', metadata: { content: Buffer.from('%PDF-1.4').toString('base64'), mediaType: 'application/pdf' } },
  [XLSX_ID]: { id: XLSX_ID, name: 'q1.xlsx', type: 'data', metadata: { content: Buffer.from('PK').toString('base64'), mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } },
  [TXT_ID]: { id: TXT_ID, name: 'notes.txt', type: 'data', metadata: { content: Buffer.from('hello from a text file').toString('base64'), mediaType: 'text/plain' } },
  [LOOSE_ID]: { id: LOOSE_ID, name: 'not-attached.png', type: 'data', metadata: { content: Buffer.from('x').toString('base64'), mediaType: 'image/png' } },
};

const adapter: any = {
  db: {
    resource: {
      findMany: async ({ where }: any) => (where.id.in as string[]).map((id) => resources[id]).filter((r) => r && r.type === where.type),
    },
    process: {
      findMany: async () => [{ resourceIds: [PNG_ID, PDF_ID, XLSX_ID, TXT_ID] }],
    },
  },
};

const base = { userId: 'user_1', adapter, processId: 'process_1' };

describe('resolveDataReferences', () => {
  it('leaves text without references, and unrelated $WORDS, untouched', async () => {
    const r = await resolveDataReferences('Total is $TOTAL and $SKILLS stay as they are.', { ...base, model: 'claude-sonnet-5' });
    expect(r.text).toBe('Total is $TOTAL and $SKILLS stay as they are.');
    expect(r.attachmentMessages).toEqual([]);
  });

  it('replaces an image reference with a label and attaches the real file', async () => {
    const r = await resolveDataReferences(`Describe this. $${PNG_ID}`, { ...base, model: 'claude-sonnet-5' });
    expect(r.text).toBe('Describe this. [Attached file: chart.png]');
    expect(r.attachmentMessages).toHaveLength(1);
    const msg = r.attachmentMessages[0];
    expect(msg.isFileAttachment).toBe(true);
    expect(msg.sourceResourceId).toBe(PNG_ID);
    expect(msg.content[1]).toMatchObject({ type: 'file', mediaType: 'image/png', data: resources[PNG_ID].metadata.content });
  });

  it('fails clearly when the model cannot read the type', async () => {
    await expect(resolveDataReferences(`Summarize $${PDF_ID}`, { ...base, model: 'mistral-medium' }))
      .rejects.toThrow(DataReferenceError);
    await expect(resolveDataReferences(`Summarize $${PDF_ID}`, { ...base, model: 'mistral-medium' }))
      .rejects.toThrow(/mistral-medium can't read "report.pdf"/);
  });

  it('points spreadsheets at attachFile, since no model reads them directly', async () => {
    await expect(resolveDataReferences(`Check $${XLSX_ID}`, { ...base, model: 'claude-sonnet-5' }))
      .rejects.toThrow(/attachFile/);
  });

  it('inlines plain text for any model', async () => {
    const r = await resolveDataReferences(`Read $${TXT_ID}`, { ...base, model: 'deepseek-chat' });
    expect(r.attachmentMessages[0].content[0].text).toContain('hello from a text file');
  });

  it('refuses a data resource that is not attached, unless the caller allows it', async () => {
    await expect(resolveDataReferences(`Look at $${LOOSE_ID}`, { ...base, model: 'claude-sonnet-5' }))
      .rejects.toThrow(/not attached/);
    const r = await resolveDataReferences(`Look at $${LOOSE_ID}`, { ...base, model: 'claude-sonnet-5', extraResourceIds: [LOOSE_ID] });
    expect(r.attachmentMessages).toHaveLength(1);
  });

  it('does not attach the same file twice in one run', async () => {
    const existingMessages = [{ role: 'user', isFileAttachment: true, sourceResourceId: PNG_ID, content: [] }];
    const r = await resolveDataReferences(`Again: $${PNG_ID}`, { ...base, model: 'claude-sonnet-5', existingMessages });
    expect(r.text).toBe('Again: [Attached file: chart.png]');
    expect(r.attachmentMessages).toEqual([]);
  });
});

describe('resolveDataReferences with several readers', () => {
  it('passes when every model can read the file', async () => {
    const r = await resolveDataReferences(`See $${PNG_ID}`, { ...base, models: ['claude-sonnet-5', 'kimi-k3'] });
    expect(r.attachmentMessages).toHaveLength(1);
  });

  it('names the model that cannot read it', async () => {
    await expect(resolveDataReferences(`See $${PDF_ID}`, { ...base, models: ['claude-sonnet-5', 'grok-4'] }))
      .rejects.toThrow(/grok-4 can't read "report.pdf"/);
  });

  it('accepts any readable type when no reader is known yet', async () => {
    const r = await resolveDataReferences(`See $${PDF_ID}`, { ...base, models: [] });
    expect(r.attachmentMessages).toHaveLength(1);
    await expect(resolveDataReferences(`See $${XLSX_ID}`, { ...base, models: [] })).rejects.toThrow(DataReferenceError);
  });
});

describe('dataReferenceSupport', () => {
  it('matches what each provider accepts as a plain file part', () => {
    expect(dataReferenceSupport('claude-sonnet-5', 'application/pdf')).toBe('file');
    expect(dataReferenceSupport('grok-4', 'application/pdf')).toBeNull();
    expect(dataReferenceSupport('kimi-k3', 'image/png')).toBe('file');
    expect(dataReferenceSupport('deepseek-chat', 'image/png')).toBeNull();
    expect(dataReferenceSupport('deepseek-chat', 'text/csv')).toBe('text');
  });
});
