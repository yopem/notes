import type { App } from "@gpuix/react/automation"

import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync, rmSync } from "node:fs"
import { z } from "zod"

const compositorVersionSchema = z.string().regex(/Hyprland \d+\.\d+\./)

const clientSchema = z.object({
  address: z.string().regex(/^0x[\da-f]+$/i),
  title: z.string(),
  pid: z.number().int().positive(),
  at: z.tuple([z.number().int(), z.number().int()]),
  size: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  mapped: z.boolean(),
  hidden: z.boolean(),
  stableId: z
    .string()
    .regex(/^[\da-f]+$/i)
    .optional(),
})

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 10000 })

  if (result.error || result.status !== 0) {
    throw new Error(
      `${command} failed: ${result.error?.message ?? (result.stderr.trim() || result.stdout.trim())}`,
    )
  }

  return result.stdout
}

function currentWindow(pid: number, requireActive = false) {
  const clients = z
    .array(clientSchema)
    .parse(JSON.parse(run("hyprctl", ["-j", "clients"])))

  const matches = clients.filter((client) => client.title === "Still Notes")

  assert.equal(
    matches.length,
    1,
    "Expected exactly one Still Notes window. Close other instances.",
  )

  const client = matches[0]

  assert(client)
  assert.equal(
    client.pid,
    pid,
    "Still Notes window does not belong to the test process.",
  )
  assert(client.mapped && !client.hidden, "Still Notes window must be visible.")

  if (!requireActive) return client

  const active = clientSchema.parse(
    JSON.parse(run("hyprctl", ["-j", "activewindow"])),
  )

  assert.equal(
    active.address,
    client.address,
    "Still Notes is not active. Select its window, then retry.",
  )
  assert.equal(
    active.pid,
    pid,
    "Active window does not belong to the test process.",
  )
  assert.equal(active.title, "Still Notes", "Active window title changed.")
  assert.deepEqual(
    active.at,
    client.at,
    "Window position changed during capture checks.",
  )
  assert.deepEqual(
    active.size,
    client.size,
    "Window size changed during capture checks.",
  )
  assert(
    active.mapped && !active.hidden,
    "Active Still Notes window must be visible.",
  )

  return client
}

export async function sizeTestWindow(
  app: App,
  pid: number,
  width: number,
  height: number,
) {
  if (process.platform === "linux") {
    const client = currentWindow(pid)
    const version = compositorVersionSchema.parse(run("hyprctl", ["version"]))
    const parts = version.match(/Hyprland (\d+)\.(\d+)\./)
    const luaDispatchers = Number(parts?.[1]) > 0 || Number(parts?.[2]) >= 57

    if (luaDispatchers) {
      run("hyprctl", [
        "dispatch",
        `hl.dsp.window.float({action="on",window="address:${client.address}"})`,
      ])
      run("hyprctl", [
        "dispatch",
        `hl.dsp.window.resize({x=${width},y=${height},relative=false,window="address:${client.address}"})`,
      ])
    } else {
      run("hyprctl", ["dispatch", "setfloating", `address:${client.address}`])
      run("hyprctl", [
        "dispatch",
        "resizewindowpixel",
        `exact ${width} ${height},address:${client.address}`,
      ])
    }
  }

  const deadline = Date.now() + 5000
  let bounds = await app.getByTestId("app").bounds()

  while (
    (bounds.width !== width || bounds.height !== height) &&
    Date.now() < deadline
  ) {
    await Bun.sleep(16)
    bounds = await app.getByTestId("app").bounds()
  }

  assert.equal(bounds.width, width, "Test window width")
  assert.equal(bounds.height, height, "Test window height")
}

export async function captureScreenshot(
  app: Pick<App, "screenshot">,
  pid: number,
  path: string,
) {
  rmSync(path, { force: true })

  try {
    if (process.platform === "linux") {
      const client = currentWindow(pid)

      if (client.stableId) {
        // Hyprland uses stableId as its foreign-toplevel identifier.
        run("grim", ["-T", client.stableId, path])
      } else {
        currentWindow(pid, true)
        const [x, y] = client.at
        const [width, height] = client.size
        run("grim", ["-g", `${x},${y} ${width}x${height}`, path])
      }
      assert.deepEqual(
        currentWindow(pid),
        client,
        "Window changed during compositor capture.",
      )
    } else {
      await app.screenshot({ path })
    }

    const image = readFileSync(path)

    assert(
      image.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")),
      "Screenshot is not PNG.",
    )
    assert(
      image.length >= 24 &&
        image.readUInt32BE(16) > 0 &&
        image.readUInt32BE(20) > 0,
      "Screenshot has no image dimensions.",
    )
  } catch (cause) {
    rmSync(path, { force: true })

    throw new Error(
      process.platform === "linux"
        ? "Native screenshot failed. Use Hyprland and grim with foreign-toplevel capture support. Keep only the test Still Notes window open and still. Older compositors need the test window active and visible. No focus change or full-desktop capture was attempted."
        : "Native screenshot failed. GPUix requires a test-support build on macOS or Windows.",
      { cause },
    )
  }
}
