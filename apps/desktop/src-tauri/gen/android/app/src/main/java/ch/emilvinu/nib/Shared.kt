package ch.emilvinu.nib

import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import android.util.Log
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

/**
 * What another app handed this one: the text, link, picture or file behind a
 * share. Never a file to open where it lies: nib opens nothing from outside its
 * spaces, so what arrives is copied into one.
 *
 * Android gives an activity a `content://` URI and a grant that lasts as long as
 * the activity does. The page cannot read one - it has no file system of its own
 * and the crate refuses every path outside a space - so the bytes are copied into
 * the app's own cache here, while the grant is good, and handed to the page in
 * slices through the bridge. The page writes them the way an import does and says
 * when it is finished, which is when the copies go.
 *
 * Nothing is decided here beyond what the intent itself says. What becomes a note,
 * what becomes a picture beside one and what the front matter carries is the
 * page's business, in mobile/shared.ts, where it is one answer for every platform.
 */
object Shared {
  private const val TAG = "nib"

  /** Where a copy waits while the page reads it. Emptied on the way in and on the
   *  way out: a share nobody finished with must not still be there next launch. */
  private const val FOLDER = "shared"

  /** How much of one share is worth copying. A picture the app will refuse is
   *  still a picture somebody chose, so the ceiling is the crate's own twelve
   *  megabytes with room for a handful of them rather than a number of its own. */
  private const val MOST_BYTES = 64L * 1024 * 1024

  /** How large a buffer one copy reads through. */
  private const val STEP = 64 * 1024

  /** One thing that arrived. `text` is the whole of a shared text or link; `file`
   *  is where the copy landed for everything else, and exactly one is ever set. */
  private class Item(
    val name: String,
    val mime: String,
    val text: String?,
    val file: File?,
  )

  private var action = ""
  private var subject = ""
  private var items = listOf<Item>()

  /** Whether there is something waiting for the page. */
  val waiting: Boolean
    get() = items.isNotEmpty()

  /**
   * Reads an intent, if it is one of ours, and answers whether it was.
   *
   * What could not be opened is left out rather than reported: a share of five
   * files where one has already been deleted is still four files somebody meant
   * to send, and the page says what it actually received.
   */
  fun take(context: Context, intent: Intent): Boolean {
    val uris =
      when (intent.action) {
        Intent.ACTION_SEND -> listOfNotNull(stream(intent))
        Intent.ACTION_SEND_MULTIPLE -> streams(intent)
        // A VIEW is a `nib://` link, which is read in the window, and a share has
        // no business clearing it; see docs/automation.md.
        else -> return false
      }

    val text = intent.getStringExtra(Intent.EXTRA_TEXT)
    if (uris.isEmpty() && text.isNullOrBlank()) return false

    clear(context)
    action = intent.action ?: ""
    subject = intent.getStringExtra(Intent.EXTRA_SUBJECT) ?: ""

    val read = mutableListOf<Item>()
    if (!text.isNullOrBlank()) {
      read.add(Item(name = "", mime = "text/plain", text = text, file = null))
    }

    var room = MOST_BYTES
    for (uri in uris) {
      if (room <= 0L) break
      val copied = copy(context, uri, read.size, room) ?: continue
      room -= copied.file?.length() ?: 0L
      read.add(copied)
    }

    items = read
    return waiting
  }

  /** What arrived, as the page asks for it: everything except the bytes. */
  fun json(): String {
    val listed = JSONArray()
    for (item in items) {
      val one = JSONObject()
      one.put("name", item.name)
      one.put("mime", item.mime)
      one.put("size", item.file?.length() ?: 0L)
      if (item.text != null) one.put("text", item.text)
      listed.put(one)
    }

    val all = JSONObject()
    all.put("action", action)
    all.put("subject", subject)
    all.put("items", listed)
    return all.toString()
  }

  /**
   * One slice of one item's bytes as base64, or an empty string past the end.
   *
   * In slices because a share can be a photograph, and a string crossing into the
   * page costs what it is worth twice over. How much to hold at once is the page's
   * choice; see mobile/bridge.ts.
   */
  fun bytes(index: Int, offset: Int, length: Int): String {
    val file = items.getOrNull(index)?.file ?: return ""
    if (offset < 0 || length <= 0) return ""

    val size = file.length()
    if (offset >= size) return ""

    val want = minOf(length.toLong(), size - offset).toInt()
    val buffer = ByteArray(want)
    var filled = 0

    try {
      file.inputStream().use { stream ->
        var skipped = 0L
        while (skipped < offset) {
          val stepped = stream.skip(offset.toLong() - skipped)
          if (stepped <= 0L) break
          skipped += stepped
        }

        if (skipped >= offset) {
          while (filled < want) {
            val got = stream.read(buffer, filled, want - filled)
            if (got < 0) break
            filled += got
          }
        }
      }
    } catch (error: Exception) {
      Log.w(TAG, "a shared file could not be read: ${error.message}")
      return ""
    }

    if (filled <= 0) return ""
    val slice = if (filled == want) buffer else buffer.copyOf(filled)
    return Base64.encodeToString(slice, Base64.NO_WRAP)
  }

  /** Forgets what arrived, and takes the copies with it. */
  fun clear(context: Context) {
    action = ""
    subject = ""
    items = emptyList()

    val held = folder(context).listFiles() ?: return
    for (file in held) file.delete()
  }

  private fun folder(context: Context): File {
    val dir = File(context.cacheDir, FOLDER)
    dir.mkdirs()
    return dir
  }

  /**
   * Copies one shared URI into the cache. Answers null when it could not be read
   * at all, or when it alone is larger than the room that is left, which a
   * revoked grant, a deleted file and a film all look like from here.
   */
  private fun copy(context: Context, uri: Uri, at: Int, room: Long): Item? {
    val resolver = context.contentResolver
    val name = nameOf(resolver, uri, at)
    val mime = resolver.getType(uri) ?: typeOf(uri)
    val target = File(folder(context), "$at-$name")
    var total = 0L

    val read =
      try {
        val stream = resolver.openInputStream(uri)
        if (stream == null) false
        else
          stream.use { source ->
            target.outputStream().use { out ->
              val buffer = ByteArray(STEP)
              while (true) {
                val got = source.read(buffer)
                if (got < 0) break
                total += got
                if (total > room) break
                out.write(buffer, 0, got)
              }
            }
            total <= room
          }
      } catch (error: Exception) {
        Log.w(TAG, "a shared file could not be read: ${error.message}")
        false
      }

    if (!read) {
      target.delete()
      return null
    }

    return Item(name = name, mime = mime, text = null, file = target)
  }

  /** The name the sending app gave the file, or one of ours when it gave none. */
  private fun nameOf(resolver: ContentResolver, uri: Uri, at: Int): String {
    val given =
      try {
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { row ->
          if (row.moveToFirst() && !row.isNull(0)) row.getString(0) else null
        }
      } catch (error: Exception) {
        Log.w(TAG, "a shared file would not say its name: ${error.message}")
        null
      }

    return safe(given ?: uri.lastPathSegment ?: "shared-$at")
  }

  /** A name that is a name: no folder in it, nothing hidden, and not endless. */
  private fun safe(name: String): String {
    val kept =
      name
        .takeLast(120)
        .map { letter ->
          if (letter.isLetterOrDigit() || letter == '.' || letter == '-' || letter == '_') letter
          else '-'
        }
        .joinToString("")
        .trimStart('.')

    return if (kept.isBlank()) "shared" else kept
  }

  /** What a URI with no type of its own holds, going by its name. Only a note is
   *  worth guessing at: anything else the page treats as a file either way. */
  private fun typeOf(uri: Uri): String {
    val name = uri.lastPathSegment?.lowercase() ?: ""
    val markdown = name.endsWith(".md") || name.endsWith(".markdown")
    return if (markdown) "text/markdown" else "application/octet-stream"
  }

  @Suppress("DEPRECATION")
  private fun stream(intent: Intent): Uri? = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)

  @Suppress("DEPRECATION")
  private fun streams(intent: Intent): List<Uri> =
    intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)?.filterNotNull() ?: emptyList()
}
