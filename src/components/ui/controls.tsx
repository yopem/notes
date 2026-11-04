import type { ReactNode } from "react"

import { Button as NativeButton } from "@gpuix/react/button"

import type { Palette } from "@/theme"

import { Icon, type IconName } from "@/components/ui/icons"

export function Label({
  children,
  color,
  size = 14,
  weight = 400,
  muted = false,
}: {
  children: ReactNode
  color: Palette
  size?: number
  weight?: number
  muted?: boolean
}) {
  return (
    <text
      style={{
        color: muted ? color.mutedForeground : color.foreground,
        fontFamily: "Inter",
        fontSize: size,
        fontWeight: weight,
        lineHeight: size * 1.5,
      }}
    >
      {children}
    </text>
  )
}

export function Button({
  children,
  color,
  icon,
  onClick,
  testId,
  label,
  variant = "ghost",
  disabled = false,
}: {
  children?: ReactNode
  color: Palette
  icon?: IconName
  onClick: () => void
  testId?: string
  label?: string
  variant?: "ghost" | "primary" | "outline" | "danger"
  disabled?: boolean
}) {
  const ink =
    variant === "primary"
      ? color.primaryForeground
      : variant === "danger"
        ? color.destructive
        : color.foreground

  return (
    <NativeButton
      testId={testId}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        minHeight: 36,
        minWidth: 36,
        paddingLeft: children ? 12 : 8,
        paddingRight: children ? 12 : 8,
        borderRadius: 12,
        borderWidth: variant === "outline" ? 1 : 0,
        borderColor: color.border,
        backgroundColor: variant === "primary" ? color.primary : "transparent",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        flexShrink: 0,
        hover: {
          backgroundColor:
            variant === "primary" ? color.primaryHover : color.accent,
        },
        active: {
          backgroundColor:
            variant === "primary" ? color.primary : color.secondary,
        },
        focusVisible: {
          outlineWidth: 2,
          outlineColor: color.ring,
          outlineOffset: 2,
        },
      }}
    >
      {icon && <Icon name={icon} color={ink} size={16} />}
      {children && (
        <text
          style={{
            color: ink,
            fontFamily: "Inter",
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          {children}
        </text>
      )}
    </NativeButton>
  )
}

export function NavItem({
  children,
  color,
  icon,
  selected,
  onClick,
  testId,
  count,
}: {
  children: string
  color: Palette
  icon: IconName
  selected: boolean
  onClick: () => void
  testId?: string
  count?: number
}) {
  return (
    <NativeButton
      testId={testId}
      aria-label={children}
      aria-selected={selected}
      onClick={onClick}
      style={{
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
      }}
    >
      <Icon
        name={icon}
        color={selected ? color.foreground : color.mutedForeground}
        size={17}
      />
      <div style={{ flexGrow: 1, minWidth: 0 }}>
        <text
          style={{
            color: color.foreground,
            fontFamily: "Inter",
            fontSize: 13,
            fontWeight: selected ? 500 : 400,
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
          }}
        >
          {children}
        </text>
      </div>
      {count !== undefined && (
        <Label color={color} size={12} muted>
          {count}
        </Label>
      )}
    </NativeButton>
  )
}
