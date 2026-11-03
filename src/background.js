chrome.action.onClicked.addListener((tab) => {
  // A tab outside app.notion.com has no content script to receive the message.
  chrome.tabs.sendMessage(tab.id, 'toggle-panel').catch(() => {});
});
