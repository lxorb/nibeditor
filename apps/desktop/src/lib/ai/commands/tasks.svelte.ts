/** A thread's background work: its goal, its loops, its subtasks and batches (`/tasks`).
 *
 *  Every runner that goes on after its command returns puts itself here with a way to
 *  stop it, so `/tasks` can list it, `/stop` can end all of it, and the panel can mark a
 *  thread that has work running out of sight. The three of these the document names as
 *  the only requests nobody pressed send for (5.1) are all on this list, and all
 *  stoppable from it. */

export type TaskKind = 'goal' | 'loop' | 'subtask' | 'batch' | 'research' | 'fork'

interface Task {
  id: string
  /** The thread it belongs to: where it was started. */
  thread: string
  kind: TaskKind
  /** What it is about: the goal's condition, the loop's prompt, the subtask's task. */
  label: string
  started: number
  /** The helper thread it runs in, where it has one. */
  helper?: string
  stop(): void
}

class Tasks {
  list = $state.raw<Task[]>([])

  add(task: Omit<Task, 'id' | 'started'>): Task {
    const made: Task = { ...task, id: crypto.randomUUID(), started: Date.now() }
    this.list = [...this.list, made]
    return made
  }

  /** Off the list, without stopping it: it ended by itself. */
  done(id: string): void {
    this.list = this.list.filter((one) => one.id !== id)
  }

  of(thread: string): Task[] {
    return this.list.filter((one) => one.thread === thread)
  }

  /** Stops every piece of a thread's work, or of one kind of it. */
  stop(thread: string, kind?: TaskKind): number {
    const ending = this.of(thread).filter((one) => !kind || one.kind === kind)
    for (const one of ending) {
      this.done(one.id)
      one.stop()
    }
    return ending.length
  }
}

export const tasks = new Tasks()
