const LinkedInJobApplyManager = {
  STATE: {
    IDLE: "idle",
    NAVIGATING_TO_JOBS: "navigating_to_jobs",
    APPLYING: "applying",
  },

  currentState: "idle",
  userId: null,
  targetTabId: null,
  webAppUrl: "http://localhost:3000",

  async init() {
    chrome.runtime.onInstalled.addListener(() =>
      console.log("LinkedIn Job Application Assistant installed")
    );
    chrome.runtime.onMessage.addListener(this.handleMessage.bind(this));
    chrome.runtime.onMessageExternal.addListener(this.handleMessage.bind(this));
    chrome.action.onClicked.addListener(() =>
      chrome.tabs.create({ url: this.webAppUrl })
    );
  },

  async handleMessage(request, sender, sendResponse) {
    try {
      switch (request.action) {
        case "startJobSearch":
          await this.navigateAndProcessJobs(
            request.url,
            request.userId,
            this.targetTabId,
            request.jobsToApply
          );
          sendResponse({ status: "ready" });
          break;

        case "navigateToJob":
          await chrome.tabs.update(sender.tab.id, { url: request.url });
          sendResponse({ status: "Navigation complete" });
          break;

        case "storeUserDetails":
          chrome.storage.local.set({ userDetails: request.userDetails }, () => {
            sendResponse({ success: true });
          });
          break;

        case "getUserDetails":
          chrome.storage.local.get(["userDetails"], (result) => {
            sendResponse({ userDetails: result.userDetails || null });
          });
          break;

        case "startApplying":
          const tab = await chrome.tabs.create({
            url: "https://www.linkedin.com/jobs/",
          });
          await this.waitForTabLoad(tab.id);

          const response = await chrome.tabs.sendMessage(tab.id, {
            action: "startJobSearch",
            userId: request.userId,
            jobsToApply: request.jobsToApply,
          });

          if (response.status === "ready") {
            await this.navigateAndProcessJobs(
              response.url,
              response.userId,
              tab.id,
              request.jobsToApply
            );
            sendResponse({
              status: "started",
              platform: "linkedin",
              message: "Job search process initiated",
              jobsToApply: request.jobsToApply,
            });
          }
          break;

        default:
          sendResponse({ status: "error", message: "Unknown action" });
      }
    } catch (error) {
      console.error("Error in handleMessage:", error);
      sendResponse({ status: "error", message: error.message });
    }
    return true;
  },

  async navigateAndProcessJobs(url, userId, tabId, jobsToApply) {
    await chrome.tabs.update(tabId, { url });
    await this.waitForTabLoad(tabId);
    return chrome.tabs.sendMessage(tabId, {
      action: "processJobs",
      userId,
      jobsToApply,
    });
  },

  async waitForTabLoad(tabId) {
    return new Promise((resolve) => {
      chrome.tabs.onUpdated.addListener(function listener(updatedTabId, info) {
        if (updatedTabId === tabId && info.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      });
    });
  },
};

LinkedInJobApplyManager.init();
