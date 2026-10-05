package ch.emilvinu.nib

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The phone's reminders as a list: what a plan sets and cancels, and what a push for a
 *  reminder the phone already rings does. See AlarmList.kt. */
class AlarmListTest {
  private fun alarm(id: String, at: Long) =
    Alarm(id, at, "Call the bank", "Plan", "Work", "Plan.md", "abc", 2)

  @Test
  fun aPlanSetsWhatIsStillToComeSoonestFirst() {
    val wanted =
      AlarmList.wanted(listOf(alarm("b", 300), alarm("past", 50), alarm("a", 200)), now = 100)
    assertEquals(listOf("a", "b"), wanted.map { it.id })
  }

  @Test
  fun sixtyFourAreKept() {
    val plan = (1..100).map { alarm(String.format("%016x", it), it * 1000L) }
    val wanted = AlarmList.wanted(plan, now = 0)
    assertEquals(64, wanted.size)
    assertEquals(64_000L, wanted.last().at)
  }

  @Test
  fun aNewPlanCancelsWhatItDropped() {
    val held = listOf(alarm("moved", 200), alarm("kept", 300))
    val wanted = listOf(alarm("kept", 300), alarm("new", 400))
    assertEquals(listOf("moved"), AlarmList.cancelled(held, wanted))
    assertEquals(emptyList<String>(), AlarmList.cancelled(wanted, wanted))
  }

  @Test
  fun anAlarmIsKnownToTheSystemByItsIdsFirstDigits() {
    assertEquals(0x00ff00ff, AlarmList.requestCode("00ff00ff00ff00ff"))
    assertEquals(
      AlarmList.requestCode("deadbeef00000000"),
      AlarmList.requestCode("deadbeef11111111"),
    )
  }

  @Test
  fun aSnoozeRingsFifteenMinutesOn() {
    assertEquals(1_000L + 15 * 60_000L, AlarmList.snoozed(1_000L))
  }

  @Test
  fun aPushForAReminderThePhoneRingsItselfIsKnown() {
    val held = listOf(alarm("set", 500))
    val rung = mapOf("rang" to 100L)
    assertTrue(AlarmList.known("set", held, rung, now = 200))
    assertTrue(AlarmList.known("rang", held, rung, now = 200))
    assertFalse(AlarmList.known("other", held, rung, now = 200))
    assertFalse(AlarmList.known("rang", held, rung, now = 100 + AlarmList.REMEMBERED_MS))
  }
}
