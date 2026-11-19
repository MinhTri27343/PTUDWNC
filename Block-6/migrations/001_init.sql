CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  tenantId TEXT NOT NULL REFERENCES tenants(id), admin INTEGER NOT NULL DEFAULT 0 CHECK(admin IN (0,1)),
  passwordHash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, tenantId TEXT NOT NULL REFERENCES tenants(id)
);
CREATE TABLE IF NOT EXISTS project_members (
  projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  userId TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL CHECK(role IN ('Viewer','Member','Owner')),
  PRIMARY KEY(projectId, userId)
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  assigneeId TEXT REFERENCES users(id), status TEXT NOT NULL CHECK(status IN ('Open','Closed'))
);
CREATE INDEX IF NOT EXISTS tasks_project ON tasks(projectId);
CREATE INDEX IF NOT EXISTS memberships_user ON project_members(userId, projectId);
