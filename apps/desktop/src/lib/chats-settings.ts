/** Settings > General > Chats: what pings for every chat at once (docs/chats.md 4.11),
 *  apart from preferences.ts so the glasses' plugin, which has no chats, can stand a twin
 *  in its place (chats-settings.even.ts). */

import { EVERY_DAY, hush, WEEKDAYS, WORKING_HOURS } from './chats/hush.svelte'
import { i18n, t } from './i18n.svelte'
import type { Field, Group } from './preferences'

/** What pings for every chat at once (docs/chats.md 4.11): the reader's keywords, the
 *  hours pings are let through, and whether a notification shows the words and makes a
 *  sound. A chat's own level and mute are the bell in its head (chats/Bell.svelte), and
 *  Do not disturb is the reader's status. On the account; see chats/hush.svelte.ts. */
export function chatsGroups(): Group[] {
  const days = hush.hours?.days.join() ?? ''
  const hoursOf = (value: string) =>
    value === 'weekdays' ? WEEKDAYS : value === 'every' ? EVERY_DAY : null
  const hourOptions = Array.from({ length: 24 }, (_, hour) => ({
    value: String(hour * 60),
    label: i18n.when(new Date(2000, 0, 1, hour).getTime(), { timeStyle: 'short' }),
  }))
  const hours = hush.hours

  return [
    {
      title: t('Chats'),
      fields: [
        {
          kind: 'text',
          label: t('My keywords'),
          words: ['chat', 'notification', 'mention', 'highlight', 'alert'],
          placeholder: t('None'),
          initial: '',
          get: () => hush.keywords.join(', '),
          set: (line) => hush.setKeywords(line),
        },
        {
          kind: 'select',
          label: t('Hours'),
          words: ['chat', 'notification', 'schedule', 'quiet', 'do not disturb', 'night'],
          options: [
            { value: 'always', label: t('Always') },
            { value: 'every', label: t('Every day') },
            { value: 'weekdays', label: t('Weekdays') },
          ],
          initial: 'always',
          get: () =>
            days === WEEKDAYS.join() ? 'weekdays' : days === EVERY_DAY.join() ? 'every' : 'always',
          set: (value) => {
            const chosen = hoursOf(value)
            hush.setHours(chosen ? { ...(hush.hours ?? WORKING_HOURS), days: chosen } : null)
          },
        },
        ...(hours
          ? ([
              {
                kind: 'select',
                label: t('Starts'),
                options: hourOptions,
                get: () => String(hours.from),
                set: (value) => hush.setHours({ ...hours, from: Number(value) }),
              },
              {
                kind: 'select',
                label: t('Ends'),
                options: hourOptions,
                get: () => String(hours.to),
                set: (value) => hush.setHours({ ...hours, to: Number(value) }),
              },
            ] satisfies Field[])
          : []),
        {
          kind: 'switch',
          label: t('Previews'),
          words: ['chat', 'notification', 'privacy', 'hide', 'message'],
          initial: true,
          get: () => hush.previews,
          set: (on) => hush.setPreviews(on),
        },
        {
          kind: 'switch',
          label: t('Sound'),
          words: ['chat', 'notification', 'audio', 'ping'],
          initial: false,
          get: () => hush.sound,
          set: (on) => hush.setSound(on),
        },
      ],
    },
  ]
}
