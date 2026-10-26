// One definition of "is this the superadmin", in middleware/requireClubAccess.js. This
// re-export keeps the existing callers' import path (REARCH-04).
exports.isSuperAdmin = require('../middleware/requireClubAccess').isSuperAdmin;
