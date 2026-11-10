export type Role = 'super_admin' | 'admin' | 'moderator' | 'creator' | 'user';
export type Action =
  | 'places.view' | 'places.write' | 'places.propose' | 'places.moderate'
  | 'submissions.view' | 'submissions.approve' | 'reports.handle' | 'reviews.moderate'
  | 'ads.manage' | 'categories.manage' | 'settings.manage' | 'users.manage' | 'dashboard.view';

const MATRIX: Record<Action, Role[]> = {
  'places.view': ['super_admin', 'admin', 'moderator', 'creator'],
  'places.write': ['super_admin', 'admin'],
  'places.propose': ['creator', 'admin', 'super_admin'],
  'places.moderate': ['super_admin', 'admin', 'moderator'],
  'submissions.view': ['super_admin', 'admin', 'moderator'],
  'submissions.approve': ['super_admin', 'admin'],
  'reports.handle': ['super_admin', 'admin', 'moderator'],
  'reviews.moderate': ['super_admin', 'admin', 'moderator'],
  'ads.manage': ['super_admin', 'admin'],
  'categories.manage': ['super_admin', 'admin'],
  'settings.manage': ['super_admin', 'admin'],
  'users.manage': ['super_admin'],
  'dashboard.view': ['super_admin', 'admin', 'moderator'],
};
export const isStaff = (r: Role) => r !== 'user';
/** Confort d'affichage uniquement : la vraie sécurité est dans les règles RLS du serveur. */
export const can = (r: Role, a: Action) => MATRIX[a].includes(r);
