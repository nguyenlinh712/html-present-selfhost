'use strict';

/**
 * Contracts supplied by each application to the shared core.
 *
 * Every repository call receives a request context. The Free app always uses
 * tenantId `default` and role `owner`; Cloud derives tenantId from its
 * authenticated session and must enforce tenant isolation in its repository.
 *
 * @typedef {object} CoreContext
 * @property {string} tenantId Stable tenant/workspace identifier.
 * @property {object|null} user Authenticated user or null for an anonymous viewer.
 * @property {string|null} role Effective role in the context (for example owner/editor/viewer).
 *
 * @typedef {object} ProjectRepository
 * @property {(ctx: CoreContext, filters?: object) => Promise<object[]>|object[]} list
 * @property {(ctx: CoreContext, id: string) => Promise<object|null>|object|null} get
 * @property {(ctx: CoreContext, slug: string) => Promise<object|null>|object|null} bySlug
 * @property {(ctx: CoreContext, input: object) => Promise<object>|object} create
 * @property {(ctx: CoreContext, id: string, patch: object) => Promise<object|null>|object|null} update
 * @property {(ctx: CoreContext, id: string) => Promise<boolean>|boolean} remove
 *
 * @typedef {object} ShareRepository
 * @property {(ctx: CoreContext, projectId: string) => Promise<object[]>|object[]} list
 * @property {(ctx: CoreContext, token: string) => Promise<object|null>|object|null} byToken
 * @property {(ctx: CoreContext, projectId: string, input: object) => Promise<object>|object} create
 * @property {(ctx: CoreContext, projectId: string, id: string, patch: object) => Promise<object|null>|object|null} update
 * @property {(ctx: CoreContext, projectId: string, id: string) => Promise<object|null>|object|null} rotate
 * @property {(ctx: CoreContext, projectId: string, id: string) => Promise<boolean>|boolean} remove
 *
 * @typedef {object} NotesRepository
 * @property {(ctx: CoreContext, projectId: string, relPath: string) => Promise<object>|object} get
 * @property {(ctx: CoreContext, projectId: string, relPath: string, notes: object) => Promise<object>|object} put
 *
 * @typedef {object} FilesRepository
 * @property {(ctx: CoreContext, projectId: string, relPath: string) => Promise<object|null>|object|null} get Returns file metadata including its storage key.
 * @property {(ctx: CoreContext, projectId: string, prefix?: string) => Promise<object[]>|object[]} list Returns file metadata under a relative prefix.
 *
 * @typedef {object} EventsRepository
 * @property {(ctx: CoreContext, rows: object[]) => Promise<number>|number} append
 * @property {(ctx: CoreContext, filter?: object) => Promise<object[]>|object[]} list
 *
 * @typedef {object} AccessRepository
 * @property {(ctx: CoreContext, rows: object[]) => Promise<number>|number} append
 * @property {(ctx: CoreContext, filter?: object) => Promise<object[]>|object[]} list
 *
 * @typedef {object} AnalyticsRepository
 * @property {(ctx: CoreContext, filter?: object) => Promise<object>|object} summary
 *
 * @typedef {object} HeatmapRepository
 * @property {(ctx: CoreContext, rows: object[]) => Promise<number>|number} add
 * @property {(ctx: CoreContext, filter?: object) => Promise<object>|object} grid
 *
 * @typedef {object} CoreRepository
 * @property {ProjectRepository} projects
 * @property {ShareRepository} shares
 * @property {NotesRepository} notes
 * @property {FilesRepository} files
 * @property {EventsRepository} events
 * @property {AccessRepository} access
 * @property {AnalyticsRepository} analytics
 * @property {HeatmapRepository} heatmap
 *
 * @typedef {object} StoragePort
 * @property {(key: string, stream: import('node:stream').Readable|Buffer) => Promise<object>} put
 * @property {(key: string) => Promise<import('node:stream').Readable|null>} get
 * @property {(prefix: string) => Promise<Array<{key: string, size?: number}>>} list
 * @property {(prefix: string) => Promise<number>} deletePrefix
 *
 * @typedef {object} AuthPort
 * @property {(request: object) => Promise<object|null>|object|null} currentUser
 * @property {(role: string) => Function} requireRole Returns application middleware enforcing the requested role.
 */

const REQUIRED_REPOSITORIES = Object.freeze({
  projects: ['list', 'get', 'bySlug', 'create', 'update', 'remove'],
  shares: ['list', 'byToken', 'create', 'update', 'rotate', 'remove'],
  notes: ['get', 'put'],
  files: ['get', 'list'],
  events: ['append', 'list'],
  access: ['append', 'list'],
  analytics: ['summary'],
  heatmap: ['add', 'grid']
});

const REQUIRED_STORAGE = Object.freeze(['put', 'get', 'list', 'deletePrefix']);
const REQUIRED_AUTH = Object.freeze(['currentUser', 'requireRole']);

function assertMethods(value, methods, label) {
  if (!value || typeof value !== 'object') throw new TypeError(`${label} must be an object`);
  for (const method of methods) {
    if (typeof value[method] !== 'function') {
      throw new TypeError(`${label}.${method} must be a function`);
    }
  }
}

/**
 * Validate the adapters once at app startup so a missing port fails early.
 * @param {{repo: CoreRepository, storage: StoragePort, auth: AuthPort}} adapters
 */
function assertCoreAdapters(adapters) {
  if (!adapters || typeof adapters !== 'object') throw new TypeError('Core adapters must be an object');
  if (!adapters.repo || typeof adapters.repo !== 'object') throw new TypeError('repo adapter is required');
  for (const [name, methods] of Object.entries(REQUIRED_REPOSITORIES)) {
    assertMethods(adapters.repo[name], methods, `repo.${name}`);
  }
  assertMethods(adapters.storage, REQUIRED_STORAGE, 'storage');
  assertMethods(adapters.auth, REQUIRED_AUTH, 'auth');
  return adapters;
}

/**
 * Create a request context without accepting an empty or missing tenant id.
 * Adapters remain responsible for deriving Cloud tenant ids from auth state.
 * @param {{tenantId: string, user?: object|null, role?: string|null}} input
 * @returns {CoreContext}
 */
function createContext(input) {
  if (!input || typeof input.tenantId !== 'string' || !input.tenantId.trim()) {
    throw new TypeError('ctx.tenantId must be a non-empty string');
  }
  return Object.freeze({
    tenantId: input.tenantId,
    user: input.user || null,
    role: input.role || null
  });
}

module.exports = { assertCoreAdapters, createContext };
