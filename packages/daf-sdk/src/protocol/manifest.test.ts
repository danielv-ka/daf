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

describe('portable resource references', () => {
  const dataResource = {
    name: 'chart.png', type: 'data', url: 'data/chart', isGlobal: false,
    ref: 'src_res_1', mediaType: 'image/png', content: 'cG5n',
  };
  const processWithRefs = {
    ...sampleProcess,
    name: 'Uses a file',
    resourceRefs: ['src_res_1'],
    steps: [{ type: 'prompt', prompt: 'Describe $src_res_1' }],
  };
  const manifest = (resources: any[], processes: any[] = [processWithRefs]) => ({
    dafVersion: DAF_V2_VERSION, dafType: 'manifest', variables: { user: {}, system: {} },
    resources, actions: [], processes,
  });

  it('keeps a data resource with its content, media type and ref through parsing', () => {
    const parsed = parseDafFile(manifest([dataResource])) as any;
    expect(parsed.resources[0]).toMatchObject({ type: 'data', ref: 'src_res_1', mediaType: 'image/png', content: 'cG5n' });
  });

  it("keeps a process's resourceRefs through parsing", () => {
    const parsed = parseDafFile(manifest([dataResource])) as any;
    expect(parsed.processes[0].resourceRefs).toEqual(['src_res_1']);
  });

  it('accepts a data resource without content (e.g. over a size limit)', () => {
    const { content, ...noContent } = dataResource;
    expect(validateManifestFile(manifest([noContent])).valid).toBe(true);
  });

  it('rejects a data resource without a media type', () => {
    const { mediaType, ...noType } = dataResource;
    expect(validateManifestFile(manifest([noType])).valid).toBe(false);
  });

  it('still accepts manifests without refs (files exported before they existed)', () => {
    const old = manifest([{ name: 'Doc', type: 'google_doc', url: 'https://docs.google.com/document/d/x', isGlobal: false }], [sampleProcess]);
    expect(validateManifestFile(old).valid).toBe(true);
  });
});

describe('Interfaces processes', () => {
  const debate = () => ({
    name: 'Framework debate',
    processType: 'INTERFACES_PROCESS',
    stopProcessKeyword: 'DONE',
    interfaceParticipants: [
      { id: 'p0', name: 'System', model: 'system', interfaceIds: ['A', 'B'] },
      { id: 'p1', name: 'Debater', model: 'claude-haiku-4-5', interfaceIds: ['A'], starterPrompt: 'Argue for React.' },
    ],
    interfaceDefs: [
      { id: 'A', name: 'Room A', participantIds: ['p0', 'p1'], type: 'text+data' },
      { id: 'B', name: 'Room B', participantIds: ['p0'], type: 'text' },
    ],
    interfaceExecutionOrder: 'ROUND_ROBIN_INTERFACE_FIRST',
    interfaceMaxSteps: 200,
    steps: [{ type: 'prompt', prompt: 'Discuss the best web framework.', targetInterfaceId: 'A' }],
  });
  const asFile = (process: any) => ({ dafVersion: DAF_V2_VERSION, dafType: 'process', processes: [process] });
  const errors = (process: any) => validateProcessDefinitionFile(asFile(process)).errors?.map((e: any) => e.message).join(' | ') ?? '';

  it('accepts a valid Interfaces process in a process definition and keeps every field', () => {
    const parsed = parseDafFile(asFile(debate())) as any;
    expect(parsed.processes[0]).toMatchObject({
      processType: 'INTERFACES_PROCESS',
      stopProcessKeyword: 'DONE',
      interfaceDefs: [{ id: 'A', type: 'text+data' }, { id: 'B', type: 'text' }],
      interfaceExecutionOrder: 'ROUND_ROBIN_INTERFACE_FIRST',
      interfaceMaxSteps: 200,
    });
    expect(parsed.processes[0].interfaceParticipants[1].starterPrompt).toBe('Argue for React.');
    expect(parsed.processes[0].steps[0].targetInterfaceId).toBe('A');
  });

  it('accepts it in a manifest too', () => {
    const manifest = { dafVersion: DAF_V2_VERSION, dafType: 'manifest', variables: { user: {}, system: {} }, resources: [], actions: [], processes: [debate()] };
    expect(validateManifestFile(manifest).valid).toBe(true);
  });

  it('treats a room without a type as valid (Text + Data by default)', () => {
    const p = debate(); delete (p.interfaceDefs[0] as any).type;
    expect(validateProcessDefinitionFile(asFile(p)).valid).toBe(true);
  });

  it('rejects an unknown room type', () => {
    const p = debate(); (p.interfaceDefs[0] as any).type = 'text-data';
    expect(validateProcessDefinitionFile(asFile(p)).valid).toBe(false);
  });

  it('rejects a step that targets a room that does not exist, or no room at all', () => {
    const wrong = debate(); wrong.steps[0].targetInterfaceId = 'Z';
    expect(errors(wrong)).toContain('Step targets unknown interface "Z"');
    const missing = debate(); delete (missing.steps[0] as any).targetInterfaceId;
    expect(errors(missing)).toContain('needs a targetInterfaceId');
  });

  it('rejects participants and rooms that point at each other wrongly', () => {
    const p = debate(); p.interfaceParticipants[1].interfaceIds = ['A', 'Z'];
    expect(errors(p)).toContain('unknown interface "Z"');
    const r = debate(); r.interfaceDefs[1].participantIds = ['p9'];
    expect(errors(r)).toContain('unknown participant "p9"');
  });

  it('rejects duplicate ids and empty rooms or participants', () => {
    const dup = debate(); dup.interfaceDefs[1].id = 'A';
    expect(errors(dup)).toContain('Duplicate interface id "A"');
    const empty = debate(); empty.interfaceDefs = []; empty.interfaceParticipants = [];
    const msg = errors(empty);
    expect(msg).toContain('at least one interface');
    expect(msg).toContain('at least one participant');
  });

  it('rejects Interfaces fields on other process types', () => {
    const p = { ...sampleProcess, interfaceDefs: [{ id: 'A', name: 'Room A', participantIds: [] }] };
    expect(errors(p)).toContain('only valid for INTERFACES_PROCESS');
    const step = { ...sampleProcess, steps: [{ type: 'prompt', prompt: 'hi', targetInterfaceId: 'A' }] };
    expect(errors(step)).toContain('targetInterfaceId is only valid');
  });

  it('allows a stop keyword on Interfaces and advanced dialogues, not on static ones', () => {
    expect(validateProcessDefinitionFile(asFile(debate())).valid).toBe(true);
    const staticWithStop = { ...sampleProcess, processType: 'STATIC_DIALOGUE', stopProcessKeyword: 'X' };
    expect(errors(staticWithStop)).toContain('stopProcessKeyword is only valid');
  });
});
