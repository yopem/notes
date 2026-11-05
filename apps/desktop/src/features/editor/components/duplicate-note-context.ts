import { createContext } from "react"

export const DuplicateNoteContext = createContext<(() => void) | null>(null)
