import { authorize, readFilter, roleFor } from './authorization.js';
import { fail, type Action, type Context, type Project, type Resource, type Task, type User, type Role } from './types.js';
export class TaskService {
  constructor(private context: Context) {}
  private get db() { return this.context.db; }
  private subject(id: string): User {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User || fail(401, 'unauthenticated');
  }
  private project(id: string): Project {
    return this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Project || fail(404, 'not_found');
  }
  private task(id: string): Resource {
    const task = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Task | undefined;
    if (!task) fail(404, 'not_found');
    return { task, project: this.project(task.projectId) };
  }
  private enforce(subject: User, action: Action, resource: Resource) {
    if (!authorize(subject, action, resource, this.context)) fail(403, 'forbidden', 'Bạn không có quyền thực hiện thao tác này.');
  }
  listProjects(uid: string) {
    const user = this.subject(uid), filter = readFilter(user, this.context);
    const projects = this.db.prepare(`SELECT p.* FROM projects p WHERE ${filter.sql} ORDER BY p.id`).all(...filter.params) as Project[];
    return projects.map(project => ({ ...project, role: roleFor(user, { project }, this.context) ?? null }));
  }
  listTasks(uid: string) {
    const filter = readFilter(this.subject(uid), this.context);
    return this.db.prepare(`SELECT t.* FROM tasks t JOIN projects p ON p.id = t.projectId WHERE ${filter.sql} ORDER BY t.id`).all(...filter.params);
  }
  getTask(uid: string, id: string) {
    const resource = this.task(id);
    this.enforce(this.subject(uid), 'read', resource);
    return resource.task!;
  }
  editTask(uid: string, id: string, body: Record<string, unknown>) {
    return this.db.transaction(() => {
      const user = this.subject(uid), resource = this.task(id);
      this.enforce(user, 'edit', resource);
      // Identity-like claims are ignored; moving a task between projects is never supported.
      if ('projectId' in body || 'id' in body) fail(400, 'immutable_field');
      const fields = ['title', 'description', 'assigneeId', 'status'] as const;
      const keys = fields.filter(k => Object.hasOwn(body, k));
      if (!keys.length) fail(400, 'empty_patch');
      const role = roleFor(user, resource, this.context);
      if (!['starter', 'v1'].includes(this.context.version) && role === 'Member' && keys.some(k => k === 'assigneeId' || k === 'status'))
        fail(403, 'forbidden', 'Member chỉ được sửa tiêu đề và mô tả.');
      if ('title' in body && (typeof body.title !== 'string' || !body.title.trim() || body.title.length > 200)) fail(400, 'invalid_title');
      if ('description' in body && (typeof body.description !== 'string' || body.description.length > 5000)) fail(400, 'invalid_description');
      if ('status' in body && !['Open', 'Closed'].includes(body.status as string)) fail(400, 'invalid_status');
      if ('assigneeId' in body && body.assigneeId !== null) {
        if (typeof body.assigneeId !== 'string' || !this.db.prepare('SELECT 1 FROM project_members WHERE projectId = ? AND userId = ?').get(resource.project.id, body.assigneeId))
          fail(400, 'invalid_assignee', 'Người được giao phải là thành viên project.');
      }
      this.db.prepare(`UPDATE tasks SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`)
        .run(...keys.map(k => body[k]), id);
      return this.task(id).task!;
    })();
  }
  deleteProject(uid: string, id: string) {
    this.db.transaction(() => {
      const project = this.project(id);
      this.enforce(this.subject(uid), 'delete', { project });
      this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    })();
    return { ok: true };
  }
  listMembers(uid: string, id: string) {
    this.enforce(this.subject(uid), 'members', { project: this.project(id) });
    return this.db.prepare('SELECT m.userId, u.name, m.role FROM project_members m JOIN users u ON u.id = m.userId WHERE m.projectId = ? ORDER BY m.userId').all(id);
  }
  changeMember(uid: string, projectId: string, method: 'POST' | 'PATCH' | 'DELETE', target: unknown, role?: unknown) {
    return this.db.transaction(() => {
      const project = this.project(projectId);
      this.enforce(this.subject(uid), 'members', { project });
      if (typeof target !== 'string') fail(400, 'invalid_user');
      const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(target) as User | undefined;
      if (!user) fail(400, 'invalid_user');
      if (this.context.version === 'v4' && user.tenantId !== project.tenantId) fail(400, 'cross_tenant_member');
      if (method !== 'DELETE' && !(['Viewer', 'Member', 'Owner'] as unknown[]).includes(role)) fail(400, 'invalid_role');
      const current = this.db.prepare('SELECT role FROM project_members WHERE projectId = ? AND userId = ?').get(projectId, target) as {role: Role} | undefined;
      if (method === 'POST' && current) fail(409, 'member_exists');
      if (method !== 'POST' && !current) fail(404, 'not_found');
      if (current?.role === 'Owner' && (method === 'DELETE' || role !== 'Owner')) {
        const owners = this.db.prepare("SELECT count(*) AS n FROM project_members WHERE projectId = ? AND role = 'Owner'").get(projectId) as {n: number};
        if (owners.n <= 1) fail(409, 'last_owner', 'Project phải còn ít nhất một Owner.');
      }
      if (method === 'POST') this.db.prepare('INSERT INTO project_members VALUES (?, ?, ?)').run(projectId, target, role);
      if (method === 'PATCH') this.db.prepare('UPDATE project_members SET role = ? WHERE projectId = ? AND userId = ?').run(role, projectId, target);
      if (method === 'DELETE') {
        this.db.prepare('DELETE FROM project_members WHERE projectId = ? AND userId = ?').run(projectId, target);
        this.db.prepare('UPDATE tasks SET assigneeId = NULL WHERE projectId = ? AND assigneeId = ?').run(projectId, target);
      }
      return { ok: true };
    })();
  }
}
