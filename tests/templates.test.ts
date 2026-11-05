import { afterEach, describe, expect, test } from "bun:test"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  builtinTemplates,
  createFromTemplate,
  insertTemplate,
  type NoteTemplate,
  renderTemplate,
  TemplateLibrary,
} from "@/services/templates"

// Enumerate before implementation: built-ins and overrides, hidden/reset state,
// nested configured folders, sidecar files, duplicate names/slugs, Unicode,
// metadata vs note frontmatter, unknown/live variables, cursor offsets,
// date locales/timezones, insertion ranges, target traversal, corrupt state,
// stale writes, real-file restart, file/directory/root symlinks and path escape.
const roots: string[] = []

function root() {
  const value = mkdtempSync(join(tmpdir(), "still-template-"))
  roots.push(value)

  return value
}

function template(body = "# {{title}}\n{{cursor}}"): NoteTemplate {
  return {
    id: "custom:test",
    name: "Test",
    description: "",
    category: "Custom",
    body,
    source: "custom",
  }
}

afterEach(() => {
  for (const value of roots.splice(0))
    rmSync(value, { recursive: true, force: true })
})

describe("template content APIs", () => {
  test("built-ins cover technical and personal note workflows", () => {
    const builtins = builtinTemplates()

    for (const id of [
      "adr",
      "rfc",
      "bug",
      "postmortem",
      "meeting",
      "oneonone",
      "daily",
      "weekly",
      "monthly",
      "journal",
      "kickoff",
      "reading",
      "todo",
    ])
      expect(builtins.some((item) => item.id === `builtin:${id}`)).toBe(true)
    expect(new Set(builtins.map((item) => item.id)).size).toBe(builtins.length)
    expect(builtinTemplates()).not.toBe(builtins)
  })

  test("variables, locale dates, unknown/live tokens, CRLF and Unicode cursors", () => {
    const value = renderTemplate(
      "É {{title}}\r\n{{ date:dddd D MMMM YYYY }} {{time}} W{{week}} {{cursor}}x{{cursor}}{{unknown}} {{modified_date}} {{owner}}",
      {
        title: "日本語",
        now: new Date(2024, 1, 29, 23, 7),
        locale: "fr",
        variables: { owner: "Mia" },
      },
    )

    expect(value.body).toBe(
      "É 日本語\r\njeudi 29 février 2024 23:07 W09 x{{unknown}} {{modified_date}} Mia",
    )
    expect(value.cursorOffset).toBe(value.body.indexOf("x{{unknown}}"))
    expect(
      renderTemplate("{{title}}", { title: "{{cursor}}", now: new Date() })
        .body,
    ).toBe("{{cursor}}")
  })

  test("insert replaces exact range; create renders title before body and validates target", () => {
    const context = { title: "Fallback", now: new Date(2024, 1, 29, 9) }

    const value = insertTemplate(
      "before SELECT after",
      { from: 7, to: 13 },
      template("{{cursor}}new"),
      context,
    )

    expect(value).toEqual({ body: "before new after", cursorOffset: 7 })
    expect(() =>
      insertTemplate("abc", { from: 3, to: 2 }, template(), context),
    ).toThrow()

    const created = createFromTemplate(
      {
        ...template(),
        titleTemplate: "Meeting {{date}}",
        targetDirectory: "Work",
      },
      context,
    )

    expect(created).toMatchObject({
      path: "Work/Meeting 2024-02-29.md",
      title: "Meeting 2024-02-29",
      body: "# Meeting 2024-02-29\n",
    })
    expect(() =>
      createFromTemplate({ ...template(), targetDirectory: "../bad" }, context),
    ).toThrow()
    expect(() =>
      createFromTemplate(
        { ...template(), titleTemplate: "../escape" },
        context,
      ),
    ).toThrow()
  })
})

describe("real template library", () => {
  test("loads configured nested notes without stripping note frontmatter", () => {
    const directory = root()
    mkdirSync(join(directory, "Templates", "Work"), { recursive: true })
    writeFileSync(
      join(directory, "Templates", "Work", "日本語.md"),
      "---\ntags: [project]\ncreated: '{{date}}'\n---\n# {{title}}",
    )
    writeFileSync(
      join(directory, "Templates", "Header.md"),
      "---\nname: Standup\ndescription: Team check\ntitleTemplate: 'Standup {{date}}'\n---\nBody",
    )

    const library = new TemplateLibrary(directory, {
      templateFolder: "Templates",
    })

    const items = library.list()
    expect(
      items.find((item) => item.id === "folder:Work/日本語")?.body,
    ).toContain("tags: [project]")
    expect(items.find((item) => item.id === "folder:Header")).toMatchObject({
      name: "Standup",
      body: "Body",
    })
    expect(library.isTemplatePath("Templates/Work/日本語.md")).toBe(true)
    expect(library.isTemplatePath("Templates Old/a.md")).toBe(false)
  })

  test("save-as-template collisions, Unicode metadata, restart and stale write protection", () => {
    const directory = root()
    const library = new TemplateLibrary(directory)

    const input = {
      name: 'Équipe: "A"',
      description: "two\nlines",
      body: "\r\n{{title}}\r\n",
      category: "Custom" as const,
    }

    const one = library.save(input)
    const two = library.save(input)
    expect(one.sourcePath).not.toBe(two.sourcePath)
    expect(
      new TemplateLibrary(directory).list().find((item) => item.id === one.id),
    ).toMatchObject(input)

    if (!one.sourcePath || one.raw === undefined)
      throw new Error("Missing saved source")
    writeFileSync(join(directory, one.sourcePath), "external")
    expect(() =>
      library.save(
        { ...input, name: "Changed" },
        { sourcePath: one.sourcePath ?? "", expectedRaw: one.raw ?? "" },
      ),
    ).toThrow("changed")
    expect(readFileSync(join(directory, one.sourcePath), "utf8")).toBe(
      "external",
    )
  })

  test("built-in overrides, hide/restore and reset survive restart", () => {
    const directory = root()
    const library = new TemplateLibrary(directory)
    const original = library.find("builtin:daily")

    if (!original) throw new Error("Missing daily template")

    const saved = library.save({
      ...original,
      body: "custom daily",
      builtinId: original.id,
    })

    expect(library.find(original.id)?.body).toBe("custom daily")
    library.setHidden(original.id, true)
    expect(
      new TemplateLibrary(directory)
        .list()
        .some((item) => item.id === saved.id),
    ).toBe(false)
    library.setHidden(original.id, false)
    library.resetBuiltin(original.id)
    expect(library.find(original.id)?.body).toBe(original.body)
  })

  test("fails closed for traversal, symlinks, corrupt preferences and external state edits", () => {
    const directory = root()
    const outside = root()
    writeFileSync(join(outside, "secret.md"), "secret")
    mkdirSync(join(directory, "Templates"))
    symlinkSync(
      join(outside, "secret.md"),
      join(directory, "Templates", "linked.md"),
    )
    expect(() =>
      new TemplateLibrary(directory, { templateFolder: "Templates" }).list(),
    ).toThrow()
    expect(
      () => new TemplateLibrary(directory, { templateFolder: "../outside" }),
    ).toThrow()
    const linked = join(root(), "alias")
    symlinkSync(outside, linked)
    expect(() => new TemplateLibrary(linked).list()).toThrow()
    const library = new TemplateLibrary(root())
    expect(() =>
      library.save({ name: "Bad", body: "x", targetDirectory: "../bad" }),
    ).toThrow()
    mkdirSync(join(directory, ".still-notes"), { recursive: true })
    writeFileSync(join(directory, ".still-notes", "templates.json"), "broken")
    expect(() => new TemplateLibrary(directory).list()).toThrow()
    expect(
      readFileSync(join(directory, ".still-notes", "templates.json"), "utf8"),
    ).toBe("broken")
  })
})
