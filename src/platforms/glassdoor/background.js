import { getGlassdoorURL } from "@shared/utils";

const GlassdoorsApplyManager = {
  STATE: {
    IDLE: "idle",
    SEARCHING: "searching",
    APPLYING: "applying",
    COMPLETED: "completed",
    ERROR: "error",
  },

  currentState: "idle",
  userId: null,
  targetTabId: null,
  webAppUrl: "http://localhost:3000",
  activeJobs: [],
  activeCountry: null,

  async init() {
    chrome.runtime.onInstalled.addListener(this.onInstalled.bind(this));
    chrome.runtime.onMessage.addListener(this.handleMessage.bind(this));
    chrome.runtime.onMessageExternal.addListener(this.handleExternalMessage.bind(this));
    
    // Listen for tab updates to track navigation
    chrome.tabs.onUpdated.addListener(this.handleTabUpdate.bind(this));
    
    console.log("Glassdoor Job Application Manager initialized");
  },

  onInstalled() {
    console.log("Glassdoor Job Application Assistant installed");
    // Reset state on installation
    this.currentState = this.STATE.IDLE;
    this.userId = null;
    this.targetTabId = null;
    this.activeJobs = [];
  },

  handleTabUpdate(tabId, changeInfo, tab) {
    // Only process tabs we're tracking
    if (tabId !== this.targetTabId) return;
    
    // If a page has completed loading
    if (changeInfo.status === 'complete') {
      console.log(`Target tab ${tabId} completed loading: ${tab.url}`);
      
      // Notify content script that page load is complete
      this.sendMessageToTab(tabId, {
        action: "pageLoaded",
        url: tab.url
      }).catch(err => {
        console.log("Could not notify content script of page load:", err);
        // Content script might not be ready yet, that's okay
      });
    }
  },

  async sendMessageToTab(tabId, message) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, message, response => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    });
  },

  async handleMessage(request, sender, sendResponse) {
    console.log("Background script received message:", request);

    try {
      switch (request.action) {
        case "startApplying":
          await this.startJobSearchProcess(request, sendResponse);
          break;

        case "pageLoaded":
          console.log("Page loaded notification received from tab:", sender.tab.id);
          // No action needed, just tracking
          sendResponse({ status: "acknowledged" });
          break;

        case "searchCompleted":
          await this.handleSearchCompleted(request, sender.tab.id);
          sendResponse({ status: "processing" });
          break;

        case "processJobs":
          await this.sendMessageToTab(sender.tab.id, {
            action: "processJobs",
          });
          sendResponse({ status: "processing" });
          break;

        case "jobViewed":
          // Track job view in database if needed
          await this.recordJobInteraction(request.jobData, "viewed");
          sendResponse({ status: "recorded" });
          break;

        case "applicationComplete":
          // Track completed application in database
          await this.recordJobInteraction(request.jobData, "applied");
          sendResponse({ status: "recorded" });
          break;

        case "applicationError":
          // Track failed application in database
          await this.recordJobInteraction(request.jobData, "error", request.error);
          sendResponse({ status: "recorded" });
          break;

        case "navigateToJob":
          // Handle request to navigate to a specific job URL
          if (request.url) {
            await chrome.tabs.update(sender.tab.id, { url: request.url });
          }
          sendResponse({ status: "navigating" });
          break;

        case "statusUpdate":
          // Forward status updates to main app if needed
          this.sendStatusToExternalApp(request.status, request.data);
          sendResponse({ status: "forwarded" });
          break;

        case "stop":
          // Stop the automation process
          this.currentState = this.STATE.IDLE;
          sendResponse({ status: "stopped" });
          break;

        default:
          sendResponse({ status: "error", message: "Unknown action" });
      }
    } catch (error) {
      console.error("Error in background script handleMessage:", error);
      this.currentState = this.STATE.ERROR;
      sendResponse({ status: "error", message: error.message });
    }
    
    return true; // Keep message channel open for async response
  },

  async handleExternalMessage(request, sender, sendResponse) {
    console.log("Background script received external message:", request);
    
    if (request.action === "startApplying") {
      try {
        this.userId = request.userId;
        this.activeJobs = request.jobsToApply || [];
        this.activeCountry = request.country || 'us';
        
        const result = await this.startJobSearchProcess(request);
        sendResponse(result);
      } catch (error) {
        console.error("Error handling external startApplying request:", error);
        sendResponse({
          status: "error",
          platform: "glassdoor",
          message: "Failed to start job search: " + error.message,
        });
      }
    } 
    else if (request.action === "getStatus") {
      // Return current automation status
      sendResponse({
        status: this.currentState,
        platform: "glassdoor",
        progress: this.currentState === this.STATE.APPLYING ? {
          currentJob: this.currentJobIndex,
          totalJobs: this.activeJobs.length,
        } : null
      });
    }
    else {
      sendResponse({ status: "error", message: "Unknown external action" });
    }
    
    return true; // Keep message channel open for async response
  },

  async startJobSearchProcess(request, sendResponse) {
    try {
      console.log("Starting job search process...");
      this.currentState = this.STATE.SEARCHING;
      
      // Create a new tab with Glassdoor
      const baseUrl = getGlassdoorURL(request.country || 'us');
      console.log(`Creating tab with URL: ${baseUrl}/Job/index.htm`);
      
      const tab = await chrome.tabs.create({
        url: `${baseUrl}/Job/index.htm`,
      });
      
      this.targetTabId = tab.id;
      
      // Wait for the tab to fully load before proceeding
      // This is now handled by the tab update listener
      
      // Set a timeout to prevent hanging
      const searchTimeout = setTimeout(() => {
        if (this.currentState === this.STATE.SEARCHING) {
          this.currentState = this.STATE.ERROR;
          console.error("Search process timed out");
          
          if (sendResponse) {
            sendResponse({
              status: "error",
              platform: "glassdoor",
              message: "Search process timed out"
            });
          }
        }
      }, 60000); // 1 minute timeout
      
      // Return immediately to maintain UI responsiveness
      return {
        status: "started",
        platform: "glassdoor",
        message: "Job search process initiated",
        tabId: tab.id
      };
    } catch (error) {
      console.error("Error starting job search process:", error);
      this.currentState = this.STATE.ERROR;
      
      return {
        status: "error",
        platform: "glassdoor",
        message: "Failed to start job search: " + error.message,
      };
    }
  },

  async handleSearchCompleted(request, tabId) {
    console.log("Search completed, starting job processing");
    
    try {
      // Update state
      this.currentState = this.STATE.APPLYING;
      
      // Tell content script to start processing jobs
      await this.sendMessageToTab(tabId, {
        action: "processJobs",
        userId: this.userId,
      });
      
      // Send status update to main app
      this.sendStatusToExternalApp("applying", "Processing job applications");
      
      return true;
    } catch (error) {
      console.error("Error handling search completion:", error);
      this.currentState = this.STATE.ERROR;
      this.sendStatusToExternalApp("error", error.message);
      return false;
    }
  },

  async recordJobInteraction(jobData, interactionType, errorMessage = null) {
    try {
      // Skip if no user ID is set
      if (!this.userId) return;
      
      // Create record of interaction for reporting
      const interaction = {
        userId: this.userId,
        jobId: jobData.jobId,
        jobTitle: jobData.jobTitle,
        company: jobData.company,
        location: jobData.location,
        timestamp: new Date().toISOString(),
        platform: "glassdoor",
        type: interactionType,
        url: jobData.url,
        error: errorMessage
      };
      
      // Send to backend API if needed
      /*
      const response = await fetch(`${this.webAppUrl}/api/job-interactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(interaction),
      });
      */
      
      console.log(`Recorded job interaction: ${interactionType}`, interaction);
    } catch (error) {
      console.error("Error recording job interaction:", error);
    }
  },

  sendStatusToExternalApp(status, message) {
    console.log(`Sending status to external app: ${status} - ${message}`);
    
    // Example of sending status to a web app via messaging
    try {
      chrome.runtime.sendMessage({
        action: "automationStatus",
        platform: "glassdoor",
        status: status,
        message: message,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("Error sending status to external app:", error);
    }
  }
};
export { GlassdoorsApplyManager };