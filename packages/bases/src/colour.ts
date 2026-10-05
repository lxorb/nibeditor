/** A view's conditional colour (`nib.colour`), Notion's: rules of a condition and a
 *  tone, the first that holds colouring the row.
 *
 *  The view keeps one expression answering a tone, so a reader who wants more than
 *  rules can write any expression there. The rules are written as nested `if`s,
 *  `if(status == "Done", "success", if(due < today(), "danger", null))`, and read back
 *  out of that shape; an expression of any other shape is kept and drawn as written.
 *  Pure. */

/** One rule: a condition (an expression) and the tone it colours a row with. */
export interface ColourRule {
  when: string
  tone: string
}

/** The rules as the expression a view keeps; none is no expression. */
export function colourExpression(rules: readonly ColourRule[]): string | undefined {
  if (!rules.length) return undefined
  return rules.reduceRight(
    (rest, rule) => `if(${rule.when}, ${JSON.stringify(rule.tone)}, ${rest})`,
    'null',
  )
}

/** The arguments of a call whose words start right after its `(`, split at the commas
 *  outside quotes and brackets; null where the brackets do not close. Answers the
 *  arguments and where the call ends. */
function argumentsOf(text: string, from: number): { args: string[]; end: number } | null {
  const args: string[] = []
  let depth = 0
  let start = from
  let quote: string | null = null
  for (let at = from; at < text.length; at++) {
    const one = text[at]
    if (quote) {
      if (one === '\\') at++
      else if (one === quote) quote = null
      continue
    }
    if (one === '"' || one === "'") quote = one
    else if (one === '(' || one === '[' || one === '{') depth++
    else if (one === ')' && depth === 0) {
      args.push(text.slice(start, at).trim())
      return { args, end: at + 1 }
    } else if (one === ')' || one === ']' || one === '}') depth--
    else if (one === ',' && depth === 0) {
      args.push(text.slice(start, at).trim())
      start = at + 1
    }
  }
  return null
}

/** The rules an expression was written from, or null where it is not that shape. */
export function colourRules(expression: string | undefined): ColourRule[] | null {
  if (expression === undefined) return []
  const rules: ColourRule[] = []
  let rest = expression.trim()
  while (rest !== 'null') {
    if (!rest.startsWith('if(')) return null
    const call = argumentsOf(rest, 3)
    if (call?.end !== rest.length || call.args.length !== 3) return null
    const [when = '', tone = '', next = ''] = call.args
    if (!/^"(?:[^"\\]|\\.)*"$/.test(tone)) return null
    rules.push({ when, tone: String(JSON.parse(tone)) })
    rest = next
  }
  return rules
}
