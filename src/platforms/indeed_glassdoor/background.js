import { HOST } from "@shared/constants";
import {
  formatUserDataForJobApplication,
  formatApplicationsToSubmittedLinks,
} from "@shared/userDataFormatter";
import { getJobURL } from "@shared/utils";

console.log("indeed_glassdoor Background Script Initialized");

/**
 * JobApplyManager - Background script for managing job applications on Indeed and Glassdoor
 * Supports both platforms with platform-specific handling where needed
 */
const JobApplyManager = {
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
    searchDomain: ["indeed.com", "glassdoor.com"],
    submittedLinks: [],

    // Platform
    platform: null, // 'indeed' or 'glassdoor'

    // Last activity timestamp for health check
    lastActivity: Date.now(),
  },

  /**
   * Initialize the manager
   */
  async init() {
    console.log("Job Apply Manager initialized");

    // Set up message listeners
    chrome.runtime.onConnect.addListener(this.handleConnect.bind(this));
    chrome.runtime.onMessage.addListener(this.handleIndeedMessage.bind(this));
    chrome.runtime.onMessage.addListener(this.handleGlassdoorMessage.bind(this));

    // Set up tab removal listener
    chrome.tabs.onRemoved.addListener(this.handleTabRemoved.bind(this));

    // Start health check interval
    this.startHealthCheck();
  },

  create() {
    return new JobApplyManager();
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
    console.log(this.state.platform);
    try {
      // Build search URL based on platform
      let searchUrl;
      const searchParams = new URLSearchParams();

      if (this.state.platform === "indeed") {
        console.log("indeed session", this.state);
        searchUrl = getJobURL(this.state.session.country);

        // Add search parameters
        if (this.state.session.role) {
          searchParams.append("q", this.state.session.role);
        }

        if (this.state.session.location) {
          searchParams.append("l", this.state.session.location);
        }

        if (this.state.session.country) {
          // Country might be used in different ways depending on Indeed's structure
          searchParams.append("sc", this.state.session.country);
        }

        if (this.state.session.workplace === "REMOTE") {
          searchParams.append("remotejob", "1");
        }
      } else if (this.state.platform === "glassdoor") {
        searchUrl = "https://www.glassdoor.com/Job/index.htm";

        // Add search parameters for Glassdoor
        if (this.state.session.role) {
          searchParams.append("sc.keyword", this.state.session.role);
        }

        if (this.state.session.location) {
          searchParams.append("locT", "C");
          searchParams.append("locId", "0"); // This would need to be dynamically determined
          searchParams.append("locKeyword", this.state.session.location);
        }

        if (this.state.session.workplace === "REMOTE") {
          searchParams.append("remoteWorkType", "1");
        }
      } else {
        // Default to Indeed if platform is not specified
        searchUrl = "https://www.indeed.com/jobs";

        if (this.state.session.role) {
          searchParams.append("q", this.state.session.role);
        }

        if (this.state.session.location) {
          searchParams.append("l", this.state.session.location);
        }
      }

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

    // Check port name for platform
    if (port.name.includes("indeed-")) {
      this.state.platform = "indeed";
    } else if (port.name.includes("glassdoor-")) {
      this.state.platform = "glassdoor";
    }

    // Register message handler for this port
    port.onMessage.addListener((message) => {
      this.handlePortMessage(message, port);
    });

    // Handle port disconnection
    port.onDisconnect.addListener(() => {
      console.log("Port disconnected:", port.name);
    });

    // Extract tab ID from port name (format: platform-TYPE-TABID)
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
  handleIndeedMessage(request, sender, sendResponse) {
    try {
      console.log("One-off message received:", request);
      this.state.lastActivity = Date.now();

      const { action, type, platform } = request;
      const messageType = action || type;

      // Update platform if provided in the message
      if (platform) {
        this.state.platform = platform;
      }

      switch (messageType) {
        case "startApplying":
          console.log(request);
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
              platform: this.state.platform,
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
      console.error("Error in handleIndeedMessage:", error);
      sendResponse({
        success: false,
        message: error.message,
      });
    }

    return true; // Keep the message channel open for async response
  },

  /**
   * Handle one-off messages (not using long-lived connections)
   */
  handleGlassdoorMessage(request, sender, sendResponse) {
    try {
      console.log("One-off message received:", request);
      this.state.lastActivity = Date.now();

      const { action, type, platform } = request;
      const messageType = action || type;

      // Update platform if provided in the message
      if (platform) {
        this.state.platform = platform;
      }

      switch (messageType) {
        case "startApplying":
          console.log(request);
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
              platform: this.state.platform,
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
      console.error("Error in handleIndeedMessage:", error);
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
    // Determine search link pattern based on platform
    let searchLinkPattern;
    if (this.state.platform === "indeed") {
      searchLinkPattern =
        /^https:\/\/(www\.)?(indeed\.com\/(viewjob|job|jobs|apply)).*$/;
    } else if (this.state.platform === "glassdoor") {
      searchLinkPattern =
        /^https:\/\/(www\.)?(glassdoor\.com\/(job|Job|partner|apply)).*$/;
    } else {
      // Default pattern that matches both
      searchLinkPattern =
        /^https:\/\/(www\.)?((indeed\.com\/(viewjob|job|jobs|apply))|(glassdoor\.com\/(job|Job|partner|apply))).*$/;
    }

    this.sendPortResponse(port, {
      type: "SEARCH_TASK_DATA",
      data: {
        limit: this.state.jobsLimit,
        current: this.state.jobsApplied,
        domain: this.state.searchDomain,
        submittedLinks: this.state.submittedLinks,
        // Convert regex pattern to string
        searchLinkPattern: searchLinkPattern.toString(),
        platform: this.state.platform,
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
        this.state.platform || "indeed", // Use detected platform
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
        platform: this.state.platform,
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
        platform: this.state.platform,
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
                applicationPlatform: this.state.platform || "indeed",
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
        platform: this.state.platform,
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
        platform: this.state.platform,
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

  async handleStartApplyingMessage(request, sendResponse) {
    try {
      // Add detailed logging for debugging in production
      console.log("[JobApplicator] Starting job application process", {
        platform: request.platform,
        devMode: request.devMode,
        userId: request.userId,
      });

      // Validate request parameters
      if (!request.userId) {
        throw new Error("User ID is required");
      }

      // Check if already in progress
      if (this.state.started) {
        console.log("[JobApplicator] Job search already in progress", {
          platform: this.state.platform,
        });
        sendResponse({
          status: "already_started",
          platform: this.state.platform,
          message: `${this.state.platform} job search already in progress`,
        });
        return;
      }

      // Initialize state with request parameters
      const userId = request.userId;
      const jobsToApply = Math.min(request.jobsToApply || 10, 50); // Limit max jobs for safety
      this.state.devMode = Boolean(request.devMode);
      this.state.platform = (request.platform || "indeed").toLowerCase();

      // Validate platform
      if (!["indeed", "glassdoor"].includes(this.state.platform)) {
        throw new Error(`Unsupported platform: ${this.state.platform}`);
      }

      // Fetch user data with timeout and retry logic
      let userData;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10-second timeout

        const response = await fetch(`${HOST}/api/user/${userId}`, {
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(
            `Failed to fetch user details: ${response.status} ${response.statusText}`
          );
        }

        userData = await response.json();
      } catch (error) {
        if (error.name === "AbortError") {
          throw new Error("User data fetch request timed out");
        }
        throw error;
      }

      // Format user data
      const formattedData = formatUserDataForJobApplication(
        userData,
        userId,
        request.sessionToken,
        jobsToApply,
        this.state.platform,
        HOST,
        this.state.devMode
      );

      // Format submitted links with validation
      const submittedLinks = formatApplicationsToSubmittedLinks(
        Array.isArray(request.submittedLinks) ? request.submittedLinks : [],
        this.state.platform
      );

      // Validate essential session data
      if (!formattedData.session?.role) {
        console.warn("[JobApplicator] Missing job role in session data");
      }

      // Update state with validated data
      this.state.submittedLinks = submittedLinks || [];
      this.state.profile = formattedData.profile;
      this.state.session = formattedData.session;
      this.state.avatarUrl = formattedData.avatarUrl;
      this.state.userId = userId;
      this.state.serverBaseUrl = HOST;
      this.state.jobsLimit = jobsToApply;

      // Start building the search URL
      let searchUrl;
      const searchParams = new URLSearchParams();

      if (this.state.platform === "indeed") {
        // searchUrl = "https://www.indeed.com/jobs";
        searchUrl = getJobURL(this.state.profile.country);

        // Add Indeed-specific search parameters
        if (this.state.session.role) {
          searchParams.append("q", this.state.session.role.trim());
        }
        if (this.state.session.country) {
          searchParams.append("rbl", this.state.session.country.trim());
        }

        if (this.state.session.country) {
          searchParams.append("l", this.state.session.country.trim());
        }

        // Add date posted filter if specified
        if (this.state.session.jobAge) {
          searchParams.append("fromage", this.state.session.jobAge.toString());
        }

        // Add job type filter if specified
        if (this.state.session.jobType) {
          searchParams.append(
            "sc",
            this.mapJobTypeToIndeed(
              this.state.session.jobType.replace("_", "-")
            )
          );
        }
      } else if (this.state.platform === "glassdoor") {
        // Construct Glassdoor URL using their specific format

        // Sanitize and format location/country
        let country = "united-states"; // Default fallback
        if (this.state.session.country) {
          country = this.state.session.country
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, "") 
            .replace(/\s+/g, "-")   
            .trim();
        }

        // Sanitize and format job role
        let role = "software-engineer"; 
        if (this.state.session.role) {
          role = this.state.session.role
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, "") 
            .replace(/\s+/g, "-") 
            .trim();
        }

        // Get country code mapping from a dedicated service
        const countryMapping = await this.getGlassdoorCountryMapping(country);

        // Extract the mapping details
        const ilCode = countryMapping.ilCode;
        const inCode = countryMapping.inCode;

        // Calculate the KO parameters (key offset)
        const koStart = country.length + 1;   
        const koEnd = koStart + role.length;

        // Construct the base Glassdoor URL with all parameters properly formatted and encoded
        searchUrl = `https://www.glassdoor.com/Job/${encodeURIComponent(
          country
        )}-${encodeURIComponent(
          role
        )}-jobs-SRCH_${ilCode}_${inCode}_KO${koStart},${koEnd}.htm`;

        // Easy Apply filter (if enabled)

        searchParams.append("applicationType", "1");
        // Remote work filter
        if (this.state.session.workplace) {
          searchParams.append("remoteWorkType", "1");
        }

        // Salary range filters
        // if (this.state.session.minSalary) {
        //   searchParams.append(
        //     "minSalary",
        //     this.state.session.minSalary.toString()
        //   );
        // }

        // if (this.state.session.maxSalary) {
        //   searchParams.append(
        //     "maxSalary",
        //     this.state.session.maxSalary.toString() ||
        //       this.state.session.minSalary
        //       ? (parseInt(this.state.session.minSalary) * 1.5).toString()
        //       : ""
        //   );
        // }

        // Company rating filter (1.0 to 5.0)
        if (this.state.session.minRating) {
          const rating = parseFloat(this.state.session.minRating);
          // Ensure rating is between 1.0 and 5.0
          if (rating >= 1.0 && rating <= 5.0) {
            searchParams.append("minRating", rating.toFixed(1));
          }
        }

        // Job age filter (days) - fromAge parameter
        const jobAge = parseInt(this.state.session.jobAge) || ""; // Default to 3 days
        searchParams.append("fromAge", jobAge.toString());
      }

      // Complete search URL with parameters
      if (searchParams.toString()) {
        searchUrl += "?" + searchParams.toString();
      }

      console.log("[JobApplicator] Opening job search URL", { searchUrl });

      // Create search window with error handling
      let window;
      try {
        window = await chrome.windows.create({
          url: searchUrl,
          state: "maximized",
        });
      } catch (error) {
        throw new Error(`Failed to create browser window: ${error.message}`);
      }

      // Update state with window information
      this.state.windowId = window.id;
      this.state.searchTabId = window.tabs[0].id;
      this.state.started = true;
      this.state.startTime = Date.now();

      // Add event listeners for window close
      chrome.windows.onRemoved.addListener(this.handleWindowClose.bind(this));

      // Send success response
      sendResponse({
        status: "started",
        platform: this.state.platform,
        message: `${this.state.platform} job search process initiated`,
        searchUrl: searchUrl, // Include the URL for debugging
      });

      // Start monitoring the process
      this.startMonitoring();
    } catch (error) {
      // Comprehensive error handling with detailed logging
      console.error(
        `[JobApplicator] Error starting ${
          this.state.platform || "job"
        } search:`,
        error
      );

      // Reset state in case of failure
      this.resetState();

      // Send detailed error response
      sendResponse({
        status: "error",
        platform: this.state.platform || request.platform || "unknown",
        message: `Failed to start job search: ${error.message}`,
        errorCode: this.categorizeError(error),
        errorDetails: error.stack,
      });
    }
  },

  // Helper method to get Glassdoor country mapping
  async getGlassdoorCountryMapping(country) {
    try {
      // Comprehensive mapping table for Glassdoor country codes
      const countryMappings = {
        // Existing mappings
        nigeria: { ilCode: "IL.0,7", inCode: "IN177" },
        "united-states": { ilCode: "IL.0,13", inCode: "IN1" },
        india: { ilCode: "IL.0,5", inCode: "IN115" },
        "united-kingdom": { ilCode: "IL.0,14", inCode: "IN2" },
        canada: { ilCode: "IL.0,6", inCode: "IN3" },
        australia: { ilCode: "IL.0,9", inCode: "IN16" },
        germany: { ilCode: "IL.0,7", inCode: "IN96" },
        france: { ilCode: "IL.0,6", inCode: "IN86" },
        brazil: { ilCode: "IL.0,6", inCode: "IN43" },
        japan: { ilCode: "IL.0,5", inCode: "IN123" },
        "south-africa": { ilCode: "IL.0,12", inCode: "IN211" },

        // Additional countries from Africa
        egypt: { ilCode: "IL.0,5", inCode: "IN78" },
        ghana: { ilCode: "IL.0,5", inCode: "IN90" },
        kenya: { ilCode: "IL.0,5", inCode: "IN126" },
        morocco: { ilCode: "IL.0,7", inCode: "IN161" },
        algeria: { ilCode: "IL.0,7", inCode: "IN9" },
        tunisia: { ilCode: "IL.0,7", inCode: "IN227" },
        tanzania: { ilCode: "IL.0,8", inCode: "IN222" },
        uganda: { ilCode: "IL.0,6", inCode: "IN231" },
        ethiopia: { ilCode: "IL.0,8", inCode: "IN80" },
        zimbabwe: { ilCode: "IL.0,8", inCode: "IN253" },
        namibia: { ilCode: "IL.0,7", inCode: "IN167" },
        botswana: { ilCode: "IL.0,8", inCode: "IN42" },
        rwanda: { ilCode: "IL.0,6", inCode: "IN198" },

        // Middle East
        "united-arab-emirates": { ilCode: "IL.0,20", inCode: "IN232" },
        "saudi-arabia": { ilCode: "IL.0,12", inCode: "IN207" },
        qatar: { ilCode: "IL.0,5", inCode: "IN187" },
        israel: { ilCode: "IL.0,6", inCode: "IN119" },
        turkey: { ilCode: "IL.0,6", inCode: "IN228" },
        lebanon: { ilCode: "IL.0,7", inCode: "IN132" },
        jordan: { ilCode: "IL.0,6", inCode: "IN124" },

        // Europe
        spain: { ilCode: "IL.0,5", inCode: "IN219" },
        italy: { ilCode: "IL.0,5", inCode: "IN120" },
        netherlands: { ilCode: "IL.0,11", inCode: "IN171" },
        sweden: { ilCode: "IL.0,6", inCode: "IN220" },
        switzerland: { ilCode: "IL.0,11", inCode: "IN221" },
        belgium: { ilCode: "IL.0,7", inCode: "IN25" },
        ireland: { ilCode: "IL.0,7", inCode: "IN118" },
        poland: { ilCode: "IL.0,6", inCode: "IN193" },
        norway: { ilCode: "IL.0,6", inCode: "IN164" },
        denmark: { ilCode: "IL.0,7", inCode: "IN63" },
        finland: { ilCode: "IL.0,7", inCode: "IN83" },
        austria: { ilCode: "IL.0,7", inCode: "IN15" },
        portugal: { ilCode: "IL.0,8", inCode: "IN186" },
        greece: { ilCode: "IL.0,6", inCode: "IN97" },
        "czech-republic": { ilCode: "IL.0,14", inCode: "IN61" },
        romania: { ilCode: "IL.0,7", inCode: "IN196" },
        hungary: { ilCode: "IL.0,7", inCode: "IN108" },

        // Asia Pacific
        singapore: { ilCode: "IL.0,9", inCode: "IN217" },
        "hong-kong": { ilCode: "IL.0,9", inCode: "IN107" },
        malaysia: { ilCode: "IL.0,8", inCode: "IN150" },
        philippines: { ilCode: "IL.0,11", inCode: "IN192" },
        thailand: { ilCode: "IL.0,8", inCode: "IN224" },
        indonesia: { ilCode: "IL.0,9", inCode: "IN113" },
        vietnam: { ilCode: "IL.0,7", inCode: "IN248" },
        "new-zealand": { ilCode: "IL.0,11", inCode: "IN172" },
        taiwan: { ilCode: "IL.0,6", inCode: "IN223" },
        "south-korea": { ilCode: "IL.0,11", inCode: "IN134" },
        china: { ilCode: "IL.0,5", inCode: "IN48" },
        pakistan: { ilCode: "IL.0,8", inCode: "IN179" },
        bangladesh: { ilCode: "IL.0,10", inCode: "IN21" },

        // Latin America
        mexico: { ilCode: "IL.0,6", inCode: "IN155" },
        argentina: { ilCode: "IL.0,9", inCode: "IN12" },
        chile: { ilCode: "IL.0,5", inCode: "IN47" },
        colombia: { ilCode: "IL.0,8", inCode: "IN52" },
        peru: { ilCode: "IL.0,4", inCode: "IN184" },
        venezuela: { ilCode: "IL.0,9", inCode: "IN244" },
        "costa-rica": { ilCode: "IL.0,10", inCode: "IN56" },
        panama: { ilCode: "IL.0,6", inCode: "IN180" },
        ecuador: { ilCode: "IL.0,7", inCode: "IN72" },
        uruguay: { ilCode: "IL.0,7", inCode: "IN237" },

        // North America - additional
        "puerto-rico": { ilCode: "IL.0,11", inCode: "IN188" },
        jamaica: { ilCode: "IL.0,7", inCode: "IN121" },

        // Default fallback to Nigeria if country not found
        default: { ilCode: "IL.0,7", inCode: "IN177" },
      };

      // Logging for debugging in production
      console.log(
        `[JobApplicator] Looking up country mapping for: "${country}"`
      );

      // Return the mapping for the requested country or use default fallback
      return countryMappings[country] || countryMappings["default"];
    } catch (error) {
      console.error("[JobApplicator] Error getting country mapping:", error);
      // Default to Nigeria in case of any error
      return { ilCode: "IL.0,7", inCode: "IN177" };
    }
  },

  mapJobTypeToIndeed(type) {
    const mapping = {
      "Full-time": "0kf:attr(CF3CP);",
      "Part-time": "0kf:attr(75GKK);",
      Contract: "0kf:attr(NJXCK);",
      Temporary: "0kf:attr(4HKF7);",
      Internship: "0kf:attr(VDTG7);",
      "New Grad": "0kf:attr(7EQCZ);",
      Permanent: "0kf:attr(5QWDV);",
      All: "0kf:attr(5QWDV|75GKK|7EQCZ|CF3CP|NJXCK|VDTG7%2COR);",
    };
    return mapping[type] || "";
  },

  // Reset state in case of failure
  resetState() {
    this.state = {
      started: false,
      platform: "",
      windowId: null,
      searchTabId: null,
      submittedLinks: [],
      profile: null,
      session: null,
      jobsLimit: 10,
      devMode: false,
      startTime: null,
    };
  },

  // Categorize error for better client handling
  categorizeError(error) {
    if (error.message.includes("fetch")) return "NETWORK_ERROR";
    if (error.message.includes("create browser window")) return "BROWSER_ERROR";
    if (error.message.includes("User ID is required"))
      return "VALIDATION_ERROR";
    if (error.message.includes("timed out")) return "TIMEOUT_ERROR";
    return "UNKNOWN_ERROR";
  },

  // Start monitoring process
  startMonitoring() {
    this.monitoringInterval = setInterval(() => {
      // Check if process has been running too long (e.g., 30 minutes)
      const runningTime = Date.now() - this.state.startTime;
      if (runningTime > 30 * 60 * 1000) {
        console.warn(
          "[JobApplicator] Job search process running for too long, stopping"
        );
        this.stopProcess();
      }

      // Add additional monitoring logic as needed
    }, 60000); // Check every minute
  },

  // Handle window close event
  handleWindowClose(windowId) {
    if (windowId === this.state.windowId) {
      console.log("[JobApplicator] Search window closed, stopping process");
      this.stopProcess();
    }
  },

  // Stop the process
  stopProcess() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    this.resetState();

    // Notify any listeners that the process has stopped
    if (this.onProcessStopped) {
      this.onProcessStopped();
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
        this.state.platform || "indeed",
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

      // Update platform based on URL if not set
      if (!this.state.platform) {
        if (request.url.includes("indeed.com")) {
          this.state.platform = "indeed";
        } else if (request.url.includes("glassdoor.com")) {
          this.state.platform = "glassdoor";
        }
      }

      // Create tab
      const tab = await chrome.tabs.create({
        url: request.url,
        windowId: this.state.windowId,
      });

      this.state.applyTabId = tab.id;

      sendResponse({
        success: true,
        tabId: tab.id,
        platform: this.state.platform,
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
   */
  async handleApplicationCompletedMessage(request, sender, sendResponse) {
    try {
      // Extract URL from request or sender
      const url = request.url || sender.tab.url;

      // Determine platform from URL if not already set
      if (!this.state.platform) {
        if (
          url.includes("indeed.com") ||
          url.includes("smartapply.indeed.com")
        ) {
          this.state.platform = "indeed";
        } else if (url.includes("glassdoor.com")) {
          this.state.platform = "glassdoor";
        }
      }

      // Add to submitted links
      this.state.submittedLinks.push({
        url,
        details: request.data || null,
        status: "SUCCESS",
        timestamp: Date.now(),
        platform: this.state.platform,
      });

      // Track job application and send to API
      const userId = this.state.userId;

      try {
        const apiPromises = [];

        if (userId) {
          apiPromises.push(
            fetch(`${this.state.serverBaseUrl}/api/applications`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ userId }),
            })
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
                applicationPlatform: this.state.platform || "indeed",
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

      // Increment count
      this.state.jobsApplied++;

      // Send response
      sendResponse({ status: "success" });

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
    } catch (error) {
      console.error("Error handling application completion message:", error);
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
   * Handle applicationError message
   */
  async handleApplicationErrorMessage(request, sender, sendResponse) {
    try {
      // Extract URL from request or sender
      const url = request.url || sender.tab.url;

      // Determine platform from URL if not already set
      if (!this.state.platform) {
        if (
          url.includes("indeed.com") ||
          url.includes("smartapply.indeed.com")
        ) {
          this.state.platform = "indeed";
        } else if (url.includes("glassdoor.com")) {
          this.state.platform = "glassdoor";
        }
      }

      // Add to submitted links
      this.state.submittedLinks.push({
        url,
        error: request.message,
        status: "ERROR",
        timestamp: Date.now(),
        platform: this.state.platform,
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

      // Determine platform from URL if not already set
      if (!this.state.platform) {
        if (
          url.includes("indeed.com") ||
          url.includes("smartapply.indeed.com")
        ) {
          this.state.platform = "indeed";
        } else if (url.includes("glassdoor.com")) {
          this.state.platform = "glassdoor";
        }
      }

      // Add to submitted links
      this.state.submittedLinks.push({
        url,
        reason: request.message,
        status: "SKIPPED",
        timestamp: Date.now(),
        platform: this.state.platform,
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

      // Keep platform but reset other state
      const platform = this.state.platform;

      // Reset state but keep platform
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
        searchDomain: ["indeed.com", "glassdoor.com"],
        submittedLinks: [],

        // Platform
        platform: platform,

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
            platform: this.state.platform,
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
          title: `${this.state.platform} Job Search Completed`,
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
   * Modified handlePortMessage to handle the new requestId field
   */
  handlePortMessage(message, port) {
    try {
      console.log("Port message received:", message);
      this.state.lastActivity = Date.now();

      // Extract message type, data, and requestId
      const { type, data, requestId, platform } = message || {};

      // Update platform if provided in message
      if (platform) {
        this.state.platform = platform;
      }

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
          // Fix: data.url instead of message.url
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
   * Modified handleCheckApplicationStatus to include requestId for response correlation
   */
  handleCheckApplicationStatus(port, requestId) {
    this.sendPortResponse(port, {
      type: "APPLICATION_STATUS",
      requestId: requestId,
      data: {
        inProgress: this.state.applicationInProgress,
        url: this.state.applicationUrl,
        tabId: this.state.applyTabId,
        platform: this.state.platform,
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
            platform: this.state.platform,
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
   * Modified handleStartApplication with improved error handling and duplicate detection
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

      // Determine platform from URL if not already set
      if (!this.state.platform) {
        if (url.includes("indeed.com")) {
          this.state.platform = "indeed";
        } else if (url.includes("glassdoor.com")) {
          this.state.platform = "glassdoor";
        } else {
          // Default to indeed if can't determine
          this.state.platform = "indeed";
        }
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
        platform: this.state.platform,
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

export { JobApplyManager };


