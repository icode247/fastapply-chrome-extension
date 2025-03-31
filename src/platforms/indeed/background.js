import { getJobURL } from "@shared/utils";
import { STATE } from "@shared/constants";

const IndeedJobApplyManager = {
  currentState: "idle",
  userId: null,
  targetTabId: null,

  async init() {
    chrome.runtime.onInstalled.addListener(this.onInstalled.bind(this));
    chrome.runtime.onMessage.addListener(this.handleMessage.bind(this));
    chrome.runtime.onMessageExternal.addListener(this.handleMessage.bind(this));
  },

  onInstalled() {
    console.log("Indeed Job Application Assistant installed");
  },

  async handleMessage(request, sender, sendResponse) {
    console.log(request)
    try {
      switch (request.action) {
        case "processJobs":
          await chrome.tabs.sendMessage(sender.tab.id, {
            action: "processJobs",
            userId: request.userId,
            jobsToApply: request.jobsToApply,
          });
          sendResponse({ status: "processing" });
          break;

        case "navigateToSearch":
          await chrome.tabs.update(sender.tab.id, { url: request.url });
          break;

        case "searchCompleted":
          await this.applyFiltersAndProcessJobs(
            sender.tab.id,
            request.userId,
            request.jobsToApply
          );
          sendResponse({ status: "processing" });
          break;

        case "startApplying":
          try {
            console.log(request.country);
            const tab = await chrome.tabs.create({
              url: getJobURL(request.country),
            });

            // Use a more reliable way to wait for page load and message handling
            await new Promise((resolve, reject) => {
              const timeout = setTimeout(() => {
                reject(new Error("Tab load timeout"));
              }, 30000);

              const messageListener = async (message, sender) => {
                if (
                  sender.tab?.id === tab.id &&
                  message.action === "pageLoaded"
                ) {
                  clearTimeout(timeout);
                  chrome.runtime.onMessage.removeListener(messageListener);

                  try {
                    await chrome.tabs.sendMessage(tab.id, {
                      action: "startJobSearch",
                      userId: request.userId,
                      jobsToApply: request.jobsToApply,
                    });
                    resolve();
                  } catch (error) {
                    reject(error);
                  }
                }
              };

              chrome.runtime.onMessage.addListener(messageListener);
            });

            sendResponse({
              status: "started",
              platform: "indeed",
              message: "Job search process initiated",
              jobsToApply: request.jobsToApply,
            });
          } catch (error) {
            sendResponse({
              status: "error",
              platform: "indeed",
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

        case "startFormFill":
          try {
            // Get the current active tab since that's where the form is
            const [activeTab] = await chrome.tabs.query({
              active: true,
              currentWindow: true,
            });

            console.log("Active tab:", activeTab);
            if (!activeTab) {
              throw new Error("No active tab found");
            }

            // Send message to fill the form in the current tab
            await chrome.tabs.sendMessage(activeTab.id, {
              action: "fillApplicationForm",
              jobData: request.jobData,
            });

            sendResponse({
              status: "success",
              message: "Started form filling process",
              tabId: activeTab.id,
            });
          } catch (error) {
            console.error("Error starting form fill:", error);
            sendResponse({
              status: "error",
              message: error.message,
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

  async handleExternalMessage(request, sender, sendResponse) {
    console.log("Received external message:", request);

    const cleanupTab = async (tabId) => {
      try {
        await chrome.tabs.remove(tabId);
      } catch (error) {
        console.error("Error cleaning up tab:", error);
      }
    };

    if (request.action === "startApplying") {
      try {
        const tab = await chrome.tabs.create({
          url: getJobURL(request.country),
        });

        await new Promise((resolve) => {
          chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
            if (tabId === tab.id && info.status === "complete") {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          });
        });

        const response = await chrome.tabs.sendMessage(tab.id, {
          action: "startJobSearch",
          userId: request.userId,
          jobsToApply: request.jobsToApply,
        });

        if (response.status === "ready") {
          await chrome.tabs.update(tab.id, { url: response.url });

          await new Promise((resolve) => {
            chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
              if (tabId === tab.id && info.status === "complete") {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
              }
            });
          });

          await chrome.tabs.sendMessage(tab.id, {
            action: "processJobs",
            jobsToApply: request.jobsToApply,
          });

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
        console.error("Error in handleExternalMessage:", error);
        if (tab?.id) await cleanupTab(tab.id);

        sendResponse({
          status: "error",
          platform: "linkedin",
          message: "Failed to start job search: " + error.message,
        });
      }
    }
    console.log(getJobURL(request.country));
    if (
      request.action === "pageLoaded" &&
      request.url === getJobURL(request.country)
    ) {
      try {
        const tab = await chrome.tabs.create({
          url: getJobURL(request.country),
        });

        await new Promise((resolve) => {
          chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
            if (tabId === tab.id && info.status === "complete") {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          });
        });

        const response = await chrome.tabs.sendMessage(tab.id, {
          action: "startJobSearch",
          userId: request.userId,
          jobsToApply: request.jobsToApply,
        });

        if (response.status === "ready") {
          await chrome.tabs.update(tab.id, { url: response.url });

          await new Promise((resolve) => {
            chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
              if (tabId === tab.id && info.status === "complete") {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
              }
            });
          });

          await chrome.tabs.sendMessage(tab.id, {
            action: "processJobs",
            jobsToApply: request.jobsToApply,
          });

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
        console.error("Error in handleExternalMessage:", error);
        if (tab?.id) await cleanupTab(tab.id);

        sendResponse({
          status: "error",
          platform: "linkedin",
          message: "Failed to start job search: " + error.message,
        });
      }
    }

    if (request.action === "statusUpdate") {
      await chrome.tabs.sendMessage(tab.id, {
        action: "statusUpdate",
        status: request.status,
        message: request.message,
      });
    }

    return true;
  },

  async startJobSearchProcess() {
    this.currentState = STATE.CHECKING_LOGIN;
    const isLoggedIn = await this.checkLinkedInLogin();

    if (isLoggedIn) {
      await this.navigateToJobsPage();
    } else {
      await this.navigateToLoginPage();
    }
  },

  async navigateToJobsPage() {
    this.currentState = STATE.NAVIGATING_TO_JOBS;
    await this.updateOrCreateTab(getJobURL(request.country));
    await this.waitForTabLoad();
    await this.startApplying();
  },

  async navigateToJob(url) {
    await this.updateOrCreateTab(url);
    await this.waitForTabLoad();

    chrome.tabs.sendMessage(
      this.targetTabId,
      { action: "navigationComplete" },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error(
            "Error sending navigation complete message:",
            chrome.runtime.lastError
          );
        }
      }
    );
  },

  async updateOrCreateTab(url) {
    const MAX_RETRIES = 3;
    let attempts = 0;

    while (attempts < MAX_RETRIES) {
      try {
        return await new Promise((resolve, reject) => {
          if (this.targetTabId) {
            chrome.tabs.update(this.targetTabId, { url }, (tab) => {
              if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
              } else {
                resolve(tab);
              }
            });
          } else {
            chrome.tabs.create({ url }, (tab) => {
              if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
              } else {
                this.targetTabId = tab.id;
                resolve(tab);
              }
            });
          }
        });
      } catch (error) {
        attempts++;
        if (attempts === MAX_RETRIES) throw error;
        // Wait before retry
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  },

  async waitForTabLoad(tabId) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error("Tab load timeout"));
      }, 30000);

      const listener = (updatedTabId, info) => {
        if (updatedTabId === tabId && info.status === "complete") {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };

      chrome.tabs.onUpdated.addListener(listener);
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

  async startApplying() {
    this.currentState = STATE.APPLYING;
    chrome.tabs.sendMessage(this.targetTabId, {
      action: "startJobSearch",
      userId: this.userId,
    });
  },

  sendStatusToExternalApp(status, message) {
    console.log(`Sending status to external app: ${status} - ${message}`);
  },

  async applyFiltersAndProcessJobs(tabId, userId, jobsToApply) {
    try {
      await chrome.tabs.sendMessage(tabId, {
        action: "processJobs",
        userId: userId,
        jobsToApply: jobsToApply,
      });
    } catch (error) {
      console.error("Error in applyFiltersAndProcessJobs:", error);
      throw error;
    }
  },
};

export { IndeedJobApplyManager };
