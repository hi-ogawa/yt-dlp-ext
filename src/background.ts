chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: "https://yt-dlp-ext.hiro18181.workers.dev/" });
});
