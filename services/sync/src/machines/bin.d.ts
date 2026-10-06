/** A `.bin` file imported by the Worker: its bytes, as wrangler's default Data rule hands
 *  them over (the machine's bundle; see bundle.ts). */
declare module '*.bin' {
  const bytes: ArrayBuffer
  export default bytes
}
