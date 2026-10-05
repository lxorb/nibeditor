package ch.emilvinu.nib

/**
 * The phone's reminders as a list, and what changes when a new one is handed over.
 *
 * Pure Kotlin, no Android in it, so the decisions are tested on the JVM
 * (AlarmListTest.kt): which alarms a plan sets, which it cancels, what number each is
 * known to the system by, and when a snooze rings. Reminders.kt is the system's half.
 * The plan itself is the page's (src/lib/reminders/plan.ts): the next 64, each with
 * the id every device and the Worker make for the same reminder.
 */
data class Alarm(
  val id: String,
  val at: Long,
  val title: String,
  val body: String,
  val space: String,
  val path: String,
  val hash: String,
  val line: Int,
)

object AlarmList {
  /** The most alarms the phone holds at once, as the page plans them. */
  const val MOST = 64

  /** How long a snooze is. */
  const val SNOOZE_MS = 15 * 60_000L

  /** How long a reminder that rang is remembered, so a push for it stays quiet. */
  const val REMEMBERED_MS = 7 * 86_400_000L

  /** The alarms a plan sets: its reminders still to come, soonest first, at most 64. */
  fun wanted(plan: List<Alarm>, now: Long): List<Alarm> =
    plan.filter { it.at > now }.sortedBy { it.at }.take(MOST)

  /** The ids held now that a new plan no longer asks for: their alarms are cancelled. */
  fun cancelled(held: List<Alarm>, wanted: List<Alarm>): List<String> {
    val keep = wanted.map { it.id }.toSet()
    return held.map { it.id }.filter { it !in keep }
  }

  /** The number the system knows an alarm by: the first eight hex digits of its id. */
  fun requestCode(id: String): Int = id.take(8).toLongOrNull(16)?.toInt() ?: id.hashCode()

  /** When a snooze pressed at `now` rings. */
  fun snoozed(now: Long): Long = now + SNOOZE_MS

  /**
   * Whether a push for a reminder is one this phone already rings, or rang: the
   * Worker pushes to every device, and a phone that set the alarm itself must not
   * ring twice.
   */
  fun known(id: String, held: List<Alarm>, rung: Map<String, Long>, now: Long): Boolean =
    held.any { it.id == id } || (rung[id]?.let { now - it < REMEMBERED_MS } ?: false)
}
