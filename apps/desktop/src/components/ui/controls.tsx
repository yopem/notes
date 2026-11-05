import type { ReactNode } from "react"

import { Button as NativeButton } from "@gpuix/react/button"

import type { Palette } from "@/components/ui/theme"

import {
  getButtonStyle,
  getButtonTextStyle,
  getLabelStyle,
  getNavStyle,
  getNavTextStyle,
  navContentStyle,
} from "@/components/ui/control-styles"
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
      style={getLabelStyle({
        color: muted ? color.mutedForeground : color.foreground,
        size,
        weight,
      })}
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
  const ink = {
    primary: color.primaryForeground,
    danger: color.destructive,
    ghost: color.foreground,
    outline: color.foreground,
  }[variant]

  return (
    <NativeButton
      testId={testId}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      style={getButtonStyle({
        color,
        variant,
        hasChildren: Boolean(children),
        disabled,
      })}
    >
      {icon && <Icon name={icon} color={ink} size={16} />}
      {children && <text style={getButtonTextStyle(ink)}>{children}</text>}
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
      style={getNavStyle({ color, selected })}
    >
      <Icon
        name={icon}
        color={selected ? color.foreground : color.mutedForeground}
        size={17}
      />
      <div style={navContentStyle}>
        <text style={getNavTextStyle({ color: color.foreground, selected })}>
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
