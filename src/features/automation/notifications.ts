import type { Notification } from "./contracts";
// Fixed internal route shapes: no source/body text is interpreted as a URL.
export function notificationHref(notification: Notification): string {
  const id = encodeURIComponent(notification.target.id);
  return notification.target.type === "task"
    ? `/app/crew/tasks/${id}`
    : `/app/growth?milestone=${id}`;
}
