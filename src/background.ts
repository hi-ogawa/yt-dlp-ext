chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: "index.html" });
});

// Inject Referer header for YouTube iframes embedded in the extension page.
// Chrome omits Referer from chrome-extension:// origins, causing YouTube to
// reject the embed with error 153 (embedder.identity.missing.referrer).
chrome.declarativeNetRequest.updateDynamicRules({
  removeRuleIds: [1],
  addRules: [
    {
      id: 1,
      priority: 1,
      action: {
        type: "modifyHeaders" as chrome.declarativeNetRequest.RuleActionType,
        requestHeaders: [
          {
            header: "referer",
            operation: "set" as chrome.declarativeNetRequest.HeaderOperation,
            value: "https://www.youtube.com",
          },
        ],
      },
      condition: {
        urlFilter: "||youtube.com/",
        initiatorDomains: [chrome.runtime.id],
        resourceTypes: [
          "sub_frame" as chrome.declarativeNetRequest.ResourceType,
        ],
      },
    },
  ],
});
