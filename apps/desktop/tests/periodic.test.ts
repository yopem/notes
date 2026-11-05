import { describe, expect, test } from "bun:test"
import { Effect } from "effect"

import {
  classifyPeriodic,
  inferDailyDue,
  periodicLocation,
  type PeriodicPattern,
  rolloverDailyTasks,
  sourceDateFormat,
} from "@/features/tasks/periodic"
import { parseTasks, type TaskNote } from "@/features/tasks/service"

// Enumerate before implementation: local dates vs UTC, ISO week-year boundaries,
// leap days/month ends, locale names, both token dialects, escaped literals,
// dynamic directories, legacy paths, invalid/ambiguous patterns, traversal,
// explicit due precedence, excluded/terminal/nested work and repeated rollover.
const daily: PeriodicPattern = {
  kind: "daily",
  directory: "Daily/{{date:yyyy}}/{{date:MM}}",
  titlePattern: "yyyy-MM-dd",
  locale: "en-US",
}

const weekly: PeriodicPattern = {
  kind: "weekly",
  directory: "Weeks/{{date:yyyy}}",
  titlePattern: "yyyy-'W'ww",
  locale: "en-US",
}

describe("periodic source date patterns", () => {
  test("raw source directories, two-digit years and compact dates round-trip", () => {
    const raw: PeriodicPattern = {
      kind: "daily",
      directory: "'Daily'/yyyy/MM",
      titlePattern: "yyyyMMdd",
      locale: "en-US",
    }

    expect(
      Effect.runSync(periodicLocation(new Date(2024, 1, 29), raw)).path,
    ).toBe("Daily/2024/02/20240229.md")
    expect(
      Effect.runSync(classifyPeriodic("Daily/2024/02/20240229.md", [raw]))
        ?.date,
    ).toBe("2024-02-29")

    const short: PeriodicPattern = {
      ...raw,
      directory: "Old",
      titlePattern: "yy-MM-dd",
    }

    expect(
      Effect.runSync(classifyPeriodic("Old/24-02-29.md", [short]))?.date,
    ).toBe("2024-02-29")
    expect(sourceDateFormat(new Date(2024, 1, 29), "yyyy-Www")).toBe("2024-W09")
  })
  test("supports localized tokens, source dialects and literals", () => {
    const date = new Date(2024, 1, 29, 23, 7, 8)
    expect(sourceDateFormat(date, "YYYY-MM-DD [at] HH:mm:ss", "en-US")).toBe(
      "2024-02-29 at 23:07:08",
    )
    expect(sourceDateFormat(date, "EEEE d MMMM yyyy", "fr")).toBe(
      "jeudi 29 février 2024",
    )
    expect(sourceDateFormat(date, "dddd D MMMM YYYY", "fr")).toBe(
      "jeudi 29 février 2024",
    )
    expect(() => sourceDateFormat(date, "yyyy-MM-dd", "made-up")).toThrow()
    expect(() =>
      sourceDateFormat(new Date(Number.NaN), "yyyy", "en-US"),
    ).toThrow()
  })

  test("weekly anchors use ISO year even when Monday crosses calendar year", () => {
    expect(
      Effect.runSync(periodicLocation(new Date(2021, 0, 1), weekly)),
    ).toMatchObject({
      path: "Weeks/2020/2020-W53.md",
      date: "2020-12-28",
    })
    expect(
      Effect.runSync(periodicLocation(new Date(2018, 11, 31), weekly)),
    ).toMatchObject({
      path: "Weeks/2019/2019-W01.md",
      date: "2018-12-31",
    })
    expect(
      Effect.runSync(classifyPeriodic("Weeks/2020/2020-W53.md", [weekly]))
        ?.date,
    ).toBe("2020-12-28")
    expect(
      Effect.runSync(classifyPeriodic("Weeks/2021/2021-W53.md", [weekly])),
    ).toBeNull()
  })

  test("daily and monthly directory patterns round-trip localized names", () => {
    expect(
      Effect.runSync(periodicLocation(new Date(2024, 1, 29, 23), daily)).path,
    ).toBe("Daily/2024/02/2024-02-29.md")
    expect(
      Effect.runSync(classifyPeriodic("Daily/2024/02/2024-02-29.md", [daily]))
        ?.date,
    ).toBe("2024-02-29")
    expect(
      Effect.runSync(classifyPeriodic("Daily/2025/02/2025-02-29.md", [daily])),
    ).toBeNull()
    expect(
      Effect.runSync(classifyPeriodic("Daily/2024/02/2024-2-29.md", [daily])),
    ).toBeNull()

    const monthly: PeriodicPattern = {
      kind: "monthly",
      directory: "Journal/{{date:yyyy}}",
      titlePattern: "MMMM yyyy",
      locale: "fr",
    }

    expect(
      Effect.runSync(periodicLocation(new Date(2024, 1, 29), monthly)),
    ).toMatchObject({
      path: "Journal/2024/février 2024.md",
      date: "2024-02-01",
    })
    expect(
      Effect.runSync(
        classifyPeriodic("Journal/2024/février 2024.md", [monthly]),
      )?.date,
    ).toBe("2024-02-01")
  })

  test("legacy detection does not classify wrong directories or unsafe patterns", () => {
    const legacy: PeriodicPattern = {
      ...daily,
      directory: "Old",
      titlePattern: "dd-MM-yyyy",
    }

    expect(
      Effect.runSync(classifyPeriodic("Old/29-02-2024.md", [daily], [legacy])),
    ).toMatchObject({ kind: "daily", date: "2024-02-29", legacy: true })
    expect(
      Effect.runSync(classifyPeriodic("Else/2024-02-29.md", [daily])),
    ).toBeNull()

    for (const directory of [
      "../outside",
      "/absolute",
      "C:/drive",
      "Daily/../../outside",
      "Daily\\bad",
    ])
      expect(() =>
        Effect.runSync(
          periodicLocation(new Date(2024, 1, 29), { ...daily, directory }),
        ),
      ).toThrow()
    expect(() =>
      Effect.runSync(
        periodicLocation(new Date(), { ...daily, titlePattern: "'../bad'" }),
      ),
    ).toThrow()
    expect(() =>
      Effect.runSync(
        periodicLocation(new Date(), { ...daily, titlePattern: "MMMM" }),
      ),
    ).toThrow()
  })
})

describe("daily task domain", () => {
  test("implicit due leaves explicit dates and forwarded records untouched", () => {
    const note: TaskNote = {
      path: "Daily/2024/02/2024-02-29.md",
      title: "Today",
      body: "- [ ] implied\n- [ ] explicit due:2024-03-05\n- [>] moved",
    }

    const tasks = Effect.runSync(inferDailyDue(parseTasks(note), [daily]))
    expect(tasks[0]).toMatchObject({ due: "2024-02-29", dueInferred: true })
    expect(tasks[1]?.due).toBe("2024-03-05")
    expect(tasks[2]?.due).toBeUndefined()
  })

  test("rollover forwards unfinished roots once and retains nested work", () => {
    const source: TaskNote = {
      path: "Daily/2024/02/2024-02-28.md",
      title: "Yesterday",
      body: "# Log\n- [ ] open\n  - [ ] nested\n- [ ] second\n- [x] done\n- [-] cancelled\n- [>] old\n- [ ] future due:2024-03-05\n",
    }

    const today: TaskNote = {
      path: "Daily/2024/02/2024-02-29.md",
      title: "Today",
      body: "# Today\n",
    }

    const changes = Effect.runSync(
      rolloverDailyTasks([source], today, "2024-02-29", [daily]),
    )

    expect(changes).toHaveLength(2)
    const updated = changes.find((item) => item.path === source.path)
    const target = changes.find((item) => item.path === today.path)
    expect(updated?.body).toContain("[>] open")
    expect(target?.body).toContain("  - [ ] nested")
    expect(target?.body).not.toContain("future")

    if (target)
      expect(
        parseTasks(target).map((task) => task.content.split(" ←")[0]),
      ).toEqual(["open", "nested", "second"])

    if (updated && target)
      expect(
        Effect.runSync(
          rolloverDailyTasks([updated], target, "2024-02-29", [daily]),
        ),
      ).toEqual([])
    expect(() =>
      Effect.runSync(
        rolloverDailyTasks([source], today, "2024-03-01", [daily]),
      ),
    ).toThrow()
  })
})
