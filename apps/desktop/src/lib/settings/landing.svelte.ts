/** The one setting the settings were opened on from the palette, by what its row
 *  says, until the pane has scrolled to it and lit it. Its own rather than the settings
 *  store's, which is in front of the first paint: only the palette and the open sheet
 *  ever read it. See SettingsPanel.svelte. */
export const landing = $state<{ label: string | null }>({ label: null })
