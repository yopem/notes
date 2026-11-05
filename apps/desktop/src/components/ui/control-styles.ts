import type { StyleDesc } from "@gpuix/react"

import type { Palette } from "@/components/ui/theme"

export const navContentStyle = { flexGrow: 1, minWidth: 0 } satisfies StyleDesc

const styles = new Map<string, StyleDesc>()

function rememberStyle(key: string, style: StyleDesc) {
  // Bound retained styles because controls accept arbitrary colors and sizes.
  if (styles.size >= 128) styles.clear()
  styles.set(key, style)

  return style
}

export function getIconStyle({ color, size }: { color: string; size: number }) {
  const key = `icon:${size}:${color}`
  const cached = styles.get(key)

  if (cached) return cached

  return rememberStyle(key, { width: size, height: size, color, flexShrink: 0 })
}

export function getLabelStyle({
  color,
  size,
  weight,
}: {
  color: string
  size: number
  weight: number
}) {
  const key = `label:${size}:${weight}:${color}`
  const cached = styles.get(key)

  if (cached) return cached

  return rememberStyle(key, {
    color,
    fontFamily: "Inter",
    fontSize: size,
    fontWeight: weight,
    lineHeight: size * 1.5,
  })
}

export function getButtonStyle({
  color,
  variant,
  hasChildren,
  disabled,
}: {
  color: Palette
  variant: "ghost" | "primary" | "outline" | "danger"
  hasChildren: boolean
  disabled: boolean
}) {
  const backgroundColor = variant === "primary" ? color.primary : "transparent"
  const hoverColor = variant === "primary" ? color.primaryHover : color.accent
  const activeColor = variant === "primary" ? color.primary : color.secondary

  const key = JSON.stringify([
    "button",
    variant,
    hasChildren,
    disabled,
    color.border,
    backgroundColor,
    hoverColor,
    activeColor,
    color.ring,
  ])

  const cached = styles.get(key)

  if (cached) return cached

  return rememberStyle(key, {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 36,
    minWidth: 36,
    paddingLeft: hasChildren ? 12 : 8,
    paddingRight: hasChildren ? 12 : 8,
    borderRadius: 12,
    borderWidth: variant === "outline" ? 1 : 0,
    borderColor: color.border,
    backgroundColor,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.64 : 1,
    flexShrink: 0,
    hover: { backgroundColor: hoverColor },
    active: { backgroundColor: activeColor },
    focusVisible: {
      outlineWidth: 2,
      outlineColor: color.ring,
      outlineOffset: 2,
    },
  })
}

export function getButtonTextStyle(color: string) {
  const key = `button-text:${color}`
  const cached = styles.get(key)

  if (cached) return cached

  return rememberStyle(key, {
    color,
    fontFamily: "Inter",
    fontSize: 13,
    fontWeight: 500,
  })
}

export function getNavStyle({
  color,
  selected,
}: {
  color: Palette
  selected: boolean
}) {
  const key = JSON.stringify(["nav", selected, color.accent, color.ring])
  const cached = styles.get(key)

  if (cached) return cached

  return rememberStyle(key, {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 38,
    paddingLeft: 12,
    paddingRight: 12,
    borderRadius: 12,
    backgroundColor: selected ? color.accent : "transparent",
    cursor: "pointer",
    hover: { backgroundColor: color.accent },
    focusVisible: {
      outlineWidth: 2,
      outlineColor: color.ring,
      outlineOffset: -2,
    },
  })
}

export function getNavTextStyle({
  color,
  selected,
}: {
  color: string
  selected: boolean
}) {
  const key = `nav-text:${selected}:${color}`
  const cached = styles.get(key)

  if (cached) return cached

  return rememberStyle(key, {
    color,
    fontFamily: "Inter",
    fontSize: 13,
    fontWeight: selected ? 500 : 400,
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  })
}
