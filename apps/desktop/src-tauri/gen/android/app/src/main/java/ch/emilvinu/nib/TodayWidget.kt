package ch.emilvinu.nib

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.util.Log
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject

/**
 * Today on the home screen: the open tasks for today and overdue, a box in front of
 * each, and a plus for quick add (docs/tasks.md 5.18).
 *
 * Drawn like the notes widget beside it, out of what the page last handed over (the
 * same JSON, under `today`; see mobile/widgets.svelte.ts), because a launcher cannot
 * ask the app anything. A box ticks the task through the app's own write: the press
 * opens the app with the task's anchor, the page ticks it in its note the way a box in
 * any view does, and the rows it hands back are the widget's next drawing. The words
 * of a row open the note the task is in.
 */
class TodayWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    val state = read(context)
    for (id in ids) manager.updateAppWidget(id, drawn(context, state))
  }

  companion object {
    /** As many rows as the layout has, each a box and the task's words. Held to
     *  `widget_today.xml` and to the page's own count by test/android.test.ts. */
    private val ROWS =
      intArrayOf(
        R.id.nib_today_row_0,
        R.id.nib_today_row_1,
        R.id.nib_today_row_2,
        R.id.nib_today_row_3,
        R.id.nib_today_row_4,
      )
    private val BOXES =
      intArrayOf(
        R.id.nib_today_box_0,
        R.id.nib_today_box_1,
        R.id.nib_today_box_2,
        R.id.nib_today_box_3,
        R.id.nib_today_box_4,
      )
    private val WORDS =
      intArrayOf(
        R.id.nib_today_text_0,
        R.id.nib_today_text_1,
        R.id.nib_today_text_2,
        R.id.nib_today_text_3,
        R.id.nib_today_text_4,
      )

    /** Draws every Today widget again; called when the page hands over new rows. */
    fun refresh(context: Context) {
      val manager = AppWidgetManager.getInstance(context) ?: return
      val ids = manager.getAppWidgetIds(ComponentName(context, TodayWidget::class.java))
      if (ids == null || ids.isEmpty()) return

      val state = read(context)
      for (id in ids) manager.updateAppWidget(id, drawn(context, state))
    }

    private fun drawn(context: Context, state: Today): RemoteViews {
      val views = RemoteViews(context.packageName, R.layout.widget_today)

      views.setTextViewText(R.id.nib_today_title, state.title)
      views.setOnClickPendingIntent(R.id.nib_today_title, command(context, "", 100))
      views.setOnClickPendingIntent(R.id.nib_today_add, command(context, "quick-add", 101))

      for ((at, row) in ROWS.withIndex()) {
        val task = state.tasks.getOrNull(at)
        if (task == null) {
          views.setViewVisibility(row, View.GONE)
          continue
        }

        views.setViewVisibility(row, View.VISIBLE)
        views.setTextViewText(WORDS[at], task.text)
        views.setOnClickPendingIntent(BOXES[at], tick(context, task, 110 + at))
        if (task.path.isNotEmpty()) {
          views.setOnClickPendingIntent(WORDS[at], open(context, task.path, 120 + at))
        }
      }

      val empty = state.tasks.isEmpty()
      views.setViewVisibility(R.id.nib_today_empty, if (empty) View.VISIBLE else View.GONE)
      views.setTextViewText(R.id.nib_today_empty, state.empty)

      return views
    }

    private fun intent(context: Context): Intent =
      Intent(context, MainActivity::class.java)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)

    private fun command(context: Context, id: String, at: Int): PendingIntent {
      val intent = intent(context)
      if (id.isNotEmpty()) intent.putExtra(MainActivity.EXTRA_COMMAND, id)
      return pending(context, intent, at)
    }

    private fun open(context: Context, path: String, at: Int): PendingIntent =
      pending(context, intent(context).putExtra(MainActivity.EXTRA_OPEN, path), at)

    /** A box: the task's anchor and its space, for the page to tick. */
    private fun tick(context: Context, task: Task, at: Int): PendingIntent =
      pending(
        context,
        intent(context)
          .putExtra(MainActivity.EXTRA_TICK, task.at)
          .putExtra(MainActivity.EXTRA_TICK_SPACE, task.space),
        at,
      )

    private fun pending(context: Context, intent: Intent, at: Int): PendingIntent =
      PendingIntent.getActivity(
        context,
        at,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )

    private fun read(context: Context): Today {
      val fallback = Today(context.getString(R.string.widget_today), "", emptyList())
      val held = WidgetNotes.read(context)
      if (held.isEmpty()) return fallback

      return try {
        val today = JSONObject(held).optJSONObject("today") ?: return fallback
        val listed = today.optJSONArray("tasks")
        val tasks = mutableListOf<Task>()
        for (at in 0 until (listed?.length() ?: 0)) {
          val one = listed?.optJSONObject(at) ?: continue
          val text = one.optString("text")
          val anchor = one.optString("at")
          if (text.isEmpty() || anchor.isEmpty()) continue
          tasks.add(Task(text, anchor, one.optString("space"), one.optString("path")))
          if (tasks.size == ROWS.size) break
        }

        val title = today.optString("title")
        Today(if (title.isEmpty()) fallback.title else title, today.optString("empty"), tasks)
      } catch (error: Exception) {
        Log.w("nib", "the widget's tasks could not be read: ${error.message}")
        fallback
      }
    }

    private class Task(val text: String, val at: String, val space: String, val path: String)

    private class Today(val title: String, val empty: String, val tasks: List<Task>)
  }
}
