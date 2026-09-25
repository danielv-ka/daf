/**
 * Basic validation tests for the protocol library
 */

import { describe, it, expect } from 'vitest';
import {
  validateDAFDocument,
  validateProcess,
  validateStep,
  DAFDocumentBuilder,
  ProcessBuilder,
  promptStep,
  fixedLoopStep,
  DAF_VERSION,
} from './index';

describe('Protocol Library', () => {
  describe('Validation', () => {
    it('should validate a simple DAF document', () => {
      const doc = {
        dafVersion: '1.2.0',
        processes: [
          {
            name: 'Test Process',
            processType: 'STATIC_DIALOGUE',
            steps: [
              { type: 'prompt', prompt: 'Hello world' },
            ],
          },
        ],
      };

      const result = validateDAFDocument(doc);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject invalid DAF documents', () => {
      const doc = {
        dafVersion: '1.2.0',
        processes: [],
      };

      const result = validateDAFDocument(doc);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should validate a process', () => {
      const process = {
        name: 'Test',
        processType: 'STATIC_DIALOGUE',
        steps: [{ type: 'prompt', prompt: 'Test' }],
      };

      const result = validateProcess(process);
      expect(result.valid).toBe(true);
    });

    it('should validate a step', () => {
      const step = { type: 'prompt', prompt: 'Test' };
      const result = validateStep(step);
      expect(result.valid).toBe(true);
    });
  });

  describe('Builders', () => {
    it('should build a DAF document', () => {
      const doc = new DAFDocumentBuilder()
        .variable('TEST', 'value')
        .process(
          new ProcessBuilder('Test', 'STATIC_DIALOGUE')
            .step(promptStep('Hello'))
            .build()
        )
        .build();

      expect(doc.dafVersion).toBe(DAF_VERSION);
      expect(doc.variables).toHaveProperty('TEST', 'value');
      expect(doc.processes).toHaveLength(1);
      expect(doc.processes[0].name).toBe('Test');
    });

    it('should build a process with steps', () => {
      const process = new ProcessBuilder('Test', 'STATIC_DIALOGUE')
        .description('Test process')
        .step(promptStep('Step 1'))
        .step(fixedLoopStep('Step 2', 5))
        .build();

      expect(process.name).toBe('Test');
      expect(process.description).toBe('Test process');
      expect(process.steps).toHaveLength(2);
      expect(process.steps[0].type).toBe('prompt');
      expect(process.steps[1].loopType).toBe('fixed');
    });
  });

  describe('Constants', () => {
    it('should export DAF_VERSION', () => {
      expect(DAF_VERSION).toBe('1.2.0');
    });
  });
});
