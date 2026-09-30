/** Stylesheets are imported for their side effect; Vite handles the rest. */
declare module '*.css'

/** The GFM plugin ships no types. It only adds rules to a Turndown instance. */
declare module 'turndown-plugin-gfm' {
  import type TurndownService from 'turndown'
  export const gfm: TurndownService.Plugin
  export const tables: TurndownService.Plugin
  export const strikethrough: TurndownService.Plugin
  export const taskListItems: TurndownService.Plugin
}

/** A file as its characters, which Vite hands over as they are on disk: the frame
 *  script, which every sandboxed frame carries inline. See web-frame.ts. */
declare module '*.js?raw' {
  const text: string
  export default text
}
