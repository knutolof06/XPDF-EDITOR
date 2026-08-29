// Manifest V3 Background Service Worker
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({
    url: 'index.html',
  });
});

chrome.runtime.onInstalled.addListener((details: chrome.runtime.InstalledDetails) => {
  if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
    chrome.tabs.create({
      url: 'index.html',
    });
  }
});
