importScripts('notion-api.js');

const UNREAD_ALARM = 'unread-count';
const BADGE_COLOR = '#2383e2';

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR }).catch(console.error);
chrome.alarms.get(UNREAD_ALARM).then((alarm) => alarm ?? chrome.alarms.create(UNREAD_ALARM, { periodInMinutes: 1 }));

chrome.alarms.onAlarm.addListener(async ({ name }) => {
  if (name !== UNREAD_ALARM) {
    return;
  }
  const { spaceId } = await chrome.storage.local.get('spaceId');
  if (spaceId) {
    await NotionTweaksApi.updateUnreadCount(spaceId).catch(console.error);
  }
});
