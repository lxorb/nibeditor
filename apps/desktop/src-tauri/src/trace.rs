//! Where a launch spent its time, in milliseconds, on the machine that is slow.
//!
//! A launch is the one thing about this app that cannot be measured anywhere but
//! on the machine complaining about it: the disk, the antivirus and the webview
//! runtime are the three biggest terms in it and none of the three is in this
//! repository. So the app can say it itself. Set `NIB_TRACE_STARTUP` and one file
//! appears in the log folder with every step of the launch on it, from before the
//! first line of our own code ran to the moment the window has nothing left to do.
//!
//! Off by default and free when it is off: one environment read, and a `mark`
//! that returns without locking anything. Nothing here is behind a compile-time
//! feature on purpose - a switch that has to be built specially is a switch that
//! is not there when the launch that is slow happens.
//!
//! Two clocks, one axis. This side counts from an `Instant` taken as the app
//! starts; the window counts from its own `performance.timeOrigin`, which is when
//! the webview began loading the page and is a different zero. Both are written
//! down against the wall clock as well, so the window's marks are placed on this
//! side's axis rather than printed as a second list nobody can line up with the
//! first; see `offset`.
//!
//! The step nothing in the process can time is the one before it: Windows loading
//! the image, mapping the runtime and - on a binary it has not seen before, which
//! every auto-update makes - letting Defender read all of it. `GetProcessTimes`
//! says when the process was created, and the first line below subtracts. A launch
//! whose whole cost is in that first row is not a launch this code can make faster.

use std::fmt::Write as _;
use std::fs;
use std::io::Write as _;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};
use tauri::AppHandle;

use crate::clock;
use crate::paths::log_dir;

/// The variable that turns this on. Any value but `0`, because somebody who wrote
/// `NIB_TRACE_STARTUP=0` meant off.
const SWITCH: &str = "NIB_TRACE_STARTUP";

/// What the file is called. Beside the app's own log rather than in it: a launch
/// trace is one launch and several screens of it, and a log somebody is reading
/// for an error should not have this in the middle of it.
const FILE: &str = "startup-trace.log";

/// Anything past this and the file starts again. A trace is read once and a
/// person who forgot to turn the switch off should not find a full disk.
const MAX_BYTES: u64 = 512 * 1024;

/// How wide the step column is written, so the numbers line up down the page.
const COLUMN: usize = 34;

/// Whether anything here does anything at all.
static ON: LazyLock<bool> = LazyLock::new(|| {
    std::env::var_os(SWITCH).is_some_and(|value| !value.is_empty() && value != "0")
});

/// Our own first line, and the same moment on the wall clock. Taken together and
/// once, because the window's marks are placed against the second of them and a
/// second reading would be a second zero.
static STARTED: LazyLock<(Instant, u64)> = LazyLock::new(|| (Instant::now(), clock::now()));

/// How long the machine spent on this process before that: loading the image,
/// mapping the webview runtime and letting whatever scans a new binary read it.
///
/// The zero of the axis, rather than a row on an axis of its own. Somebody waited
/// through this as surely as through the rest, so every step below is placed after
/// it - which is also what makes the column that says how long each step took read
/// as what it says: an axis starting at our first line puts the machine's own row
/// in the middle of the page and takes its time out of the step that follows it.
static BEFORE: LazyLock<Duration> = LazyLock::new(|| before_main().unwrap_or(Duration::ZERO));

/// Every step so far, in the order it happened.
static MARKS: Mutex<Vec<Mark>> = Mutex::new(Vec::new());

/// One step: what it was, how long after the app started it happened, and how much
/// processor this process had spent by then.
///
/// The processor time is the number worth comparing. Wall-clock says what somebody
/// waited through, which is the question - but it also says what every other
/// program on the machine was doing at the time, and a launch measured beside seven
/// other builds is a launch measured against those builds. User plus kernel time is
/// this process's own work and nothing else's, so it is the same number on a quiet
/// machine as on a loaded one, and it is what says whether a change made the app do
/// less. `None` for a step the window timed: the window's clock is its own, and the
/// processor time of this process when its list arrived is not the processor time it
/// had reached at that step.
struct Mark {
    step: String,
    at: Duration,
    cpu: Option<Duration>,
}

/// A step the window timed, as it hands it over. `at` is milliseconds on the
/// window's own clock, which is not this side's; the command below is given the
/// one number that turns that clock into this one.
#[derive(serde::Deserialize)]
pub struct Said {
    step: String,
    at: f64,
}

/// Starts the clock, and writes down the one step that happened before it.
///
/// Called as the first thing the app does. Everything before this line belongs to
/// Windows rather than to us - loading the image, mapping the webview runtime,
/// and letting whatever scans a new binary read it - and on a machine that has
/// just auto-updated that is most of what somebody waited through.
pub fn begin() {
    if !on() {
        return;
    }

    let _ = *STARTED;
    if *BEFORE > Duration::ZERO {
        push("windows, before our first line", *BEFORE);
    }
    mark("app starting");
}

/// Whether the switch is on. Read by the one command below, so a window does not
/// send a list nothing is going to write.
pub fn on() -> bool {
    *ON
}

/// One step, now.
pub fn mark(step: &str) {
    if !on() {
        return;
    }

    push(step, along());
}

/// Where now is on the axis: what the machine did before our first line, and then
/// how long since it. See `BEFORE`.
fn along() -> Duration {
    BEFORE.saturating_add(STARTED.0.elapsed())
}

/// The file, as the trace stands. Written at every step that could be the last
/// one: a launch that wedges before the window is done still leaves what it got
/// through, which is the launch worth looking at.
pub fn write(app: &AppHandle) {
    if !on() {
        return;
    }

    let Ok(path) = file(app) else { return };
    if fs::metadata(&path).map_or(0, |one| one.len()) > MAX_BYTES {
        let _ = fs::remove_file(&path);
    }

    let Ok(marks) = MARKS.lock() else { return };
    let Ok(mut out) = fs::OpenOptions::new().create(true).append(true).open(&path) else {
        return;
    };
    let _ = out.write_all(page(&marks).as_bytes());
    let _ = out.write_all(line(&marks).as_bytes());
}

/// Where the file is, in a folder that exists by the time this returns.
fn file(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(log_dir(app)?.join(FILE))
}

/// The whole trace as it reads on the page: a line per step with the time it
/// happened and the time since the step before it, which is the column that says
/// where the launch actually went.
fn page(marks: &[Mark]) -> String {
    let mut out = format!(
        "\n=== nib {} launched {} ===\n",
        env!("CARGO_PKG_VERSION"),
        STARTED.1
    );

    let mut last = Duration::ZERO;
    let mut spent_by = Duration::ZERO;
    for mark in marks {
        let step = mark.step.chars().take(COLUMN).collect::<String>();
        let since = mark.at.saturating_sub(last);
        // And what the processor spent over the same step, which is the column that
        // means the same thing on a loaded machine. Blank for the window's own
        // steps; see `Mark`.
        let spent = match mark.cpu {
            Some(now) => {
                let over = now.saturating_sub(spent_by);
                spent_by = now;
                format!("{:>8.1} cpu", millis(over))
            }
            None => " ".repeat(12),
        };
        let _ = writeln!(
            out,
            "{step:<COLUMN$} {:>9.1} ms  +{:>8.1} ms  {spent}",
            millis(mark.at),
            millis(since)
        );
        last = mark.at;
    }

    out
}

/// The same trace as one line of JSON, so a check can read it.
///
/// A page is for a person and this is for a program: every number a speed run
/// reports, every budget a gate holds the launch to, and every before-and-after
/// table comes off this line rather than off somebody's reading of the page above.
/// One line, appended, so a file of several launches is several lines and the last
/// of them is the launch that just happened.
fn line(marks: &[Mark]) -> String {
    let mut out = format!(
        "{{\"nib\":\"{}\",\"launched\":{},\"steps\":[",
        env!("CARGO_PKG_VERSION"),
        STARTED.1
    );

    for (index, mark) in marks.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }

        // The step's name with the two characters JSON minds taken out rather than
        // escaped. Every step name is written in this crate and none of them holds
        // either; a hand-rolled escape is a bug waiting for the first one that does.
        let step = mark.step.replace(['\\', '"'], " ");
        let _ = write!(out, "{{\"step\":\"{step}\",\"at\":{:.1}", millis(mark.at));
        if let Some(over) = mark.cpu {
            let _ = write!(out, ",\"cpu\":{:.1}", millis(over));
        }
        out.push('}');
    }

    out.push_str("]}\n");
    out
}

/// A duration as the milliseconds a person reads.
fn millis(span: Duration) -> f64 {
    span.as_secs_f64() * 1000.0
}

/// Adds a step, and keeps the list in the order the steps happened: the window's
/// arrive last and belong in the middle.
fn push(step: &str, at: Duration) {
    push_with(step, at, cpu());
}

/// The same, for a step whose processor time is not ours to report.
fn push_said(step: &str, at: Duration) {
    push_with(step, at, None);
}

fn push_with(step: &str, at: Duration, cpu: Option<Duration>) {
    let Ok(mut marks) = MARKS.lock() else { return };

    let mark = Mark {
        step: step.to_owned(),
        at,
        cpu,
    };
    let place = marks.partition_point(|held| held.at <= mark.at);
    marks.insert(place, mark);
}

/// The window's own steps, put on this side's axis and written out with the rest.
///
/// A step the window timed is milliseconds since its `timeOrigin`, which is when
/// the webview started loading the page - some way into the launch on this side.
/// `origin` says where that was on the wall clock, so the difference against this
/// side's own zero is what turns one into the other.
#[tauri::command(async)]
pub fn trace_startup(app: AppHandle, origin: f64, steps: Vec<Said>) {
    if !on() {
        return;
    }

    let shift = offset(origin);
    for said in steps {
        let at = Duration::from_secs_f64(said.at.max(0.0) / 1000.0);
        // On the same axis as this side's own steps, which starts before our first
        // line rather than at it; see `BEFORE`.
        let at = at.saturating_add(shift).saturating_add(*BEFORE);
        push_said(&format!("window: {}", said.step), at);
    }

    write(&app);
}

/// How far into the launch the window's clock started, or nothing at all where
/// the two clocks disagree about which came first - a window whose origin reads
/// as before the process began is a clock that was stepped, and a negative shift
/// would put its steps above the first line of the app.
fn offset(origin: f64) -> Duration {
    if !origin.is_finite() || origin <= 0.0 {
        return Duration::ZERO;
    }

    // Both are milliseconds since the epoch; the window's is fractional.
    Duration::from_secs_f64(((origin - millis_since_epoch()) / 1000.0).max(0.0))
}

/// This side's zero on the wall clock, in the milliseconds the window counts in.
fn millis_since_epoch() -> f64 {
    #[allow(
        clippy::cast_precision_loss,
        reason = "a millisecond count this size is exact in an f64 for another 280,000 years"
    )]
    {
        STARTED.1 as f64
    }
}

/// How long the machine spent on this process before our own first line ran.
///
/// How much processor this process has spent, user and kernel together.
///
/// The load-independent half of the trace: wall-clock says what somebody waited
/// through and processor time says what the app actually did, and only the second
/// one means the same thing on a machine running seven other builds. Windows hands
/// both back from the same call `before_main` already makes.
#[cfg(windows)]
fn cpu() -> Option<Duration> {
    use windows::Win32::Foundation::FILETIME;
    use windows::Win32::System::Threading::{GetCurrentProcess, GetProcessTimes};

    /// Windows counts processor time in hundreds of nanoseconds.
    const PER_TICK: u32 = 100;

    let mut created = FILETIME::default();
    let mut exited = FILETIME::default();
    let mut kernel = FILETIME::default();
    let mut user = FILETIME::default();

    // SAFETY: the four are ours and outlive the call, and the handle is the
    // pseudo-handle for this process, which needs no closing. The call writes the
    // four and nothing else.
    #[allow(
        unsafe_code,
        reason = "there is no safe way to ask Windows how much processor this process has had"
    )]
    unsafe {
        GetProcessTimes(
            GetCurrentProcess(),
            std::ptr::from_mut(&mut created),
            std::ptr::from_mut(&mut exited),
            std::ptr::from_mut(&mut kernel),
            std::ptr::from_mut(&mut user),
        )
    }
    .ok()?;

    let ticks =
        |one: FILETIME| (u64::from(one.dwHighDateTime) << 32) | u64::from(one.dwLowDateTime);
    let spent = ticks(kernel).checked_add(ticks(user))?;

    Some(Duration::new(spent / 10_000_000, {
        #[allow(
            clippy::cast_possible_truncation,
            reason = "a remainder under ten million times a hundred is under a second of nanoseconds"
        )]
        {
            (spent % 10_000_000) as u32 * PER_TICK
        }
    }))
}

/// Nothing to say where the platform is not asked this way. The wall-clock half of
/// the trace still stands; only the column that does not move with the load is
/// missing.
#[cfg(not(windows))]
fn cpu() -> Option<Duration> {
    None
}

/// Windows says when the process was created and the clock above says when we
/// first looked, and the difference is the image being loaded, the webview runtime
/// being mapped and - on a binary the machine has not seen before - whatever reads
/// all of it first. Nothing to report on the platforms that do not make a person
/// wait for that.
#[cfg(windows)]
fn before_main() -> Option<Duration> {
    use std::time::{SystemTime, UNIX_EPOCH};
    use windows::Win32::Foundation::FILETIME;
    use windows::Win32::System::Threading::{GetCurrentProcess, GetProcessTimes};

    /// Windows counts from 1601 and in hundreds of nanoseconds; the epoch is this
    /// many of those along.
    const TO_EPOCH: u64 = 116_444_736_000_000_000;

    let mut created = FILETIME::default();
    let mut exited = FILETIME::default();
    let mut kernel = FILETIME::default();
    let mut user = FILETIME::default();

    // SAFETY: the four are ours and outlive the call, and the handle is the
    // pseudo-handle for this process, which needs no closing. The call writes the
    // four and nothing else. The pointers are taken by name rather than left to a
    // coercion, which is what `implicit borrow as raw pointer` is about.
    #[allow(
        unsafe_code,
        reason = "there is no safe way to ask Windows when this process was created"
    )]
    unsafe {
        GetProcessTimes(
            GetCurrentProcess(),
            std::ptr::from_mut(&mut created),
            std::ptr::from_mut(&mut exited),
            std::ptr::from_mut(&mut kernel),
            std::ptr::from_mut(&mut user),
        )
    }
    .ok()?;

    let ticks = (u64::from(created.dwHighDateTime) << 32) | u64::from(created.dwLowDateTime);
    let since = ticks.checked_sub(TO_EPOCH)?;
    let at = UNIX_EPOCH.checked_add(Duration::new(since / 10_000_000, {
        #[allow(
            clippy::cast_possible_truncation,
            reason = "a remainder under ten million times a hundred is under a second of nanoseconds"
        )]
        {
            (since % 10_000_000) as u32 * 100
        }
    }))?;

    SystemTime::now().duration_since(at).ok()
}

/// Nothing to say: the platforms that do not scan a new binary before running it
/// do not make anybody wait for one either.
#[cfg(not(windows))]
fn before_main() -> Option<Duration> {
    None
}

#[cfg(test)]
mod tests {
    use super::{line, millis, page, push, Mark, COLUMN, MARKS};
    use std::time::Duration;

    /// The marks are one list for the whole process, so a test that writes to them
    /// takes them back out again.
    fn only(marks: Vec<Mark>) -> String {
        with(marks, page)
    }

    /// The same, read as the one line a program reads.
    fn only_line(marks: Vec<Mark>) -> String {
        with(marks, line)
    }

    fn with(marks: Vec<Mark>, read: fn(&[Mark]) -> String) -> String {
        let mut held = MARKS.lock().expect("the marks");
        let before = std::mem::replace(&mut *held, marks);
        let written = read(&held);
        *held = before;
        written
    }

    #[test]
    fn a_duration_reads_as_milliseconds() {
        assert!((millis(Duration::from_millis(1500)) - 1500.0).abs() < 0.001);
        assert!((millis(Duration::ZERO)).abs() < 0.001);
    }

    #[test]
    fn every_step_says_how_long_since_the_one_before_it() {
        let written = only(vec![
            Mark {
                step: "first".to_owned(),
                at: Duration::from_millis(10),
                cpu: None,
            },
            Mark {
                step: "second".to_owned(),
                at: Duration::from_millis(45),
                cpu: None,
            },
        ]);

        assert!(written.contains("first"), "{written}");
        // The first step's gap is from zero, the second's is from the first.
        assert!(written.contains("10.0 ms  +    10.0 ms"), "{written}");
        assert!(written.contains("45.0 ms  +    35.0 ms"), "{written}");
    }

    #[test]
    fn a_long_step_name_cannot_push_the_numbers_out_of_line() {
        let written = only(vec![Mark {
            step: "x".repeat(COLUMN * 2),
            at: Duration::ZERO,
            cpu: None,
        }]);

        let line = written
            .lines()
            .find(|one| one.starts_with('x'))
            .expect("the step");
        assert_eq!(line.chars().filter(|one| *one == 'x').count(), COLUMN);
    }

    #[test]
    fn a_step_goes_in_where_it_happened_rather_than_at_the_end() {
        let mut held = MARKS.lock().expect("the marks");
        let before = std::mem::take(&mut *held);
        drop(held);

        push("late", Duration::from_millis(100));
        push("early", Duration::from_millis(5));
        push("between", Duration::from_millis(50));

        let mut held = MARKS.lock().expect("the marks");
        let order: Vec<&str> = held.iter().map(|one| one.step.as_str()).collect();
        assert_eq!(order, vec!["early", "between", "late"]);
        *held = before;
    }

    /// The line a check reads, which is the whole point of having one: every number
    /// in a speed report and every budget a gate holds the launch to comes off this
    /// rather than off somebody's reading of the page above it.
    #[test]
    fn the_line_is_json_a_program_can_read() {
        let written = only_line(vec![
            Mark {
                step: "app starting".to_owned(),
                at: Duration::ZERO,
                cpu: Some(Duration::from_millis(2)),
            },
            Mark {
                step: "window: first frame painted".to_owned(),
                at: Duration::from_millis(400),
                cpu: None,
            },
        ]);

        assert!(written.ends_with("]}\n"), "{written}");
        assert!(
            written.contains(r#""step":"app starting","at":0.0,"cpu":2.0"#),
            "{written}"
        );
        // A step the window timed has no processor time of ours to report, and says
        // nothing rather than nought: nought would read as "this cost nothing".
        assert!(
            written.contains(r#""step":"window: first frame painted","at":400.0}"#),
            "{written}"
        );
    }

    /// A step name with a quote in it would otherwise close the string it is in and
    /// leave a line no parser can read. None of them has one; this is the guard for
    /// the first one that does.
    #[test]
    fn a_quote_in_a_step_name_cannot_break_the_line() {
        let written = only_line(vec![Mark {
            step: "a \"quoted\" step".to_owned(),
            at: Duration::ZERO,
            cpu: None,
        }]);

        assert_eq!(written.matches('"').count() % 2, 0, "{written}");
        assert!(!written.contains('\\'), "{written}");
    }

    /// The processor column is the one that means the same thing on a loaded
    /// machine, so it says what each step spent rather than the running total.
    #[test]
    fn the_processor_column_is_what_each_step_spent() {
        let written = only(vec![
            Mark {
                step: "first".to_owned(),
                at: Duration::from_millis(10),
                cpu: Some(Duration::from_millis(8)),
            },
            Mark {
                step: "second".to_owned(),
                at: Duration::from_millis(45),
                cpu: Some(Duration::from_millis(30)),
            },
        ]);

        let second = written
            .lines()
            .find(|one| one.starts_with("second"))
            .unwrap_or_default();

        // Thirty less the eight already spent, not thirty.
        assert!(second.contains("22.0 cpu"), "{written}");
    }
}
