package ch.emilvinu.nib

import android.Manifest
import android.app.Activity
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONArray
import org.json.JSONObject

/**
 * Reminders on the phone: alarms the system rings with nib closed (docs/tasks.md 5.10).
 *
 * The page plans (src/lib/reminders) and hands the whole plan over through the bridge
 * whenever it changes; this sets an `AlarmManager` alarm for each, keeps the plan in the
 * app's own preferences, cancels what a new plan dropped, and sets them all again after
 * a reboot, an update or a change of time zone. No sync and no credential here, so
 * docs/mobile.md's rule against a second sync implementation holds: the phone only
 * rings what the page last said.
 *
 * Exact where the phone allows it, and within a few minutes where it does not: from
 * Android 14 `SCHEDULE_EXACT_ALARM` is not granted to a new install, and the reader is
 * sent to its switch once, the first time a reminder is set (docs/tasks.md 7.3).
 *
 * What rings has Done, Snooze and a press. Snooze is answered here, by an alarm fifteen
 * minutes on. Done and the press need the page, which owns the one write path: each is
 * queued here and handed over the next time the page asks (`remindersTaken`), at once
 * when nib is open, and the press opens nib to do it.
 */
object Reminders {
  private const val STORE = "nib.reminders"
  private const val PLAN = "plan"
  private const val WORDS = "words"
  private const val PRESSES = "presses"
  private const val RUNG = "rung"
  private const val ASKED_EXACT = "asked-exact"
  private const val ASKED_SHOWING = "asked-showing"

  const val CHANNEL = "reminders"
  const val ACTION_RING = "ch.emilvinu.nib.reminder.RING"
  const val ACTION_DONE = "ch.emilvinu.nib.reminder.DONE"
  const val ACTION_SNOOZE = "ch.emilvinu.nib.reminder.SNOOZE"
  const val EXTRA_ALARM = "ch.emilvinu.nib.reminder"

  /** Asking to show notifications at all, from Android 13. */
  private const val SHOWING = 0x6e6f

  private fun prefs(context: Context) = context.getSharedPreferences(STORE, Context.MODE_PRIVATE)

  /** The page's plan, set: alarms for what is new, none for what went. */
  fun set(activity: Activity, json: String) {
    val read =
      try {
        JSONObject(json)
      } catch (error: Exception) {
        Log.w("nib", "a reminders plan that could not be read: ${error.message}")
        return
      }
    val plan = alarmsOf(read.optJSONArray("reminders") ?: JSONArray())
    val held = held(activity)
    val wanted = AlarmList.wanted(plan, System.currentTimeMillis())

    val manager = activity.getSystemService(AlarmManager::class.java) ?: return
    for (id in AlarmList.cancelled(held, wanted)) manager.cancel(ringing(activity, id, null))
    for (one in wanted) schedule(activity, manager, one)

    prefs(activity)
      .edit()
      .putString(PLAN, toJson(wanted).toString())
      .putString(WORDS, (read.optJSONObject("words") ?: JSONObject()).toString())
      .apply()

    if (wanted.isNotEmpty()) askOnce(activity)
  }

  /** Every alarm set again from what was kept: after a reboot, an update, a new zone. */
  fun again(context: Context) {
    val manager = context.getSystemService(AlarmManager::class.java) ?: return
    for (one in AlarmList.wanted(held(context), System.currentTimeMillis())) {
      schedule(context, manager, one)
    }
  }

  /** Whether an alarm rings at its minute rather than within a few. */
  fun exact(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
    return context.getSystemService(AlarmManager::class.java)?.canScheduleExactAlarms() ?: false
  }

  /** The system's own switch for exact alarms. */
  fun openExactSwitch(activity: Activity) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
    activity.runOnUiThread {
      try {
        activity.startActivity(
          Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM)
            .setData(Uri.parse("package:${activity.packageName}"))
        )
      } catch (error: Exception) {
        Log.w("nib", "the exact alarms switch could not be opened: ${error.message}")
      }
    }
  }

  /** The presses waiting for the page, as JSON, taken. */
  fun taken(context: Context): String {
    val waiting = prefs(context).getString(PRESSES, "[]") ?: "[]"
    prefs(context).edit().putString(PRESSES, "[]").apply()
    return waiting
  }

  /** A press the page has to answer: Done, or the notification itself. */
  fun pressed(context: Context, act: String, alarm: Alarm) {
    val waiting =
      try {
        JSONArray(prefs(context).getString(PRESSES, "[]"))
      } catch (unread: Exception) {
        JSONArray()
      }
    waiting.put(
      JSONObject()
        .put("act", act)
        .put("space", alarm.space)
        .put("path", alarm.path)
        .put("hash", alarm.hash)
        .put("line", alarm.line)
    )
    prefs(context).edit().putString(PRESSES, waiting.toString()).apply()
  }

  /** Shows a reminder whose alarm rang, with Done, Snooze and a press. */
  fun ring(context: Context, alarm: Alarm) {
    remember(context, alarm.id)
    channel(context)
    val words = words(context)
    val code = AlarmList.requestCode(alarm.id)

    val open =
      PendingIntent.getActivity(
        context,
        code,
        Intent(context, MainActivity::class.java)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
          .putExtra(EXTRA_ALARM, toJson(listOf(alarm)).toString()),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    val notification =
      NotificationCompat.Builder(context, CHANNEL)
        .setSmallIcon(R.drawable.ic_reminder)
        .setContentTitle(alarm.title)
        .setContentText(alarm.body)
        .setCategory(NotificationCompat.CATEGORY_REMINDER)
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setAutoCancel(true)
        .setContentIntent(open)
        .addAction(0, words.optString("done", "Done"), action(context, ACTION_DONE, alarm))
        .addAction(0, words.optString("snooze", "Snooze"), action(context, ACTION_SNOOZE, alarm))
        .build()
    // Notifications turned off for the app, or never allowed: nothing to show.
    if (
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
        context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
          PackageManager.PERMISSION_GRANTED
    ) {
      return
    }
    try {
      NotificationManagerCompat.from(context).notify(alarm.id, code, notification)
    } catch (error: SecurityException) {
      // Notifications turned off for the app: nothing to show, and nothing to do.
      Log.w("nib", "a reminder could not be shown: ${error.message}")
    }
  }

  /** Takes a reminder's notification away, once it was answered. */
  fun dismiss(context: Context, alarm: Alarm) {
    NotificationManagerCompat.from(context).cancel(alarm.id, AlarmList.requestCode(alarm.id))
  }

  /** Rings a reminder again in fifteen minutes. */
  fun snooze(context: Context, alarm: Alarm) {
    val manager = context.getSystemService(AlarmManager::class.java) ?: return
    schedule(context, manager, alarm.copy(at = AlarmList.snoozed(System.currentTimeMillis())))
  }

  /** Whether a push for this reminder is one the phone rings, or rang, itself. */
  fun known(context: Context, id: String): Boolean =
    AlarmList.known(id, held(context), rung(context), System.currentTimeMillis())

  private fun schedule(context: Context, manager: AlarmManager, alarm: Alarm) {
    val pending = ringing(context, alarm.id, alarm)
    if (exact(context)) {
      manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, alarm.at, pending)
    } else {
      manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, alarm.at, pending)
    }
  }

  /** The broadcast an alarm sends when it rings. The same one for the same id, so a
   *  plan handed over again replaces it and a cancel finds it. */
  private fun ringing(context: Context, id: String, alarm: Alarm?): PendingIntent {
    val intent = Intent(context, ReminderReceiver::class.java).setAction(ACTION_RING)
    // The id in the data, which is what makes two alarms two different intents.
    intent.data = Uri.parse("nib-reminder://$id")
    if (alarm != null) intent.putExtra(EXTRA_ALARM, toJson(listOf(alarm)).toString())
    return PendingIntent.getBroadcast(
      context,
      AlarmList.requestCode(id),
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun action(context: Context, act: String, alarm: Alarm): PendingIntent {
    val intent =
      Intent(context, ReminderReceiver::class.java)
        .setAction(act)
        .setData(Uri.parse("nib-reminder://${alarm.id}/$act"))
        .putExtra(EXTRA_ALARM, toJson(listOf(alarm)).toString())
    return PendingIntent.getBroadcast(
      context,
      AlarmList.requestCode(alarm.id),
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun channel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    if (manager.getNotificationChannel(CHANNEL) != null) return
    val name = words(context).optString("channel", "Reminders")
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL, name, NotificationManager.IMPORTANCE_HIGH)
    )
  }

  /** Once each: leave to show notifications (Android 13), and the exact alarms switch
   *  (Android 12 on), the first time a reminder is set. */
  private fun askOnce(activity: Activity) {
    val prefs = prefs(activity)
    if (
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
        !prefs.getBoolean(ASKED_SHOWING, false) &&
        activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
          PackageManager.PERMISSION_GRANTED
    ) {
      prefs.edit().putBoolean(ASKED_SHOWING, true).apply()
      activity.runOnUiThread {
        activity.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), SHOWING)
      }
      return
    }
    if (!exact(activity) && !prefs.getBoolean(ASKED_EXACT, false)) {
      prefs.edit().putBoolean(ASKED_EXACT, true).apply()
      openExactSwitch(activity)
    }
  }

  private fun words(context: Context): JSONObject =
    try {
      JSONObject(prefs(context).getString(WORDS, "{}") ?: "{}")
    } catch (unread: Exception) {
      JSONObject()
    }

  private fun held(context: Context): List<Alarm> =
    try {
      alarmsOf(JSONArray(prefs(context).getString(PLAN, "[]") ?: "[]"))
    } catch (unread: Exception) {
      emptyList()
    }

  private fun rung(context: Context): Map<String, Long> {
    val read =
      try {
        JSONObject(prefs(context).getString(RUNG, "{}") ?: "{}")
      } catch (unread: Exception) {
        JSONObject()
      }
    return read.keys().asSequence().associateWith { read.optLong(it) }
  }

  private fun remember(context: Context, id: String) {
    val now = System.currentTimeMillis()
    val kept = rung(context).filterValues { now - it < AlarmList.REMEMBERED_MS } + (id to now)
    prefs(context).edit().putString(RUNG, JSONObject(kept).toString()).apply()
  }

  fun alarmsOf(list: JSONArray): List<Alarm> {
    val out = mutableListOf<Alarm>()
    for (at in 0 until list.length()) {
      val one = list.optJSONObject(at) ?: continue
      val id = one.optString("id")
      if (id.isEmpty()) continue
      out.add(
        Alarm(
          id = id,
          at = one.optLong("at"),
          title = one.optString("title"),
          body = one.optString("body"),
          space = one.optString("space"),
          path = one.optString("path"),
          hash = one.optString("hash"),
          line = one.optInt("line"),
        )
      )
    }
    return out
  }

  private fun toJson(alarms: List<Alarm>): JSONArray {
    val out = JSONArray()
    for (one in alarms) {
      out.put(
        JSONObject()
          .put("id", one.id)
          .put("at", one.at)
          .put("title", one.title)
          .put("body", one.body)
          .put("space", one.space)
          .put("path", one.path)
          .put("hash", one.hash)
          .put("line", one.line)
      )
    }
    return out
  }

  /** The one alarm an intent carries. */
  fun carried(intent: Intent): Alarm? {
    val json = intent.getStringExtra(EXTRA_ALARM) ?: return null
    return try {
      alarmsOf(JSONArray(json)).firstOrNull()
    } catch (unread: Exception) {
      null
    }
  }
}

/** What every reminder's alarm and button sends, and what the system sends after a
 *  reboot, an update and a new time zone. */
class ReminderReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      Reminders.ACTION_RING -> Reminders.carried(intent)?.let { Reminders.ring(context, it) }
      Reminders.ACTION_SNOOZE ->
        Reminders.carried(intent)?.let {
          Reminders.dismiss(context, it)
          Reminders.snooze(context, it)
        }
      Reminders.ACTION_DONE ->
        Reminders.carried(intent)?.let {
          Reminders.dismiss(context, it)
          Reminders.pressed(context, "done", it)
          MainActivity.reminded()
        }
      Intent.ACTION_BOOT_COMPLETED,
      Intent.ACTION_MY_PACKAGE_REPLACED,
      Intent.ACTION_TIMEZONE_CHANGED,
      Intent.ACTION_TIME_CHANGED -> Reminders.again(context)
    }
  }
}
