const TOGGLE_PANEL = 'toggle-panel';
const NOTION_ORIGIN = 'https://app.notion.com/';
const CONTENT_SCRIPTS = ['src/grouping.js', 'src/notion-api.js', 'src/panel.js', 'src/content.js'];

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.url?.startsWith(NOTION_ORIGIN)) {
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, TOGGLE_PANEL);
  } catch {
    // A tab opened before the extension loaded has no content script yet.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_SCRIPTS });
    await chrome.tabs.sendMessage(tab.id, TOGGLE_PANEL);
  }
});
