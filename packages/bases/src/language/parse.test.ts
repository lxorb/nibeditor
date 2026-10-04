import { describe, expect, test } from 'vitest'
import { parseQuickAdd, type QuickAdd } from './parse'

/** Wednesday 7 October 2026, ten in the morning, on the reader's wall clock. */
const NOW = new Date(2026, 9, 7, 10, 0)

const en = (text: string, options = {}) => parseQuickAdd(text, ['en'], NOW, options)
const de = (text: string) => parseQuickAdd(text, ['de'], NOW)
const us = (text: string) => parseQuickAdd(text, ['en-US'], NOW)

/** What a line said: its words and the fields set, nothing empty. */
function said(add: QuickAdd) {
  const fields: Record<string, unknown> = { ...add.fields }
  if (add.fields.tags.length === 0) delete fields.tags
  if (add.fields.remind.length === 0) delete fields.remind
  const out: Record<string, unknown> = { text: add.text, ...fields }
  if (add.note !== undefined) out.note = add.note
  if (add.heading !== undefined) out.heading = add.heading
  return out
}

describe('days, a row of the table each', () => {
  test.each([
    ['Pay rent today', '2026-10-07'],
    ['Pay rent tod', '2026-10-07'],
    ['Pay rent tomorrow', '2026-10-08'],
    ['Pay rent tmr', '2026-10-08'],
    ['Pay rent mon', '2026-10-12'],
    ['Pay rent monday', '2026-10-12'],
    ['Pay rent sunday', '2026-10-11'],
    ['Pay rent wednesday', '2026-10-07'],
    ['Pay rent next fri', '2026-10-09'],
    ['Pay rent next wed', '2026-10-14'],
    ['Pay rent this friday', '2026-10-09'],
    ['Pay rent in 3 days', '2026-10-10'],
    ['Pay rent in a week', '2026-10-14'],
    ['Pay rent in 2 months', '2026-12-07'],
    ['Pay rent next week', '2026-10-12'],
    ['Pay rent next month', '2026-11-01'],
    ['Pay rent end of month', '2026-10-31'],
    ['Pay rent eom', '2026-10-31'],
    ['Pay rent this weekend', '2026-10-10'],
    ['Pay rent oct 9', '2026-10-09'],
    ['Pay rent october 9th', '2026-10-09'],
    ['Pay rent 9 oct', '2026-10-09'],
    ['Pay rent 9th of october', '2026-10-09'],
    ['Pay rent oct 6', '2027-10-06'],
    ['Pay rent oct 6 2026', '2026-10-06'],
    ['Pay rent 6/10', '2027-10-06'],
    ['Pay rent 9/10/2026', '2026-10-09'],
    ['Pay rent 2026-10-06', '2026-10-06'],
    ['Pay rent day after tomorrow', '2026-10-09'],
    ['Pay rent on fri', '2026-10-09'],
    ['Pay rent by friday', '2026-10-09'],
  ])('%s', (text, due) => {
    expect(said(en(text))).toEqual({ text: 'Pay rent', due })
  })

  test.each([
    ['Miete zahlen heute', '2026-10-07'],
    ['Miete zahlen morgen', '2026-10-08'],
    ['Miete zahlen übermorgen', '2026-10-09'],
    ['Miete zahlen am Mo', '2026-10-12'],
    ['Miete zahlen Montag', '2026-10-12'],
    ['Miete zahlen Sonntag', '2026-10-11'],
    ['Miete zahlen nächsten Fr', '2026-10-09'],
    ['Miete zahlen nächsten Freitag', '2026-10-09'],
    ['Miete zahlen in 3 Tagen', '2026-10-10'],
    ['Miete zahlen in einer Woche', '2026-10-14'],
    ['Miete zahlen nächste Woche', '2026-10-12'],
    ['Miete zahlen nächsten Monat', '2026-11-01'],
    ['Miete zahlen Monatsende', '2026-10-31'],
    ['Miete zahlen Ende des Monats', '2026-10-31'],
    ['Miete zahlen am Wochenende', '2026-10-10'],
    ['Miete zahlen 9. Okt', '2026-10-09'],
    ['Miete zahlen 9. Oktober', '2026-10-09'],
    ['Miete zahlen am 9. Oktober 2027', '2027-10-09'],
    ['Miete zahlen 6.10.', '2027-10-06'],
    ['Miete zahlen 9.10.2026', '2026-10-09'],
    ['Miete zahlen bis Freitag', '2026-10-09'],
  ])('%s', (text, due) => {
    expect(said(de(text))).toEqual({ text: 'Miete zahlen', due })
  })
})

describe('times', () => {
  test.each([
    ['Call bank 16:00', '2026-10-07', '16:00'],
    ['Call bank 4pm', '2026-10-07', '16:00'],
    ['Call bank 4 pm', '2026-10-07', '16:00'],
    ['Call bank 4:30pm', '2026-10-07', '16:30'],
    ['Call bank at 4', '2026-10-07', '16:00'],
    ['Call bank at 11', '2026-10-07', '11:00'],
    ['Call bank noon', '2026-10-07', '12:00'],
    ['Call bank tonight', '2026-10-07', '19:00'],
    ['Call bank tonight at 8', '2026-10-07', '20:00'],
    ['Call bank tomorrow 4pm', '2026-10-08', '16:00'],
    ['Call bank tomorrow at 4pm', '2026-10-08', '16:00'],
    ['Call bank 4pm tomorrow', '2026-10-08', '16:00'],
    ['Call bank fri at noon', '2026-10-09', '12:00'],
    ['Call bank in 2 hours', '2026-10-07', '12:00'],
    ['Call bank in 30 min', '2026-10-07', '10:30'],
    // Nine has gone by today, so it is tomorrow's nine.
    ['Call bank 9am', '2026-10-08', '09:00'],
  ])('%s', (text, due, time) => {
    expect(said(en(text))).toEqual({ text: 'Call bank', due, time })
  })

  test.each([
    ['Bank anrufen 16:00', '2026-10-07', '16:00'],
    ['Bank anrufen 16 Uhr', '2026-10-07', '16:00'],
    ['Bank anrufen 16.30 Uhr', '2026-10-07', '16:30'],
    ['Bank anrufen um 4', '2026-10-07', '16:00'],
    ['Bank anrufen um 11', '2026-10-07', '11:00'],
    ['Bank anrufen mittags', '2026-10-07', '12:00'],
    ['Bank anrufen heute Abend', '2026-10-07', '19:00'],
    ['Bank anrufen morgen früh', '2026-10-08', '09:00'],
    ['Bank anrufen morgen um 9', '2026-10-08', '09:00'],
    ['Bank anrufen Freitag 14 Uhr', '2026-10-09', '14:00'],
  ])('%s', (text, due, time) => {
    expect(said(de(text))).toEqual({ text: 'Bank anrufen', due, time })
  })
})

describe('repeating', () => {
  test.each([
    ['Water plants every day', 'every day', '2026-10-07'],
    ['Water plants daily', 'every day', '2026-10-07'],
    ['Water plants every weekday', 'every weekday', '2026-10-07'],
    ['Water plants every workday', 'every weekday', '2026-10-07'],
    ['Water plants every other week', 'every 2 weeks', '2026-10-07'],
    ['Water plants every 2nd monday', 'every month on the 2nd Monday', '2026-10-12'],
    ['Water plants every last friday', 'every month on the last Friday', '2026-10-30'],
    ['Water plants every 3 months', 'every 3 months', '2026-10-07'],
    ['Water plants every sunday', 'every week on Sunday', '2026-10-11'],
    ['Water plants every mon, fri', 'every week on Monday, Friday', '2026-10-09'],
    ['Water plants every! 3 days', 'every 3 days when done', '2026-10-07'],
    ['Water plants each week', 'every week', '2026-10-07'],
    ['Water plants every day until dec 24', 'every day until December 24, 2026', '2026-10-07'],
    ['Water plants every monday starting oct 19', 'every week on Monday', '2026-10-19'],
  ])('%s', (text, recurrence, due) => {
    expect(said(en(text))).toEqual({ text: 'Water plants', recurrence, due })
  })

  test.each([
    ['Blumen gießen jeden Tag', 'every day', '2026-10-07'],
    ['Blumen gießen täglich', 'every day', '2026-10-07'],
    ['Blumen gießen werktags', 'every weekday', '2026-10-07'],
    ['Blumen gießen jeden Werktag', 'every weekday', '2026-10-07'],
    ['Blumen gießen jede zweite Woche', 'every 2 weeks', '2026-10-07'],
    ['Blumen gießen jeden 2. Montag', 'every month on the 2nd Monday', '2026-10-12'],
    ['Blumen gießen jeden letzten Freitag', 'every month on the last Friday', '2026-10-30'],
    ['Blumen gießen alle 3 Monate', 'every 3 months', '2026-10-07'],
    ['Blumen gießen jeden Sonntag', 'every week on Sunday', '2026-10-11'],
    ['Blumen gießen montags', 'every week on Monday', '2026-10-12'],
    ['Blumen gießen jeden Mo und Fr', 'every week on Monday, Friday', '2026-10-09'],
    ['Blumen gießen jeden 15.', 'every month on the 15th', '2026-10-15'],
    ['Blumen gießen jeden! Tag', 'every day when done', '2026-10-07'],
    ['Blumen gießen jeden Tag bis 24.12.', 'every day until December 24, 2026', '2026-10-07'],
    ['Blumen gießen jeden Montag ab 19.10.', 'every week on Monday', '2026-10-19'],
  ])('%s', (text, recurrence, due) => {
    expect(said(de(text))).toEqual({ text: 'Blumen gießen', recurrence, due })
  })

  test('a time beside a rule is its time, and the day the rule gives', () => {
    expect(said(en('Gym every monday 6pm'))).toEqual({
      text: 'Gym',
      recurrence: 'every week on Monday',
      due: '2026-10-12',
      time: '18:00',
    })
  })

  test('a day said beside a rule is its first', () => {
    expect(said(en('Gym every week fri'))).toEqual({
      text: 'Gym',
      recurrence: 'every week',
      due: '2026-10-09',
    })
  })
})

describe('the marks', () => {
  test.each([
    ['p1', 1],
    ['p2', 2],
    ['p3', 3],
    ['p4', 4],
    ['P1', 1],
    ['!!!', 1],
  ])('priority %s', (mark, priority) => {
    expect(said(en(`Fix the sink ${mark}`))).toEqual({ text: 'Fix the sink', priority })
    expect(said(de(`Spüle reparieren ${mark}`))).toEqual({ text: 'Spüle reparieren', priority })
  })

  test.each([
    ['>Errands', 'Errands', undefined],
    ['>Work/Thesis', 'Work/Thesis', undefined],
    ['>Errands /Phone', 'Errands', 'Phone'],
    ['>"Moving flat"', 'Moving flat', undefined],
  ])('where %s', (mark, note, heading) => {
    const out: Record<string, unknown> = { text: 'Call bank', note }
    if (heading) out.heading = heading
    expect(said(en(`Call bank ${mark}`))).toEqual(out)
    expect(said(de(`Call bank ${mark}`))).toEqual(out)
  })

  test("a name with spaces is the space's own note", () => {
    expect(said(en('Call bank >Moving flat soon', { notes: ['Moving flat'] }))).toEqual({
      text: 'Call bank soon',
      note: 'Moving flat',
    })
  })

  test.each(['#family', '@family', '%family'])('tag %s', (mark) => {
    expect(said(en(`Call mum ${mark}`))).toEqual({ text: 'Call mum', tags: ['family'] })
    expect(said(de(`Mama anrufen ${mark}`))).toEqual({ text: 'Mama anrufen', tags: ['family'] })
  })

  test('assignee', () => {
    expect(said(en('Review PR +Lucile'))).toEqual({ text: 'Review PR', assignee: 'Lucile' })
    expect(said(de('PR prüfen +Lucile'))).toEqual({ text: 'PR prüfen', assignee: 'Lucile' })
  })

  test.each([
    ['!30m', { before: 30 }],
    ['!1h', { before: 60 }],
    ['!9am', { time: '09:00' }],
    ['!9:00', { time: '09:00' }],
    ['!tomorrow 9am', { at: '2026-10-08', time: '09:00' }],
  ])('reminder %s', (mark, remind) => {
    expect(said(en(`Call bank ${mark}`))).toEqual({ text: 'Call bank', remind: [remind] })
  })

  test.each([
    ['!30m', { before: 30 }],
    ['!9 Uhr', { time: '09:00' }],
    ['!morgen 9 Uhr', { at: '2026-10-08', time: '09:00' }],
  ])('Erinnerung %s', (mark, remind) => {
    expect(said(de(`Bank anrufen ${mark}`))).toEqual({ text: 'Bank anrufen', remind: [remind] })
  })

  test.each([
    ['{fri}', '2026-10-09'],
    ['{oct 20}', '2026-10-20'],
    ['{next friday}', '2026-10-09'],
  ])('deadline %s', (mark, deadline) => {
    expect(said(en(`Draft talk ${mark}`))).toEqual({ text: 'Draft talk', deadline })
  })

  test.each([
    ['{Fr}', '2026-10-09'],
    ['{20.10.}', '2026-10-20'],
  ])('Frist %s', (mark, deadline) => {
    expect(said(de(`Vortrag ${mark}`))).toEqual({ text: 'Vortrag', deadline })
  })

  test.each([
    ['for 45m', 45],
    ['for 1h30', 90],
    ['for 1h 30m', 90],
    ['for 2 hours', 120],
    ['for 45 min', 45],
    ['for an hour', 60],
  ])('duration %s', (mark, duration) => {
    expect(said(en(`Draft talk ${mark}`))).toEqual({ text: 'Draft talk', duration })
  })

  test.each([
    ['für 45 Min', 45],
    ['1,5 Std', 90],
    ['für 2 Stunden', 120],
  ])('Dauer %s', (mark, duration) => {
    expect(said(de(`Vortrag ${mark}`))).toEqual({ text: 'Vortrag', duration })
  })
})

describe('the whole line', () => {
  test("Todoist's own example", () => {
    const add = en('Call mum tomorrow 4pm #family p1 every sunday')
    expect(said(add)).toEqual({
      text: 'Call mum',
      due: '2026-10-08',
      time: '16:00',
      tags: ['family'],
      priority: 1,
      recurrence: 'every week on Sunday',
    })
    expect(add.chips.map((chip) => chip.kind)).toEqual(['when', 'tag', 'priority', 'repeat'])
    expect(
      add.chips.map((chip) =>
        'Call mum tomorrow 4pm #family p1 every sunday'.slice(chip.from, chip.to),
      ),
    ).toEqual(['tomorrow 4pm', '#family', 'p1', 'every sunday'])
  })

  test('a German reader typing English is understood too', () => {
    expect(said(de('Mama anrufen tomorrow'))).toEqual({ text: 'Mama anrufen', due: '2026-10-08' })
  })

  test('a chip turned back into words is read as words', () => {
    const text = 'Read Friday tomorrow'
    expect(said(en(text))).toEqual({ text: 'Read Friday', due: '2026-10-08' })
    const from = text.indexOf('tomorrow')
    expect(said(en(text, { keep: [{ from, to: from + 8 }] }))).toEqual({
      text: 'Read tomorrow',
      due: '2026-10-09',
    })
  })

  test('the last of two days is the day, the first stays words', () => {
    expect(said(en('Plan friday party tomorrow'))).toEqual({
      text: 'Plan friday party',
      due: '2026-10-08',
    })
  })

  test('a day and a time said apart both count', () => {
    expect(said(en('Call mum tomorrow and say hi at 4pm'))).toEqual({
      text: 'Call mum and say hi',
      due: '2026-10-08',
      time: '16:00',
    })
  })

  test('nothing at all', () => {
    expect(said(en(''))).toEqual({ text: '' })
    expect(said(en('   '))).toEqual({ text: '' })
  })
})

describe('what a person types in a hurry', () => {
  test.each([
    ['Trash every 2nd week', 'every 2 weeks'],
    ['Trash every 3rd day', 'every 3 days'],
    ['Trash every second week', 'every 2 weeks'],
  ])('%s', (text, recurrence) => {
    expect(said(en(text))).toEqual({ text: 'Trash', recurrence, due: '2026-10-07' })
  })

  test.each([
    ['Müll rausbringen jede 2. Woche', 'every 2 weeks'],
    ['Müll rausbringen alle zwei Wochen', 'every 2 weeks'],
    ['Müll rausbringen alle drei Tage', 'every 3 days'],
  ])('%s', (text, recurrence) => {
    expect(said(de(text))).toEqual({ text: 'Müll rausbringen', recurrence, due: '2026-10-07' })
  })

  test.each([
    ['Run every morning', '09:00'],
    ['Run every evening', '19:00'],
  ])('%s', (text, time) => {
    expect(said(en(text))).toEqual({ text: 'Run', recurrence: 'every day', due: '2026-10-07', time })
  })

  test.each([
    ['Laufen jeden Morgen', '09:00'],
    ['Laufen jeden Abend', '19:00'],
    ['Laufen jeden Mittag', '12:00'],
  ])('%s', (text, time) => {
    expect(said(de(text))).toEqual({ text: 'Laufen', recurrence: 'every day', due: '2026-10-07', time })
  })

  test('a time said beside every morning is the time', () => {
    expect(said(de('Laufen jeden Morgen um 7'))).toEqual({
      text: 'Laufen',
      recurrence: 'every day',
      due: '2026-10-07',
      time: '07:00',
    })
  })

  test.each([
    ['Present every first monday', 'en'],
    ['Present every 1st monday', 'en'],
    ['Present jeden ersten Montag', 'de'],
    ['Present jeden 1. Montag', 'de'],
  ])('%s', (text, lang) => {
    expect(said(lang === 'en' ? en(text) : de(text))).toEqual({
      text: 'Present',
      recurrence: 'every month on the 1st Monday',
      due: '2026-11-02',
    })
  })

  test.each([
    ['Clean next weekend', 'en', '2026-10-17'],
    ['Clean nächstes Wochenende', 'de', '2026-10-17'],
    ['Clean wednesday next week', 'en', '2026-10-14'],
    ['Clean Mittwoch nächste Woche', 'de', '2026-10-14'],
    ['Clean Freitag nächster Woche', 'de', '2026-10-16'],
    ['Clean on the 15th', 'en', '2026-10-15'],
    ['Clean by the 5th', 'en', '2026-11-05'],
    ['Clean am 15.', 'de', '2026-10-15'],
    ['Clean bis zum 5.', 'de', '2026-11-05'],
  ])('%s', (text, lang, due) => {
    expect(said(lang === 'en' ? en(text) : de(text))).toEqual({ text: 'Clean', due })
  })

  test('a German time with a dot after um', () => {
    expect(said(de('Bank anrufen um 15.30'))).toEqual({
      text: 'Bank anrufen',
      due: '2026-10-07',
      time: '15:30',
    })
    expect(said(de('Zug um 7.05'))).toEqual({ text: 'Zug', due: '2026-10-08', time: '07:05' })
  })

  test('am Morgen is the morning, not tomorrow', () => {
    expect(said(de('Laufen am Morgen'))).toEqual({ text: 'Laufen', due: '2026-10-08', time: '09:00' })
    expect(said(de('Laufen morgen am Abend'))).toEqual({
      text: 'Laufen',
      due: '2026-10-08',
      time: '19:00',
    })
  })

  test('a bare hour after a morning is in the morning', () => {
    expect(said(en('Run tomorrow morning at 7'))).toEqual({
      text: 'Run',
      due: '2026-10-08',
      time: '07:00',
    })
    expect(said(de('Brötchen morgen früh um 7'))).toEqual({
      text: 'Brötchen',
      due: '2026-10-08',
      time: '07:00',
    })
    expect(said(en('Run tonight at 8')).time).toBe('20:00')
  })

  test('next weekend from a Saturday is the one after', () => {
    const saturday = new Date(2026, 9, 10, 10, 0)
    expect(parseQuickAdd('Clean next weekend', ['en'], saturday).fields.due).toBe('2026-10-17')
  })
})

describe('the ambiguous cases stay words', () => {
  test.each([
    'Call Tom',
    'Sit in the sun',
    'Wed in May',
    'Sat down with Anna',
    'Read chapter 6',
    'Fix version 1.2',
    'Buy May issue',
    'every time I try',
    'Find the old card',
    'Mark p5 as done',
    'Say hi!',
    'Ship it at last',
    'email anna@example.com',
    'Learn C#',
    'Buy 3 apples',
    'for the team',
  ])('%s', (text) => {
    expect(said(en(text))).toEqual({ text })
  })

  test.each([
    'Do the dishes',
    'So ein Tag',
    'Mi casa',
    'Fr. Müller anrufen',
    'Alle Kinder abholen',
    'Morgenroutine planen',
    'Bericht für Anna',
    'Kapitel 3. lesen',
    'Am Ende Morgenkaffee',
  ])('%s', (text) => {
    expect(said(de(text))).toEqual({ text })
  })

  test('but a short day after a word that asks for one is a day', () => {
    expect(said(en('Picnic on sun'))).toEqual({ text: 'Picnic', due: '2026-10-11' })
    expect(said(de('Abholen am Do'))).toEqual({ text: 'Abholen', due: '2026-10-08' })
  })

  test('6/10 is read the way the language writes dates', () => {
    expect(en('Pay 9/10').fields.due).toBe('2026-10-09')
    expect(us('Pay 10/9').fields.due).toBe('2026-10-09')
    expect(us('Pay 9/10').fields.due).toBe('2027-09-10')
  })

  test('English words German does not have are still English', () => {
    expect(said(en('Morgen planen'))).toEqual({ text: 'Morgen planen' })
  })
})
