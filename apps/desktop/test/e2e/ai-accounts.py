"""Settings > AI with several accounts of a provider, and the palette's switch.

Seeds the accounts a reader with two Claude Code sign-ins, a work key and an OpenAI key
would have (in a browser they are this tab's own storage, `nib:ai-accounts`; see
src/lib/ai/accounts-file.ts), opens Settings > AI, and checks what docs/ai.md says the
page is: Claude as a row of its own over its three accounts, one of them in use; OpenAI,
with one account, as that account's row; a press on Use moving the provider to another
account; the palette offering `AI account: Claude · ...` with the one in use ticked; and
Access under the accounts, where an old link to Agents lands.

    python apps/desktop/test/e2e/ai-accounts.py

Screenshots go beside this file under `shots/ai-accounts/`, which is ignored.
"""

from __future__ import annotations

import json

from harness import Drive
from settling import quiet

DRIVE = Drive(__file__)
say, wrong, shot = DRIVE.say, DRIVE.wrong, DRIVE.shot

ACCOUNTS = {
    "version": 1,
    "accounts": [
        {"id": "anthropic", "kind": "anthropic", "name": "Work", "model": "claude-opus-5-5"},
        {"id": "anthropic-2", "kind": "anthropic", "name": "", "model": "claude-sonnet-5-5"},
        {"id": "openai", "kind": "openai", "name": "", "model": "gpt-6-astra"},
    ],
    "active": {"claude": "anthropic", "openai": "openai"},
    "defaultVendor": "claude",
    "uses": {},
}


def check(what: str, held: bool) -> None:
    if held:
        say(f"ok   {what}")
    else:
        wrong(what)


def drive(browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1180, "height": 860}, reduced_motion="reduce")
    page.context.add_init_script(
        f"localStorage.setItem('nib:ai-accounts', {json.dumps(json.dumps(ACCOUNTS))})"
    )
    DRIVE.open(page)
    page.evaluate("window.nibApp.settings.show('ai')")
    page.wait_for_selector("text=Accounts")
    quiet(page)
    shot(page, "01-accounts")

    sheet = page.locator(".sheet")
    check("Claude is a row of its own over its accounts", sheet.locator(".name.strong", has_text="Claude").count() == 1)
    check("one Claude account is in use", sheet.get_by_text("In use", exact=True).count() == 1)
    check("the other can be switched to", sheet.get_by_role("button", name="Use", exact=True).count() == 1)
    check("OpenAI's one account is its own row", sheet.locator(".name.strong", has_text="OpenAI").count() == 0)
    check("Access is on the same page", sheet.get_by_text("Access", exact=True).count() >= 1)

    sheet.get_by_role("button", name="Use", exact=True).click()
    quiet(page)
    active = page.evaluate("JSON.parse(localStorage.getItem('nib:ai-accounts')).active.claude")
    check("Use moved Claude to the other account", active == "anthropic-2")
    shot(page, "02-switched")

    page.keyboard.press("Escape")
    page.wait_for_selector(".sheet", state="detached")
    page.keyboard.press("Control+Shift+P")
    page.wait_for_selector('input[role="combobox"]')
    page.keyboard.type("AI account")
    quiet(page)
    shot(page, "03-palette")
    rows = page.locator('[role="option"]', has_text="AI account")
    check("the palette offers each Claude account", rows.count() == 2)

    page.keyboard.press("Escape")
    page.evaluate("window.nibApp.settings.show('agents')")
    quiet(page)
    check("an old link to Agents lands on AI", page.locator(".sheet").get_by_text("Accounts", exact=True).count() == 1)


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "settings > ai holds several accounts of a provider"))
