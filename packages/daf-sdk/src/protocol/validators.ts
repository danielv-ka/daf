/**
 * Validation utilities for DAF documents and actions
 */

import { ZodError, ZodType } from 'zod';
import {
  dafDocumentSchema,
  processDefinitionFileSchema,
  manifestFileSchema,
  dafFileSchema,
  processSchema,
  stepSchema,
  resourceSchema,
  actionSchema,
  editorActionSchema,
  editorActionBaseParamsSchema,
  sendEmailParamsSchema,
  scrapeParamsSchema,
  searchParamsSchema,
  newsSearchParamsSchema,
  previewSearchParamsSchema,
  tavilySearchParamsSchema,
  checkDomainParamsSchema,
  readDocumentParamsSchema,
  writeDocumentParamsSchema,
  formatDocumentParamsSchema,
  removeDocumentParamsSchema,
  renameDocumentParamsSchema,
  duplicateDocumentParamsSchema,
  addDocumentParamsSchema,
  addFolderParamsSchema,
  removeFolderParamsSchema,
  readFolderParamsSchema,
  renameFolderParamsSchema,
  createDatabaseParamsSchema,
  readDatabaseParamsSchema,
  updateDatabaseParamsSchema,
  deleteDatabaseParamsSchema,
  writeDatabaseParamsSchema,
  duplicateDatabaseParamsSchema,
  dbFindParamsSchema,
  dbInsertParamsSchema,
  dbUpdateParamsSchema,
  dbDeleteParamsSchema,
  askUserInputParamsSchema,
  runCodeParamsSchema,
  runShellParamsSchema,
  readMdFileParamsSchema,
  writeMdFileParamsSchema,
  createMdFileParamsSchema,
  deleteMdFileParamsSchema,
  renameMdFileParamsSchema,
  duplicateMdFileParamsSchema,
  translateParamsSchema,
  directiveParamsSchema,
  attachFileParamsSchema,
} from './schemas';
import { ACTION_TYPES, DIRECT_APPLY_EDITOR_ACTIONS } from './constants';
import type {
  DAFDocument,
  DAFProcess,
  DAFStep,
  DAFResource,
  DAFAction,
  DAFEditorAction,
  DAFProcessDefinitionFile,
  DAFManifestFile,
  DAFFile,
  ValidationResult,
  ValidationError,
} from './types';

/**
 * Convert Zod errors to our ValidationError format
 */
function zodErrorToValidationErrors(error: ZodError): ValidationError[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
    code: issue.code,
  }));
}

/**
 * Validate a complete DAF document
 */
export function validateDAFDocument(doc: unknown): ValidationResult {
  try {
    dafDocumentSchema.parse(doc);
    return { valid: true, errors: [] };
  } catch (error) {
    if (error instanceof ZodError) {
      return { valid: false, errors: zodErrorToValidationErrors(error) };
    }
    return {
      valid: false,
      errors: [{ path: '', message: 'Unknown validation error' }],
    };
  }
}

/**
 * Validate a v2.0 process definition file (dafType: 'process')
 */
export function validateProcessDefinitionFile(file: unknown): ValidationResult {
  try {
    processDefinitionFileSchema.parse(file);
    return { valid: true, errors: [] };
  } catch (error) {
    if (error instanceof ZodError) {
      return { valid: false, errors: zodErrorToValidationErrors(error) };
    }
    return {
      valid: false,
      errors: [{ path: '', message: 'Unknown validation error' }],
    };
  }
}

/**
 * Validate a v2.0 manifest file (dafType: 'manifest')
 */
export function validateManifestFile(file: unknown): ValidationResult {
  try {
    manifestFileSchema.parse(file);
    return { valid: true, errors: [] };
  } catch (error) {
    if (error instanceof ZodError) {
      return { valid: false, errors: zodErrorToValidationErrors(error) };
    }
    return {
      valid: false,
      errors: [{ path: '', message: 'Unknown validation error' }],
    };
  }
}

/**
 * Validate a v2.0 DAF file of either kind, dispatching on `dafType` first so
 * a missing/invalid `dafType` produces a clear error instead of silently
 * falling through to whichever schema happens to partially match.
 */
export function validateDafFile(file: unknown): ValidationResult {
  try {
    dafFileSchema.parse(file);
    return { valid: true, errors: [] };
  } catch (error) {
    if (error instanceof ZodError) {
      return { valid: false, errors: zodErrorToValidationErrors(error) };
    }
    return {
      valid: false,
      errors: [{ path: '', message: 'Unknown validation error' }],
    };
  }
}

/**
 * Parse and validate a raw v2.0 DAF file, returning the typed, narrowed
 * result on success or throwing with the validation errors attached
 * otherwise. Prefer this over validateDafFile when you actually want to use
 * the parsed value, not just check it.
 */
export function parseDafFile(file: unknown): DAFFile {
  const result = dafFileSchema.safeParse(file);
  if (!result.success) {
    const errors = zodErrorToValidationErrors(result.error);
    const err = new Error(
      `Invalid DAF file: ${errors.map((e) => `${e.path || '(root)'}: ${e.message}`).join('; ')}`
    );
    (err as Error & { validationErrors: ValidationError[] }).validationErrors = errors;
    throw err;
  }
  return result.data as DAFFile;
}

/**
 * Validate a single process
 */
export function validateProcess(process: unknown): ValidationResult {
  try {
    processSchema.parse(process);
    return { valid: true, errors: [] };
  } catch (error) {
    if (error instanceof ZodError) {
      return { valid: false, errors: zodErrorToValidationErrors(error) };
    }
    return {
      valid: false,
      errors: [{ path: '', message: 'Unknown validation error' }],
    };
  }
}

/**
 * Validate a single step
 */
export function validateStep(step: unknown): ValidationResult {
  try {
    stepSchema.parse(step);
    return { valid: true, errors: [] };
  } catch (error) {
    if (error instanceof ZodError) {
      return { valid: false, errors: zodErrorToValidationErrors(error) };
    }
    return {
      valid: false,
      errors: [{ path: '', message: 'Unknown validation error' }],
    };
  }
}

/**
 * Validate a resource
 */
export function validateResource(resource: unknown): ValidationResult {
  try {
    resourceSchema.parse(resource);
    return { valid: true, errors: [] };
  } catch (error) {
    if (error instanceof ZodError) {
      return { valid: false, errors: zodErrorToValidationErrors(error) };
    }
    return {
      valid: false,
      errors: [{ path: '', message: 'Unknown validation error' }],
    };
  }
}

/**
 * Per-variant parameter schemas. A variant absent from this map is rejected by
 * validateAction (the default-reject case). `crawl` is intentionally omitted:
 * the platform currently treats it as deactivated and rejects it.
 */
// Exported so runtime/actionTools.ts can build native tool schemas from the
// exact same per-variant param schemas used for text-convention validation,
// rather than maintaining a second, driftable list of "which actions have a
// schema".
export const actionParamSchemas: Partial<Record<string, ZodType>> = {
  [ACTION_TYPES.SEND_EMAIL]: sendEmailParamsSchema,
  [ACTION_TYPES.SCRAPE]: scrapeParamsSchema,
  [ACTION_TYPES.SEARCH]: searchParamsSchema,
  [ACTION_TYPES.NEWS_SEARCH]: newsSearchParamsSchema,
  [ACTION_TYPES.PREVIEW_SEARCH]: previewSearchParamsSchema,
  [ACTION_TYPES.TAVILY_SEARCH]: tavilySearchParamsSchema,
  [ACTION_TYPES.CHECK_DOMAIN]: checkDomainParamsSchema,
  [ACTION_TYPES.READ_DOCUMENT]: readDocumentParamsSchema,
  [ACTION_TYPES.WRITE_DOCUMENT]: writeDocumentParamsSchema,
  [ACTION_TYPES.FORMAT_DOCUMENT]: formatDocumentParamsSchema,
  [ACTION_TYPES.REMOVE_DOCUMENT]: removeDocumentParamsSchema,
  [ACTION_TYPES.RENAME_DOCUMENT]: renameDocumentParamsSchema,
  [ACTION_TYPES.DUPLICATE_DOCUMENT]: duplicateDocumentParamsSchema,
  [ACTION_TYPES.ADD_DOCUMENT]: addDocumentParamsSchema,
  [ACTION_TYPES.ADD_FOLDER]: addFolderParamsSchema,
  [ACTION_TYPES.REMOVE_FOLDER]: removeFolderParamsSchema,
  [ACTION_TYPES.READ_FOLDER]: readFolderParamsSchema,
  [ACTION_TYPES.RENAME_FOLDER]: renameFolderParamsSchema,
  [ACTION_TYPES.CREATE_DATABASE]: createDatabaseParamsSchema,
  [ACTION_TYPES.READ_DATABASE]: readDatabaseParamsSchema,
  [ACTION_TYPES.UPDATE_DATABASE]: updateDatabaseParamsSchema,
  [ACTION_TYPES.DELETE_DATABASE]: deleteDatabaseParamsSchema,
  [ACTION_TYPES.WRITE_DATABASE]: writeDatabaseParamsSchema,
  [ACTION_TYPES.DUPLICATE_DATABASE]: duplicateDatabaseParamsSchema,
  [ACTION_TYPES.DB_FIND]: dbFindParamsSchema,
  [ACTION_TYPES.DB_INSERT]: dbInsertParamsSchema,
  [ACTION_TYPES.DB_UPDATE]: dbUpdateParamsSchema,
  [ACTION_TYPES.DB_DELETE]: dbDeleteParamsSchema,
  [ACTION_TYPES.ASK_USER_INPUT]: askUserInputParamsSchema,
  [ACTION_TYPES.RUN_CODE]: runCodeParamsSchema,
  [ACTION_TYPES.RUN_SHELL]: runShellParamsSchema,
  [ACTION_TYPES.READ_MD_FILE]: readMdFileParamsSchema,
  [ACTION_TYPES.WRITE_MD_FILE]: writeMdFileParamsSchema,
  [ACTION_TYPES.CREATE_MD_FILE]: createMdFileParamsSchema,
  [ACTION_TYPES.DELETE_MD_FILE]: deleteMdFileParamsSchema,
  [ACTION_TYPES.RENAME_MD_FILE]: renameMdFileParamsSchema,
  [ACTION_TYPES.DUPLICATE_MD_FILE]: duplicateMdFileParamsSchema,
  [ACTION_TYPES.ATTACH_FILE]: attachFileParamsSchema,
};

/**
 * Validate an action with specific parameter validation based on variant
 */
export function validateAction(action: unknown): ValidationResult {
  try {
    // First validate basic action structure
    const validAction = actionSchema.parse(action) as DAFAction;

    const paramSchema = actionParamSchemas[validAction.variant];
    if (!paramSchema) {
      // Unknown / unsupported variant (e.g. deactivated crawl)
      return {
        valid: false,
        errors: [{ path: 'variant', message: `Unsupported action variant: ${validAction.variant}` }],
      };
    }

    paramSchema.parse(validAction.parameters);
    return { valid: true, errors: [] };
  } catch (error) {
    if (error instanceof ZodError) {
      return { valid: false, errors: zodErrorToValidationErrors(error) };
    }
    return {
      valid: false,
      errors: [{ path: '', message: 'Unknown validation error' }],
    };
  }
}

/**
 * Validate an editor action with specific parameter validation based on variant
 */
export function validateEditorAction(action: unknown): ValidationResult {
  try {
    const validAction = editorActionSchema.parse(action) as DAFEditorAction;

    // Direct-apply variants are applied client-side and need no parameter checks
    if ((DIRECT_APPLY_EDITOR_ACTIONS as readonly string[]).includes(validAction.variant)) {
      return { valid: true, errors: [] };
    }

    switch (validAction.variant) {
      case 'translate':
        translateParamsSchema.parse(validAction.parameters);
        break;
      case 'directive':
        directiveParamsSchema.parse(validAction.parameters);
        break;
      default:
        editorActionBaseParamsSchema.parse(validAction.parameters);
        break;
    }

    return { valid: true, errors: [] };
  } catch (error) {
    if (error instanceof ZodError) {
      return { valid: false, errors: zodErrorToValidationErrors(error) };
    }
    return {
      valid: false,
      errors: [{ path: '', message: 'Unknown validation error' }],
    };
  }
}

/**
 * Check if a DAF document is valid (returns boolean)
 */
export function isValidDAFDocument(doc: unknown): doc is DAFDocument {
  return validateDAFDocument(doc).valid;
}

/**
 * Check if a process is valid (returns boolean)
 */
export function isValidProcess(process: unknown): process is DAFProcess {
  return validateProcess(process).valid;
}

/**
 * Check if a step is valid (returns boolean)
 */
export function isValidStep(step: unknown): step is DAFStep {
  return validateStep(step).valid;
}

/**
 * Check if a resource is valid (returns boolean)
 */
export function isValidResource(resource: unknown): resource is DAFResource {
  return validateResource(resource).valid;
}

/**
 * Check if an action is valid (returns boolean)
 */
export function isValidAction(action: unknown): action is DAFAction {
  return validateAction(action).valid;
}

/**
 * Check if an editor action is valid (returns boolean)
 */
export function isValidEditorAction(action: unknown): action is DAFEditorAction {
  return validateEditorAction(action).valid;
}

/**
 * Check if a v2.0 process definition file is valid (returns boolean)
 */
export function isValidProcessDefinitionFile(file: unknown): file is DAFProcessDefinitionFile {
  return validateProcessDefinitionFile(file).valid;
}

/**
 * Check if a v2.0 manifest file is valid (returns boolean)
 */
export function isValidManifestFile(file: unknown): file is DAFManifestFile {
  return validateManifestFile(file).valid;
}
