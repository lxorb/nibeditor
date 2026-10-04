package ch.emilvinu.nib

import android.Manifest
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.util.UUID
import org.json.JSONObject

class MainActivity : TauriActivity() {
  companion object {
    /** A command in the page's own registry, carried in by a quick settings tile
     *  or a widget. See commands.ts and mobile/handed.ts. */
    const val EXTRA_COMMAND = "ch.emilvinu.nib.command"

    /** A note to open, carried in by a widget row. */
    const val EXTRA_OPEN = "ch.emilvinu.nib.open"

    /** A task to tick, by its anchor and its space, carried in by a box of the Today
     *  widget; see TodayWidget.kt and mobile/handed.ts. */
    const val EXTRA_TICK = "ch.emilvinu.nib.tick"
    const val EXTRA_TICK_SPACE = "ch.emilvinu.nib.tick.space"

    /** Written onto an intent once it has been read, so a launch that is replayed
     *  - a process killed in the background and restored with the intent it was
     *  started with - does not make the same note twice. */
    private const val EXTRA_READ = "ch.emilvinu.nib.read"

    /** Asking for the microphone. Its own number so the answer can be told from
     *  anything else the app ever asks for. */
    private const val MICROPHONE = 0x6d69
  }

  // Back closes whatever is over the note rather than the app. Every layer the
  // page opens takes a history entry of its own (see backstack.svelte.ts), so a
  // back press the webview can answer is one it should: WryActivity does exactly
  // that when this is on, and finishes the activity once nothing is left to
  // close. Tauri turns it off by default.
  override val handleBackNavigation = true

  // What the system bars leave for the page, in CSS pixels, as the page reads
  // it. Written on the UI thread by the inset listener and read on the
  // webview's own thread through the bridge, so it is published between them.
  @Volatile private var edges = "{\"top\":0,\"right\":0,\"bottom\":0,\"left\":0}"

  // What a tile, a widget row or a share left for the page, waiting until the
  // page asks. Written on the UI thread by an intent and read on the webview's
  // own thread, the same way the insets are.
  @Volatile private var command = ""
  @Volatile private var opening = ""
  @Volatile private var ticking = ""
  @Volatile private var tickingIn = ""

  /** The page, once there is one. Held so an intent that arrives while the app is
   *  already open can say so, and so the recogniser's words have somewhere to go. */
  private var page: WebView? = null

  /** A word made up for this launch, which the activity says to the page itself and
   *  to nothing else.
   *
   *  `addJavascriptInterface` has no notion of an origin and no notion of a frame:
   *  Android injects the object into *every* frame of the webview, iframes included,
   *  and the call carries nothing about who made it. Nib's pages do hold frames of
   *  somebody else's - a note may embed a page, and a block of a note's own HTML
   *  runs in a frame of its own - and those are sandboxed precisely so that the app
   *  is out of their reach. The bridge was the way round the sandbox: a framed page
   *  could ask for every AI key on the phone, or turn the microphone on.
   *
   *  So the calls that matter want this word, and the only way to learn it is to be
   *  the page: `evaluateJavascript` runs in the main frame, so `askForTheFrame`
   *  answers into the main frame whoever asked, and a frame at another origin cannot
   *  read a variable the main frame holds. See mobile/bridge.ts, which is the page's
   *  side of it. */
  private val frame: String = UUID.randomUUID().toString()

  private val dictation by lazy { Dictation(this) }

  override fun onCreate(savedInstanceState: Bundle?) {
    // Android 15 draws every app under the system bars whether it asks or not,
    // so Nib asks, and paints those areas itself: transparent bars over the
    // page's own background, with the page's chrome padded by the insets. A
    // scrim behind the clock would be a band of somebody else's colour across
    // the top of a themed app.
    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
      navigationBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
    )
    super.onCreate(savedInstanceState)

    // Read before the page exists, which is the usual case: a share is what
    // started the app. The page asks for it as it comes up; see mobile/handed.ts.
    read(intent)
  }

  /** An intent for an app that is already open. `singleTask` means every share
   *  after the first arrives here rather than in a second activity. */
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    if (read(intent)) tell("window.__nibHanded?.()")
  }

  /**
   * Takes what an intent was carrying and answers whether it was carrying
   * anything. Nothing here acts on it: what a share becomes, and what a command
   * id means, is the page's business, and it asks as soon as it can.
   */
  private fun read(intent: Intent?): Boolean {
    if (intent == null || intent.getBooleanExtra(EXTRA_READ, false)) return false
    intent.putExtra(EXTRA_READ, true)

    val asked = intent.getStringExtra(EXTRA_COMMAND) ?: ""
    val note = intent.getStringExtra(EXTRA_OPEN) ?: ""
    val tick = intent.getStringExtra(EXTRA_TICK) ?: ""
    if (asked.isNotEmpty()) command = asked
    if (note.isNotEmpty()) opening = note
    if (tick.isNotEmpty()) {
      ticking = tick
      tickingIn = intent.getStringExtra(EXTRA_TICK_SPACE) ?: ""
    }

    val shared = Shared.take(this, intent)
    return shared || asked.isNotEmpty() || note.isNotEmpty() || tick.isNotEmpty()
  }

  override fun onWebViewCreate(webView: WebView) {
    page = webView
    webView.addJavascriptInterface(Bridge(), "__NIB_SYSTEM__")

    // Two different edges, handled two different ways.
    //
    // The keyboard pads the webview: nothing shortens the window when the page
    // is drawn edge to edge, so the line being written can end up behind the
    // keys. Padding the view ends the page where the keys begin instead, which
    // the layout and the visual viewport both read; see viewport.svelte.ts.
    // Below Android 11 there is no keyboard inset to read and the manifest's
    // adjustResize shortens the window itself, leaving this at zero.
    //
    // The system bars do not pad it. Padding there would letterbox the app in
    // whatever colour the window happens to be, and the drawer, the scrim and
    // the sheets would stop short of the edge - which is exactly what a native
    // app does not look like. They are handed to the page as numbers instead,
    // so it draws the whole screen and each bar of its own clears them; see
    // insets.ts and the --inset-* tokens.
    // The listener is on the webview, so the webview itself is what every line
    // below speaks to: only a View arrives in the callback, and running a
    // script is a WebView's own trick and not a View's.
    ViewCompat.setOnApplyWindowInsetsListener(webView) { _: View, insets: WindowInsetsCompat ->
      val keys = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
      webView.setPadding(0, 0, 0, keys)

      val bars =
        insets.getInsets(
          WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
        )
      val density = webView.resources.displayMetrics.density
      fun css(pixels: Int) = (pixels / density).toInt()

      // The gesture bar sits behind the keyboard while it is up, and the page
      // already ends above the keys, so its inset has been paid for once.
      edges =
        "{\"top\":${css(bars.top)},\"right\":${css(bars.right)}," +
          "\"bottom\":${css(maxOf(0, bars.bottom - keys))},\"left\":${css(bars.left)}}"
      webView.evaluateJavascript("window.__nibInsets?.()", null)
      insets
    }

    // The pen writes on the canvas rather than into a handwriting recogniser.
    //
    // Android turns stylus handwriting on for every text field by default from
    // 14, and Samsung's Direct Writing does the same from Android 11 on its own
    // devices. Both watch for a stylus over an editable area and then swallow
    // the touch stream to convert it to text - which over a note being written
    // in, or over a canvas card, means the pen never reaches the page at all.
    // Nib draws with the pen itself, so the recogniser is turned off here and
    // every stylus event arrives as a pointer event; see canvas/ink.ts.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      webView.isAutoHandwritingEnabled = false
    }
  }

  /** Where an AI provider's key lives on a phone.
   *
   *  `EncryptedSharedPreferences` is Android's own answer to the keychain a desktop
   *  has: the file is encrypted with a key held in the hardware-backed Keystore,
   *  which never leaves the device and which no other app can reach. Built lazily
   *  and kept, because building it derives the master key, and somebody who never
   *  sets a key up should not pay for that on the way in.
   *
   *  See secrets.rs for the desktop's side of the same three calls, and keys.ts in
   *  the app, which is what chooses between them. */
  private val secrets: SharedPreferences by lazy {
    EncryptedSharedPreferences.create(
      this,
      "nib-secrets",
      MasterKey.Builder(this).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
      EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
      EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )
  }

  /** Runs a line in the page, on the thread a webview may be touched from. */
  private fun tell(script: String) {
    val webView = page ?: return
    webView.post { webView.evaluateJavascript(script, null) }
  }

  /** What the recogniser heard, or what it is doing; see mobile/dictation.ts. */
  fun heard(json: String) {
    tell("window.__nibHeard?.(${JSONObject.quote(json)})")
  }

  /** The microphone, asked for the first time dictation is turned on. The old
   *  call rather than a result contract: the webview registers its own contracts
   *  as it is built, and registering another one this late throws. */
  fun askForTheMicrophone() {
    runOnUiThread { requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), MICROPHONE) }
  }

  override fun onRequestPermissionsResult(
    requestCode: Int,
    permissions: Array<out String>,
    grantResults: IntArray,
  ) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    if (requestCode != MICROPHONE) return

    val granted =
      grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
    dictation.allowedNow(granted)
  }

  /** What the page cannot see for itself: the window's own edges, what another app
   *  handed over, what the home screen asked for, and the phone's recogniser. */
  private inner class Bridge {
    @JavascriptInterface fun insets(): String = edges

    /** Says this launch's word, into the page itself. Whoever called it, the answer
     *  goes to the main frame - which is what makes it a word only the page has;
     *  see `frame`. */
    @JavascriptInterface
    fun askForTheFrame() {
      tell("window.__nibFrame?.(${JSONObject.quote(frame)})")
    }

    /** The key kept under `name`, or null where there is none - and null for
     *  anybody who is not the page; see `frame`. */
    @JavascriptInterface
    fun secretRead(said: String, name: String): String? =
      if (said == frame) secrets.getString(name, null) else null

    /** Writes one, replacing whatever was there. */
    @JavascriptInterface
    fun secretWrite(said: String, name: String, secret: String) {
      if (said != frame) return
      secrets.edit().putString(name, secret).apply()
    }

    /** Takes one away. */
    @JavascriptInterface
    fun secretForget(said: String, name: String) {
      if (said != frame) return
      secrets.edit().remove(name).apply()
    }

    /** The clock, the battery and the gesture bar are the system's own icons
     *  drawn over our page: light on a dark theme, dark on a light one. Called
     *  on the webview's thread, so the window is touched on the UI one. */
    @JavascriptInterface
    fun bars(dark: Boolean) {
      val window = this@MainActivity.window
      window.decorView.post {
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        controller.isAppearanceLightStatusBars = !dark
        controller.isAppearanceLightNavigationBars = !dark
      }
    }

    /** A tile or a widget row, once. Cleared as it is read, so the same press
     *  cannot be answered twice. */
    @JavascriptInterface
    fun handed(): String {
      val json = JSONObject()
      json.put("command", command)
      json.put("open", opening)
      json.put("tick", ticking)
      json.put("tickSpace", tickingIn)
      command = ""
      opening = ""
      ticking = ""
      tickingIn = ""
      return json.toString()
    }

    /** What another app shared, without the bytes; see Shared.kt. */
    @JavascriptInterface fun shared(): String = if (Shared.waiting) Shared.json() else ""

    /** One slice of one shared file, as base64. */
    @JavascriptInterface
    fun sharedBytes(at: Int, offset: Int, length: Int): String = Shared.bytes(at, offset, length)

    /** The page has written what it was given, and the copies can go. */
    @JavascriptInterface
    fun sharedDone() {
      Shared.clear(this@MainActivity)
    }

    /** The rows the home screen draws, as JSON; see mobile/widgets.ts. */
    @JavascriptInterface
    fun widgets(json: String) {
      WidgetNotes.write(this@MainActivity, json)
    }

    /** Whether this phone has a speech recogniser to dictate into. */
    @JavascriptInterface fun dictates(): Boolean = dictation.available()

    /** Turns dictation on or off; answers whether it is listening now. The word,
     *  because a microphone is not a thing a framed page turns on; see `frame`. */
    @JavascriptInterface
    fun listen(said: String, on: Boolean): Boolean = said == frame && dictation.listen(on)
  }
}
