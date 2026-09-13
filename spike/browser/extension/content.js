// The one thing a screenshot and a title read can both see. A content script that
// ran means the extension was loaded, matched the page, and was allowed to inject -
// which is the whole of what the spike has to prove about extensions.
document.title = `NIB-EXTENSION-OK ${document.title}`

const mark = document.createElement('div')
mark.id = 'nib-spike-extension-marker'
mark.textContent = 'nib spike probe: content script ran'
mark.style.cssText =
  'position:fixed;inset:0 0 auto 0;z-index:2147483647;background:#0a7;color:#fff;font:14px system-ui;padding:8px'

const put = () => document.documentElement.appendChild(mark)
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', put)
else put()

chrome.runtime.sendMessage('alive', (answer) => {
  if (answer && answer.worker) mark.textContent += ` - worker ${answer.id}`
})
