const rulesInput = document.getElementById('rules');
const saveStatus = document.getElementById('status');
const errorList = document.getElementById('errors');

chrome.storage.sync.get('rulesText').then(({ rulesText = '' }) => {
  rulesInput.value = rulesText;
});

document.getElementById('save').addEventListener('click', async () => {
  const { errors } = NotionTweaksGrouping.parseRules(rulesInput.value);
  errorList.replaceChildren(
    ...errors.map(({ line, reason }) => Object.assign(document.createElement('li'), { textContent: `Line ${line}: ${reason}` })),
  );
  if (errors.length) {
    saveStatus.textContent = 'Not saved.';
    return;
  }
  try {
    await chrome.storage.sync.set({ rulesText: rulesInput.value });
    saveStatus.textContent = 'Saved.';
  } catch (error) {
    saveStatus.textContent = `Not saved: ${error.message}`;
  }
});
