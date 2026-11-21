import type { WorkspaceRead } from "./service";
export function selectClients(
  workspace: WorkspaceRead,
  search = "",
  archived = false,
) {
  const term = search.trim().toLocaleLowerCase("en");
  return workspace.clients.filter(
    (c) =>
      Boolean(c.archivedAt) === archived &&
      (!term ||
        [c.name, c.organization, c.note].some((v) =>
          v.toLocaleLowerCase("en").includes(term),
        )),
  );
}
export function selectProjects(workspace: WorkspaceRead, status?: string) {
  return workspace.projects.filter(
    (p) =>
      !p.archivedAt &&
      (!status ||
        p.status === status ||
        (status === "active" && p.status === "review")),
  );
}
export function selectTasks(workspace: WorkspaceRead, status?: string) {
  return workspace.tasks.filter((t) => !status || t.status === status);
}
