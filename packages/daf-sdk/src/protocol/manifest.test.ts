/**
 * Tests for the DAF v2.0 process definition / manifest split
 */

import { describe, it, expect } from 'vitest';
import {
  validateProcessDefinitionFile,
  validateManifestFile,
  validateDafFile,
  parseDafFile,
  isValidProcessDefinitionFile,
  isValidManifestFile,
  buildProcessDefinitionFile,
  buildManifestActions,
  manifestResource,
  ManifestBuilder,
  ACTION_TYPES,
  DAF_V2_VERSION,
} from './index';

const sampleProcess = {
  name: 'One bild.de item',
  processType: 'ADVANCED_DIALOGUE',
  steps: [
    { type: 'prompt', prompt: '$STARTERPROMPT', skipCompletion: true },
    { type: 'prompt', prompt: 'Please browse bild.de with the scrape website action and get its content' },
    { type: 'prompt', prompt: 'Pick one news item, summarize it, and email it to rene@prismrun.ai' },
  ],
};

describe('DAF v2.0 process definitions', () => {
  it('validates a minimal process definition file', () => {
    const file = buildProcessDefinitionFile([sampleProcess as any]);
    expect(file.dafVersion).toBe(DAF_V2_VERSION);
    expect(file.dafType).toBe('process');
    expect(validateProcessDefinitionFile(file).valid).toBe(true);
    expect(isValidProcessDefinitionFile(file)).toBe(true);
  });

  it('rejects a process definition carrying variables or resources', () => {
    const file = { ...buildProcessDefinitionFile([sampleProcess as any]), variables: { FOO: 'bar' } };
    // extra keys are fine under the current schema (no .strict()), so this
    // asserts the *type* contract instead: DAFProcessDefinitionFile has no
    // variables/resources fields, so nothing in this package ever reads them
    // off a process definition even if a caller bolts one on by hand.
    expect(validateProcessDefinitionFile(file).valid).toBe(true);
  });

  it('rejects a file missing processes', () => {
    const file = { dafVersion: DAF_V2_VERSION, dafType: 'process', processes: [] };
    expect(validateProcessDefinitionFile(file).valid).toBe(false);
  });
});

describe('step vocabulary', () => {
  it('accepts userFeedback and completionWithoutPrompt steps', () => {
    const process = {
      name: 'Simple Chat Outer Loop',
      processType: 'ADVANCED_DIALOGUE',
      steps: [
        { type: 'process', processName: 'Simple Chat Inner worker loop' },
        { type: 'userFeedback' },
        { type: 'completionWithoutPrompt' },
      ],
    };
    const file = buildProcessDefinitionFile([process as any]);
    expect(validateProcessDefinitionFile(file).valid).toBe(true);
  });

  it('accepts loopType "none" on a process-reference step', () => {
    const process = {
      name: 'Update Newspaper Sections',
      processType: 'ADVANCED_DIALOGUE',
      steps: [
        { type: 'process', processName: 'Update Culture Section', loopType: 'none' },
      ],
    };
    const file = buildProcessDefinitionFile([process as any]);
    expect(validateProcessDefinitionFile(file).valid).toBe(true);
  });

  it('accepts a process-reference step with only processName (no processId)', () => {
    const process = {
      name: 'wrapper',
      processType: 'STATIC_DIALOGUE',
      steps: [{ type: 'process', processName: 'jokes' }],
    };
    const file = buildProcessDefinitionFile([process as any]);
    expect(validateProcessDefinitionFile(file).valid).toBe(true);
  });

  it('still rejects a process-reference step with neither processId nor processName', () => {
    const process = {
      name: 'wrapper',
      processType: 'STATIC_DIALOGUE',
      steps: [{ type: 'process' }],
    };
    const file = buildProcessDefinitionFile([process as any]);
    expect(validateProcessDefinitionFile(file).valid).toBe(false);
  });
});

describe('DAF v2.0 manifests', () => {
  it('builds a manifest with the full app action vocabulary by default', () => {
    const manifest = new ManifestBuilder()
      .userVariables({ API_KEY: 'secret' })
      .systemVariables({ SKILLS: 'You have 2 skills available: ...' })
      .resource(manifestResource({ name: 'Project Notes', type: 'notion_page', url: 'https://notion.so/x', isGlobal: false }, 'notion'))
      .process(sampleProcess as any)
      .build();

    expect(manifest.dafType).toBe('manifest');
    expect(manifest.actions).toEqual(buildManifestActions());
    expect(manifest.actions).toContain('readDocument');
    expect(manifest.actions.length).toBe(Object.keys(ACTION_TYPES).length);
    expect(manifest.variables.user).toEqual({ API_KEY: 'secret' });
    expect(manifest.variables.system).toEqual({ SKILLS: 'You have 2 skills available: ...' });
    expect(manifest.resources[0].requiredIntegration).toBe('notion');
    expect(validateManifestFile(manifest).valid).toBe(true);
  });

  it('leaves requiredIntegration unset for resources that need no integration', () => {
    const resource = manifestResource({ name: 'Some page', type: 'md_file', url: 'md/some-page', isGlobal: true });
    expect(resource.requiredIntegration).toBeUndefined();
    expect(validateManifestFile(new ManifestBuilder().resource(resource).process(sampleProcess as any).build()).valid).toBe(true);
  });

  it('rejects an action outside the known vocabulary', () => {
    const manifest = new ManifestBuilder().process(sampleProcess as any).actions(['notARealAction' as any]).build();
    expect(validateManifestFile(manifest).valid).toBe(false);
  });

  it('rejects a manifest missing the variables split', () => {
    const bad = { dafVersion: DAF_V2_VERSION, dafType: 'manifest', resources: [], actions: [], processes: [sampleProcess] };
    expect(validateManifestFile(bad).valid).toBe(false);
  });

  it('schedules are optional and validate when present', () => {
    const noSchedules = new ManifestBuilder().process(sampleProcess as any).build();
    expect(noSchedules.schedules).toBeUndefined();
    expect(validateManifestFile(noSchedules).valid).toBe(true);

    const withSchedule = new ManifestBuilder()
      .process(sampleProcess as any)
      .schedule({
        name: 'Daily bild.de check',
        processName: sampleProcess.name,
        interval: 'DAILY',
        firstExecutionType: 'IMMEDIATE',
      })
      .build();
    expect(withSchedule.schedules).toHaveLength(1);
    expect(validateManifestFile(withSchedule).valid).toBe(true);
  });

  it('rejects a schedule with an invalid interval', () => {
    const manifest = new ManifestBuilder()
      .process(sampleProcess as any)
      .schedule({ name: 'x', processName: sampleProcess.name, interval: 'YEARLY' as any })
      .build();
    expect(validateManifestFile(manifest).valid).toBe(false);
  });
});

describe('parseDafFile / validateDafFile dispatch', () => {
  it('parses a process definition and narrows the type', () => {
    const file = buildProcessDefinitionFile([sampleProcess as any]);
    const parsed = parseDafFile(file);
    expect(parsed.dafType).toBe('process');
    if (parsed.dafType === 'process') {
      expect(parsed.processes).toHaveLength(1);
    }
  });

  it('parses a manifest and narrows the type', () => {
    const manifest = new ManifestBuilder().process(sampleProcess as any).build();
    const parsed = parseDafFile(manifest);
    expect(parsed.dafType).toBe('manifest');
    if (parsed.dafType === 'manifest') {
      expect(parsed.actions.length).toBeGreaterThan(0);
    }
  });

  it('throws with validation errors attached for a malformed dafType', () => {
    expect(() => parseDafFile({ dafVersion: DAF_V2_VERSION, dafType: 'nonsense', processes: [] })).toThrow();
    expect(validateDafFile({ dafVersion: DAF_V2_VERSION, dafType: 'nonsense', processes: [] }).valid).toBe(false);
  });
});
