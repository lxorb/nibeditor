# Captures a running window to a PNG. Used by `nib screenshot` and to eyeball the real
# app during development.
#
# Three things it is careful about, and each of them was wrong before:
#
#   - WHICH window. A pid, and nothing else. `-Pid` (spelled `-ProcessId` as well) is
#     the process to photograph, and every caller has one: `nib screenshot` passes the
#     pid the app wrote beside its port, and a drive passes the pid of the app it
#     launched - so the window that answered the request is the window in the picture.
#     A name used to be taken as a fallback, and it photographed somebody's own browser
#     window: a machine that is building nib has several processes called nib, and
#     Windows lists whichever it lists. A picture of the wrong window is worse than no
#     picture - it can hold a stranger's screen and nothing in the file says it is not
#     ours - so a name is refused outright rather than guessed from.
#   - WHAT is in it. `PrintWindow` with `PW_RENDERFULLCONTENT` asks the window to draw
#     itself, so what lands in the file is the window and not the screen in front of it:
#     a menu, a notification or another app over the corner used to be part of the
#     picture. Windows enumerates top-level windows rather than trusting
#     MainWindowHandle, which an undecorated Tauri window is often not.
#   - WHOSE keyboard. Nothing is raised, focused or moved. The old version called
#     SetForegroundWindow and waited 700ms for it, which took the keyboard away from
#     whatever somebody was typing in - a screenshot is a question, not an interruption.
param(
  [Alias('Pid')]
  [int]$ProcessId = 0,
  [string]$Out = "$env:TEMP\nib-window.png",
  [switch]$ListOnly
)

# One sentence, and a non-zero exit. Said before anything is loaded, because the
# alternative to stopping here is a photograph of a window nobody asked for.
if ($ProcessId -le 0) {
  [Console]::Error.WriteLine('capture-window.ps1 needs -Pid <process id>: a window is photographed by pid, never by name.')
  exit 2
}

Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class NibCapture {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  public delegate bool EnumProc(IntPtr hWnd, IntPtr param);

  // Draw everything, including what the window composites for itself. Without this a
  // webview's own content comes back blank, because a DirectComposition surface is not
  // part of what a window paints on request.
  public const int PW_RENDERFULLCONTENT = 2;

  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr param);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, int flags);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int count);

  public static List<string> Windows(uint pid) {
    var found = new List<string>();
    EnumWindows((hWnd, param) => {
      uint owner;
      GetWindowThreadProcessId(hWnd, out owner);
      if (owner != pid) return true;

      RECT r;
      GetWindowRect(hWnd, out r);
      var title = new StringBuilder(256);
      GetWindowTextW(hWnd, title, title.Capacity);
      found.Add(string.Format("{0}|{1}|{2}|{3}|{4}|{5}|{6}|{7}",
        hWnd.ToInt64(), IsWindowVisible(hWnd), r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top,
        IsIconic(hWnd), title));
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@

# The process the caller named. A pid nothing answers to is a window that has closed,
# which is an error rather than a reason to look for another one.
$process = Get-Process -Id $ProcessId -ErrorAction Stop

$rows = [NibCapture]::Windows($process.Id) | ForEach-Object {
  $parts = $_ -split '\|'
  [pscustomobject]@{
    Handle    = [int64]$parts[0]
    Visible   = [bool]::Parse($parts[1])
    X         = [int]$parts[2]
    Y         = [int]$parts[3]
    Width     = [int]$parts[4]
    Height    = [int]$parts[5]
    Minimized = [bool]::Parse($parts[6])
    Title     = $parts[7]
  }
}

if ($ListOnly) { return $rows | Sort-Object -Property Width -Descending }

# The window worth photographing: visible, not minimised, sizeable, and with a title.
# This process owns more than one - the single instance plugin keeps a 13 by 13 listener
# with a title of its own, and there is an unnamed one beside it - so size decides among
# the ones that are windows at all.
$target = $rows |
  Where-Object { $_.Visible -and -not $_.Minimized -and $_.Width -gt 200 -and $_.Height -gt 200 } |
  Sort-Object -Property Width -Descending |
  Select-Object -First 1

if (-not $target) { throw "no sizeable visible window for process $($process.Id)" }

$handle = [IntPtr]$target.Handle

$rect = New-Object NibCapture+RECT
[void][NibCapture]::GetWindowRect($handle, [ref]$rect)
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top

$bitmap = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$hdc = $graphics.GetHdc()
$drew = [NibCapture]::PrintWindow($handle, $hdc, [NibCapture]::PW_RENDERFULLCONTENT)
$graphics.ReleaseHdc($hdc)

if (-not $drew) {
  $graphics.Dispose()
  $bitmap.Dispose()
  throw "window $($target.Handle) would not draw itself"
}

$bitmap.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()

Write-Output "$Out ${width}x${height} pid $($process.Id)"
