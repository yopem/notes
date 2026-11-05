import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { SettingsStore } from "@/features/settings/store"

// Real files check defaults, restart, immutable values, corrupt input, bounds,
// external edits, failed saves, and credential rejection before implementation.
const roots: string[] = []

function directory() {
  const path = mkdtempSync(join(tmpdir(), "still-settings-"))
  roots.push(path)

  return path
}

afterEach(() => {
  for (const path of roots.splice(0))
    rmSync(path, { recursive: true, force: true })
})

describe("SettingsStore real file integration", () => {
  test("defaults are complete and custom values survive restart", () => {
    const root = directory()
    const store = new SettingsStore(root)
    expect(store.getSnapshot().editorFontSize).toBe(16)
    expect(store.getSnapshot().tabsEnabled).toBe(true)
    Effect.runSync(
      store.update({ editorFontSize: 21, themeMode: "dark", wordWrap: false }),
    )
    const reopened = new SettingsStore(root)
    expect(reopened.getSnapshot().editorFontSize).toBe(21)
    expect(reopened.getSnapshot().themeMode).toBe("dark")
    expect(reopened.getSnapshot().wordWrap).toBe(false)
    expect(reopened.getSnapshot().tabsEnabled).toBe(true)
  })

  test("snapshot identity is stable and nested maps are immutable", () => {
    const store = new SettingsStore(directory())
    const before = store.getSnapshot()
    expect(store.getSnapshot()).toBe(before)
    expect(Object.isFrozen(before)).toBe(true)
    expect(Object.isFrozen(before.commandKeymaps)).toBe(true)
    expect(Object.isFrozen(before.ignoredKeys)).toBe(true)
  })

  test("subscribers run only after durable changes", () => {
    const root = directory()
    const store = new SettingsStore(root)
    let calls = 0

    const unsubscribe = store.subscribe(() => {
      expect(new SettingsStore(root).getSnapshot().editorFontSize).toBe(19)
      calls += 1
    })

    Effect.runSync(store.update({ editorFontSize: 19 }))
    expect(calls).toBe(1)
    unsubscribe()
    Effect.runSync(store.update({ editorFontSize: 20 }))
    expect(calls).toBe(1)
  })

  test("rejects invalid values without changing state or file", () => {
    const root = directory()
    const store = new SettingsStore(root)
    const snapshot = store.getSnapshot()
    const bytes = readFileSync(join(root, "settings.json"))
    expect(() => Effect.runSync(store.update({ editorFontSize: -1 }))).toThrow(
      Error,
    )
    expect(() =>
      Effect.runSync(store.update({ editorLineHeight: 30 })),
    ).toThrow(Error)
    expect(() =>
      Effect.runSync(store.update({ taskReminderTime: "99:99" })),
    ).toThrow(Error)
    expect(store.getSnapshot()).toBe(snapshot)
    expect(readFileSync(join(root, "settings.json"))).toEqual(bytes)
  })

  test("preserves malformed settings and rejects plaintext credentials", () => {
    const root = directory()
    const path = join(root, "settings.json")
    writeFileSync(path, "{broken")
    expect(() => new SettingsStore(root)).toThrow(/settings/)
    expect(readFileSync(path, "utf8")).toBe("{broken")
    writeFileSync(
      path,
      JSON.stringify({ version: 1, preferences: { apiKey: "not-a-secret" } }),
    )
    expect(() => new SettingsStore(root)).toThrow(Error)
  })

  test("refuses external edits and leaves pending in-memory values unchanged", () => {
    const root = directory()
    const store = new SettingsStore(root)
    const snapshot = store.getSnapshot()
    const path = join(root, "settings.json")
    const external = readFileSync(path, "utf8") + "\n"
    writeFileSync(path, external)
    expect(() => Effect.runSync(store.update({ editorFontSize: 18 }))).toThrow(
      /outside/,
    )
    expect(store.getSnapshot()).toBe(snapshot)
    expect(readFileSync(path, "utf8")).toBe(external)
  })

  test("does not follow a settings-file symlink", () => {
    const root = directory()
    const outside = join(directory(), "outside.json")
    writeFileSync(outside, "keep")
    symlinkSync(outside, join(root, "settings.json"))
    expect(() => new SettingsStore(root)).toThrow(Error)
    expect(readFileSync(outside, "utf8")).toBe("keep")
  })
})
