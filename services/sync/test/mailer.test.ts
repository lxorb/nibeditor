/** Which way a message leaves, and what a refusal turns into.
 *
 *  The sign-in mail reached its owner and nobody else for as long as the sending
 *  domain was not onboarded: the binding then behaves as Email Routing's, and
 *  Cloudflare refuses every address that is not one of the account's own. What
 *  the service can do about that is send in the shape Email Sending takes, and
 *  write down the provider's code when it is refused. See src/email.ts. */

import { afterEach, describe, expect, test, vi } from 'vitest'
import { mailer, sender } from '../src/email'
import type { EmailSender, Env } from '../src/types'

afterEach(() => {
  vi.restoreAllMocks()
})

const MESSAGE = { text: 'Your sign-in code is 123 456.', html: '<p>123 456</p>' }

/** Only the two fields `mailer` reads; nothing else in the environment matters
 *  to which way a message goes. */
function environment(parts: Pick<Env, 'EMAIL' | 'MAIL_FROM'>): Env {
  return parts as Env
}

/** A binding that keeps what it was handed, and answers the way `answer` says. */
function binding(answer: () => Promise<{ messageId?: string }>) {
  const handed: Parameters<EmailSender['send']>[0][] = []
  const email: EmailSender = {
    send(message) {
      handed.push(message)
      return answer()
    },
  }
  return { email, handed }
}

/** Every line written to the error log while `work` ran. */
async function logged(work: () => Promise<unknown>): Promise<string[]> {
  const lines: string[] = []
  vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
    lines.push(String(line))
  })
  await work()
  return lines
}

describe('which way a message goes', () => {
  test('to the log, without a binding', async () => {
    const lines: string[] = []
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      lines.push(String(line))
    })

    const sent = await mailer(environment({ MAIL_FROM: 'Nib <nib@nibeditor.com>' })).send(
      'a@b.dev',
      'code',
      MESSAGE,
    )

    expect(sent).toBe(true)
    expect(lines.join('\n')).toContain('123 456')
  })

  test('to the log, with a binding and nobody to send it as', async () => {
    const { email, handed } = binding(() => Promise.resolve({ messageId: 'm' }))
    vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await mailer(environment({ EMAIL: email })).send('a@b.dev', 'code', MESSAGE)

    expect(handed).toHaveLength(0)
  })

  test('through the binding, as a name and an address apart', async () => {
    const { email, handed } = binding(() => Promise.resolve({ messageId: 'm' }))

    const sent = await mailer(
      environment({ EMAIL: email, MAIL_FROM: 'Nib <nib@nibeditor.com>' }),
    ).send('someone@example.org', 'code', MESSAGE)

    expect(sent).toBe(true)
    expect(handed).toEqual([
      {
        from: { name: 'Nib', email: 'nib@nibeditor.com' },
        to: 'someone@example.org',
        subject: 'code',
        text: MESSAGE.text,
        html: MESSAGE.html,
      },
    ])
  })
})

describe('a refusal', () => {
  /** What Email Routing answers for any address that is not the account's own:
   *  the live failure, word for word. */
  test('is a no, with the provider’s words in the log', async () => {
    const { email } = binding(() =>
      Promise.reject(new Error('destination address is not a verified address')),
    )

    let sent = true
    const lines = await logged(async () => {
      sent = await mailer(environment({ EMAIL: email, MAIL_FROM: 'nib@nibeditor.com' })).send(
        'someone@example.org',
        'code',
        MESSAGE,
      )
    })

    expect(sent).toBe(false)
    expect(lines).toHaveLength(1)
    const line = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>
    expect(line.failed).toBe('mail')
    expect(line.said).toBe('destination address is not a verified address')
  })

  /** Email Sending's errors carry a code, which is what can be counted. */
  test('keeps the code Email Sending gives it', async () => {
    const { email } = binding(() =>
      Promise.reject(
        Object.assign(new Error('Sender domain not verified'), { code: 'E_SENDER_NOT_VERIFIED' }),
      ),
    )

    let sent = true
    const lines = await logged(async () => {
      sent = await mailer(environment({ EMAIL: email, MAIL_FROM: 'nib@nibeditor.com' })).send(
        'someone@example.org',
        'code',
        MESSAGE,
      )
    })

    expect(sent).toBe(false)
    const line = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>
    expect(line.code).toBe('E_SENDER_NOT_VERIFIED')
  })
})

describe('the sender line', () => {
  test('parts a name from its address', () => {
    expect(sender('Nib <nib@nibeditor.com>')).toEqual({ name: 'Nib', email: 'nib@nibeditor.com' })
    expect(sender('"Nib Editor" <nib@nibeditor.com>')).toEqual({
      name: 'Nib Editor',
      email: 'nib@nibeditor.com',
    })
  })

  test('leaves a bare address a string', () => {
    expect(sender('nib@nibeditor.com')).toBe('nib@nibeditor.com')
    expect(sender('<nib@nibeditor.com>')).toBe('nib@nibeditor.com')
  })
})
