// Modified version of your main background.js file

// Import platform handlers
import { LinkedInJobApplyManager } from "./platforms/linkedin/background";
import { JobApplyManager } from "./platforms/indeed_glassdoor/background";
import { LeverJobApplyManager } from "./platforms/lever/background";
import { WorkableJobApplyManager } from "./platforms/workable/background";
import { BreezyJobApplyManager } from "./platforms/breezy/background";
import { RecruiteeJobApplyManager } from "./platforms/recruitee/background";
import { ZipRecruiterManager } from "./platforms/ziprecruiter/background";
import { ExternalJobApplyManager } from "./platforms/external/background";

const PLATFORMS = {
  LINKEDIN: "linkedin",
  INDEED: "indeed",
  EXTERNAL: "external", // Added external platform type
  GLASSDOOR: "glassdoor",
  LEVER: "lever",
  WORKABLE: "workable",
  BREEZY: "breezy",
  RECRUITEE: "recruitee",
  INDEED_GLASSDOOR: "indeed_glassdoor",
  ZIPRECRUITER: "ziprecruiter",
};

const WEB_APP_URL = "https://fastapply.co";

// Create a singleton tab manager to be shared across platforms
class TabManager {
  constructor() {
    this.activeTabs = new Map();
    this.tabRelationships = new Map(); // Track parent-child tab relationships
    this.tabOrigins = new Map(); // Track source platform of each tab
    this.tabJobData = new Map(); // Store job data for each tab
    this.setupTabListeners();
  }

  setupTabListeners() {
    // Track tab removal
    chrome.tabs.onRemoved.addListener((tabId) => {
      this.activeTabs.delete(tabId);
      this.tabRelationships.delete(tabId);
      this.tabOrigins.delete(tabId);
      this.tabJobData.delete(tabId);
    });

    // Track tab creation - this is the key part for tracking redirects
    chrome.tabs.onCreated.addListener((tab) => {
      const openerTabId = tab.openerTabId;
      if (openerTabId && this.activeTabs.has(openerTabId)) {
        // Record parent-child relationship
        this.tabRelationships.set(tab.id, openerTabId);
        
        // Inherit origin from parent tab
        const parentOrigin = this.tabOrigins.get(openerTabId);
        if (parentOrigin) {
          this.tabOrigins.set(tab.id, parentOrigin);
          console.log(`Tab ${tab.id} inherited origin platform: ${parentOrigin}`);
        }
        
        // Inherit job data from parent tab
        const parentJobData = this.tabJobData.get(openerTabId);
        if (parentJobData) {
          this.tabJobData.set(tab.id, parentJobData);
          console.log(`Tab ${tab.id} inherited job data from parent`);
        }
      }
    });

    // Handle tab updates - to detect when an external page is loaded
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status === 'complete') {
        const originPlatform = this.tabOrigins.get(tabId);
        const jobData = this.tabJobData.get(tabId);
        
        // If this tab has an origin platform and job data, it's a redirect from a job platform
        if (originPlatform && jobData) {
          console.log(`Tab ${tabId} loaded with origin: ${originPlatform}`);
          
          // Notify the content script in this tab that it was opened from a job platform
          this.notifyTabOfOrigin(tabId, originPlatform, jobData);
        }
      }
    });
  }
  
  notifyTabOfOrigin(tabId, originPlatform, jobData) {
    // Tell the content script this tab came from a job platform
    try {
      chrome.tabs.sendMessage(tabId, {
        type: "EXTERNAL_TAB_ORIGIN",
        data: {
          originPlatform,
          jobData
        }
      }).catch(err => {
        // Content script might not be loaded yet - normal
        console.log("Content script not ready yet for origin notification");
      });
    } catch (error) {
      console.error("Error notifying tab of origin:", error);
    }
  }

  getTabOrigin(tabId) {
    return this.tabOrigins.get(tabId);
  }
  
  getTabJobData(tabId) {
    return this.tabJobData.get(tabId);
  }
  
  setTabJobData(tabId, jobData) {
    this.tabJobData.set(tabId, jobData);
  }
  
  setTabOrigin(tabId, platform) {
    this.tabOrigins.set(tabId, platform);
  }
  
  trackTab(tabId, url) {
    this.activeTabs.set(tabId, {
      url,
      startTime: Date.now()
    });
  }
}

// Create a single tab manager instance
const globalTabManager = new TabManager();

const PlatformRouter = {
  handlers: {
    [PLATFORMS.LINKEDIN]: LinkedInJobApplyManager,
    [PLATFORMS.ZIPRECRUITER]: ZipRecruiterManager,
    [PLATFORMS.INDEED]: JobApplyManager,
    [PLATFORMS.GLASSDOOR]: JobApplyManager,
    [PLATFORMS.LEVER]: LeverJobApplyManager,
    [PLATFORMS.WORKABLE]: WorkableJobApplyManager,
    [PLATFORMS.BREEZY]: BreezyJobApplyManager,
    [PLATFORMS.RECRUITEE]: RecruiteeJobApplyManager,
    [PLATFORMS.EXTERNAL]: ExternalJobApplyManager, // Add external handler
  },

  activeHandler: null,
  activePlatform: null,
  tabManager: globalTabManager, // Share the tab manager

  async init() {
    try {
      // Setup extension listeners
      chrome.action.onClicked.addListener(() => {
        chrome.tabs.create({ url: WEB_APP_URL });
      });

      chrome.runtime.onMessageExternal.addListener(
        this.handleExternalMessage.bind(this)
      );

      chrome.runtime.onMessage.addListener(
        this.handleInternalMessage.bind(this)
      );
      
      // Initialize the external handler
      await this.activatePlatformHandler(PLATFORMS.EXTERNAL);
      
      // Share the tab manager with all platform handlers
      for (const [platform, handler] of Object.entries(this.handlers)) {
        if (handler && typeof handler === 'object') {
          handler.tabManager = this.tabManager;
        }
      }
    } catch (error) {
      console.error("Failed to initialize PlatformRouter:", error);
    }
  },

  async activatePlatformHandler(platform) {
    // If this platform is already active, return its handler
    if (platform === this.activePlatform && this.activeHandler) {
      return this.activeHandler;
    }

    // Clean up previous handler if it exists
    if (
      this.activeHandler &&
      typeof this.activeHandler.cleanup === "function" &&
      this.activePlatform !== PLATFORMS.EXTERNAL 
    ) {
      await this.activeHandler.cleanup();
    }
    console.log(platform)
    const handler = this.handlers[platform];
    console.log(handler)
    if (!handler) {
      throw new Error(`Unsupported platform: ${platform}`);
    }

    // Initialize the new handler only when needed
    if (typeof handler.init === "function" && !handler.isInitialized) {
      await handler.init();
      handler.isInitialized = true;
      
      // Share the tab manager with the handler
      handler.tabManager = this.tabManager;
    }

    // Update active handler state
    this.activeHandler = handler;
    this.activePlatform = platform;

    console.log(`Activated ${platform} handler`);
    return handler;
  },

  async handleExternalMessage(request, sender, sendResponse) {
    const { platform } = request;
    console.log("External message received for platform:", platform);

    try {
      const handler = await this.activatePlatformHandler(platform);
    
      const methodName = `handle${platform
        .charAt(0)
        .toUpperCase()}${platform.slice(1)}Message`;
      
      // Store job data in the tab manager for potential redirects
      if (request.jobData && sender.tab) {
        this.tabManager.setTabJobData(sender.tab.id, request.jobData);
        this.tabManager.setTabOrigin(sender.tab.id, platform);
      }
       
      handler[methodName](request, sender, sendResponse);
    } catch (error) {
      console.error(`Error in ${platform} handler:`, error);
      const errorMessage =
        error.message === "Failed to initialize automation"
          ? "Unable to start automation. Please refresh the page and try again."
          : error.message;

      sendResponse({
        status: "error",
        message: errorMessage,
        code: error.code || "AUTOMATION_ERROR",
      });
    }
    return true;
  },

  async handleInternalMessage(message, sender, sendResponse) {
    console.log("Internal message received:", message.type);
    
    // Add support for REGISTER_EXTERNAL_TAB message - sent by job platform content script
    // when user clicks on an external apply button
    if (message.type === "REGISTER_EXTERNAL_TAB") {
      try {
        const tabId = sender.tab?.id;
        if (!tabId) {
          sendResponse({ success: false, error: "No tab ID available" });
          return true;
        }
        
        // Register this tab as originating from a job platform
        this.tabManager.setTabOrigin(tabId, message.data.platform);
        this.tabManager.setTabJobData(tabId, message.data.jobData);
        
        console.log(`Registered tab ${tabId} for external tracking: ${message.data.platform}`);
        
        sendResponse({ success: true });
        return true;
      } catch (error) {
        console.error("Error registering external tab:", error);
        sendResponse({ success: false, error: error.message });
        return true;
      }
    }
    
    // Handle START_EXTERNAL_AUTOMATION message - sent when a form is detected on external site
    if (message.type === "START_EXTERNAL_AUTOMATION") {
      try {
        const handler = await this.activatePlatformHandler(PLATFORMS.EXTERNAL);
        const result = await handler.handleExternalAutomation(message.data, sender);
        sendResponse(result);
        return true;
      } catch (error) {
        console.error("Error starting external automation:", error);
        sendResponse({ success: false, error: error.message });
        return true;
      }
    }
    
    // Handle EXTERNAL_APPLICATION_STATUS message
    if (message.type === "EXTERNAL_APPLICATION_STATUS") {
      try {
        // Get the origin platform
        const originPlatform = message.data.platform || 
                               this.tabManager.getTabOrigin(sender.tab?.id);
        
        // If we have an origin platform, notify that platform's handler
        if (originPlatform && this.handlers[originPlatform]) {
          const handler = await this.activatePlatformHandler(originPlatform);
          if (handler.notifyApplicationStatus) {
            handler.notifyApplicationStatus(message.data);
          }
        }
        
        sendResponse({ success: true });
        return true;
      } catch (error) {
        console.error("Error handling application status:", error);
        sendResponse({ success: false, error: error.message });
        return true;
      }
    }
    
    // Regular platform detection and handling
    const url = sender.tab?.url || "";
    const platform = this.detectPlatform(url);

    if (platform) {
      try {
        const handler = await this.activatePlatformHandler(platform);
        return handler.handleMessage?.(message, sender, sendResponse) || 
               handler.handleWorkableMessage?.(message, sender, sendResponse) ||
               true;
      } catch (error) {
        console.error(
          `Error handling internal message for ${platform}:`,
          error
        );
        return false;
      }
    }
    return false;
  },

  detectPlatform(url) {
    if (!url) return null;
    
    const platformDomains = {
      "linkedin.com": PLATFORMS.LINKEDIN,
      "indeed.com": PLATFORMS.INDEED,
      "glassdoor.com": PLATFORMS.GLASSDOOR,
      "lever.co": PLATFORMS.LEVER,
      "workable.com": PLATFORMS.WORKABLE,
      "breezy.hr": PLATFORMS.BREEZY,
      "recruitee.com": PLATFORMS.RECRUITEE,
      "ziprecruiter.com": PLATFORMS.ZIPRECRUITER,
    };
    
    return Object.entries(platformDomains).find(([domain]) =>
      url.includes(domain)
    )?.[1] || null;
  },
  
  // Method for content scripts to explicitly register an external redirect
  registerExternalRedirect(tabId, platform, jobData) {
    this.tabManager.setTabOrigin(tabId, platform);
    this.tabManager.setTabJobData(tabId, jobData);
    console.log(`Explicitly registered tab ${tabId} as ${platform} redirect with job data`);
  }
};

// Initialize router
PlatformRouter.init();

export { PlatformRouter };

//Unsupported platform: ashby