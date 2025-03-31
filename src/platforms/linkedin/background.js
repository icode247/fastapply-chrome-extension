const LinkedInJobApplyManager = {
  currentState: "idle",
  userId: null,
  targetTabId: null,

  async init() {
    chrome.runtime.onMessage.addListener(this.handleMessage.bind(this));
    console.log("LinkedIn Initialized!");
  },

  async handleMessage(request, sender, sendResponse) {
    try {
      switch (request.action) {
        case "HANDLE_EXTERNAL_APPLICATION":
          await this.handleExternalApplication(
            request.data,
            sender,
            sendResponse
          );
          break;
        case "navigateToJob":
          await chrome.tabs.update(sender.tab.id, { url: request.url });
          sendResponse({ status: "Navigation complete" });
          break;

        case "loginCompleted":
          await this.onLoginCompleted();
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
          try {
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
            } else {
              throw new Error("Failed to start job search");
            }
          } catch (error) {
            console.error("Error in startApplying:", error);
            sendResponse({
              status: "error",
              platform: "linkedin",
              message: "Failed to start job search: " + error.message,
            });
          }
          break;

        case "statusUpdate":
          sendResponse({
            status: request.status,
            message: request.message,
            action: request.action,
          });
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
    await chrome.tabs.update(tabId, { url: url });
    await this.waitForTabLoad(tabId);

    const result = await chrome.tabs.sendMessage(tabId, {
      action: "processJobs",
      userId: userId,
      jobsToApply: jobsToApply,
    });

    return result;
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

  async logExternalApplication(data) {
    // Add any LinkedIn-specific logging or tracking here
    console.log("External application detected:", {
      platform: "LinkedIn",
      url: data.url,
      jobDetails: data.jobDetails,
    });
  },
};

export { LinkedInJobApplyManager };
