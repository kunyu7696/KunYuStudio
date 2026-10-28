import { randomUUID } from 'node:crypto'
import { getDb } from './db'
import type {
  CreateProjectInput,
  ModLoader,
  Project,
  ProjectType,
  UpdateProjectInput
} from '../../shared/types/project'

interface ProjectRow {
  id: string
  name: string
  type: string
  path: string
  loader: string | null
  mc_version: string
  loader_version: string | null
  mod_id: string | null
  namespace: string | null
  jdk_path: string | null
  description: string
  created_at: number
  last_opened_at: number
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    type: row.type as ProjectType,
    path: row.path,
    loader: row.loader as ModLoader | null,
    mcVersion: row.mc_version,
    loaderVersion: row.loader_version ?? null,
    modId: row.mod_id,
    namespace: row.namespace,
    jdkPath: row.jdk_path,
    description: row.description,
    createdAt: row.created_at,
    lastOpenedAt: row.last_opened_at
  }
}

export function insertProject(input: CreateProjectInput): Project {
  const db = getDb()
  const now = Date.now()
  const project: Project = {
    id: randomUUID(),
    name: input.name.trim(),
    type: input.type,
    path: input.path,
    loader: input.loader ?? null,
    mcVersion: input.mcVersion ?? '',
    loaderVersion: input.loaderVersion ?? null,
    modId: input.modId ?? null,
    namespace: input.namespace ?? null,
    jdkPath: input.jdkPath ?? null,
    description: input.description ?? '',
    createdAt: now,
    lastOpenedAt: now
  }
  const stmt = db.prepare(`
    INSERT INTO projects
      (id, name, type, path, loader, mc_version, loader_version, mod_id, namespace, jdk_path, description, created_at, last_opened_at)
    VALUES
      (@id, @name, @type, @path, @loader, @mcVersion, @loaderVersion, @modId, @namespace, @jdkPath, @description, @createdAt, @lastOpenedAt)
  `)
  stmt.run({
    id: project.id,
    name: project.name,
    type: project.type,
    path: project.path,
    loader: project.loader,
    mcVersion: project.mcVersion,
    loaderVersion: project.loaderVersion,
    modId: project.modId,
    namespace: project.namespace,
    jdkPath: project.jdkPath,
    description: project.description,
    createdAt: project.createdAt,
    lastOpenedAt: project.lastOpenedAt
  })
  return project
}

export function getProjectById(id: string): Project | undefined {
  const row = getDb()
    .prepare('SELECT * FROM projects WHERE id = ?')
    .get(id) as ProjectRow | undefined
  return row ? rowToProject(row) : undefined
}

export function getProjectByPath(path: string): Project | undefined {
  const row = getDb()
    .prepare('SELECT * FROM projects WHERE path = ?')
    .get(path) as ProjectRow | undefined
  return row ? rowToProject(row) : undefined
}

export function listProjects(): Project[] {
  const rows = getDb()
    .prepare('SELECT * FROM projects ORDER BY last_opened_at DESC')
    .all() as ProjectRow[]
  return rows.map(rowToProject)
}

export function updateProject(id: string, patch: UpdateProjectInput): Project | undefined {
  const existing = getProjectById(id)
  if (!existing) return undefined
  const merged: Project = {
    ...existing,
    ...patch,
    lastOpenedAt: patch.lastOpenedAt ?? existing.lastOpenedAt
  }
  getDb()
    .prepare(
      `UPDATE projects SET
        name = @name,
        description = @description,
        path = @path,
        last_opened_at = @lastOpenedAt
      WHERE id = @id`
    )
    .run({
      id,
      name: merged.name,
      description: merged.description,
      path: merged.path,
      lastOpenedAt: merged.lastOpenedAt
    })
  return merged
}

export function deleteProjectRecord(id: string): boolean {
  const result = getDb().prepare('DELETE FROM projects WHERE id = ?').run(id)
  return result.changes > 0
}
