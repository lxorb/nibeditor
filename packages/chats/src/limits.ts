/** The numbers a chat is held to (docs/chats.md 4.3, 4.4, 4.8, 4.10, 4.18).
 *
 *  One list, because three ends read each: `ChatLog` refuses past them, the checks in
 *  ./wire drop a frame past them, and the composer warns before them. */

/** Characters of words in one message. Discord's 2,000 is too few for code, Slack's
 *  40,000 is cut in practice. */
export const MOST_BODY = 16_000

/** Past this many characters the composer offers to send a paste as a `.md` file. */
export const LONG_PASTE = 4000

/** Files one message carries. */
export const MOST_FILES = 10

/** The largest file, sent in 8 MB parts past the 64 MB one request takes. */
export const MOST_FILE_BYTES = 2 * 1024 * 1024 * 1024

/** Bars in a voice message's waveform. */
export const WAVE_BARS = 64

/** A voice message's longest recording, in seconds: Discord's twenty minutes. */
export const MOST_VOICE_SECONDS = 20 * 60

/** Answers a poll offers, at least and at most. */
export const FEWEST_ANSWERS = 2
export const MOST_ANSWERS = 10

/** Characters of a poll's question and of one answer. */
export const LONGEST_QUESTION = 300
export const LONGEST_ANSWER = 100

/** Characters of a chat's topic: Slack's. */
export const LONGEST_TOPIC = 250

/** The longest slowmode, in seconds: Discord's six hours. */
export const MOST_SLOWMODE = 6 * 60 * 60

/** Events one `POST /v2/chats/:id/events` carries from an outbox. */
export const MOST_POSTED = 50

/** Events one page of `GET /v2/chats/:id/events` answers. */
export const MOST_PAGE = 500

/** How far behind a device may be before it takes the messages as they stand, newest
 *  first, rather than every event since (4.5). */
export const MOST_BEHIND = 10_000

/** Events one account may send a minute, across every chat. */
export const EVENTS_A_MINUTE = 600

/** Posts one person may send in one chat in `BURST_SECONDS`. */
export const BURST_POSTS = 10
export const BURST_SECONDS = 10

/** People a chat holds: the space's. */
export const MOST_MEMBERS = 200

/** Read receipts are drawn in chats of up to this many people (decision 7.5). */
export const RECEIPTS_UP_TO = 10

/** A chat of more than this many people pings for mentions only by default (4.11). */
export const MENTIONS_ONLY_PAST = 10

/** Above this many people the composer asks once before an @here or @everyone. */
export const ASK_EVERYONE_PAST = 10

/** A typing frame at most this often while the words change, and drawn this long after
 *  the last one, in milliseconds (4.10). */
export const TYPING_EVERY = 3000
export const TYPING_SHOWN = 5000

/** Within this many milliseconds a person's messages are grouped under one avatar. */
export const GROUP_WITHIN = 5 * 60 * 1000

/** Within this many milliseconds of sending, Ctrl+Z takes a message back (Unsend). */
export const UNSEND_WITHIN = 15_000
