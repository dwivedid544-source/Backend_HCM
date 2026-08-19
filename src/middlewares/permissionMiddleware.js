// ============================================================
// Permission Middleware
// Validates module-level permissions from DB for all API routes
// Usage: checkPermission('users', 'delete')
// ============================================================

const prisma = require('../config/prisma');
const { getRoleCustomName, ensureDefaultRoles } = require('../utils/roleSeeder');

const MODULE_ALIASES = {
  payroll_operations: ['payroll_operations', 'payroll_center', 'payroll'],
  payroll_center: ['payroll_center', 'payroll_operations', 'payroll'],
  payroll: ['payroll', 'payroll_center', 'payroll_operations'],
  overtime_policies: ['overtime_policies', 'overtime_rules'],
  overtime_rules: ['overtime_rules', 'overtime_policies'],
  shifts: ['shifts', 'shift_management'],
  shift_management: ['shift_management', 'shifts'],
  employees: ['employees', 'users', 'team_members'],
  users: ['users', 'employees', 'team_members'],
  candidates: ['candidates', 'job_posts', 'hiring_pipeline']
};

/**
 * Factory: returns Express middleware that checks if the authenticated user
 * has the specified action permission for a module.
 *
 * @param {string} module  - e.g. 'users', 'departments', 'payroll_center'
 * @param {string} action  - 'view' | 'create' | 'edit' | 'delete' | 'approve' | 'manage'
 */
const checkPermission = (module, action = 'view') => {
  return async (req, res, next) => {
    try {
      const userRole = (req.user?.role || '').toUpperCase();

      // SUPERADMIN and ADMIN have comprehensive clearance for organizational modules
      if (userRole === 'SUPERADMIN' || userRole === 'ADMIN') {
        return next();
      }

      let customRole = null;

      // 1. Check if user has an active custom role override
      if (req.user?.customRoleId && req.user?.customRoleStatus === 'ACTIVE') {
        customRole = await prisma.customRole.findUnique({ where: { id: req.user.customRoleId } });
      }

      // 2. Fallback to base role (e.g. "HR Manager", "Manager", "Employee", "Candidate")
      if (!customRole || customRole.status !== 'ACTIVE') {
        const customRoleName = getRoleCustomName(userRole);
        if (customRoleName) {
          customRole = await prisma.customRole.findFirst({ where: { name: customRoleName } });
        }
      }

      if (!customRole) {
        // If HR role, grant HR operations by default
        if (userRole === 'HR') return next();
        if (userRole === 'MANAGER' && (module.startsWith('team') || module.startsWith('leave') || module.startsWith('attend') || module.startsWith('task') || module.startsWith('rev'))) return next();
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Role permissions not configured. Contact your administrator.'
          }
        });
      }

      let permissions = {};
      try {
        permissions = typeof customRole.permissions === 'string' 
          ? JSON.parse(customRole.permissions || '{}') 
          : (customRole.permissions || {});
      } catch (e) {
        permissions = {};
      }

      // Check direct module and any module aliases
      const candidateModules = [module, ...(MODULE_ALIASES[module] || [])];
      let modulePerms = [];
      for (const mod of candidateModules) {
        if (Array.isArray(permissions[mod]) && permissions[mod].length > 0) {
          modulePerms = permissions[mod];
          break;
        }
      }

      // If the module permissions array doesn't exist or is empty
      if (!Array.isArray(modulePerms) || modulePerms.length === 0) {
        if (userRole === 'HR') return next();
        return res.status(403).json({
          success: false,
          error: {
            code: 'MODULE_ACCESS_DENIED',
            message: `Access to '${module}' module has been denied for your role.`
          }
        });
      }

      // 'manage' grants all actions within the module
      if (modulePerms.includes('manage')) {
        return next();
      }

      // Specific action check
      if (modulePerms.includes(action)) {
        return next();
      }

      // If action is view, but user has any other valid capability (create/edit/delete/approve), grant view
      if (action === 'view' && modulePerms.length > 0) {
        return next();
      }

      return res.status(403).json({
        success: false,
        error: {
          code: 'ACTION_DENIED',
          message: `You do not have '${action}' permission on the '${module}' module.`
        }
      });

    } catch (err) {
      next(err);
    }
  };
};

module.exports = { checkPermission };
