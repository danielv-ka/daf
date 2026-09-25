import { describe, it, expect } from 'vitest';
import { buildActionTools, annotateActionCatalogWithToolNotes } from './actionTools';
import { ACTION_TYPES, sendEmailParamsSchema } from '../protocol';

describe('buildActionTools', () => {
  it('gives every tool its real description, never the generic fallback', () => {
    const tools = buildActionTools() as Record<string, any>;
    const fallbacks = Object.entries(tools).filter(([, t]) => t.description.startsWith('Run the "')).map(([k]) => k);
    expect(fallbacks).toEqual([]);
    expect(tools.previewSearch.description).toContain('search');
  });

  it('returns a tool for every action variant that has a schema', () => {
    const tools = buildActionTools();
    expect(Object.keys(tools)).toContain('sendEmail');
    expect(Object.keys(tools)).toContain('scrape');
    expect(Object.keys(tools)).toContain('dbFind');
    expect(Object.keys(tools)).toContain('runCode');
    expect(Object.keys(tools)).toContain('readMdFile');
  });

  it('excludes crawl (deactivated, no schema)', () => {
    const tools = buildActionTools();
    expect(Object.keys(tools)).not.toContain('crawl');
  });

  it('excludes the *Data variants (no schema, not in ACTION_TYPES)', () => {
    const tools = buildActionTools();
    for (const variant of ['readData', 'writeData', 'createData', 'deleteData', 'renameData', 'duplicateData']) {
      expect(Object.keys(tools)).not.toContain(variant);
    }
  });

  it('every returned tool has a non-empty description and an input schema', () => {
    const tools = buildActionTools();
    for (const [variant, t] of Object.entries(tools)) {
      expect(t.description, `${variant} should have a description`).toBeTruthy();
      expect(t.inputSchema, `${variant} should have an inputSchema`).toBeTruthy();
    }
  });

  it('passes the exact same Zod schema through unmodified (no re-derivation)', () => {
    const tools = buildActionTools();
    expect(tools.sendEmail!.inputSchema).toBe(sendEmailParamsSchema);
    expect(sendEmailParamsSchema.safeParse({ to: 'a@b.com', subject: 'Hi', content: 'Body' }).success).toBe(true);
  });

  it('allowedVariants restricts the returned tool set', () => {
    const tools = buildActionTools({ allowedVariants: ['sendEmail', 'scrape'] });
    expect(Object.keys(tools).sort()).toEqual(['scrape', 'sendEmail']);
  });

  it('covers every ACTION_TYPES entry with a schema (no accidental drift from validators.ts)', () => {
    const tools = buildActionTools();
    // Every action wired into ACTION_TYPES should either be a tool or be one
    // of the known, deliberately-unschema'd exceptions.
    const allVariants = Object.values(ACTION_TYPES) as string[];
    for (const variant of allVariants) {
      if (variant === 'crawl') continue;
      expect(Object.keys(tools), `${variant} should have a tool`).toContain(variant);
    }
  });
});

describe('annotateActionCatalogWithToolNotes', () => {
  const catalogEntry = (variant: string) => `**News Search**

**JSON Format:**
"{
  "type": "action",
  "variant": "${variant}",
  "parameters": {
    "query": "search query"
  }
}"

*(Quotation marks added to escape execution - this is documentation only)*

**Description:**
Searches news sources.`;

  it('does nothing when no tool variants are given', () => {
    const messages = [{ role: 'user', content: catalogEntry('newsSearch') }];
    expect(annotateActionCatalogWithToolNotes(messages, [])).toBe(messages);
  });

  it('leaves a message without a JSON-format block untouched', () => {
    const messages = [{ role: 'user', content: 'just a plain message' }];
    const result = annotateActionCatalogWithToolNotes(messages, ['newsSearch']);
    expect(result[0].content).toBe('just a plain message');
  });

  it('inserts a note right after the JSON-format block for a covered variant', () => {
    const messages = [{ role: 'user', content: catalogEntry('newsSearch') }];
    const result = annotateActionCatalogWithToolNotes(messages, ['newsSearch']);
    const content = result[0].content as string;
    expect(content).toContain('A native tool is also available for the "newsSearch" action');
    // The example itself must stay fully intact.
    expect(content).toContain('"variant": "newsSearch"');
    // The note comes after the quotation-marks line, before the Description.
    const noteIndex = content.indexOf('**Note:**');
    const descIndex = content.indexOf('**Description:**');
    expect(noteIndex).toBeGreaterThan(-1);
    expect(noteIndex).toBeLessThan(descIndex);
  });

  it('only annotates variants actually passed in, leaving others alone', () => {
    const messages = [{ role: 'user', content: catalogEntry('newsSearch') }];
    const result = annotateActionCatalogWithToolNotes(messages, ['search']);
    expect(result[0].content).not.toContain('**Note:**');
  });

  it('handles content-parts array shape (prompt-caching format)', () => {
    const messages = [{
      role: 'user',
      content: [{ type: 'text', text: catalogEntry('newsSearch'), providerOptions: {} }],
    }];
    const result = annotateActionCatalogWithToolNotes(messages, ['newsSearch']);
    const parts = result[0].content as any[];
    expect(parts[0].text).toContain('**Note:**');
    expect(parts[0].providerOptions).toEqual({});
  });
});
