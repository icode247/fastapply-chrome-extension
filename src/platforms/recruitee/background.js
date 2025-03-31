import { STATE } from "@shared/constants";

const RecruiteeJobApplyManager = {
  currentState: "idle",
  userId: null,
  targetTabId: null,
  windowId: null,

  async init() {
    console.log("Recruitee Job Application Manager initialized");
    return this;
  },

  async cleanup() {
    if (this.windowId) {
      try {
        await chrome.windows.remove(this.windowId);
      } catch (error) {
        console.error("Error cleaning up Recruitee window:", error);
      }
      this.windowId = null;
    }
    this.targetTabId = null;
    this.currentState = "idle";
  },

  async handleMessage(request, sender, sendResponse) {
    console.log("Recruitee handler received message:", request);

    try {
      switch (request.action) {
        case "startApplying":
          await this.startJobApplicationProcess(request, sendResponse);
          break;

        case "navigationComplete":
          if (sender.tab?.id === this.targetTabId) {
            sendResponse({ status: "success" });
          }
          break;

        case "statusUpdate":
          // Forward status updates to web app if needed
          sendResponse({ status: "success" });
          break;

        case "processJobs":
          if (sender.tab?.id === this.targetTabId) {
            await chrome.tabs.sendMessage(this.targetTabId, {
              action: "processJobs",
              userId: request.userId,
              jobsToApply: request.jobsToApply,
            });
            sendResponse({ status: "processing" });
          }
          break;

        default:
          console.log(
            "Unhandled message type in Recruitee handler:",
            request.action
          );
          sendResponse({ status: "error", message: "Unsupported action" });
      }
    } catch (error) {
      console.error("Error in Recruitee handler:", error);
      sendResponse({ status: "error", message: error.message });
    }

    return true;
  },

  async startJobApplicationProcess(request, sendResponse) {
    try {
      this.userId = request.userId;
      this.currentState = STATE.NAVIGATING_TO_JOBS;

      // Create a new window for the job application process
      const window = await chrome.windows.create({
        url: this.getSearchUrl(request),
        type: "normal",
        state: "maximized",
      });

      this.windowId = window.id;
      this.targetTabId = window.tabs[0].id;

      // Wait for the page to load
      await new Promise((resolve) => {
        const listener = (tabId, changeInfo) => {
          if (tabId === this.targetTabId && changeInfo.status === "complete") {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
      });

      // Send initialization message to the content script
      await chrome.tabs.sendMessage(this.targetTabId, {
        action: "initializeSearch",
        userId: request.userId,
        jobsToApply: request.jobsToApply,
      });

      sendResponse({
        status: "started",
        platform: "recruitee",
        message: "Job search process initiated on Recruitee",
        jobsToApply: request.jobsToApply,
      });
    } catch (error) {
      console.error("Error starting Recruitee job application process:", error);

      // Clean up in case of error
      if (this.windowId) {
        try {
          await chrome.windows.remove(this.windowId);
        } catch (e) {
          console.error("Error cleaning up window:", e);
        }
        this.windowId = null;
      }

      sendResponse({
        status: "error",
        platform: "recruitee",
        message: "Failed to start job search: " + error.message,
      });
    }
  },

  getSearchUrl(request) {
    // Build search URL for Recruitee
    let query = `site:recruitee.com ${request.jobTitle || ""}`;

    if (request.location) {
      query += ` ${request.location}`;
    }

    if (request.remote) {
      query += " Remote";
    }

    return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  },

  async navigateToJob(url) {
    if (!this.targetTabId) {
      throw new Error("No active tab available");
    }

    await chrome.tabs.update(this.targetTabId, { url });

    // Wait for navigation to complete
    await new Promise((resolve) => {
      const listener = (tabId, changeInfo) => {
        if (tabId === this.targetTabId && changeInfo.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });

    await chrome.tabs.sendMessage(this.targetTabId, {
      action: "navigationComplete",
    });
  },
};

export { RecruiteeJobApplyManager };
