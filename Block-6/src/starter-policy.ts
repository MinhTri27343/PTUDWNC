import type { User, Action, Resource, Context } from './types.js';
// Actual vulnerable policy used by /api/starter, after authentication middleware.
export function authorize(_subject: User, _action: Action, _resource: Resource, _context: Context): boolean {
  return true;
}
