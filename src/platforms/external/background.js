// background.js

const CONFIG = {
  navigationTimeout: 60000,
  retryAttempts: 3,
  retryDelay: 1000,
  buttonClickTimeout: 5000,
  API_HOST: "http://localhost:3000",
  // Known job platforms we want to track redirections from
  jobPlatforms: [
    "linkedin.com",
    "indeed.com",
    "glassdoor.com",
    "monster.com",
    "ziprecruiter.com"
  ],
  // Platforms we don't want to run automation on directly
  excludedPlatforms: [
    "linkedin.com",
    "indeed.com",
    "glassdoor.com",
    "workable.com",
    "lever.co"
  ]
};

class TabManager {
  constructor() {
    this.activeTabs = new Map();
    this.tabRelationships = new Map(); // Track parent-child tab relationships
    this.tabOrigins = new Map(); // Track source platform of each tab
    this.setupTabListeners();
  }

  setupTabListeners() {
    // Track tab removal
    chrome.tabs.onRemoved.addListener((tabId) => {
      this.activeTabs.delete(tabId);
      this.tabRelationships.delete(tabId);
      this.tabOrigins.delete(tabId);
    });

    // Track tab creation
    chrome.tabs.onCreated.addListener((tab) => {
      const openerTabId = tab.openerTabId;
      if (openerTabId && this.activeTabs.has(openerTabId)) {
        // Record parent-child relationship
        this.tabRelationships.set(tab.id, openerTabId);

        // Inherit origin from parent tab
        const parentOrigin = this.tabOrigins.get(openerTabId);
        if (parentOrigin) {
          this.tabOrigins.set(tab.id, parentOrigin);
        }
      }
    });

    // Handle tab navigation updates
    chrome.webNavigation.onCompleted.addListener((details) => {
      if (details.frameId === 0) { // Main frame only
        this.handleTabNavigation(details.tabId, details.url);
      }
    });
  }

  handleTabNavigation(tabId, url) {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;

      // Update tab information
      if (this.activeTabs.has(tabId)) {
        const tabInfo = this.activeTabs.get(tabId);
        tabInfo.url = url;
        tabInfo.lastNavigation = Date.now();
      }

      // Check if this is a known job platform
      CONFIG.jobPlatforms.forEach(platform => {
        if (hostname.includes(platform)) {
          this.tabOrigins.set(tabId, platform);
        }
      });

      // If this is a new external site from a job platform, notify for potential automation
      if (this.shouldRunAutomation(tabId, hostname)) {
        this.notifyForPotentialAutomation(tabId, url);
      }
    } catch (error) {
      console.error("Error handling tab navigation:", error);
    }
  }

  shouldRunAutomation(tabId, hostname) {
    // Don't run on excluded platforms
    if (CONFIG.excludedPlatforms.some(platform => hostname.includes(platform))) {
      return false;
    }

    // Check if this tab originated from a job platform (either directly or via parent)
    const originPlatform = this.tabOrigins.get(tabId);
    if (originPlatform) {
      return true;
    }

    // Check if parent tab originated from job platform
    const parentTabId = this.tabRelationships.get(tabId);
    if (parentTabId) {
      const parentOrigin = this.tabOrigins.get(parentTabId);
      return !!parentOrigin;
    }

    return false;
  }

  notifyForPotentialAutomation(tabId, url) {
    // Get origin platform
    const originPlatform = this.getTabOriginPlatform(tabId);

    // Notify content script to check if this is an application page
    chrome.tabs.sendMessage(tabId, {
      type: "CHECK_APPLICATION_PAGE",
      data: {
        url: url,
        originPlatform: originPlatform
      }
    }).catch(() => {
      // Content script might not be loaded yet, we'll retry on document_idle
    });
  }

  getTabOriginPlatform(tabId) {
    // Get direct origin
    let origin = this.tabOrigins.get(tabId);
    if (origin) return origin;

    // Try parent tab origin
    const parentTabId = this.tabRelationships.get(tabId);
    if (parentTabId) {
      return this.tabOrigins.get(parentTabId);
    }

    return null;
  }

  async createTab(url, openerTabId = null) {
    const tab = await chrome.tabs.create({
      url,
      openerTabId
    });

    if (openerTabId) {
      this.tabRelationships.set(tab.id, openerTabId);

      // Inherit platform origin from parent
      const parentOrigin = this.tabOrigins.get(openerTabId);
      if (parentOrigin) {
        this.tabOrigins.set(tab.id, parentOrigin);
      }
    }

    return this.trackTab(tab);
  }

  trackTab(tab) {
    this.activeTabs.set(tab.id, {
      url: tab.url,
      startTime: Date.now(),
      lastNavigation: Date.now()
    });
    return tab;
  }

  async closeTab(tabId) {
    if (this.activeTabs.has(tabId)) {
      await chrome.tabs.remove(tabId);
      this.activeTabs.delete(tabId);
      this.tabRelationships.delete(tabId);
      this.tabOrigins.delete(tabId);
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

  getReferringPlatform(tabId) {
    return this.tabOrigins.get(tabId);
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
      this.setupMessageListeners();
      this.isInitialized = true;
    } catch (error) {
      console.error("Failed to initialize ExternalJobApplyManager:", error);
      this.isInitialized = false;
      throw error;
    }
  }

  setupMessageListeners() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.log("Received message:", message.type, sender);

      if (message.type === "START_EXTERNAL_APPLICATION" ||
          message.type === "APPLICATION_STATUS" ||
          message.type === "CHECK_FORM_DETECTED" ||
          message.type === "REQUEST_USER_INFO") {
        this.handleMessage(message, sender, sendResponse);
        return true; // Keep the message channel open for async response
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
          sendResponse({ success: true });
          break;

        case "CHECK_FORM_DETECTED":
          // Content script detected an application form
          await this.handleFormDetection(message.data, sender.tab?.id);
          sendResponse({ success: true });
          break;

        case "REQUEST_USER_INFO":
          // Content script is requesting user info to start automation
          const userInfo = await this.getUserInfo(message.data.userId);
          sendResponse({ success: true, data: userInfo });
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

  async handleFormDetection(data, tabId) {
    // Check if this tab originated from a job platform
    const originPlatform = this.tabManager.getReferringPlatform(tabId);

    if (originPlatform) {
      console.log(`Application form detected on tab ${tabId} originating from ${originPlatform}`);

      // Get user info from storage or last request
      const userId = await this.getLastActiveUserId();

      if (userId) {
        // Initialize automation for this tab
        await this.initializeAutomation(tabId, {
          userId: userId,
          platform: originPlatform,
          host: CONFIG.API_HOST,
        });

        // Start the application process
        await this.processApplication(tabId, {
          jobDetails: {
            title: data.pageTitle || "External Job",
            company: data.companyName || "Unknown",
            source: originPlatform,
            url: data.url
          }
        });
      } else {
        console.warn("No user ID available to start automation");
      }
    }
  }

  async getLastActiveUserId() {
    // Get user ID from storage
    const data = await chrome.storage.local.get("lastActiveUserId");
    return data.lastActiveUserId;
  }

  async saveLastActiveUserId(userId) {
    await chrome.storage.local.set({ "lastActiveUserId": userId });
  }

  async getUserInfo(userId) {
    try {
      const response = await fetch(`${CONFIG.API_HOST}/api/user/${userId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch user details: ${response.statusText}`);
      }

      const data = await response.json();
      if (!data) throw new Error("No user data received from backend");
      return data;
    } catch (error) {
      console.error("Error fetching user details:", error);
      throw error;
    }
  }

  async handleExternalApplication(data, sender) {
    try {
      console.log("Handling external application", data);
      this.validateApplicationData(data);

      // Save user ID for potential redirects
      await this.saveLastActiveUserId(data.userId);

      // Create a new tab for the application
      const tab = await this.tabManager.createTab(data.url, sender.tab?.id);

      // Tag this tab with the platform it came from
      if (data.platform) {
        this.tabManager.tabOrigins.set(tab.id, data.platform);
      }

      this.currentApplications.set(tab.id, {
        startTime: Date.now(),
        platform: data.platform,
        originalTab: sender.tab,
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
            platform: data.platform,
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
      await this.handleApplicationCompletion(tabId, statusData);
    }
  }

  isApplicationComplete(status) {
    return status.status === "completed" || (status.error && !status.retryable);
  }

  async cleanup(tabId) {
    try {
      // Wait a moment before closing tab to let user see the result
      await new Promise(resolve => setTimeout(resolve, 2000));
      await this.tabManager.closeTab(tabId);
    } finally {
      this.currentApplications.delete(tabId);
    }
  }
}

// Initialize the manager when the extension loads
const manager = new ExternalJobApplyManager();
manager.initialize();

// platforms/external/background.js

// class ExternalJobApplyManager {
//   static instance = null;
//   static isInitialized = false;

//   constructor() {
//     if (ExternalJobApplyManager.instance) {
//       return ExternalJobApplyManager.instance;
//     }
//     this.tabManager = null; // Will be set by PlatformRouter
//     this.currentApplications = new Map();
//     ExternalJobApplyManager.instance = this;

//     // Config will be shared from PlatformRouter
//     this.CONFIG = {
//       navigationTimeout: 60000,
//       retryAttempts: 3,
//       retryDelay: 1000,
//       buttonClickTimeout: 5000,
//       API_HOST: "http://localhost:3000", // Update with your actual API host
//     };
//   }

//   async init() {
//     if (this.isInitialized) return;

//     try {
//       console.log("Initializing ExternalJobApplyManager");
//       this.isInitialized = true;
//       return true;
//     } catch (error) {
//       console.error("Failed to initialize ExternalJobApplyManager:", error);
//       this.isInitialized = false;
//       throw error;
//     }
//   }

//   async handleExternalMessage(message, sender, sendResponse) {
//     console.log("ExternalJobApplyManager handling message:", message);

//     try {
//       if (message.action === "START_EXTERNAL_APPLICATION") {
//         const result = await this.handleExternalApplication(
//           message.data,
//           sender
//         );
//         sendResponse(result);
//       } else {
//         sendResponse({
//           status: "error",
//           message: "Unknown action for external platform",
//         });
//       }
//     } catch (error) {
//       console.error("External message handling error:", error);
//       sendResponse({
//         status: "error",
//         message: error.message,
//         code: "EXTERNAL_AUTOMATION_ERROR",
//       });
//     }
//   }

//   async handleFormDetection(data, tabId) {
//     // Check if this tab originated from a job platform
//     const originPlatform = this.tabManager.getReferringPlatform(tabId);
//     const jobData = this.tabManager.getJobData(tabId);

//     if (originPlatform) {
//       console.log(
//         `Application form detected on tab ${tabId} originating from ${originPlatform}`
//       );

//       // Get user ID from job data or storage
//       const userId = jobData?.userId || (await this.getLastActiveUserId());

//       if (userId) {
//         // Initialize automation for this tab
//         await this.initializeAutomation(tabId, {
//           userId: userId,
//           platform: originPlatform,
//           host: this.CONFIG.API_HOST,
//           jobDetails: jobData,
//         });

//         // Start the application process
//         await this.processApplication(tabId, {
//           jobDetails: {
//             title: jobData?.title || data.pageTitle || "External Job",
//             company: jobData?.company || data.companyName || "Unknown",
//             source: originPlatform,
//             url: data.url,
//             jobId: jobData?.jobId,
//           },
//         });

//         // Track this application
//         this.currentApplications.set(tabId, {
//           startTime: Date.now(),
//           platform: originPlatform,
//           originalTab: jobData?.originalTabId,
//           jobDetails: jobData,
//         });
//       } else {
//         console.warn("No user ID available to start automation");
//       }
//     }
//   }

//   async getLastActiveUserId() {
//     // Get user ID from storage
//     const data = await chrome.storage.local.get("lastActiveUserId");
//     return data.lastActiveUserId;
//   }

//   async handleExternalApplication(data, sender) {
//     try {
//       console.log("Handling external application", data);
//       this.validateApplicationData(data);

//       // Create a new tab for the application
//       const tab = await this.tabManager.createTab(data.url, sender.tab?.id, {
//         userId: data.userId,
//         jobId: data.jobId,
//         title: data.title,
//         company: data.company,
//         originalTabId: sender.tab?.id,
//         platform: data.platform,
//       });

//       this.currentApplications.set(tab.id, {
//         startTime: Date.now(),
//         platform: data.platform,
//         originalTab: sender.tab,
//         jobDetails: {
//           jobId: data.jobId,
//           title: data.title,
//           company: data.company,
//         },
//       });

//       return {
//         status: "success",
//         message: "External application initiated",
//         tabId: tab.id,
//       };
//     } catch (error) {
//       console.error("External application error:", error);
//       return {
//         status: "error",
//         message: error.message,
//         code: "EXTERNAL_INIT_ERROR",
//       };
//     }
//   }

//   async handleApplicationStatus(statusData, tabId) {
//     const application = this.currentApplications.get(tabId);
//     if (!application) return;

//     // Update application status
//     application.status = statusData;

//     // Check if there's an original tab to notify
//     if (application.originalTab) {
//       try {
//         // Send status back to original platform
//         const message = {
//           type: "EXTERNAL_APPLICATION_COMPLETED",
//           data: {
//             jobId: application.jobDetails?.jobId,
//             status: statusData.status === "completed" ? "success" : "error",
//             message: statusData.message,
//             platform: application.platform,
//           },
//         };

//         await chrome.tabs.sendMessage(application.originalTab.id, message);
//       } catch (error) {
//         console.error("Error notifying original tab:", error);
//       }
//     }

//     // If application is complete, cleanup
//     if (this.isApplicationComplete(statusData)) {
//       await this.cleanup(tabId);
//     }
//   }

//   validateApplicationData(data) {
//     const required = ["url", "userId"];
//     const missing = required.filter((field) => !data[field]);
//     if (missing.length > 0) {
//       throw new Error(`Missing required fields: ${missing.join(", ")}`);
//     }
//   }

//   async initializeAutomation(tabId, data) {
//     // Add timeout to wait for content script
//     const timeout = this.CONFIG.navigationTimeout;
//     const startTime = Date.now();

//     while (Date.now() - startTime < timeout) {
//       try {
//         const response = await chrome.tabs.sendMessage(tabId, {
//           type: "INIT_AUTOMATION",
//           data: {
//             userId: data.userId,
//             host: this.CONFIG.API_HOST,
//             platform: data.platform,
//             config: this.CONFIG,
//             jobDetails: data.jobDetails,
//           },
//         });

//         if (response?.success) {
//           return true;
//         }
//       } catch (error) {
//         // If content script isn't ready yet, wait and retry
//         await new Promise((resolve) => setTimeout(resolve, 100));
//         continue;
//       }
//     }

//     throw new Error(
//       "Failed to initialize automation: Content script not ready"
//     );
//   }

//   async processApplication(tabId, data) {
//     const response = await chrome.tabs.sendMessage(tabId, {
//       type: "PROCESS_APPLICATION",
//       data: {
//         jobDetails: data.jobDetails,
//         config: this.CONFIG,
//       },
//     });

//     if (!response?.success) {
//       throw new Error(response?.error || "Application process failed");
//     }

//     return response.data;
//   }

//   isApplicationComplete(status) {
//     return status.status === "completed" || (status.error && !status.retryable);
//   }

//   async cleanup(tabId) {
//     try {
//       // Wait a moment before closing tab to let user see the result
//       await new Promise((resolve) => setTimeout(resolve, 2000));
//       await this.tabManager.closeTab(tabId);
//     } finally {
//       this.currentApplications.delete(tabId);
//     }
//   }

//   // Method to notify other platform handlers about external application status
//   notifyApplicationStatus(status, jobId, platform) {
//     // Find the original tab that opened this application
//     for (const [tabId, application] of this.currentApplications.entries()) {
//       if (
//         application.jobDetails?.jobId === jobId &&
//         application.platform === platform
//       ) {
//         this.handleApplicationStatus(status, tabId);
//         break;
//       }
//     }
//   }
// }

// // Create singleton instance
// const externalManager = new ExternalJobApplyManager();

export { ExternalJobApplyManager };
//CHECK_FORM_DETECTED