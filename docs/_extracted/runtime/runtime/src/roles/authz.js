'use strict';
/**
 * roles/authz.js — three-tier RBAC (project invariant: Admin · Educator · Learner).
 * Deny-by-default; role is necessary but NOT sufficient — resource access also needs
 * membership/ownership. Enforce on the server; never trust a client-asserted role.
 *
 * Expects upstream auth to populate req.user = { id, role, email, classIds?: [] }.
 * (Wire this from your OAuth/XGH gateway — see team-xgh-gateway.)
 */
const ROLES = Object.freeze({ ADMIN: 'admin', EDUCATOR: 'educator', LEARNER: 'learner' });

function userFrom(req) {
  return (req && req.user) || null;
}

/** Require any of the given roles. */
function requireRole(...allowed) {
  const set = new Set(allowed);
  return (req, res, next) => {
    const u = userFrom(req);
    if (!u || !u.role) return res.status(401).json({ error: 'authentication required' });
    if (!set.has(u.role)) return res.status(403).json({ error: 'forbidden', need: [...set] });
    next();
  };
}
const requireAdmin = requireRole(ROLES.ADMIN);

/**
 * Resource-level check. Hierarchy by membership:
 *  - learner: only own resources (resource.userId === user.id)
 *  - educator: own resources OR a class they own/teach (resource.classId in user.classIds)
 *  - admin: everything (log access for audit — see team-privacy)
 */
function canAccess(user, resource = {}) {
  if (!user || !user.role) return false;
  if (user.role === ROLES.ADMIN) return true;
  if (user.role === ROLES.EDUCATOR) {
    if (resource.classId && Array.isArray(user.classIds) && user.classIds.includes(resource.classId)) return true;
    return resource.userId === user.id;
  }
  if (user.role === ROLES.LEARNER) return resource.userId === user.id;
  return false;
}

/** Express guard that pulls the resource via a resolver(req) -> {userId?, classId?}. */
function requireAccess(resolver) {
  return async (req, res, next) => {
    const u = userFrom(req);
    if (!u) return res.status(401).json({ error: 'authentication required' });
    let resource;
    try { resource = await resolver(req); } catch (e) { return next(e); }
    if (!canAccess(u, resource || {})) return res.status(403).json({ error: 'forbidden' });
    next();
  };
}

module.exports = { ROLES, requireRole, requireAdmin, canAccess, requireAccess };
