import { describe, it, expect, afterEach } from 'vitest';
import {
  SANDBOX_ALLOWED_ACTIONS,
  configureSandboxActionCalling,
  isSandboxActionCallingEnabled,
  mintSandboxToken,
  invalidateSandboxToken,
  resolveSandboxCall,
  buildSandboxCodePreamble,
  buildSandboxProgram,
  buildSandboxDescriptionBlock,
} from './sandboxTools';

describe('sandbox (programmatic) tool calling', () => {
  afterEach(() => {
    configureSandboxActionCalling(false);
  });

  it('is off by default', () => {
    expect(isSandboxActionCallingEnabled()).toBe(false);
  });

  it('stays off if enabled without a base URL', () => {
    configureSandboxActionCalling(true);
    expect(isSandboxActionCallingEnabled()).toBe(false);
  });

  it('turns on once enabled with a base URL', () => {
    configureSandboxActionCalling(true, 'http://127.0.0.1:3001');
    expect(isSandboxActionCallingEnabled()).toBe(true);
  });

  it('only allows the fixed read-only action list', () => {
    for (const mutating of ['sendEmail', 'writeDocument', 'dbInsert', 'runCode', 'runShell', 'askUserInput', 'readData']) {
      expect(SANDBOX_ALLOWED_ACTIONS).not.toContain(mutating);
    }
    expect(SANDBOX_ALLOWED_ACTIONS).toContain('search');
  });

  describe('resolveSandboxCall', () => {
    it('rejects an unknown token', () => {
      const result = resolveSandboxCall('not-a-real-token', 'search', { query: 'hi' });
      expect(result.ok).toBe(false);
    });

    it('accepts a valid call for an allowed action with valid parameters', () => {
      const token = mintSandboxToken('user_1', 'process_1', [], 30_000);
      const result = resolveSandboxCall(token, 'search', { query: 'daf sdk' });
      expect(result).toEqual({ ok: true, userId: 'user_1', processId: 'process_1', parentProcessIds: [] });
    });

    it('rejects a variant outside the allowed list', () => {
      const token = mintSandboxToken('user_1', 'process_1', [], 30_000);
      const result = resolveSandboxCall(token, 'sendEmail', { to: 'a@b.com', subject: 'x', body: 'y' });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('not available in the sandbox');
    });

    it('rejects invalid parameters for an allowed action', () => {
      const token = mintSandboxToken('user_1', 'process_1', [], 30_000);
      const result = resolveSandboxCall(token, 'search', {});
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('Invalid parameters');
    });

    it('rejects an expired token', () => {
      const token = mintSandboxToken('user_1', 'process_1', [], -1);
      const result = resolveSandboxCall(token, 'search', { query: 'hi' });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('expired');
    });

    it('rejects further calls once a token is invalidated', () => {
      const token = mintSandboxToken('user_1', 'process_1', [], 30_000);
      expect(resolveSandboxCall(token, 'search', { query: 'hi' }).ok).toBe(true);
      invalidateSandboxToken(token);
      expect(resolveSandboxCall(token, 'search', { query: 'hi' }).ok).toBe(false);
    });

    it('caps the number of calls a single token can make', () => {
      const token = mintSandboxToken('user_1', 'process_1', [], 30_000);
      let lastOk = true;
      for (let i = 0; i < 51; i++) {
        lastOk = resolveSandboxCall(token, 'search', { query: 'hi' }).ok;
      }
      expect(lastOk).toBe(false);
    });
  });

  describe('buildSandboxCodePreamble', () => {
    it('defines a callable function for every allowed action', () => {
      configureSandboxActionCalling(true, 'http://127.0.0.1:3001');
      const token = mintSandboxToken('user_1', 'process_1', [], 30_000);
      const preamble = buildSandboxCodePreamble(token);
      for (const variant of SANDBOX_ALLOWED_ACTIONS) {
        expect(preamble).toContain(`async function ${variant}(parameters)`);
      }
      expect(preamble).toContain(token);
      expect(preamble).toContain('http://127.0.0.1:3001/api/internal/sandbox-action');
    });
  });

  describe('buildSandboxDescriptionBlock', () => {
    it('documents every allowed action and nothing else', () => {
      const block = buildSandboxDescriptionBlock();
      for (const variant of SANDBOX_ALLOWED_ACTIONS) {
        expect(block).toContain(`\`${variant}`);
      }
      expect(block).not.toContain('sendEmail');
      expect(block).not.toContain('runCode');
    });

    it('shows each function taking one object, with no doubled periods or generic fallbacks', () => {
      const block = buildSandboxDescriptionBlock();
      expect(block).toContain('`newsSearch({ query,');
      expect(block).not.toMatch(/`newsSearch\(query/);
      expect(block).not.toContain('..');
      expect(block).not.toContain('Run the "previewSearch" action');
      expect(block).toContain('use `await` directly at the top level');
    });
  });

  describe('buildSandboxProgram', () => {
    it('runs the model code inside an async function so top-level await works', async () => {
      configureSandboxActionCalling(true, 'http://127.0.0.1:3001');
      const token = mintSandboxToken('user_1', 'process_1', [], 30_000);
      const program = buildSandboxProgram(token, 'const x = await Promise.resolve(41);\nglobalThis.__sandboxResult = x + 1;');
      expect(program.indexOf('async function search(parameters)')).toBeLessThan(program.indexOf('const x = await'));
      // Executes as a plain CommonJS function body, the way the sandbox runs it.
      await new Function(program)();
      await new Promise((r) => setTimeout(r, 0));
      expect((globalThis as any).__sandboxResult).toBe(42);
    });
  });
});
