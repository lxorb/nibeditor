// A service worker under Manifest V3. If this never runs, MV3 background pages do
// not work in this engine, and the content script below says so out loud: it asks
// the worker whether it is there and puts the answer in the marker a screenshot
// and a title read can both see.
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ installed: Date.now() })
})

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message === 'alive') reply({ worker: true, id: chrome.runtime.id })
  return true
})
