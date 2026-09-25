/**
 * Tests for all action builders and validators
 */

import { describe, it, expect } from 'vitest';
import {
  // Action builders
  sendEmailAction,
  scrapeAction,
  searchAction,
  newsSearchAction,
  previewSearchAction,
  tavilySearchAction,
  readDocumentAction,
  writeDocumentAction,
  formatDocumentAction,
  removeDocumentAction,
  renameDocumentAction,
  duplicateDocumentAction,
  addFolderAction,
  removeFolderAction,
  readFolderAction,
  renameFolderAction,
  addDocumentAction,
  createDatabaseAction,
  readDatabaseAction,
  updateDatabaseAction,
  deleteDatabaseAction,
  writeDatabaseAction,
  duplicateDatabaseAction,
  // Editor action builders
  fixSpellingGrammarAction,
  rewriteAction,
  extendTextAction,
  reduceTextAction,
  simplifyAction,
  completeSentenceAction,
  translateAction,
  formatTextAction,
  directiveAction,
  // Validators
  validateAction,
  validateEditorAction,
  isValidAction,
  isValidEditorAction,
} from './index';

// ============================================================================
// Action Builders
// ============================================================================

describe('Action Builders', () => {
  describe('sendEmailAction', () => {
    it('should build a send email action', () => {
      const action = sendEmailAction('user@example.com', 'Hello', 'Body text');
      expect(action.type).toBe('action');
      expect(action.variant).toBe('sendEmail');
      expect(action.parameters.to).toBe('user@example.com');
      expect(action.parameters.subject).toBe('Hello');
      expect(action.parameters.content).toBe('Body text');
    });
  });

  describe('scrapeAction', () => {
    it('should build a scrape action without timeout', () => {
      const action = scrapeAction('https://example.com');
      expect(action.type).toBe('action');
      expect(action.variant).toBe('scrape');
      expect(action.parameters.url).toBe('https://example.com');
      expect(action.parameters.timeout).toBeUndefined();
    });

    it('should build a scrape action with timeout', () => {
      const action = scrapeAction('https://example.com', 5000);
      expect(action.parameters.timeout).toBe(5000);
    });
  });

  describe('searchAction', () => {
    it('should build a search action', () => {
      const action = searchAction('TypeScript tutorial');
      expect(action.variant).toBe('search');
      expect(action.parameters.query).toBe('TypeScript tutorial');
    });

    it('should build a search action with limit', () => {
      const action = searchAction('query', 10);
      expect(action.parameters.limit).toBe(10);
    });
  });

  describe('newsSearchAction', () => {
    it('should build a news search action with only query', () => {
      const action = newsSearchAction('AI news');
      expect(action.type).toBe('action');
      expect(action.variant).toBe('newsSearch');
      expect(action.parameters.query).toBe('AI news');
    });

    it('should build a news search action with all options', () => {
      const action = newsSearchAction('AI news', {
        limit: 10,
        ignoreInvalidURLs: true,
        tbs: 'qdr:d',
        location: 'Germany',
      });
      expect(action.parameters.limit).toBe(10);
      expect(action.parameters.ignoreInvalidURLs).toBe(true);
      expect(action.parameters.tbs).toBe('qdr:d');
      expect(action.parameters.location).toBe('Germany');
    });
  });

  describe('previewSearchAction', () => {
    it('should build a preview search action', () => {
      const action = previewSearchAction('latest tech');
      expect(action.type).toBe('action');
      expect(action.variant).toBe('previewSearch');
      expect(action.parameters.query).toBe('latest tech');
    });

    it('should build a preview search action with sources', () => {
      const action = previewSearchAction('news query', { sources: ['news'], limit: 5 });
      expect(action.parameters.sources).toEqual(['news']);
      expect(action.parameters.limit).toBe(5);
    });
  });

  describe('tavilySearchAction', () => {
    it('should build a tavily search action', () => {
      const action = tavilySearchAction('deep research query');
      expect(action.type).toBe('action');
      expect(action.variant).toBe('tavilySearch');
      expect(action.parameters.query).toBe('deep research query');
    });

    it('should build a tavily search action with all options', () => {
      const action = tavilySearchAction('query', {
        maxResults: 5,
        searchDepth: 'advanced',
        includeAnswer: true,
      });
      expect(action.parameters.maxResults).toBe(5);
      expect(action.parameters.searchDepth).toBe('advanced');
      expect(action.parameters.includeAnswer).toBe(true);
    });
  });

  describe('readDocumentAction', () => {
    it('should build a read document action', () => {
      const action = readDocumentAction('https://docs.google.com/doc1');
      expect(action.variant).toBe('readDocument');
      expect((action.parameters as any).resourceUrl).toBe('https://docs.google.com/doc1');
    });
  });

  describe('writeDocumentAction', () => {
    it('should build a write document action with default mode', () => {
      const action = writeDocumentAction('https://docs.google.com/doc1', 'New content');
      expect(action.variant).toBe('writeDocument');
      expect((action.parameters as any).resourceUrl).toBe('https://docs.google.com/doc1');
      expect((action.parameters as any).content).toBe('New content');
    });

    it('should build a selective write action with mode and range', () => {
      const action = writeDocumentAction('https://docs.google.com/doc1', 'replacement', {
        mode: 'selective',
        range: { startIndex: 0, endIndex: 10 },
      });
      expect((action.parameters as any).mode).toBe('selective');
      expect((action.parameters as any).range).toEqual({ startIndex: 0, endIndex: 10 });
    });
  });

  describe('formatDocumentAction', () => {
    it('should build a format document action', () => {
      const action = formatDocumentAction('https://docs.google.com/doc1', { bold: true });
      expect(action.variant).toBe('formatDocument');
      expect(action.parameters.formatting.bold).toBe(true);
    });

    it('should build a format document action with range', () => {
      const action = formatDocumentAction(
        'https://docs.google.com/doc1',
        { italic: true, fontSize: 14 },
        { startIndex: 0, endIndex: 100 }
      );
      expect(action.parameters.range).toEqual({ startIndex: 0, endIndex: 100 });
    });
  });

  describe('removeDocumentAction', () => {
    it('should build a remove document action', () => {
      const action = removeDocumentAction('https://docs.google.com/doc1');
      expect(action.variant).toBe('removeDocument');
      expect(action.parameters.resourceUrl).toBe('https://docs.google.com/doc1');
    });
  });

  describe('renameDocumentAction', () => {
    it('should build a rename document action', () => {
      const action = renameDocumentAction('https://docs.google.com/doc1', 'New Name');
      expect(action.variant).toBe('renameDocument');
      expect(action.parameters.newName).toBe('New Name');
    });
  });

  describe('duplicateDocumentAction', () => {
    it('should build a duplicate document action', () => {
      const action = duplicateDocumentAction('https://docs.google.com/doc1', 'Copy of Doc');
      expect(action.variant).toBe('duplicateDocument');
      expect(action.parameters.newName).toBe('Copy of Doc');
    });
  });

  describe('addFolderAction', () => {
    it('should build an add folder action for google', () => {
      const action = addFolderAction('New Folder', 'google');
      expect(action.variant).toBe('addFolder');
      expect(action.parameters.folderName).toBe('New Folder');
      expect(action.parameters.provider).toBe('google');
    });

    it('should build an add folder action for notion with parent', () => {
      const action = addFolderAction('Projects', 'notion', 'https://notion.so/parent');
      expect(action.parameters.parentUrl).toBe('https://notion.so/parent');
    });
  });

  describe('removeFolderAction', () => {
    it('should build a remove folder action', () => {
      const action = removeFolderAction('https://drive.google.com/folder1');
      expect(action.variant).toBe('removeFolder');
      expect(action.parameters.folderUrl).toBe('https://drive.google.com/folder1');
    });
  });

  describe('readFolderAction', () => {
    it('should build a read folder action', () => {
      const action = readFolderAction('https://drive.google.com/folder1');
      expect(action.variant).toBe('readFolder');
      expect(action.parameters.folderUrl).toBe('https://drive.google.com/folder1');
    });
  });

  describe('renameFolderAction', () => {
    it('should build a rename folder action', () => {
      const action = renameFolderAction('https://drive.google.com/folder1', 'Renamed Folder');
      expect(action.variant).toBe('renameFolder');
      expect(action.parameters.newName).toBe('Renamed Folder');
    });
  });

  describe('addDocumentAction', () => {
    it('should build an add document action', () => {
      const action = addDocumentAction('My Doc', 'google');
      expect(action.variant).toBe('addDocument');
      expect(action.parameters.documentName).toBe('My Doc');
      expect(action.parameters.provider).toBe('google');
    });

    it('should build an add document action with content and location', () => {
      const action = addDocumentAction('My Doc', 'notion', 'https://notion.so/parent', '# Hello');
      expect(action.parameters.locationUrl).toBe('https://notion.so/parent');
      expect(action.parameters.content).toBe('# Hello');
    });
  });

  describe('createDatabaseAction', () => {
    it('should build a create database action', () => {
      const action = createDatabaseAction('Tasks DB');
      expect(action.variant).toBe('createDatabase');
      expect(action.parameters.databaseName).toBe('Tasks DB');
    });

    it('should build a create database action with parent', () => {
      const action = createDatabaseAction('Tasks DB', 'https://notion.so/parent');
      expect(action.parameters.parentPageUrl).toBe('https://notion.so/parent');
    });
  });

  describe('readDatabaseAction', () => {
    it('should build a read database action', () => {
      const action = readDatabaseAction('https://notion.so/db1');
      expect(action.variant).toBe('readDatabase');
      expect(action.parameters.databaseUrl).toBe('https://notion.so/db1');
    });
  });

  describe('updateDatabaseAction', () => {
    it('should build an update database action', () => {
      const action = updateDatabaseAction('https://notion.so/db1', { databaseName: 'New Name' });
      expect(action.variant).toBe('updateDatabase');
      expect(action.parameters.databaseName).toBe('New Name');
    });
  });

  describe('deleteDatabaseAction', () => {
    it('should build a delete database action', () => {
      const action = deleteDatabaseAction('https://notion.so/db1');
      expect(action.variant).toBe('deleteDatabase');
      expect(action.parameters.databaseUrl).toBe('https://notion.so/db1');
    });
  });

  describe('writeDatabaseAction', () => {
    it('should build a write database action', () => {
      const action = writeDatabaseAction('https://notion.so/db1', { Name: 'Row 1', Status: 'Done' });
      expect(action.variant).toBe('writeDatabase');
      expect(action.parameters.properties).toEqual({ Name: 'Row 1', Status: 'Done' });
    });
  });

  describe('duplicateDatabaseAction', () => {
    it('should build a duplicate database action', () => {
      const action = duplicateDatabaseAction('https://notion.so/db1', 'Copy of DB');
      expect(action.variant).toBe('duplicateDatabase');
      expect(action.parameters.newDatabaseName).toBe('Copy of DB');
    });
  });
});

// ============================================================================
// Editor Action Builders
// ============================================================================

describe('Editor Action Builders', () => {
  it('fixSpellingGrammarAction should build correctly', () => {
    const action = fixSpellingGrammarAction('teh quick brown fox');
    expect(action.type).toBe('editorAction');
    expect(action.variant).toBe('fixSpellingGrammar');
    expect(action.parameters.selectedText).toBe('teh quick brown fox');
  });

  it('rewriteAction should build correctly', () => {
    const action = rewriteAction('Some text to rewrite', { from: 0, to: 20 });
    expect(action.type).toBe('editorAction');
    expect(action.variant).toBe('rewrite');
    expect(action.parameters.from).toBe(0);
    expect(action.parameters.to).toBe(20);
  });

  it('extendTextAction should build correctly', () => {
    const action = extendTextAction('Short text');
    expect(action.variant).toBe('extendText');
    expect(action.parameters.selectedText).toBe('Short text');
  });

  it('reduceTextAction should build correctly', () => {
    const action = reduceTextAction('This is a very long piece of text that needs condensing');
    expect(action.variant).toBe('reduceText');
  });

  it('simplifyAction should build correctly', () => {
    const action = simplifyAction('Complex jargon-filled sentence');
    expect(action.variant).toBe('simplify');
  });

  it('completeSentenceAction should build correctly', () => {
    const action = completeSentenceAction('The quick brown fox');
    expect(action.variant).toBe('completeSentence');
  });

  it('translateAction should build correctly', () => {
    const action = translateAction('Hello world', 'Spanish');
    expect(action.type).toBe('editorAction');
    expect(action.variant).toBe('translate');
    expect(action.parameters.selectedText).toBe('Hello world');
    expect(action.parameters.language).toBe('Spanish');
  });

  it('translateAction should include position options', () => {
    const action = translateAction('Hello', 'French', { from: 5, to: 10 });
    expect(action.parameters.from).toBe(5);
    expect(action.parameters.to).toBe(10);
  });

  it('formatTextAction should build correctly', () => {
    const action = formatTextAction('poorly formatted text');
    expect(action.variant).toBe('formatText');
  });

  it('directiveAction should build correctly', () => {
    const action = directiveAction('Some text', 'Make this more formal');
    expect(action.type).toBe('editorAction');
    expect(action.variant).toBe('directive');
    expect(action.parameters.selectedText).toBe('Some text');
    expect(action.parameters.directive).toBe('Make this more formal');
  });
});

// ============================================================================
// Action Validators
// ============================================================================

describe('validateAction', () => {
  it('should validate sendEmail action', () => {
    const result = validateAction(sendEmailAction('a@b.com', 'Hi', 'Body'));
    expect(result.valid).toBe(true);
  });

  it('should reject sendEmail with missing content', () => {
    const result = validateAction({ type: 'action', variant: 'sendEmail', parameters: { to: 'user@example.com', subject: 'Hi' } });
    expect(result.valid).toBe(false);
  });

  it('should validate scrape action', () => {
    const result = validateAction(scrapeAction('https://example.com'));
    expect(result.valid).toBe(true);
  });

  it('should validate search action', () => {
    const result = validateAction(searchAction('query'));
    expect(result.valid).toBe(true);
  });

  it('should validate newsSearch action', () => {
    const result = validateAction(newsSearchAction('AI news', { limit: 5, tbs: 'qdr:w' }));
    expect(result.valid).toBe(true);
  });

  it('should reject newsSearch with missing query', () => {
    const result = validateAction({ type: 'action', variant: 'newsSearch', parameters: { limit: 5 } });
    expect(result.valid).toBe(false);
  });

  it('should validate previewSearch action', () => {
    const result = validateAction(previewSearchAction('tech news', { sources: ['web', 'news'] }));
    expect(result.valid).toBe(true);
  });

  it('should validate tavilySearch action', () => {
    const result = validateAction(tavilySearchAction('research topic', { searchDepth: 'advanced', includeAnswer: true }));
    expect(result.valid).toBe(true);
  });

  it('should reject tavilySearch with invalid searchDepth', () => {
    const result = validateAction({ type: 'action', variant: 'tavilySearch', parameters: { query: 'test', searchDepth: 'extreme' } });
    expect(result.valid).toBe(false);
  });

  it('should validate readDocument action', () => {
    const result = validateAction(readDocumentAction('myDoc'));
    expect(result.valid).toBe(true);
  });

  it('should validate writeDocument action', () => {
    const result = validateAction(writeDocumentAction('https://docs.google.com/doc1', 'More content', { mode: 'append' }));
    expect(result.valid).toBe(true);
  });

  it('should reject writeDocument selective without range', () => {
    const result = validateAction({ type: 'action', variant: 'writeDocument', parameters: { resourceUrl: 'https://docs.google.com/doc1', mode: 'selective', content: 'x' } });
    expect(result.valid).toBe(false);
  });

  it('should reject unknown variant', () => {
    const result = validateAction({ type: 'action', variant: 'unknownAction', parameters: {} });
    expect(result.valid).toBe(false);
  });

  it('should validate checkDomain action', () => {
    const result = validateAction({ type: 'action', variant: 'checkDomain', parameters: { domains: ['example.com', 'example.io'] } });
    expect(result.valid).toBe(true);
  });

  it('should reject checkDomain with empty domains', () => {
    const result = validateAction({ type: 'action', variant: 'checkDomain', parameters: { domains: [] } });
    expect(result.valid).toBe(false);
  });

  it('should validate dbInsert action', () => {
    const result = validateAction({ type: 'action', variant: 'dbInsert', parameters: { resourceUrl: 'mongodb://x', document: { name: 'a' } } });
    expect(result.valid).toBe(true);
  });

  it('should reject dbInsert without document', () => {
    const result = validateAction({ type: 'action', variant: 'dbInsert', parameters: { resourceUrl: 'mongodb://x' } });
    expect(result.valid).toBe(false);
  });

  it('should validate runCode action', () => {
    const result = validateAction({ type: 'action', variant: 'runCode', parameters: { code: 'print(1)' } });
    expect(result.valid).toBe(true);
  });

  it('should validate runShell action', () => {
    const result = validateAction({ type: 'action', variant: 'runShell', parameters: { command: 'ls -la' } });
    expect(result.valid).toBe(true);
  });

  it('should reject runShell action without command', () => {
    const result = validateAction({ type: 'action', variant: 'runShell', parameters: {} });
    expect(result.valid).toBe(false);
  });

  it('should reject deactivated crawl variant', () => {
    const result = validateAction({ type: 'action', variant: 'crawl', parameters: { url: 'https://example.com' } });
    expect(result.valid).toBe(false);
  });

  it('should validate readMdFile action', () => {
    const result = validateAction({ type: 'action', variant: 'readMdFile', parameters: { id: 'file-1' } });
    expect(result.valid).toBe(true);
  });

  it('should reject readMdFile action without id', () => {
    const result = validateAction({ type: 'action', variant: 'readMdFile', parameters: {} });
    expect(result.valid).toBe(false);
  });

  it('should validate writeMdFile action', () => {
    const result = validateAction({ type: 'action', variant: 'writeMdFile', parameters: { id: 'file-1', content: 'hello', mode: 'append' } });
    expect(result.valid).toBe(true);
  });

  it('should validate createMdFile action', () => {
    const result = validateAction({ type: 'action', variant: 'createMdFile', parameters: { name: 'notes.md' } });
    expect(result.valid).toBe(true);
  });

  it('should reject createMdFile action without name', () => {
    const result = validateAction({ type: 'action', variant: 'createMdFile', parameters: { content: 'hello' } });
    expect(result.valid).toBe(false);
  });

  it('should validate deleteMdFile action', () => {
    const result = validateAction({ type: 'action', variant: 'deleteMdFile', parameters: { id: 'file-1' } });
    expect(result.valid).toBe(true);
  });

  it('should validate renameMdFile action', () => {
    const result = validateAction({ type: 'action', variant: 'renameMdFile', parameters: { id: 'file-1', newName: 'renamed.md' } });
    expect(result.valid).toBe(true);
  });

  it('should reject renameMdFile action without newName', () => {
    const result = validateAction({ type: 'action', variant: 'renameMdFile', parameters: { id: 'file-1' } });
    expect(result.valid).toBe(false);
  });

  it('should validate duplicateMdFile action', () => {
    const result = validateAction({ type: 'action', variant: 'duplicateMdFile', parameters: { id: 'file-1', newName: 'copy.md' } });
    expect(result.valid).toBe(true);
  });

  it('isValidAction should return boolean', () => {
    expect(isValidAction(searchAction('query'))).toBe(true);
    expect(isValidAction({ type: 'action', variant: 'bad', parameters: {} })).toBe(false);
  });
});

// ============================================================================
// Editor Action Validators
// ============================================================================

describe('validateEditorAction', () => {
  it('should validate fixSpellingGrammar', () => {
    const result = validateEditorAction(fixSpellingGrammarAction('teh text'));
    expect(result.valid).toBe(true);
  });

  it('should validate rewrite', () => {
    const result = validateEditorAction(rewriteAction('some text'));
    expect(result.valid).toBe(true);
  });

  it('should validate extendText', () => {
    const result = validateEditorAction(extendTextAction('short'));
    expect(result.valid).toBe(true);
  });

  it('should validate reduceText', () => {
    const result = validateEditorAction(reduceTextAction('long text here'));
    expect(result.valid).toBe(true);
  });

  it('should validate simplify', () => {
    const result = validateEditorAction(simplifyAction('complex text'));
    expect(result.valid).toBe(true);
  });

  it('should validate completeSentence', () => {
    const result = validateEditorAction(completeSentenceAction('The fox'));
    expect(result.valid).toBe(true);
  });

  it('should validate translate with language', () => {
    const result = validateEditorAction(translateAction('Hello', 'Spanish'));
    expect(result.valid).toBe(true);
  });

  it('should reject translate without language', () => {
    const result = validateEditorAction({ type: 'editorAction', variant: 'translate', parameters: { selectedText: 'Hello' } });
    expect(result.valid).toBe(false);
  });

  it('should validate formatText', () => {
    const result = validateEditorAction(formatTextAction('text'));
    expect(result.valid).toBe(true);
  });

  it('should validate directive with directive param', () => {
    const result = validateEditorAction(directiveAction('text', 'Make it formal'));
    expect(result.valid).toBe(true);
  });

  it('should reject directive without directive param', () => {
    const result = validateEditorAction({ type: 'editorAction', variant: 'directive', parameters: { selectedText: 'text' } });
    expect(result.valid).toBe(false);
  });

  it('should reject editor actions with empty selectedText', () => {
    const result = validateEditorAction({ type: 'editorAction', variant: 'rewrite', parameters: { selectedText: '' } });
    expect(result.valid).toBe(false);
  });

  it('should reject unknown editor variant', () => {
    const result = validateEditorAction({ type: 'editorAction', variant: 'unknownEditor', parameters: { selectedText: 'text' } });
    expect(result.valid).toBe(false);
  });

  it('isValidEditorAction should return boolean', () => {
    expect(isValidEditorAction(rewriteAction('text'))).toBe(true);
    expect(isValidEditorAction({ type: 'editorAction', variant: 'bad', parameters: {} })).toBe(false);
  });
});
