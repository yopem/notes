import { afterEach, describe, expect, test } from "bun:test"
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  completeNoteTask,
  completeTask,
  computeReminders,
  editTask,
  forwardTask,
  nextRepeatDate,
  parseRepeatRule,
  parseTasks,
  ReminderLedger,
  selectTasks,
  type TaskNote,
  taskProgress,
} from "@/features/tasks/service"

// Source edits need isolation: enumerate byte preservation, stale records,
// tabs, Unicode, CRLF, callouts, comments, fenced/indented/inline code,
// note defaults, custom states, nesting, filters, recurrence, and duplicate work.
// Ledger checks use real files: restart, collision, corruption, failed paths,
// symlinks, independent writers, catch-up, and notification claims before emit.
const roots: string[] = []

function root() {
  const value = mkdtempSync(join(tmpdir(), "still-task-"))
  roots.push(value)

  return value
}

function note(body: string, path = "inbox/work.md"): TaskNote {
  return { path, title: "Work", body }
}

function first(body: string) {
  const source = note(body)
  const task = parseTasks(source)[0]

  if (!task) throw new Error("Missing task fixture")

  return { source, task }
}

afterEach(() => {
  for (const value of roots.splice(0))
    rmSync(value, { recursive: true, force: true })
})

describe("task parsing and safe source changes", () => {
  test("skips comments, fences, code and frontmatter; retains callouts and tabs", () => {
    const body = [
      "---",
      "sample: '- [ ] no'",
      "---",
      "<!--",
      "- [ ] hidden",
      "-->",
      "````md",
      "- [ ] code",
      "```",
      "- [ ] still code",
      "````",
      "    - [ ] indented code",
      "`- [ ] inline`",
      "> [!NOTE]",
      "> - [/] 日本語 #計画 @status:Review @sprint:24",
      "- [ ] parent",
      "\t- [x] child",
      "- [ ]glued",
      "- [ ] visible `due:2000-01-01` <!-- @status:no -->",
    ].join("\r\n")

    const tasks = parseTasks(note(body))
    expect(tasks.map((task) => task.content)).toEqual([
      "日本語 #計画",
      "parent",
      "child",
      "visible `due:2000-01-01`",
    ])
    expect(tasks[0]?.state).toBe("in-progress")
    expect(tasks[0]?.fields).toEqual({ status: "review", sprint: "24" })
    expect(tasks[0]?.tags).toEqual(["計画"])
    expect(tasks[2]?.parentId).toBe(tasks[1]?.id)
    expect(tasks[3]?.due).toBeUndefined()
  })

  test("whole-note task, flat and list tags, defaults, all states and dates", () => {
    const tasks = parseTasks(
      note(
        "---\r\ntags:\r\n  - task\r\n  - 工作\r\nstatus: review\r\ndue: '2024-02-29'\r\nscheduled: 2024-02-01\r\ncompletedDate: 2024-03-01\r\npriority: normal\r\nsprint: 24\r\n---\r\n- [ ] open\r\n- [x] done\r\n- [>] forwarded\r\n- [-] cancelled\r\n- [/] doing\r\n- [ ] wait @waiting",
      ),
    )

    expect(tasks).toHaveLength(7)
    expect(tasks[0]).toMatchObject({
      kind: "note",
      state: "open",
      status: "review",
      due: "2024-02-29",
      scheduled: "2024-02-01",
      completed: "2024-03-01",
      priority: "med",
      tags: ["工作"],
    })
    expect(tasks[0]?.fields.sprint).toBe("24")
    expect(tasks.slice(1).map((task) => task.state)).toEqual([
      "open",
      "done",
      "forwarded",
      "cancelled",
      "in-progress",
      "waiting",
    ])
    expect(tasks[1]?.parentId).toBe(tasks[0]?.id)
    expect(
      parseTasks(note("---\ntags: [task]\ntasks: note\n---\n- [ ] hidden")),
    ).toHaveLength(1)
    expect(
      parseTasks(note("---\ntags: [task]\ntasks: false\n---\n- [ ] hidden")),
    ).toEqual([])
    expect(
      parseTasks(note("---\ntasks: off\n---\n- [ ] visible"), {
        includeExcluded: true,
      }),
    ).toHaveLength(1)
  })

  test("rejects overflow and non-padded dates; accepts valid leap dates", () => {
    const tasks = parseTasks(
      note(
        "- [ ] bad due:2025-02-29 scheduled:2024-13-01\n- [ ] bad due:2024-2-01\n- [ ] leap due:2024-02-29 !HIGH @owner:Éva",
      ),
    )

    expect(tasks[0]?.due).toBeUndefined()
    expect(tasks[0]?.scheduled).toBeUndefined()
    expect(tasks[1]?.due).toBeUndefined()
    expect(tasks[2]).toMatchObject({
      due: "2024-02-29",
      priority: "high",
      fields: { owner: "éva" },
    })
  })

  test("plain bullets block task parentage and quote depth stays separate", () => {
    const tasks = parseTasks(
      note(
        "- [ ] top\n  - prose\n    - [ ] not direct\n> - [ ] quoted\n>   - [x] child\n- [ ] sibling",
      ),
    )

    expect(tasks[1]?.parentId).toBeUndefined()
    expect(tasks[3]?.parentId).toBe(tasks[2]?.id)
    expect(tasks[4]?.parentId).toBeUndefined()
    expect(taskProgress(tasks, tasks[2]?.id ?? "")).toEqual({
      total: 1,
      done: 1,
      fraction: 1,
    })
  })

  test("minimal edits preserve CRLF, indentation, trailing spaces and code tokens", () => {
    const { source, task } = first(
      "prefix\r\n\r\n-\t[ ]  Keep  text `due:2001-01-01` due: 2024-02-01  \r\nfooter\r\n",
    )

    const body = editTask(source, task, {
      state: "in-progress",
      due: "2024-02-02",
    })

    expect(body).toBe(
      "prefix\r\n\r\n-\t[/]  Keep  text `due:2001-01-01` due: 2024-02-02  \r\nfooter\r\n",
    )
    expect(() =>
      editTask(
        { ...source, body: source.body.replace("Keep", "Changed") },
        task,
        { state: "done" },
      ),
    ).toThrow("changed")
    expect(() => editTask(source, task, { due: "2024-02-30" })).toThrow()
    expect(() =>
      editTask(source, task, { fields: { status: "bad\n- [ ] injected" } }),
    ).toThrow()
  })

  test("note metadata edit preserves other YAML and body", () => {
    const { source, task } = first(
      "---\r\ntags: [task]\r\ndue: '2024-01-01' # keep\r\nother: value\r\n---\r\nText\r\n",
    )

    const body = editTask(source, task, {
      due: "2024-01-02",
      state: "done",
      completed: "2024-01-02",
      fields: { sprint: "25" },
    })

    expect(body).toContain("due: '2024-01-02' # keep\r\nother: value\r\n")
    expect(body.endsWith("---\r\nText\r\n")).toBe(true)
    expect(parseTasks({ ...source, body })[0]).toMatchObject({
      state: "done",
      completed: "2024-01-02",
      fields: { sprint: "25" },
    })
  })

  test("filters and sorts preserve input, folder boundaries and explicit manual order", () => {
    const tasks = [
      ...parseTasks(
        note(
          "- [ ] Later due:2024-03-02 !high #work @status:review\n- [ ] First due:2024-03-01 !low #work\n- [x] Done",
          "Projects/a.md",
        ),
      ),
      ...parseTasks(note("- [ ] Other", "Projects Old/b.md")),
    ]

    expect(
      selectTasks(tasks, {
        folders: ["Projects"],
        tags: ["work"],
        sort: "due",
      }).map((task) => task.content),
    ).toEqual(["First #work", "Later #work"])
    expect(
      selectTasks(tasks, { status: ["review"], sort: "priority" }),
    ).toHaveLength(1)
    expect(
      selectTasks(tasks, {
        sort: "manual",
        manualOrder: [tasks[1]?.id ?? ""],
      })[0]?.content,
    ).toBe("First #work")
    expect(
      selectTasks(tasks, { excludeFolders: ["Projects"], hideEmpty: true }),
    ).toHaveLength(1)
    expect(tasks[0]?.content).toBe("Later #work")
  })
})

describe("recurrence and forwarding", () => {
  test("whole-note recurrence returns guarded record and separate create draft", () => {
    const { source, task } = first(
      "---\ntags: [task]\ndue: 2024-01-31\nrepeat: monthly\nremind: 9am\n---\n- [ ] step\n",
    )

    const plan = completeNoteTask(source, task, "2024-01-31")
    expect(parseTasks(plan.record)[0]).toMatchObject({
      state: "done",
      completed: "2024-01-31",
    })
    expect(parseTasks(plan.record)[0]?.fields.repeat).toBeUndefined()
    expect(plan.next?.path).toBe("inbox/work 2024-02-29.md")

    if (plan.next)
      expect(parseTasks(plan.next)[0]).toMatchObject({
        state: "open",
        due: "2024-02-29",
        fields: { repeat: "monthly" },
      })
    const record = parseTasks(plan.record)[0]

    if (record)
      expect(
        completeNoteTask(plan.record, record, "2024-01-31").next,
      ).toBeUndefined()
  })
  test("valid rules clamp month ends, leap years, weekdays and skip missed dates", () => {
    const cases = [
      ["monthly", "2024-01-31", "2024-02-29", "2024-03-31"],
      ["yearly", "2024-02-29", "2024-02-29", "2025-02-28"],
      ["daily", "2024-01-01", "2024-01-10", "2024-01-11"],
      ["after-3d", "2024-01-20", "2024-01-01", "2024-01-04"],
      ["mon/thu", "2024-01-04", "2024-01-04", "2024-01-08"],
      ["weekdays", "2024-01-05", "2024-01-05", "2024-01-08"],
    ]

    for (const [raw, base, today, expected] of cases) {
      const rule = parseRepeatRule(raw ?? "")
      expect(rule).not.toBeNull()

      if (rule)
        expect(nextRepeatDate(rule, base ?? "", today ?? "")).toBe(
          expected ?? "",
        )
    }

    for (const raw of [
      "0d",
      "1000d",
      "after-mon",
      "mon/nope",
      "-1w",
      "2hours",
      "",
    ])
      expect(parseRepeatRule(raw)).toBeNull()
  })

  test("completion repeats subtree, cancels unfinished record children, never repeats record", () => {
    const { source, task } = first(
      "- [ ] Water due:2024-01-01 @repeat:weekly @remind:9am\r\n  - [ ] refill\r\n  - [x] wash\r\nend\r\n",
    )

    const body = completeTask(source, task, "2024-01-10")
    const tasks = parseTasks({ ...source, body })
    expect(tasks).toHaveLength(6)
    expect(tasks[0]).toMatchObject({
      state: "open",
      due: "2024-01-15",
      fields: { repeat: "weekly", remind: "9am" },
    })
    expect(tasks[1]?.state).toBe("open")
    expect(tasks[2]?.state).toBe("open")
    expect(tasks[3]).toMatchObject({ state: "done", completed: "2024-01-10" })
    expect(tasks[3]?.fields.repeat).toBeUndefined()
    expect(tasks[4]?.state).toBe("cancelled")
    const record = tasks[3]

    if (record)
      expect(completeTask({ ...source, body }, record, "2024-01-10")).toBe(body)
    expect(body.endsWith("end\r\n")).toBe(true)
  })

  test("forwarding nested and quoted tasks keeps destination work parseable", () => {
    for (const body of [
      "- [ ] parent\n\t- [ ] move\n\t  - [ ] child\n",
      "> [!NOTE]\n> - [ ] move\n>   - [ ] child\n",
    ]) {
      const source = note(body)
      const task = parseTasks(source).find((item) => item.content === "move")

      if (!task) throw new Error("Missing nested fixture")
      const target = note("# Target\n", "inbox/target.md")
      const moved = forwardTask(source, task, target)
      expect(
        parseTasks(moved.target).map((item) => item.content.split(" ←")[0]),
      ).toEqual(["move", "child"])
      expect(parseTasks(moved.target)[1]?.parentId).toBe(
        parseTasks(moved.target)[0]?.id,
      )
    }
  })

  test("invalid recurrence completes once; forwarding is guarded and keeps subtree", () => {
    const { source, task } = first(
      "- [/] Plan due:2024-01-01 @repeat:nope\n  - [ ] child\n",
    )

    expect(
      parseTasks({ ...source, body: completeTask(source, task, "2024-01-02") }),
    ).toHaveLength(2)
    const target = note("# Next\n", "inbox/next.md")
    const changes = forwardTask(source, task, target)
    expect(changes.source.body).toContain("[>]")
    expect(changes.target.body).toContain("- [ ] Plan")
    expect(changes.target.body).not.toContain("due:2024-01-01")
    expect(changes.target.body).toContain("  - [ ] child")
    expect(() => forwardTask(source, task, source)).toThrow()
    const moved = parseTasks(changes.source)[0]

    if (moved)
      expect(() => forwardTask(changes.source, moved, target)).toThrow()
  })
})

describe("real reminder ledger", () => {
  test("local clock grammar, distinct equal titles, terminal states and restart once-only", () => {
    const now = new Date(2024, 2, 1, 10)

    const tasks = parseTasks(
      note(
        "- [ ] Same due:2024-03-01 @remind:930am\n- [ ] Same due:2024-03-01 @remind:930am\n- [x] Done due:2024-03-01 @remind:9am\n- [ ] Bad due:2024-03-01 @remind:2560",
      ),
    )

    const reminders = computeReminders(tasks, { now })
    expect(reminders).toHaveLength(2)
    expect(new Set(reminders.map((item) => item.key)).size).toBe(2)
    expect(new Date(reminders[0]?.fireAt ?? 0).getHours()).toBe(9)
    const directory = root()
    const start = new Date(2024, 2, 1, 9).getTime()
    const ledger = new ReminderLedger(directory, start)
    ledger.claim(reminders, start)
    expect(ledger.claim(reminders, now.getTime())).toHaveLength(2)
    expect(
      new ReminderLedger(directory, now.getTime()).claim(
        reminders,
        now.getTime(),
      ),
    ).toEqual([])
    expect(readFileSync(join(directory, "reminders.json"), "utf8")).toContain(
      '"version":1',
    )
  })

  test("concurrent instances reread claims; corrupt data and symlinks fail closed", () => {
    const directory = root()
    const at = new Date(2024, 0, 1, 9).getTime()

    const items = computeReminders(
      parseTasks(note("- [ ] Ping due:2024-01-01 @remind:9am")),
      { now: new Date(at) },
    )

    const one = new ReminderLedger(directory, at - 1)
    const two = new ReminderLedger(directory, at - 1)
    expect(one.claim(items, at)).toHaveLength(1)
    expect(two.claim(items, at)).toEqual([])
    writeFileSync(join(directory, "reminders.json"), "broken")
    expect(() => one.claim(items, at)).toThrow()
    expect(readFileSync(join(directory, "reminders.json"), "utf8")).toBe(
      "broken",
    )
    const outside = root()
    const linked = root()
    symlinkSync(join(outside, "state.json"), join(linked, "reminders.json"))
    expect(() => new ReminderLedger(linked, at).claim(items, at)).toThrow()
  })
})
