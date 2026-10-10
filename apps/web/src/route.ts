import { useEffect, useState } from "react";

export type Route =
  | { page: "overview" }
  | { page: "tasks" }
  | { page: "new-task" }
  | { page: "task"; id: string };

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseRoute(hash: string): Route {
  const path = safeDecode(hash.replace(/^#\/?/, ""));
  if (path === "tasks") return { page: "tasks" };
  if (path === "tasks/new") return { page: "new-task" };
  const match = /^tasks\/([^/]+)$/.exec(path);
  if (match) return { page: "task", id: match[1] };
  return { page: "overview" };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = (): void => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
