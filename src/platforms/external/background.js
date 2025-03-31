// background.js
const CONFIG = {
  navigationTimeout: 60000,
  retryAttempts: 3,
  retryDelay: 1000,
  buttonClickTimeout: 5000,
  API_HOST: "http://localhost:3000",
};

class TabManager {
  constructor() {
    this.activeTabs = new Map();
    this.setupTabListeners();
  }

  setupTabListeners() {
    chrome.tabs.onRemoved.addListener((tabId) => {
      this.activeTabs.delete(tabId);
    });
  }

  async createTab(url) {
    const tab = await chrome.tabs.create({ url });
    return this.trackTab(tab);
  }

  trackTab(tab) {
    this.activeTabs.set(tab.id, {
      url: tab.url,
      startTime: Date.now(),
    });
    return tab;
  }

  async closeTab(tabId) {
    if (this.activeTabs.has(tabId)) {
      await chrome.tabs.remove(tabId);
      this.activeTabs.delete(tabId);
    }
  }

  async waitForTabLoad(tabId) {
    return new Promise((resolve) => {
      const listener = (updatedTabId, info) => {
        if (updatedTabId === tabId && info.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
  }
}

class ExternalJobApplyManager {
  static instance = null;
  static isInitialized = false;

  constructor() {
    if (ExternalJobApplyManager.instance) {
      return ExternalJobApplyManager.instance;
    }
    this.tabManager = new TabManager();
    this.currentApplications = new Map();
    ExternalJobApplyManager.instance = this;
  }

   async initialize() {
    if (this.isInitialized) return;

    try {
      this.instance = new ExternalJobApplyManager();
      this.instance.setupMessageListeners();
      this.isInitialized = true;
    } catch (error) {
      console.error("Failed to initialize ExternalJobApplyManager:", error);
      this.isInitialized = false;
      throw error;
    }
  }

  setupMessageListeners() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (
        message.type === "START_EXTERNAL_APPLICATION" ||
        message.platform === "linkedin"
      ) {
        this.handleMessage(message, sender, sendResponse);
        return true;
      }
    });
  }

  async handleMessage(message, sender, sendResponse) {
    console.log("ExternalJobApplyManager handling message:", message);

    try {
      switch (message.type) {
        case "START_EXTERNAL_APPLICATION":
          const result = await this.handleExternalApplication(
            message.data,
            sender
          );
          sendResponse(result);
          break;

        case "APPLICATION_STATUS":
          await this.handleApplicationStatus(message.data, sender.tab?.id);
          break;

        default:
          console.warn(`Unknown message type: ${message.type}`);
          sendResponse({ success: false, error: "Unknown message type" });
      }
    } catch (error) {
      console.error("Message handling error:", error);
      sendResponse({ success: false, error: error.message });
    }
  }

  async handleExternalApplication(data, sender) {
    try {
      console.log("Handling external application", data);
      this.validateApplicationData(data);

      const tab = data.newTab;
      this.currentApplications.set(tab.id, {
        startTime: Date.now(),
        platform: data.platform,
        originalTab: data.originalTab,
        jobDetails: data.jobDetails,
      });

      await this.initializeAutomation(tab.id, {
        userId: data.userId,
        jobDetails: data.jobDetails,
        platform: data.platform,
      });

      return {
        success: true,
        message: "External application initiated",
        tabId: tab.id,
      };
    } catch (error) {
      console.error("External application error:", error);
      return { success: false, error: error.message };
    }
  }
  // Add method to handle cleanup and return to original platform
  async handleApplicationCompletion(tabId, status) {
    const applicationData = this.currentApplications.get(tabId);
    if (!applicationData) return;

    const { platform, originalTab } = applicationData;

    // Notify original platform of completion
    if (originalTab) {
      await chrome.tabs.sendMessage(originalTab.id, {
        action: "EXTERNAL_APPLICATION_COMPLETED",
        status: status,
        platform: platform,
      });
    }

    // Cleanup
    await this.cleanup(tabId);
  }

  validateApplicationData(data) {
    const required = ["url", "userId"];
    const missing = required.filter((field) => !data[field]);
    if (missing.length > 0) {
      throw new Error(`Missing required fields: ${missing.join(", ")}`);
    }
  }

  async initializeAutomation(tabId, data) {
    // Add timeout to wait for content script
    const timeout = CONFIG.navigationTimeout;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        const response = await chrome.tabs.sendMessage(tabId, {
          type: "INIT_AUTOMATION",
          data: {
            userId: data.userId,
            host: CONFIG.API_HOST,
            config: CONFIG,
          },
        });

        if (response?.success) {
          return;
        }
      } catch (error) {
        // If content script isn't ready yet, wait and retry
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }
    }

    throw new Error(
      "Failed to initialize automation: Content script not ready"
    );
  }

  async processApplication(tabId, data) {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "PROCESS_APPLICATION",
      data: {
        jobDetails: data.jobDetails,
        config: CONFIG,
      },
    });

    if (!response?.success) {
      throw new Error(response?.error || "Application process failed");
    }

    return response.data;
  }
  async handleApplicationStatus(statusData, tabId) {
    const application = this.currentApplications.get(tabId);
    if (!application) return;

    // Update application status
    application.status = statusData;

    // Relay status to main application
    chrome.runtime.sendMessage({
      type: "EXTERNAL_APPLICATION_STATUS",
      data: {
        tabId,
        ...statusData,
      },
    });

    // If application is complete, cleanup
    if (this.isApplicationComplete(statusData)) {
      await this.cleanup(tabId);
    }
  }

  isApplicationComplete(status) {
    return status.success || (status.error && !status.retryable);
  }

  async cleanup(tabId) {
    try {
      await this.tabManager.closeTab(tabId);
    } finally {
      this.currentApplications.delete(tabId);
    }
  }

  isValidExternalSender(sender) {
    // Add your external sender validation logic here
    const allowedOrigins = ["https://yourapp.com", "http://localhost:3000"];
    return allowedOrigins.includes(sender.origin);
  }
}

export { ExternalJobApplyManager };
