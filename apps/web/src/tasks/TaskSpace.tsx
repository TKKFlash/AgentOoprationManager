import "./tasks.css";
import type { Route } from "../route.js";
import { NewTaskPage } from "./NewTask.js";
import { TaskList } from "./TaskList.js";
import { TaskRoom } from "./TaskRoom.js";

export function TaskSpace({ route }: { route: Route }) {
  if (route.page === "new-task") return <NewTaskPage />;
  if (route.page === "task") return <TaskRoom key={route.id} taskId={route.id} />;
  return <TaskList />;
}
