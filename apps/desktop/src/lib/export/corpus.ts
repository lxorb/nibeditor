/** One note with everything in it, for the tests of every converter.
 *
 *  Nine formats read the same note, and a construct that only appears in one
 *  test is a construct only one format is held to. So the corpus lives here and
 *  each writer's test asserts what its own format does with the whole of it. */

export const CORPUS = `---
title: Export corpus
author: Ada Lovelace
lang: en
date: 2026-09-08
---

# Export corpus

Prose with **bold**, *italic*, ~~struck~~, ==marked==, \`inline code\`, H~2~O,
x^2^, a [link](https://orden.so), a footnote[^one] and inline maths
$E = mc^2$ in one paragraph.

[^one]: The footnote's own words, with **bold** in them.

## A table

| Left | Middle | Right |
| :--- | :----: | ----: |
| one | alpha | 1 |
| two | beta | 22 |

## Code

\`\`\`ts
const answer: number = 42
  const indented = true
\`\`\`

## Display maths

$$
\\int_0^1 x^2\\,dx = \\frac{1}{3}
$$

## Pictures

![Pasted picture](assets/pic.png)

![Remote picture](https://orden.so/remote.jpg)

## Links and lists

A wikilink to [[Another note]] and one with an alias [[Another note|the other]].

- plain bullet
  - nested bullet
- [x] done
- [ ] open

1. first
2. second

> A blockquote, with **bold** inside it.

> [!NOTE]
> Careful with that.

> [!tldr]- The **short** of it
> A callout with an alias, a title and a fold sign on it.

Markdown
: A way of writing formatted text.
: Also the format itself.

---

<div style="page-break-after: always;"></div>

## Diagram

\`\`\`mermaid
graph TD; A-->B
\`\`\`
`

/** The name of the file the corpus stands for. */
export const CORPUS_NAME = 'Export corpus.md'
