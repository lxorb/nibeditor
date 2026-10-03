/** What went wrong in a base: an expression that does not parse, a function that
 *  does not exist, a value a method cannot take. `at` is the offset into the
 *  expression where it went wrong, when there is one, so the formula field can
 *  put its mark there. */
export class BasesError extends Error {
  constructor(
    message: string,
    readonly at?: number,
  ) {
    super(message)
    this.name = 'BasesError'
  }
}
