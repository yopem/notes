import type { GpuixTheme, StyleDesc } from "@gpuix/react";

export interface Palette {
  appearance: "light" | "dark";
  background: string;
  foreground: string;
  sidebar: string;
  primary: string;
  primaryForeground: string;
  primaryHover: string;
  secondary: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  border: string;
  input: string;
  ring: string;
  destructive: string;
  selection: string;
}

// Yopem UI base registry, commit 9b8a61b. Alpha tokens stay translucent.
export const palettes: Record<"light" | "dark", Palette> = {
  light: {
    appearance: "light",
    background: "#ffffff",
    foreground: "#262626",
    sidebar: "#fafafa",
    primary: "#262626",
    primaryForeground: "#fafafa",
    primaryHover: "#262626e6",
    secondary: "#0000000a",
    muted: "#0000000a",
    mutedForeground: "#686868",
    accent: "#0000000a",
    border: "#00000014",
    input: "#0000001a",
    ring: "#a1a1a1",
    destructive: "#c10007",
    selection: "#00000020",
  },
  dark: {
    appearance: "dark",
    background: "#141414",
    foreground: "#f5f5f5",
    sidebar: "#111111",
    primary: "#f5f5f5",
    primaryForeground: "#262626",
    primaryHover: "#f5f5f5e6",
    secondary: "#ffffff0a",
    muted: "#ffffff0a",
    mutedForeground: "#b1b1b1",
    accent: "#ffffff0a",
    border: "#ffffff0f",
    input: "#ffffff14",
    ring: "#737373",
    destructive: "#ff6467",
    selection: "#ffffff26",
  },
};

export function inputStyle(color: Palette): StyleDesc {
  return {
    color: color.foreground,
    backgroundColor: color.background,
    fontFamily: "Inter",
    fontSize: 14,
    lineHeight: 20,
    height: 36,
    paddingLeft: 12,
    paddingRight: 12,
    borderWidth: 1,
    borderColor: color.input,
    borderRadius: 12,
    focusVisible: { outlineColor: color.ring, outlineWidth: 2, outlineOffset: 1 },
  };
}

export function nativeTheme(color: Palette): GpuixTheme {
  return {
    appearance: color.appearance,
    bg: color.background,
    text: color.foreground,
    border: color.border,
    textMuted: color.mutedForeground,
    textFaint: color.mutedForeground,
    textDim: color.mutedForeground,
    accent: color.foreground,
    caret: color.foreground,
    fontSans: "Inter",
    fontMono: "IBM Plex Mono",
    metrics: { mdHeadingSizes: [28, 24, 20, 18] },
  };
}
