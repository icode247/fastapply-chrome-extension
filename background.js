const LinkedInJobApplyManager = {
  STATE: {
    IDLE: "idle",
    CHECKING_LOGIN: "checking_login",
    LOGGING_IN: "logging_in",
    NAVIGATING_TO_JOBS: "navigating_to_jobs",
    APPLYING: "applying",
  },

  currentState: "idle",
  userId: null,
  targetTabId: null,

  async init() {
    chrome.runtime.onInstalled.addListener(this.onInstalled.bind(this));
    chrome.runtime.onMessage.addListener(this.handleMessage.bind(this));
    chrome.runtime.onMessageExternal.addListener(this.handleMessage.bind(this));
  },

  onInstalled() {
    console.log("LinkedIn Job Application Assistant installed");
  },

  async handleMessage(request, sender, sendResponse) {
    console.log("Received message:", request);

    try {
      switch (request.action) {
        case "startJobSearch":
          this.userId = request.userId;
          const searchResult = await this.startJobSearch(this.userId);
          if (searchResult.status === "ready") {
            await this.navigateAndProcessJobs(
              searchResult.url,
              searchResult.userId
            );
          }
          sendResponse(searchResult);
          break;

        case "navigateToJob":
          await chrome.tabs.update(sender.tab.id, { url: request.url });
          sendResponse({ status: "Navigation complete" });
          break;

        case "loginCompleted":
          await this.onLoginCompleted();
          break;

        case "statusUpdate":
          this.sendStatusToExternalApp(request.status, request.message);
          break;

        case "storeUserDetails":
          try {
            chrome.storage.local.set(
              { userDetails: request.userDetails },
              () => {
                sendResponse({ success: true });
              }
            );
            console.log("saved user details");
          } catch (error) {
            console.log("error occured while storing user:", error);
          }
          break;

        case "getUserDetails":
          try {
            chrome.storage.local.get(["userDetails"], (result) => {
              sendResponse({ userDetails: result.userDetails || null });
            });
            console.log("fetched user details");
          } catch (error) {
            console.log("error occured while fetching user:", error);
          }
          break;

        case "startApplying":
          try {
            const tab = await chrome.tabs.create({
              url: "https://www.linkedin.com/jobs/",
            });

            // Wait for the tab to finish loading
            await this.waitForTabLoad(tab.id);

            // Now that the page is loaded, send a message to the content script
            const response = await chrome.tabs.sendMessage(tab.id, {
              action: "startJobSearch",
              userId: request.userId,
            });

            if (response.status === "ready") {
              await this.navigateAndProcessJobs(
                response.url,
                response.userId,
                tab.id
              );
              sendResponse({
                status: "started",
                platform: "linkedin",
                message: "Job search process initiated",
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

        default:
          sendResponse({ status: "error", message: "Unknown action" });
      }
    } catch (error) {
      console.error("Error in handleMessage:", error);
      sendResponse({ status: "error", message: error.message });
    }

    return true;
  },

  async navigateAndProcessJobs(url, userId, tabId) {
    // Navigate to the search URL
    await chrome.tabs.update(tabId, { url: url });

    // Wait for this page to load
    await this.waitForTabLoad(tabId);

    // Now we can start processing jobs
    const result = await chrome.tabs.sendMessage(tabId, {
      action: "processJobs",
      userId: userId,
    });

    return result;
  },
  async handleExternalMessage(request, sender, sendResponse) {
    console.log("Received external message:", request);

    if (request.action === "startApplying") {
      try {
        const tab = await chrome.tabs.create({
          url: "https://www.linkedin.com/jobs/",
        });

        // Wait for the tab to finish loading
        await new Promise((resolve) => {
          chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
            if (tabId === tab.id && info.status === "complete") {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          });
        });

        // Now that the page is loaded, send a message to the content script
        const response = await chrome.tabs.sendMessage(tab.id, {
          action: "startJobSearch",
          userId: request.userId,
        });

        if (response.status === "ready") {
          // Navigate to the search URL
          await chrome.tabs.update(tab.id, { url: response.url });

          // Wait for this page to load as well
          await new Promise((resolve) => {
            chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
              if (tabId === tab.id && info.status === "complete") {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
              }
            });
          });

          // Now we can start processing jobs
          await chrome.tabs.sendMessage(tab.id, { action: "processJobs" });

          sendResponse({
            status: "started",
            platform: "linkedin",
            message: "Job search process initiated",
          });
        } else {
          throw new Error("Failed to start job search");
        }
      } catch (error) {
        console.error("Error in handleExternalMessage:", error);
        sendResponse({
          status: "error",
          platform: "linkedin",
          message: "Failed to start job search: " + error.message,
        });
      }
    }

    return true;
  },

  async startJobSearchProcess() {
    this.currentState = this.STATE.CHECKING_LOGIN;
    const isLoggedIn = await this.checkLinkedInLogin();

    if (isLoggedIn) {
      await this.navigateToJobsPage();
    } else {
      await this.navigateToLoginPage();
    }
  },

  async checkLinkedInLogin() {
    return new Promise((resolve) => {
      chrome.cookies.get(
        { url: "https://www.linkedin.com", name: "li_at" },
        (cookie) => {
          resolve(!!cookie);
        }
      );
    });
  },

  async navigateToLoginPage() {
    this.currentState = this.STATE.LOGGING_IN;
    await this.updateOrCreateTab("https://www.linkedin.com/login");
  },

  async onLoginCompleted() {
    console.log("Login completed");
    await this.navigateToJobsPage();
  },

  async navigateToJobsPage() {
    this.currentState = this.STATE.NAVIGATING_TO_JOBS;
    await this.updateOrCreateTab("https://www.linkedin.com/jobs/");
    await this.waitForTabLoad();
    await this.startApplying();
  },

  async navigateToJob(url) {
    await this.updateOrCreateTab(url);
    await this.waitForTabLoad();

    // Send a message indicating navigation is complete
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
    return new Promise((resolve) => {
      if (this.targetTabId) {
        chrome.tabs.update(this.targetTabId, { url }, resolve);
      } else {
        chrome.tabs.create({ url }, (tab) => {
          this.targetTabId = tab.id;
          resolve(tab);
        });
      }
    });
  },

  // async waitForTabLoad() {
  //   return new Promise((resolve) => {
  //     chrome.tabs.onUpdated.addListener(
  //       function listener(tabId, info) {
  //         if (tabId === this.targetTabId && info.status === "complete") {
  //           chrome.tabs.onUpdated.removeListener(listener);
  //           resolve();
  //         }
  //       }.bind(this)
  //     );
  //   });
  // },

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
    this.currentState = this.STATE.APPLYING;
    chrome.tabs.sendMessage(this.targetTabId, {
      action: "startJobSearch",
      userId: this.userId,
    });
  },

  sendStatusToExternalApp(status, message) {
    // Implement the logic to send status updates to the Next.js app
    console.log(`Sending status to external app: ${status} - ${message}`);
    // You'll need to implement the actual communication with the Next.js app here
    // This could be done using chrome.runtime.sendMessage to a specific extension ID
    // or by making an HTTP request to your Next.js app's API endpoint
  },
};

LinkedInJobApplyManager.init();
