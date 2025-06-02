import { HOST } from "@shared/constants";
import {
  formatUserDataForJobApplication,
  formatApplicationsToSubmittedLinks,
} from "@shared/userDataFormatter";

console.log("ZipRecruiter Background Script Initialized");
/**
 * ZipRecruiterManager - Background script for managing job applications on ZipRecruiter
 * Coordinates between search and application tabs and communicates with the server
 */
const ZipRecruiterManager = {
  // State management
  state: {
    // Session data
    userId: null,
    profile: null,
    session: null,
    devMode: false,
    serverBaseUrl: HOST,
    avatarUrl: "",

    // Window and tab tracking
    windowId: null,
    searchTabId: null,
    applyTabId: null,

    // Application state
    started: false,
    applicationInProgress: false,
    applicationUrl: null,
    applicationStartTime: null,

    // Job search parameters
    jobsLimit: 100,
    jobsApplied: 0,
    searchDomain: ["ziprecruiter.com"],
    submittedLinks: [],

    // Last activity timestamp for health check
    lastActivity: Date.now(),
  },

  /**
   * Initialize the manager
   */
  async init() {
    console.log("ZipRecruiter Manager initialized");

    // Set up message listeners
    chrome.runtime.onConnect.addListener(this.handleConnect.bind(this));
    chrome.runtime.onMessage.addListener(
      this.handleZiprecruiterMessage.bind(this)
    );

    // Set up tab removal listener
    chrome.tabs.onRemoved.addListener(this.handleTabRemoved.bind(this));

    // Start health check interval
    this.startHealthCheck();
  },

  /**
   * Start health check interval to detect and recover from stuck states
   */
  startHealthCheck() {
    setInterval(() => this.checkHealth(), 60000); // Check every minute
  },

  /**
   * Check the health of the automation system and recover from stuck states
   */
  checkHealth() {
    const now = Date.now();

    // Check for stuck application
    if (this.state.applicationInProgress && this.state.applicationStartTime) {
      const applicationTime = now - this.state.applicationStartTime;

      // If application has been active for over 5 minutes, it's probably stuck
      if (applicationTime > 5 * 60 * 1000) {
        console.warn(
          "Application appears to be stuck for over 5 minutes, attempting recovery"
        );

        try {
          // Force close the application tab if it exists
          if (this.state.applyTabId) {
            chrome.tabs.remove(this.state.applyTabId);
          }

          // Mark URL as error
          const url = this.state.applicationUrl;
          if (url) {
            this.state.submittedLinks.push({
              url,
              status: "ERROR",
              error: "Application timed out after 5 minutes",
              timestamp: now,
            });
          }

          // Reset application state
          this.resetApplicationState();

          // Notify search tab to continue
          this.notifySearchNext({
            url,
            status: "ERROR",
            message: "Application timed out after 5 minutes",
          });
        } catch (error) {
          console.error("Error during application recovery:", error);
        }
      }
    }

    // If no activity for 10 minutes but we're supposed to be running, check search tab
    const inactivityTime = now - this.state.lastActivity;
    if (inactivityTime > 10 * 60 * 1000 && this.state.started) {
      this.checkSearchTab();
    }

    // Update last activity time
    this.state.lastActivity = now;
  },

  /**
   * Check if search tab is still active and reload if needed
   */
  async checkSearchTab() {
    try {
      if (this.state.searchTabId) {
        try {
          const tab = await chrome.tabs.get(this.state.searchTabId);
          if (tab) {
            // Tab exists, try to refresh it
            await chrome.tabs.reload(this.state.searchTabId);
            console.log("Refreshed search tab after inactivity");
          }
        } catch (error) {
          // Tab doesn't exist, recreate it
          this.recreateSearchTab();
        }
      } else {
        // No search tab ID, create a new one
        this.recreateSearchTab();
      }
    } catch (error) {
      console.error("Error checking search tab:", error);
    }
  },

  /**
   * Recreate search tab if it's missing
   */
  async recreateSearchTab() {
    if (!this.state.started || !this.state.session) return;

    try {
      // Build search URL
      let searchUrl = "https://www.ziprecruiter.com/jobs-search";

      // Add search parameters
      const searchParams = new URLSearchParams();

      if (this.state.session.role) {
        searchParams.append("search", this.state.session.role);
      }

      if (this.state.session.location) {
        searchParams.append("location", this.state.session.location);
      }

      // Add additional parameters to match proper ZipRecruiter URL format
      if (this.state.session.workplace === "REMOTE") {
        searchParams.append("refine_by_location_type", "remote");
      } else {
        searchParams.append("refine_by_location_type", "");
      }

      // Add standard search parameters
      searchParams.append("radius", "25");
      searchParams.append("days", "");
      searchParams.append("refine_by_employment", "employment_type:all");
      searchParams.append("refine_by_salary", "");
      searchParams.append("refine_by_salary_ceil", "");

      // Complete search URL with parameters
      if (searchParams.toString()) {
        searchUrl += "?" + searchParams.toString();
      }

      // Create window or tab as needed
      if (this.state.windowId) {
        try {
          await chrome.windows.get(this.state.windowId);
          // Create tab in existing window
          const tab = await chrome.tabs.create({
            url: searchUrl,
            windowId: this.state.windowId,
          });
          this.state.searchTabId = tab.id;
        } catch (error) {
          // Window doesn't exist, create new one
          const window = await chrome.windows.create({
            url: searchUrl,
            state: "maximized",
          });
          this.state.windowId = window.id;
          this.state.searchTabId = window.tabs[0].id;
        }
      } else {
        // No window, create new one
        const window = await chrome.windows.create({
          url: searchUrl,
          state: "maximized",
        });
        this.state.windowId = window.id;
        this.state.searchTabId = window.tabs[0].id;
      }
    } catch (error) {
      console.error("Error recreating search tab:", error);
    }
  },

  /**
   * Handle connection request from content scripts
   */
  handleConnect(port) {
    console.log("New connection established:", port.name);
    this.state.lastActivity = Date.now();

    // Register message handler for this port
    port.onMessage.addListener((message) => {
      this.handlePortMessage(message, port);
    });

    // Handle port disconnection
    port.onDisconnect.addListener(() => {
      console.log("Port disconnected:", port.name);
    });

    // Extract tab ID from port name (format: ziprecruiter-TYPE-TABID)
    const portNameParts = port.name.split("-");
    if (portNameParts.length >= 3) {
      const tabId = parseInt(portNameParts[2]);
      const type = portNameParts[1];

      // Update our tab IDs if appropriate
      if (
        type === "search" &&
        this.state.started &&
        !this.state.applicationInProgress
      ) {
        this.state.searchTabId = tabId;
      } else if (
        type === "apply" &&
        this.state.applicationInProgress &&
        !this.state.applyTabId
      ) {
        this.state.applyTabId = tabId;
      }
    }
  },

  /**
   * Send a response through the port
   */
  sendPortResponse(port, message) {
    try {
      if (port && port.sender) {
        port.postMessage(message);
      }
    } catch (error) {
      console.warn("Failed to send port response:", error);
    }
  },

  /**
   * Handle one-off messages (not using long-lived connections)
   */
  handleZiprecruiterMessage(request, sender, sendResponse) {
    try {
      console.log("One-off message received:", request);
      this.state.lastActivity = Date.now();

      const { action, type } = request;
      const messageType = action || type;

      switch (messageType) {
        case "startApplying":
          this.handleStartApplyingMessage(request, sendResponse);
          break;

        case "checkState":
          sendResponse({
            success: true,
            data: {
              started: this.state.started,
              applicationInProgress: this.state.applicationInProgress,
              searchTabId: this.state.searchTabId,
              applyTabId: this.state.applyTabId,
              jobsApplied: this.state.jobsApplied,
              jobsLimit: this.state.jobsLimit,
            },
          });
          break;

        case "resetState":
          this.resetState();
          sendResponse({
            success: true,
            message: "State has been reset",
          });
          break;

        case "getProfileData":
          this.handleGetProfileDataMessage(request, sendResponse);
          break;

        case "openJobInNewTab":
          this.handleOpenJobInNewTab(request, sendResponse);
          break;

        case "applicationCompleted":
          this.handleApplicationCompletedMessage(request, sender, sendResponse);
          break;

        case "applicationError":
          this.handleApplicationErrorMessage(request, sender, sendResponse);
          break;

        case "applicationSkipped":
          this.handleApplicationSkippedMessage(request, sender, sendResponse);
          break;

        default:
          sendResponse({
            success: false,
            message: "Unknown message type: " + messageType,
          });
      }
    } catch (error) {
      console.error("Error in handleZiprecruiterMessage:", error);
      sendResponse({
        success: false,
        message: error.message,
      });
    }

    return true; // Keep the message channel open for async response
  },

  /**
   * Handle GET_SEARCH_TASK message
   */
  handleGetSearchTask(port) {
    // Define search link pattern for ZipRecruiter
    const searchLinkPattern =
      /^https:\/\/(www\.)?ziprecruiter\.com\/(job|jobs|jz|apply).*$/;

    this.sendPortResponse(port, {
      type: "SEARCH_TASK_DATA",
      data: {
        limit: this.state.jobsLimit,
        current: this.state.jobsApplied,
        domain: this.state.searchDomain,
        submittedLinks: this.state.submittedLinks,
        // Convert regex pattern to string
        searchLinkPattern: searchLinkPattern.toString(),
      },
    });
  },

  /**
   * Handle GET_PROFILE_DATA message
   */
  async handleGetProfileData(url, port) {
    try {
      if (this.state.profile) {
        // Use cached profile data
        this.sendPortResponse(port, {
          type: "PROFILE_DATA",
          data: this.state.profile,
        });
        return;
      }

      // If no cached profile, fetch from API
      const userId = this.state.userId;
      if (!userId) {
        throw new Error("User ID not available");
      }

      const response = await fetch(
        `${this.state.serverBaseUrl}/api/user/${userId}`
      );
      if (!response.ok) {
        throw new Error(`Failed to fetch user details: ${response.status}`);
      }

      const userData = await response.json();

      // Format data consistently
      const formattedData = formatUserDataForJobApplication(
        userData,
        userId,
        this.state.session?.apiKey,
        this.state.jobsLimit,
        "ziprecruiter",
        this.state.serverBaseUrl,
        this.state.devMode
      );

      // Cache profile data
      this.state.profile = formattedData.profile;

      // Send response
      this.sendPortResponse(port, {
        type: "PROFILE_DATA",
        data: this.state.profile,
      });
    } catch (error) {
      console.error("Error getting profile data:", error);
      this.sendPortResponse(port, {
        type: "ERROR",
        message: "Failed to get profile data: " + error.message,
      });
    }
  },

  /**
   * Handle GET_APPLICATION_TASK message
   */
  handleGetApplicationTask(port) {
    this.sendPortResponse(port, {
      type: "APPLICATION_TASK_DATA",
      data: {
        devMode: this.state.devMode,
        profile: this.state.profile,
        session: this.state.session,
        avatarUrl: this.state.avatarUrl,
      },
    });
  },

  /**
   * Handle APPLICATION_COMPLETED message
   */
  async handleApplicationCompleted(data, port) {
    try {
      const url = this.state.applicationUrl;

      // Add to submitted links with SUCCESS status
      this.state.submittedLinks.push({
        url,
        details: data || null,
        status: "SUCCESS",
        timestamp: Date.now(),
      });

      // Track job application and send to API
      const userId = this.state.userId;

      try {
        const apiPromises = [];

        if (userId) {
          // Update application count
          apiPromises.push(
            fetch(`${this.state.serverBaseUrl}/api/applications`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ userId }),
            })
          );
        }

        if (data) {
          // Add job to applied jobs
          apiPromises.push(
            fetch(`${this.state.serverBaseUrl}/api/applied-jobs`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ...data,
                userId,
                applicationPlatform: "ziprecruiter",
              }),
            })
          );
        }

        if (apiPromises.length > 0) {
          await Promise.all(apiPromises);
        }
      } catch (apiError) {
        console.error("API error:", apiError);
      }

      // Close the application tab
      try {
        if (this.state.applyTabId) {
          await chrome.tabs.remove(this.state.applyTabId);
        }
      } catch (tabError) {
        console.error("Error closing tab:", tabError);
      }

      // Send success response to the port
      this.sendPortResponse(port, {
        type: "SUCCESS",
        message: "Application completed successfully",
      });

      // Increment job application counter
      this.state.jobsApplied++;

      // Reset application state
      this.resetApplicationState();

      // Check if we've reached the limit
      if (this.state.jobsApplied >= this.state.jobsLimit) {
        this.completeSearch("Reached application limit");
      } else {
        // Continue to next job
        this.notifySearchNext({
          url,
          status: "SUCCESS",
        });
      }
    } catch (error) {
      console.error("Error handling application completion:", error);

      // Reset application state
      this.resetApplicationState();

      // Notify search tab to continue
      this.notifySearchNext({
        url: this.state.applicationUrl,
        status: "ERROR",
        message: error.message,
      });
    }
  },

  /**
   * Handle APPLICATION_ERROR message
   */
  async handleApplicationError(data, port) {
    try {
      const url = this.state.applicationUrl;

      // Add to submitted links with ERROR status
      this.state.submittedLinks.push({
        url,
        error: data,
        status: "ERROR",
        timestamp: Date.now(),
      });

      // Close the application tab
      try {
        if (this.state.applyTabId) {
          await chrome.tabs.remove(this.state.applyTabId);
        }
      } catch (tabError) {
        console.error("Error closing tab:", tabError);
      }

      // Send response to the port
      this.sendPortResponse(port, {
        type: "SUCCESS",
        message: "Error acknowledged",
      });

      // Reset application state
      this.resetApplicationState();

      // Notify search tab to continue
      this.notifySearchNext({
        url,
        status: "ERROR",
        message: typeof data === "string" ? data : "Application error",
      });
    } catch (error) {
      console.error("Error handling application error:", error);

      // Reset application state
      this.resetApplicationState();

      // Try to notify search tab
      this.notifySearchNext({
        url: this.state.applicationUrl,
        status: "ERROR",
        message: "Failed to process error: " + error.message,
      });
    }
  },

  /**
   * Handle APPLICATION_SKIPPED message
   */
  async handleApplicationSkipped(data, port) {
    try {
      const url = this.state.applicationUrl;

      // Add to submitted links with SKIPPED status
      this.state.submittedLinks.push({
        url,
        reason: data,
        status: "SKIPPED",
        timestamp: Date.now(),
      });

      // Close the application tab
      try {
        if (this.state.applyTabId) {
          await chrome.tabs.remove(this.state.applyTabId);
        }
      } catch (tabError) {
        console.error("Error closing tab:", tabError);
      }

      // Send response to the port
      this.sendPortResponse(port, {
        type: "SUCCESS",
        message: "Skip acknowledged",
      });

      // Reset application state
      this.resetApplicationState();

      // Notify search tab to continue
      this.notifySearchNext({
        url,
        status: "SKIPPED",
        message: data,
      });
    } catch (error) {
      console.error("Error handling application skip:", error);

      // Reset application state
      this.resetApplicationState();

      // Try to notify search tab
      this.notifySearchNext({
        url: this.state.applicationUrl,
        status: "ERROR",
        message: "Failed to process skip: " + error.message,
      });
    }
  },

  /**
   * Handle SEARCH_COMPLETED message
   */
  handleSearchCompleted() {
    this.completeSearch("Search completed by content script");
  },

  /**
   * Handle startApplying message
   */
  async handleStartApplyingMessage(request, sendResponse) {
    try {
      if (this.state.started) {
        sendResponse({
          status: "already_started",
          message: "ZipRecruiter job search already in progress",
        });
        return;
      }

      const userId = request.userId;
      const jobsToApply = request.jobsToApply || 10;
      this.state.devMode = request.devMode || false;

      // Fetch user data
      const response = await fetch(`${HOST}/api/user/${userId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch user details: ${response.status}`);
      }

      const userData = await response.json();

      // Format user data
      const formattedData = formatUserDataForJobApplication(
        userData,
        userId,
        request.sessionToken,
        jobsToApply,
        "ziprecruiter",
        HOST,
        this.state.devMode
      );

      // Format submitted links
      const submittedLinks = formatApplicationsToSubmittedLinks(
        request.submittedLinks || [],
        "ziprecruiter"
      );

      // Update state
      this.state.submittedLinks = submittedLinks || [];
      console.log(formattedData.session);
      this.state.profile = formattedData.profile;
      this.state.session = formattedData.session;
      this.state.avatarUrl = formattedData.avatarUrl;
      this.state.userId = userId;
      this.state.serverBaseUrl = HOST;
      this.state.jobsLimit = jobsToApply;

      let searchUrl = "https://www.ziprecruiter.com/jobs-search";

      // Add search parameters
      const searchParams = new URLSearchParams();

      // Add job role (search term)
      if (this.state.session.role) {
        searchParams.append("search", this.state.session.role);
      }

      // Add location
      if (this.state.session.country) {
        searchParams.append("location", this.state.session.country);
      }
      console.log(this.state.session.jobAge);
      // Handle remote filter correctly
      if (this.state.session.workplace) {
        searchParams.append("refine_by_location_type", "only_remote");
      } else {
        searchParams.append("refine_by_location_type", ""); // For in-person jobs
        // searchParams.append("refine_by_location_type", "no_remote"); // For in-person jobs
      }

      // Handle date posted filter
      if (this.state.session.jobAge) {
        searchParams.append("days", this.state.session.jobAge);
      } else {
        searchParams.append("days", ""); // Any time
      }

      console.log(this.state.session.jobType);
      const jobType = this.state.session.jobType.toLowerCase() || "all";
      searchParams.append("refine_by_employment", `employment_type:${jobType}`);

      // Handle salary filters
      if (this.state.session.minSalary) {
        searchParams.append("refine_by_salary", this.state.session.minSalary);
      }

      if (this.state.session.maxSalary) {
        searchParams.append(
          "refine_by_salary_ceil",
          this.state.session.maxSalary
        );
      }

      // Add standard search parameter
      searchParams.append("radius", "25");

      // Complete search URL with parameters
      if (searchParams.toString()) {
        searchUrl += "?" + searchParams.toString();
      }

      // Create search window
      const window = await chrome.windows.create({
        url: searchUrl,
        state: "maximized",
      });

      this.state.windowId = window.id;
      this.state.searchTabId = window.tabs[0].id;
      this.state.started = true;

      sendResponse({
        status: "started",
        message: "ZipRecruiter job search process initiated",
      });
    } catch (error) {
      console.error("Error starting ZipRecruiter job search:", error);
      sendResponse({
        status: "error",
        message: "Failed to start ZipRecruiter job search: " + error.message,
      });
    }
  },

  /**
   * Handle getProfileData message
   */
  async handleGetProfileDataMessage(request, sendResponse) {
    try {
      if (this.state.profile) {
        // Use cached profile
        sendResponse({
          success: true,
          data: this.state.profile,
        });
        return;
      }

      // Fetch new profile data
      const userId = this.state.userId;
      if (!userId) {
        throw new Error("User ID not available");
      }

      const response = await fetch(
        `${this.state.serverBaseUrl}/api/user/${userId}`
      );
      if (!response.ok) {
        throw new Error(`Failed to fetch user details: ${response.status}`);
      }

      const userData = await response.json();

      // Format data
      const formattedData = formatUserDataForJobApplication(
        userData,
        userId,
        this.state.session?.apiKey,
        this.state.jobsLimit,
        "ziprecruiter",
        this.state.serverBaseUrl,
        this.state.devMode
      );

      // Cache and return
      this.state.profile = formattedData.profile;

      sendResponse({
        success: true,
        data: this.state.profile,
      });
    } catch (error) {
      console.error("Error getting profile data:", error);
      sendResponse({
        success: false,
        message: error.message,
      });
    }
  },

  /**
   * Handle openJobInNewTab message
   */
  async handleOpenJobInNewTab(request, sendResponse) {
    try {
      // Check if already processing a job
      if (this.state.applicationInProgress) {
        console.log("Already processing a job, ignoring new tab request");
        sendResponse({
          success: false,
          message: "Already processing another job",
        });
        return;
      }

      // Update state
      this.state.applicationInProgress = true;
      this.state.applicationUrl = request.url;
      this.state.applicationStartTime = Date.now();

      // Create tab
      const tab = await chrome.tabs.create({
        url: request.url,
        windowId: this.state.windowId,
      });

      this.state.applyTabId = tab.id;

      sendResponse({
        success: true,
        tabId: tab.id,
      });
    } catch (error) {
      // Reset state on error
      this.resetApplicationState();

      console.error("Error opening job tab:", error);
      sendResponse({
        success: false,
        message: error.message,
      });
    }
  },

  /**
   * Handle applicationCompleted message
   * Improved to handle potential port closure
   */
  async handleApplicationCompletedMessage(request, sender, sendResponse) {
    try {
      // Extract URL from request or sender
      const url = request.url || sender?.tab?.url || "unknown";

      // Log the receipt of the message to debug later
      console.log("Received applicationCompleted message:", {
        url: url,
        sender: sender?.tab?.id || "unknown",
        data: request.data ? { ...request.data } : null,
      });

      // Check if this is a duplicate (already processed)
      const isDuplicate = this.state.submittedLinks.some(
        (link) => this.isUrlMatch(link.url, url) && link.status === "SUCCESS"
      );

      if (isDuplicate) {
        console.log("Ignoring duplicate application completion for URL:", url);

        // Still send success response
        if (sendResponse) {
          try {
            sendResponse({ status: "success", duplicate: true });
          } catch (e) {
            console.warn("Error sending response:", e);
          }
        }
        return;
      }

      // Add to submitted links
      this.state.submittedLinks.push({
        url,
        details: request.data || null,
        status: "SUCCESS",
        timestamp: Date.now(),
      });

      // Track job application and send to API
      const userId = this.state.userId;

      const apiPromises = [];

      if (userId) {
        // Create promises but don't await them yet
        apiPromises.push(
          fetch(`${this.state.serverBaseUrl}/api/applications`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId }),
          }).catch((e) => console.error("API applications error:", e))
        );
      }

      if (request.data) {
        apiPromises.push(
          fetch(`${this.state.serverBaseUrl}/api/applied-jobs`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...request.data,
              userId,
              applicationPlatform: "ziprecruiter",
            }),
          }).catch((e) => console.error("API applied-jobs error:", e))
        );
      }

      // Execute API calls in parallel but don't block on them
      if (apiPromises.length > 0) {
        Promise.all(apiPromises).catch((error) => {
          console.error("Error in API calls:", error);
        });
      }

      // Increment count immediately
      this.state.jobsApplied++;

      // Send success response if callback exists
      if (sendResponse) {
        try {
          sendResponse({ status: "success" });
        } catch (responseError) {
          console.warn("Error sending response:", responseError);
        }
      }

      // Reset application state
      this.resetApplicationState();

      // Check if we've reached the limit
      if (this.state.jobsApplied >= this.state.jobsLimit) {
        this.completeSearch("Reached application limit");
      } else {
        // Notify search tab
        this.notifySearchNext({
          url,
          status: "SUCCESS",
        });
      }

      // Return success for async handlers
      return true;
    } catch (error) {
      console.error("Error handling application completion message:", error);

      // Try to send response if possible
      if (sendResponse) {
        try {
          sendResponse({ status: "error", message: error.message });
        } catch (e) {
          console.warn("Error sending error response:", e);
        }
      }

      // Reset and continue anyway
      this.resetApplicationState();
      this.notifySearchNext({
        url: request.url || sender?.tab?.url || "unknown",
        status: "ERROR",
        message: error.message,
      });

      // Return true to indicate we handled it
      return true;
    }
  },

  /**
   * Helper method to safely close a tab
   */
  async tryCloseTab(tabId) {
    if (!tabId) return false;

    try {
      // Check if tab exists before removing
      const tab = await chrome.tabs.get(tabId);
      if (tab) {
        await chrome.tabs.remove(tabId);
        return true;
      }
    } catch (e) {
      // Tab might not exist anymore, which is fine
      console.log("Tab not found or already closed:", tabId);
    }
    return false;
  },

  /**
   * Handle applicationError message
   */
  async handleApplicationErrorMessage(request, sender, sendResponse) {
    try {
      // Extract URL from request or sender
      const url = request.url || sender.tab.url;

      // Add to submitted links
      this.state.submittedLinks.push({
        url,
        error: request.message,
        status: "ERROR",
        timestamp: Date.now(),
      });

      // Close the tab
      try {
        if (sender.tab?.id) {
          await chrome.tabs.remove(sender.tab.id);
        } else if (this.state.applyTabId) {
          await chrome.tabs.remove(this.state.applyTabId);
        }
      } catch (tabError) {
        console.error("Error closing tab:", tabError);
      }

      // Send response
      sendResponse({ status: "success" });

      // Reset application state
      this.resetApplicationState();

      // Notify search tab
      this.notifySearchNext({
        url,
        status: "ERROR",
        message: request.message || "Application error",
      });
    } catch (error) {
      console.error("Error handling application error message:", error);
      sendResponse({ status: "error", message: error.message });

      // Reset and continue
      this.resetApplicationState();
      this.notifySearchNext({
        url: request.url || sender.tab.url,
        status: "ERROR",
        message: error.message,
      });
    }
  },

  /**
   * Handle applicationSkipped message
   */
  async handleApplicationSkippedMessage(request, sender, sendResponse) {
    try {
      // Extract URL from request or sender
      const url = request.url || sender.tab.url;

      // Add to submitted links
      this.state.submittedLinks.push({
        url,
        reason: request.message,
        status: "SKIPPED",
        timestamp: Date.now(),
      });

      // Close the tab
      try {
        if (sender.tab?.id) {
          await chrome.tabs.remove(sender.tab.id);
        } else if (this.state.applyTabId) {
          await chrome.tabs.remove(this.state.applyTabId);
        }
      } catch (tabError) {
        console.error("Error closing tab:", tabError);
      }

      // Send response
      sendResponse({ status: "success" });

      // Reset application state
      this.resetApplicationState();

      // Notify search tab
      this.notifySearchNext({
        url,
        status: "SKIPPED",
        message: request.message || "Skipped application",
      });
    } catch (error) {
      console.error("Error handling application skip message:", error);
      sendResponse({ status: "error", message: error.message });

      // Reset and continue
      this.resetApplicationState();
      this.notifySearchNext({
        url: request.url || sender.tab.url,
        status: "ERROR",
        message: error.message,
      });
    }
  },

  /**
   * Reset application state
   */
  resetApplicationState() {
    this.state.applicationInProgress = false;
    this.state.applicationUrl = null;
    this.state.applicationStartTime = null;
    this.state.applyTabId = null;
  },

  /**
   * Reset the entire state
   */
  async resetState() {
    try {
      // Close apply tab if it exists
      if (this.state.applyTabId) {
        try {
          await chrome.tabs.remove(this.state.applyTabId);
        } catch (e) {
          console.warn("Error closing apply tab:", e);
        }
      }

      // Reset application state
      this.resetApplicationState();

      // Reset state
      this.state = {
        // Session data
        userId: null,
        profile: null,
        session: null,
        devMode: false,
        serverBaseUrl: HOST,
        avatarUrl: "",

        // Window and tab tracking
        windowId: null,
        searchTabId: null,
        applyTabId: null,

        // Application state
        started: false,
        applicationInProgress: false,
        applicationUrl: null,
        applicationStartTime: null,

        // Job search parameters
        jobsLimit: 100,
        jobsApplied: 0,
        searchDomain: ["ziprecruiter.com"],
        submittedLinks: [],

        // Last activity timestamp for health check
        lastActivity: Date.now(),
      };

      console.log("State has been reset");
    } catch (error) {
      console.error("Error resetting state:", error);
    }
  },

  /**
   * Handle tab removal to clean up state
   */
  handleTabRemoved(tabId, removeInfo) {
    console.log("Tab removed:", tabId);
    this.state.lastActivity = Date.now();

    // Update state if needed
    if (this.state.searchTabId === tabId) {
      this.state.searchTabId = null;
    }

    if (this.state.applyTabId === tabId) {
      // If this was the application tab and task is still active, handle as error
      if (this.state.applicationInProgress) {
        const url = this.state.applicationUrl;

        // Mark as error in submitted links
        if (url) {
          this.state.submittedLinks.push({
            url,
            status: "ERROR",
            error: "Tab was closed before completion",
            timestamp: Date.now(),
          });
        }

        // Reset application state
        this.resetApplicationState();

        // Notify search tab to continue
        if (url) {
          this.notifySearchNext({
            url,
            status: "ERROR",
            message: "Tab was closed before completion",
          });
        }
      } else {
        // Just clear the state
        this.state.applyTabId = null;
      }
    }
  },

  /**
   * Complete the search process
   */
  completeSearch(reason) {
    try {
      console.log("Search completed:", reason);

      // Show completion notification
      try {
        chrome.notifications.create({
          type: "basic",
          iconUrl: "icon.png",
          title: "ZipRecruiter Job Search Completed",
          message: `Successfully completed ${this.state.jobsApplied} applications.`,
        });
      } catch (error) {
        console.warn("Error showing notification:", error);
      }

      // Reset started state
      this.state.started = false;

      console.log("All tasks completed successfully");
    } catch (error) {
      console.error("Error in completeSearch:", error);
    }
  },

  /**
   * Notify search tab to continue to next job
   */
  notifySearchNext(data) {
    try {
      if (this.state.searchTabId) {
        chrome.tabs.sendMessage(this.state.searchTabId, {
          type: "SEARCH_NEXT",
          data,
        });
      }
    } catch (error) {
      console.error("Error sending SEARCH_NEXT message:", error);
    }
  },

  /**
   * Check if two URLs match (after normalization)
   */
  isUrlMatch(url1, url2) {
    if (!url1 || !url2) return false;

    try {
      // Normalize both URLs
      const normalize = (url) => {
        if (!url.startsWith("http")) {
          url = "https://" + url;
        }

        try {
          const urlObj = new URL(url);
          return (urlObj.origin + urlObj.pathname)
            .toLowerCase()
            .trim()
            .replace(/\/+$/, "");
        } catch (e) {
          return url.toLowerCase().trim();
        }
      };

      const normalized1 = normalize(url1);
      const normalized2 = normalize(url2);

      return (
        normalized1 === normalized2 ||
        normalized1.includes(normalized2) ||
        normalized2.includes(normalized1)
      );
    } catch (e) {
      console.error("Error comparing URLs:", e);
      return false;
    }
  },

  /**
   * Handle port message
   */
  handlePortMessage(message, port) {
    try {
      console.log("Port message received:", message);
      this.state.lastActivity = Date.now();

      // Extract message type and data
      const { type, data, requestId } = message || {};

      if (!type) {
        this.sendPortResponse(port, {
          type: "ERROR",
          message: "Message missing type field",
        });
        return;
      }

      switch (type) {
        case "GET_SEARCH_TASK":
          this.handleGetSearchTask(port);
          break;

        case "GET_PROFILE_DATA":
          this.handleGetProfileData(data?.url, port);
          break;

        case "GET_APPLICATION_TASK":
          this.handleGetApplicationTask(port);
          break;

        case "START_APPLICATION":
          this.handleStartApplication(data, port, requestId);
          break;

        case "APPLICATION_COMPLETED":
          this.handleApplicationCompleted(data, port);
          break;

        case "APPLICATION_ERROR":
          this.handleApplicationError(data, port);
          break;

        case "APPLICATION_SKIPPED":
          this.handleApplicationSkipped(data, port);
          break;

        case "SEARCH_COMPLETED":
          this.handleSearchCompleted();
          break;

        case "CHECK_APPLICATION_STATUS":
          this.handleCheckApplicationStatus(port, requestId);
          break;

        case "SEARCH_NEXT_READY":
          // Just acknowledge that the search tab is ready for next job
          this.sendPortResponse(port, {
            type: "NEXT_READY_ACKNOWLEDGED",
          });
          break;

        case "KEEPALIVE":
          // Just update the last activity time and respond
          this.sendPortResponse(port, {
            type: "KEEPALIVE_RESPONSE",
            data: { timestamp: Date.now() },
          });
          break;

        default:
          console.log("Unhandled port message type:", type);
          break;
      }
    } catch (error) {
      console.error("Error handling port message:", error);
      this.sendPortResponse(port, {
        type: "ERROR",
        message: "Error handling message: " + error.message,
      });
    }
  },

  /**
   * Handle check application status
   */
  handleCheckApplicationStatus(port, requestId) {
    this.sendPortResponse(port, {
      type: "APPLICATION_STATUS",
      requestId: requestId,
      data: {
        inProgress: this.state.applicationInProgress,
        url: this.state.applicationUrl,
        tabId: this.state.applyTabId,
      },
    });

    // Also respond via chrome.tabs.sendMessage for redundancy
    if (requestId && this.getTabIdFromPort(port)) {
      try {
        chrome.tabs.sendMessage(this.getTabIdFromPort(port), {
          type: "APPLICATION_STATUS",
          requestId: requestId,
          data: {
            inProgress: this.state.applicationInProgress,
            url: this.state.applicationUrl,
            tabId: this.state.applyTabId,
          },
        });
      } catch (error) {
        console.warn("Error sending redundant status message:", error);
      }
    }
  },

  /**
   * Extract tab ID from port
   */
  getTabIdFromPort(port) {
    try {
      if (port && port.sender && port.sender.tab) {
        return port.sender.tab.id;
      }

      // Try to extract from port name
      if (port && port.name) {
        const parts = port.name.split("-");
        if (parts.length >= 3 && !isNaN(parseInt(parts[parts.length - 1]))) {
          return parseInt(parts[parts.length - 1]);
        }
      }

      return null;
    } catch (error) {
      console.warn("Error extracting tab ID from port:", error);
      return null;
    }
  },

  /**
   * Handle start application
   */
  async handleStartApplication(data, port, requestId) {
    try {
      // Check if already processing an application
      if (this.state.applicationInProgress) {
        console.log("Already have an active application, ignoring new request");

        // Send response message for the specific request
        if (requestId && this.getTabIdFromPort(port)) {
          chrome.tabs.sendMessage(this.getTabIdFromPort(port), {
            type: "APPLICATION_START_RESPONSE",
            requestId,
            success: false,
            message: "An application is already in progress",
          });
        }

        return;
      }

      // Check if URL already processed
      const url = data.url;
      const isDuplicate = this.state.submittedLinks.some((link) =>
        this.isUrlMatch(link.url, url)
      );

      if (isDuplicate) {
        console.log("URL already processed:", url);

        // Send responses
        this.sendPortResponse(port, {
          type: "DUPLICATE",
          message: "This job has already been processed",
          data: { url },
        });

        if (requestId && this.getTabIdFromPort(port)) {
          chrome.tabs.sendMessage(this.getTabIdFromPort(port), {
            type: "APPLICATION_START_RESPONSE",
            requestId,
            success: false,
            duplicate: true,
            message: "This job has already been processed",
          });
        }

        return;
      }

      // Set state before proceeding
      this.state.applicationInProgress = true;
      this.state.applicationUrl = url;
      this.state.applicationStartTime = Date.now();

      // Add to submitted links with PROCESSING status
      this.state.submittedLinks.push({
        url,
        status: "PROCESSING",
        timestamp: Date.now(),
      });

      // Acknowledge the request
      this.sendPortResponse(port, {
        type: "APPLICATION_STARTING",
        data: { url },
      });

      // Also send specific response to the request
      if (requestId && this.getTabIdFromPort(port)) {
        chrome.tabs.sendMessage(this.getTabIdFromPort(port), {
          type: "APPLICATION_START_RESPONSE",
          requestId,
          success: true,
          data: { url },
        });
      }

      // Create the application tab
      try {
        const tab = await chrome.tabs.create({
          url,
          windowId: this.state.windowId,
          active: true, // Make it the active tab
        });

        this.state.applyTabId = tab.id;
        console.log("Application tab created:", tab.id);
      } catch (error) {
        console.error("Error creating application tab:", error);

        // Reset application state on error
        this.resetApplicationState();

        // Remove from submitted links
        const index = this.state.submittedLinks.findIndex((link) =>
          this.isUrlMatch(link.url, url)
        );

        if (index !== -1) {
          this.state.submittedLinks.splice(index, 1);
        }

        // Notify search tab of error
        this.notifySearchNext({
          url,
          status: "ERROR",
          message: "Failed to create application tab: " + error.message,
        });
      }
    } catch (error) {
      console.error("Error starting application:", error);

      // Send error responses
      this.sendPortResponse(port, {
        type: "ERROR",
        message: "Error starting application: " + error.message,
      });

      if (requestId && this.getTabIdFromPort(port)) {
        chrome.tabs.sendMessage(this.getTabIdFromPort(port), {
          type: "APPLICATION_START_RESPONSE",
          requestId,
          success: false,
          message: "Error starting application: " + error.message,
        });
      }

      // Reset application state on error
      this.resetApplicationState();
    }
  },
};

export { ZipRecruiterManager };
