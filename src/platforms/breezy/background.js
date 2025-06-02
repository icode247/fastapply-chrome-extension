import { HOST } from "@shared/constants";
import {
  formatUserDataForJobApplication,
  formatApplicationsToSubmittedLinks,
} from "@shared/userDataFormatter";

console.log("Background Script Initialized");

//Tab not responding timeout
/**
 * BreezyJobApplyManager - Background script for managing Breezy job applications
 * Complete implementation with event handlers and error recovery
 */
const BreezyJobApplyManager = {
  // Tab and window tracking
  windowId: null,

  // Connections map to manage long-lived connections to content scripts
  connections: {
    search: null, // Connection to search tab
    apply: null, // Connection to apply tab
  },

  // Active connections by tab ID for quick lookup
  tabConnections: {},

  // Status tracking
  status: {
    lastActivity: Date.now(),
    healthCheckInterval: null,
  },

  // Store data
  store: {
    tasks: {
      search: {
        tabId: null,
        limit: null,
        domain: null,
        current: 0,
        searchLinkPattern: null,
      },
      sendCv: {
        url: null,
        tabId: null,
        active: false,
        finalUrl: null,
        startTime: null,
      },
    },
    devMode: false,
    profile: null,
    session: null,
    started: false,
    submittedLinks: [],
    platformsFlow: [],
    applyTabOpened: null,
    searchTabTimestamp: Date.now(),
    applyTabTimestamp: null,
    windowTimestamp: null,
    isProcessingJob: false,
    avatarUrl: "",
  },

  /**
   * Initialize the manager
   */
  async init() {
    console.log("Breezy Job Application Manager initialized");

    // Set up connection listener for long-lived connections
    chrome.runtime.onConnect.addListener(this.handleBreezyConnect.bind(this));

    // Set up standard message listener for one-off messages
    chrome.runtime.onMessage.addListener(this.handleBreezyMessage.bind(this));

    // Set up tab removal listener to clean up connections
    chrome.tabs.onRemoved.addListener(this.handleTabRemoved.bind(this));

    // Start health check interval
    this.startHealthCheck();
  },

  /**
   * Start health check interval to detect and recover from stuck states
   */
  startHealthCheck() {
    // Clear any existing interval
    if (this.status.healthCheckInterval) {
      clearInterval(this.status.healthCheckInterval);
    }

    // Set up new interval
    this.status.healthCheckInterval = setInterval(() => this.checkHealth(), 60000); // Check every minute
  },

  /**
   * Check the health of the automation system and recover from stuck states
   */
  async checkHealth() {
    const now = Date.now();
    const inactivityTime = now - this.status.lastActivity;

    // If we have an active send CV task that's been active for over 5 minutes, it might be stuck
    if (this.store.tasks.sendCv.active && this.store.tasks.sendCv.startTime) {
      const taskTime = now - this.store.tasks.sendCv.startTime;

      // If task has been active for over 5 minutes, it's probably stuck
      if (taskTime > 5 * 60 * 1000) {
        console.warn("CV task appears to be stuck for over 5 minutes, attempting recovery");

        try {
          // Force close the tab if it exists
          if (this.store.tasks.sendCv.tabId) {
            await chrome.tabs.remove(this.store.tasks.sendCv.tabId);
          }

          // Mark URL as error
          const url = this.store.tasks.sendCv.url;
          if (url) {
            this.store.submittedLinks.push({
              url,
              status: "ERROR",
              error: "Task timed out after 5 minutes",
              timestamp: now,
            });
          }

          // Reset task state
          const oldUrl = this.store.tasks.sendCv.url;
          this.store.tasks.sendCv = {
            url: null,
            tabId: null,
            active: false,
            finalUrl: null,
            startTime: null,
          };

          // Notify search tab to continue
          this.sendSearchNextMessage({
            url: oldUrl,
            status: "ERROR",
            message: "Task timed out after 5 minutes",
          });

          console.log("Recovery completed for stuck CV task");
        } catch (error) {
          console.error("Error during CV task recovery:", error);
        }
      }
    }

    // If no activity for 10 minutes but we're supposed to be running, check search tab
    if (inactivityTime > 10 * 60 * 1000 && this.store.started) {
      console.warn("No activity for 10 minutes, checking search tab");

      try {
        // Check if search tab still exists
        if (this.store.tasks.search.tabId) {
          try {
            const tab = await chrome.tabs.get(this.store.tasks.search.tabId);
            if (tab) {
              // Tab exists, try to refresh it
              await chrome.tabs.reload(this.store.tasks.search.tabId);
              console.log("Refreshed search tab after inactivity");
            }
          } catch (tabError) {
            // Tab doesn't exist, create a new one
            console.warn("Search tab no longer exists, creating a new one");
            this.recreateSearchTab();
          }
        } else {
          // No search tab ID, create a new one
          this.recreateSearchTab();
        }
      } catch (error) {
        console.error("Error during inactivity recovery:", error);
      }
    }

    // Update last activity time
    this.status.lastActivity = now;
  },

  /**
   * Recreate search tab if it's missing
   */
  async recreateSearchTab() {
    if (!this.store.started || !this.store.session) return;

    try {
      // Build search query
      let searchQuery = `site:breezy.hr ${this.store.session.role || "jobs"}`;
      if (this.store.session.country) {
        searchQuery += ` ${this.store.session.country}`;
      }
      if (this.store.session.city) {
        searchQuery += ` ${this.store.session.city}`;
      }
      if (this.store.session.workplace === "REMOTE") {
        searchQuery += " Remote";
      } else if (this.store.session.workplace === "ON_SITE") {
        searchQuery += " On-site";
      } else if (this.store.session.workplace === "HYBRID") {
        searchQuery += " Hybrid";
      }

      // Check if window exists
      if (this.windowId) {
        try {
          await chrome.windows.get(this.windowId);
          // Create tab in existing window
          const tab = await chrome.tabs.create({
            url: `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`,
            windowId: this.windowId,
          });
          this.store.tasks.search.tabId = tab.id;
          console.log("Created new search tab in existing window:", tab.id);
        } catch (windowError) {
          // Window doesn't exist, create new one
          const window = await chrome.windows.create({
            url: `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`,
            state: "maximized",
          });
          this.windowId = window.id;
          this.store.tasks.search.tabId = window.tabs[0].id;
          console.log("Created new window and search tab:", window.tabs[0].id);
        }
      } else {
        // No window, create new one
        const window = await chrome.windows.create({
          url: `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`,
          state: "maximized",
        });
        this.windowId = window.id;
        this.store.tasks.search.tabId = window.tabs[0].id;
        console.log("Created new window and search tab:", window.tabs[0].id);
      }
    } catch (error) {
      console.error("Error recreating search tab:", error);
    }
  },

  /**
   * Handle connection request from content scripts
   */
  handleBreezyConnect(port) {
    console.log("New connection established:", port.name);
    this.status.lastActivity = Date.now();

    // Store connection based on type
    if (port.name.startsWith("breezy-search-")) {
      // Extract tab ID from port name
      const tabId = parseInt(port.name.split("-")[2]);

      this.connections.search = port;
      this.tabConnections[tabId] = port;

      // If we're already in a started state, update the search tab ID
      if (this.store.started && !this.store.tasks.search.tabId) {
        this.store.tasks.search.tabId = tabId;
        console.log("Updated search tab ID to:", tabId);
      }
    } else if (port.name.startsWith("breezy-apply-")) {
      // Extract tab ID from port name
      const tabId = parseInt(port.name.split("-")[2]);

      this.connections.apply = port;
      this.tabConnections[tabId] = port;

      // If we have a pending CV task, associate it with this tab
      if (this.store.tasks.sendCv.active && !this.store.tasks.sendCv.tabId) {
        this.store.tasks.sendCv.tabId = tabId;
        console.log("Updated sendCv tab ID to:", tabId);
      }
    }

    // Set up message handler for this port
    port.onMessage.addListener((message, senderPort) => {
      console.log("Port message received:", message);
      this.status.lastActivity = Date.now();
      this.handleBreezyPortMessage(message, senderPort);
    });

    // Handle disconnection
    port.onDisconnect.addListener((disconnectedPort) => {
      console.log("Port disconnected:", disconnectedPort.name);

      // Clean up connection references
      if (disconnectedPort === this.connections.search) {
        this.connections.search = null;
      } else if (disconnectedPort === this.connections.apply) {
        this.connections.apply = null;
      }

      // Remove from tab connections
      Object.keys(this.tabConnections).forEach((tabId) => {
        if (this.tabConnections[tabId] === disconnectedPort) {
          delete this.tabConnections[tabId];
        }
      });
    });
  },

  /**
   * Handle messages received through long-lived connections
   */
  handleBreezyPortMessage(message, port) {
    try {
      console.log("Port message received:", message);
      this.status.lastActivity = Date.now();

      // Validate message structure
      if (!message) {
        console.error("Received empty or null message");
        this.trySendResponse(port, {
          type: "ERROR",
          message: "Empty or invalid message received",
        });
        return;
      }

      const type = message.type || message.action;

      if (!type) {
        console.error("Message missing type or action field");
        this.trySendResponse(port, {
          type: "ERROR",
          message: "Message missing type field",
        });
        return;
      }

      switch (type) {
        case "VERIFY_APPLICATION_STATUS":
          // Respond with the actual application status
          const isActive = this.store.tasks.sendCv.active;
          this.trySendResponse(port, {
            type: "APPLICATION_STATUS_RESPONSE",
            data: {
              active: isActive,
              url: this.store.tasks.sendCv.url,
              tabId: this.store.tasks.sendCv.tabId,
            },
          });

          // If there's a state mismatch (search page thinks application is active but it's not)
          if (!isActive) {
            // Try to find which tab this message came from
            const tabId = this.findTabIdFromPort(port);
            if (tabId && tabId === this.store.tasks.search.tabId) {
              // This is from the search tab - send reset message
              this.sendSearchNextMessage({
                status: "RESET",
                message: "Forced reset due to state mismatch",
              });
            }
          }
          break;

        case "GET_SEARCH_TASK":
          this.handleGetSearchTask(port);
          break;

        case "GET_PROFILE_DATA":
          this.handleGetProfileData(message.url, port);
          break;

        case "GET_SEND_CV_TASK":
          this.handleGetSendCvTask(port);
          break;

        case "SEND_CV_TASK":
          if (!message.data) {
            console.error("SEND_CV_TASK message missing data field");
            this.trySendResponse(port, {
              type: "ERROR",
              message: "SEND_CV_TASK message missing data field",
            });
            return;
          }
          this.handleSendCvTask(message.data, port);
          break;

        case "SEND_CV_TASK_DONE":
          this.handleSendCvTaskDone(message.data, port);
          break;

        case "SEND_CV_TASK_ERROR":
          this.handleSendCvTaskError(message.data, port);
          break;

        case "SEND_CV_TASK_SKIP":
          this.handleSendCvTaskSkip(message.data, port);
          break;

        case "SEARCH_TASK_DONE":
          this.handleSearchTaskDone();
          break;

        case "SEARCH_TASK_ERROR":
          this.handleSearchTaskError(message.data);
          break;

        case "KEEPALIVE":
          // Just update the last activity time and respond with success
          this.status.lastActivity = Date.now();
          this.trySendResponse(port, {
            type: "KEEPALIVE_RESPONSE",
            data: { timestamp: this.status.lastActivity },
          });
          break;

        case "SEND_CV_TAB_NOT_RESPOND":
          this.handleSendCvTabNotRespond();
          break;

        case "CHECK_JOB_TAB_STATUS":
          this.handleCheckJobTabStatus(port, message);
          break;

        case "SEARCH_NEXT_READY":
          this.handleSearchNextReady(port, message);
          break;

        case "GET_TAB_ID":
          const tabId = this.findTabIdFromPort(port);
          this.trySendResponse(port, {
            type: "TAB_ID_RESPONSE",
            data: { tabId },
          });
          break;

        default:
          console.log("Unhandled port message type:", type);
          this.trySendResponse(port, {
            type: "ERROR",
            message: "Unknown message type: " + type,
          });
      }
    } catch (error) {
      console.error("Error handling port message:", error);
      this.trySendResponse(port, {
        type: "ERROR",
        message: "Error handling message: " + error.message,
      });
    }
  },

  /**
   * Safely try to send a response on a port
   */
  trySendResponse(port, message) {
    try {
      // Check if port is still connected
      if (port && port.sender) {
        port.postMessage(message);
      }
    } catch (error) {
      console.warn("Failed to send response:", error);
    }
  },

  /**
   * Helper method to find the tab ID associated with a port
   */
  findTabIdFromPort(port) {
    if (!port || !port.name) return null;

    // Extract tab ID from port name (format: breezy-TYPE-TABID)
    const match = port.name.match(/breezy-[^-]+-(\d+)/);
    if (match && match[1]) {
      return parseInt(match[1], 10);
    }

    // Alternative: search through tabConnections
    for (const [tabId, connectionPort] of Object.entries(this.tabConnections)) {
      if (connectionPort === port) {
        return parseInt(tabId, 10);
      }
    }

    return null;
  },

  /**
   * Handle one-off messages (not using long-lived connections)
   */
  async handleBreezyMessage(request, sender, sendResponse) {
    try {
      console.log("One-off message received:", request);
      this.status.lastActivity = Date.now();

      const type = request.action || request.type;

      switch (type) {
        case "startApplying":
          await this.startJobSearch(request, sendResponse);
          break;

        case "checkTabState":
          sendResponse({
            type: "SUCCESS",
            data: {
              started: this.store.started,
              searchTabId: this.store.tasks.search.tabId,
              applyTabId: this.store.tasks.sendCv.tabId,
            },
          });
          break;

        case "getState":
          sendResponse({
            type: "SUCCESS",
            data: {
              store: this.store,
            },
          });
          break;

        case "resetState":
          // Reset the state and clean up
          this.resetState();
          sendResponse({
            type: "SUCCESS",
            message: "State has been reset",
          });
          break;

        case "sendCvTaskDone":
          this.handleSendCvTaskDoneMessage(request, sender, sendResponse);
          break;

        case "sendCvTaskError":
          this.handleSendCvTaskErrorMessage(request, sender, sendResponse);
          break;

        case "sendCvTaskSkip":
          this.handleSendCvTaskSkipMessage(request, sender, sendResponse);
          break;

        case "getProfileData":
          this.handleGetProfileDataMessage(request, sender, sendResponse);
          break;

        case "openJobInNewTab":
          await this.handleOpenJobInNewTab(request, sender, sendResponse);
          break;

        case "checkJobTabStatus":
          this.handleCheckJobTabStatusMessage(request, sender, sendResponse);
          break;

        case "sendCvTabTimerEnded":
          this.handleSendCvTabTimerEndedMessage(request, sender, sendResponse);
          break;

        default:
          console.log("Unhandled one-off message type:", type);
          sendResponse({
            type: "ERROR",
            message: "Unknown message type: " + type,
          });
      }
    } catch (error) {
      console.error("Error in handleBreezyMessage:", error);
      sendResponse({
        type: "ERROR",
        message: error.message,
      });
    }
    return true; // Keep the message channel open for async response
  },

  /**
   * Reset the state of the automation
   */
  async resetState() {
    try {
      // Close tab if it exists
      if (this.store.tasks.sendCv.tabId) {
        try {
          await chrome.tabs.remove(this.store.tasks.sendCv.tabId);
        } catch (e) {
          console.warn("Error closing CV tab:", e);
        }
      }

      // Restore default state
      this.store.tasks.sendCv = {
        url: null,
        tabId: null,
        active: false,
        finalUrl: null,
        startTime: null,
      };

      console.log("State has been reset");
    } catch (error) {
      console.error("Error resetting state:", error);
    }
  },

  /**
   * Handle tab removal to clean up connections
   */
  handleTabRemoved(tabId, removeInfo) {
    console.log("Tab removed:", tabId);
    this.status.lastActivity = Date.now();

    // Clean up connections
    if (this.tabConnections[tabId]) {
      delete this.tabConnections[tabId];
    }

    // Update state if needed
    if (this.store.tasks.search.tabId === tabId) {
      this.store.tasks.search.tabId = null;
    }

    if (this.store.tasks.sendCv.tabId === tabId) {
      // If this was the CV tab and task is still active, handle as error
      if (this.store.tasks.sendCv.active) {
        const url = this.store.tasks.sendCv.url;

        // Mark as error in submitted links
        if (url) {
          this.store.submittedLinks.push({
            url,
            status: "ERROR",
            error: "Tab was closed before completion",
            timestamp: Date.now(),
          });
        }

        // Reset task state
        const oldUrl = url;
        this.store.tasks.sendCv = {
          url: null,
          tabId: null,
          active: false,
          finalUrl: null,
          startTime: null,
        };

        // Notify search tab to continue
        if (oldUrl) {
          this.sendSearchNextMessage({
            url: oldUrl,
            status: "ERROR",
            message: "Tab was closed before completion",
          });
        }
      } else {
        // Just clear the state
        this.store.tasks.sendCv.tabId = null;
        this.store.tasks.sendCv.active = false;
      }
    }
  },

  /**
   * Handler for GET_SEARCH_TASK messages
   */
  handleGetSearchTask(port) {
    // Always respond with the current data, regardless of what tab it's from
    // This avoids the "message port closed" issue
    this.trySendResponse(port, {
      type: "SUCCESS",
      data: {
        ...this.store.tasks.search,
        submittedLinks: this.store.submittedLinks,
      },
    });

    // Extract tab ID from port name
    const portNameParts = port.name.split("-");
    if (portNameParts.length >= 3) {
      const tabId = parseInt(portNameParts[2]);

      // If this is a Google search tab and we're in started state, update the tab ID
      if (this.store.started && this.store.tasks.search.tabId !== tabId) {
        this.store.tasks.search.tabId = tabId;
        console.log("Updated search tab ID to:", tabId);
      }
    }
  },

  /**
   * Handler for GET_PROFILE_DATA messages
   */
  async handleGetProfileData(url, port) {
    try {
      console.log("Getting profile data for URL:", url);

      if (this.store.profile) {
        console.log("Using cached profile data");
        this.trySendResponse(port, {
          type: "PROFILE_DATA_RESPONSE",
          success: true,
          data: this.store.profile,
        });
        return;
      }

      // If no cached profile, fetch from API
      const userId = this.store.userId || this.store.session?.userId;
      if (!userId) {
        throw new Error("User ID not available");
      }

      // Make sure we have a server base URL
      if (!this.store.serverBaseUrl) {
        this.store.serverBaseUrl = HOST;
        console.log("Using default server base URL:", HOST);
      }

      // Fetch user data from API
      console.log("Fetching user data from API for userId:", userId);
      const response = await fetch(`${this.store.serverBaseUrl}/api/user/${userId}`);

      if (!response.ok) {
        throw new Error(`Failed to fetch user details: ${response.status}`);
      }

      const userData = await response.json();
      console.log("User data fetched successfully");

      // Format data consistently
      const formattedData = formatUserDataForJobApplication(
        userData,
        userId,
        this.store.session?.apiKey,
        this.store.tasks.search.limit || 10,
        "breezy",
        this.store.serverBaseUrl,
        this.store.devMode || false
      );

      // Cache profile data
      this.store.profile = formattedData.profile;

      // Send response
      this.trySendResponse(port, {
        type: "PROFILE_DATA_RESPONSE",
        success: true,
        data: this.store.profile,
      });
    } catch (error) {
      console.error("Error getting profile data:", error);
      this.trySendResponse(port, {
        type: "PROFILE_DATA_RESPONSE",
        success: false,
        message: error.message,
      });
    }
  },

  /**
   * Handler for GET_SEND_CV_TASK messages
   */
  handleGetSendCvTask(port) {
    // Always respond with the data needed for applications
    this.trySendResponse(port, {
      type: "SUCCESS",
      data: {
        devMode: this.store.devMode,
        profile: this.store.profile,
        session: this.store.session,
        avatarUrl: this.store.avatarUrl,
      },
    });

    // Extract tab ID from port name
    const portNameParts = port.name.split("-");
    if (portNameParts.length >= 3) {
      const tabId = parseInt(portNameParts[2]);

      // If we have an active CV task but no tab ID, update it
      if (this.store.tasks.sendCv.active && !this.store.tasks.sendCv.tabId) {
        this.store.tasks.sendCv.tabId = tabId;
        console.log("Updated sendCv tab ID to:", tabId);
      }
    }
  },

  /**
   * Start the job search process
   */
  async startJobSearch(request, sendResponse) {
    try {
      console.log("Starting Breezy job search:", request);

      if (this.store.started) {
        console.log("Job search already started, skipping duplicate start");
        sendResponse({
          status: "already_started",
          platform: "breezy",
          message: "Breezy job search already in progress",
        });
        return;
      }

      const userId = request.userId;
      const sessionToken = this.store.sessionToken;
      const jobsToApply = request.jobsToApply || 10;
      this.store.devMode = request.devMode || false;

      const response = await fetch(`${HOST}/api/user/${userId}`);
      if (!response.ok) throw new Error("Failed to fetch user details");
      const userData = await response.json();

      // Use the formatter function to get standardized user data
      const formattedData = formatUserDataForJobApplication(
        userData,
        userId,
        sessionToken,
        jobsToApply,
        "breezy",
        HOST,
        request.devMode || false
      );

      const submittedLinks = formatApplicationsToSubmittedLinks(
        request.submittedLinks || [],
        "breezy"
      );

      this.store.submittedLinks = submittedLinks || [];
      this.store.profile = formattedData.profile;
      this.store.session = formattedData.session;
      this.store.avatarUrl = formattedData.avatarUrl;
      this.store.userId = userId;
      this.store.serverBaseUrl = HOST;

      // Build search query for Google
      let searchQuery = `site:breezy.hr ${this.store.session.role}`;
      if (this.store.session.country) {
        searchQuery += ` ${this.store.session.country}`;
      }
      if (this.store.session.city) {
        searchQuery += ` ${this.store.session.city}`;
      }
      if (this.store.session.workplace === "REMOTE") {
        searchQuery += " Remote";
      } else if (this.store.session.workplace === "ON_SITE") {
        searchQuery += " On-site";
      } else if (this.store.session.workplace === "HYBRID") {
        searchQuery += " Hybrid";
      }

      if (this.windowId) {
        try {
          const existingWindow = await chrome.windows.get(this.windowId);
          if (existingWindow) {
            console.log("Window already exists, focusing it instead of creating new one");
            await chrome.windows.update(this.windowId, { focused: true });

            // Just update the search tab with the new query
            if (this.store.tasks.search.tabId) {
              await chrome.tabs.update(this.store.tasks.search.tabId, {
                url: `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`,
              });

              sendResponse({
                status: "updated",
                platform: "breezy",
                message: "Breezy job search updated with new query",
              });
              return;
            }
          }
        } catch (err) {
          // Window doesn't exist anymore, that's ok, we'll create a new one
          console.log("Previous window no longer exists, creating new one");
          this.windowId = null;
        }
      }

      // Create window with Google search
      const window = await chrome.windows.create({
        url: `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`,
        state: "maximized",
      });

      this.windowId = window.id;
      this.store.tasks.search.tabId = window.tabs[0].id;
      this.store.tasks.search.limit = this.store.session.liftsLimit || 100;
      this.store.tasks.search.current = this.store.session.liftsCurrent || 0;
      this.store.tasks.search.domain = ["breezy.hr", "app.breezy.hr"];
      this.store.windowTimestamp = Date.now();
      this.store.searchTabTimestamp = Date.now();

      // Regular expression pattern for Breezy jobs
      this.store.tasks.search.searchLinkPattern =
        /^https:\/\/([\w-]+\.breezy\.hr\/p\/|app\.breezy\.hr\/jobs\/)([^\/]+)\/?.*$/.toString();

      this.store.started = true;

      sendResponse({
        status: "started",
        platform: "breezy",
        message: "Breezy job search process initiated",
      });
    } catch (error) {
      console.error("Error starting Breezy job search:", error);
      sendResponse({
        status: "error",
        platform: "breezy",
        message: "Failed to start Breezy job search: " + error.message,
      });
    }
  },

  /**
   * Handle open job in new tab request
   */
  async handleOpenJobInNewTab(request, sender, sendResponse) {
    try {
      // Check if already processing a job
      if (this.store.tasks.sendCv.active || this.store.isProcessingJob) {
        console.log("Already processing a job, ignoring new tab request");
        sendResponse({
          success: false,
          message: "Already processing another job",
        });
        return;
      }

      // Mark as processing immediately to prevent race conditions
      this.store.isProcessingJob = true;
      this.store.tasks.sendCv.active = true;
      this.store.tasks.sendCv.url = request.url;
      this.store.applyTabOpened = Date.now();
      this.store.applyTabTimestamp = Date.now();
      this.store.tasks.sendCv.startTime = Date.now();

      // Create tab
      const tab = await chrome.tabs.create({
        url: request.url,
        windowId: this.windowId,
      });

      // Set tab ID
      this.store.tasks.sendCv.tabId = tab.id;

      console.log("Job tab opened", { tabId: tab.id, url: request.url });

      sendResponse({
        success: true,
        tabId: tab.id,
      });
    } catch (error) {
      // Reset flags on error
      this.store.isProcessingJob = false;
      this.store.tasks.sendCv.active = false;
      this.store.tasks.sendCv.url = null;
      this.store.applyTabOpened = null;
      this.store.tasks.sendCv.startTime = null;

      console.error("Error opening job tab:", error);
      sendResponse({
        success: false,
        message: error.message,
      });
    }
  },

  /**
   * Handler for SEND_CV_TASK messages
   */
  async handleSendCvTask(data, port) {
    try {
      if (this.store.tasks.sendCv.active) {
        console.log("Already have an active CV task, ignoring new request");
        this.trySendResponse(port, {
          type: "ERROR",
          message: "Already processing another job application",
        });
        return;
      }

      if (
        this.store.submittedLinks.some(
          (link) =>
            link.url === data.url ||
            data.url.includes(link.url) ||
            (link.url && link.url.includes(data.url))
        )
      ) {
        console.log("URL already processed:", data.url);
        this.trySendResponse(port, {
          type: "DUPLICATE",
          message: "This job has already been processed",
          data: { url: data.url },
        });
        return;
      }

      this.store.submittedLinks.push({
        url: data.url,
        status: "PROCESSING",
        timestamp: Date.now(),
      });

      this.trySendResponse(port, {
        type: "SUCCESS",
        message: "Apply tab will be created",
      });

      const tab = await chrome.tabs.create({
        url: data.url,
        windowId: this.windowId,
      });

      this.store.tasks.sendCv.url = data.url;
      this.store.tasks.sendCv.tabId = tab.id;
      this.store.tasks.sendCv.active = true;
      this.store.tasks.sendCv.startTime = Date.now();
      this.store.applyTabOpened = Date.now();
      this.store.applyTabTimestamp = Date.now();
    } catch (error) {
      console.error("Error in handleSendCvTask:", error);

      const submittedIndex = this.store.submittedLinks.findIndex(
        (link) => link.url === data.url && link.status === "PROCESSING"
      );

      if (submittedIndex !== -1) {
        this.store.submittedLinks.splice(submittedIndex, 1);
      }

      this.trySendResponse(port, {
        type: "ERROR",
        message: error.message,
      });
    }
  },

  /**
   * Handler for SEND_CV_TASK_DONE messages
   */
  async handleSendCvTaskDone(applicationData, port) {
    try {
      // Add to submitted links with success status
      this.store.submittedLinks.push({
        url: this.store.tasks.sendCv.url,
        details: applicationData || null,
        status: "SUCCESS",
        timestamp: Date.now(),
      });

      const userId = this.store.session?.userId;
      console.log(userId);

      try {
        const apiPromises = [];

        if (userId) {
          apiPromises.push(
            fetch(`${HOST}/api/applications`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                userId,
              }),
            }).then((response) => {
              if (!response.ok) {
                throw new Error(`API returned ${response.status}`);
              }
              return response;
            })
          );
        }

        if (applicationData) {
          applicationData.userId = userId;
          applicationData.applicationPlatform = "Breezy";

          apiPromises.push(
            fetch(`${HOST}/api/applied-jobs`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify(applicationData),
            }).then((response) => {
              if (!response.ok) {
                throw new Error(`API returned ${response.status}`);
              }
              return response;
            })
          );
        }

        if (apiPromises.length > 0) {
          await Promise.all(apiPromises);
          console.log("All API calls completed successfully");
        }
      } catch (apiError) {
        console.error("API error:", apiError);
      }

      // Try to close the tab but don't let errors stop the process
      try {
        if (this.store.tasks.sendCv.tabId) {
          await chrome.tabs.remove(this.store.tasks.sendCv.tabId);
        }
      } catch (tabError) {
        console.error("Tab removal error:", tabError);
        // Continue anyway - tab errors shouldn't break the automation
      }

      // Try to send success response but don't let errors stop the process
      try {
        this.trySendResponse(port, {
          type: "SUCCESS",
          message: "Application completed",
        });
      } catch (portError) {
        console.warn("Port error when responding:", portError);
        // Continue anyway - port errors shouldn't break the automation
      }

      // Save old task data before resetting
      const oldSendCvTask = { ...this.store.tasks.sendCv };

      // Reset task state
      this.store.tasks.sendCv = {
        url: null,
        tabId: null,
        active: false,
        finalUrl: null,
        startTime: null,
      };
      this.store.isProcessingJob = false;
      this.store.applyTabOpened = null;

      // Increment application counter
      this.store.tasks.search.current = (this.store.tasks.search.current || 0) + 1;

      // Log for debugging
      console.log(`Completed application ${this.store.tasks.search.current} of ${this.store.tasks.search.limit}`);

      const currentLifts = this.store.tasks.search.current;
      const maxLifts = this.store.tasks.search.limit || 100;

      // Check if we've reached the limit
      if (currentLifts >= maxLifts) {
        await this.finishSuccess("lifts-out");
      } else {
        // Notify search tab to continue to next job using our safer method
        this.sendSearchNextMessage({
          url: oldSendCvTask.url,
          status: "SUCCESS",
        });
      }
    } catch (error) {
      console.error("Error in handleSendCvTaskDone:", error);

      // Even on error, try to notify search tab to continue
      try {
        const url = this.store.tasks.sendCv.url;

        // Reset task state
        this.store.tasks.sendCv = {
          url: null,
          tabId: null,
          active: false,
          finalUrl: null,
          startTime: null,
        };
        this.store.isProcessingJob = false;
        this.store.applyTabOpened = null;

        // Notify search tab
        this.sendSearchNextMessage({
          url,
          status: "ERROR",
          message: error.message,
        });
      } catch (notifyError) {
        console.error("Failed to notify search tab:", notifyError);
      }
    }
  },

  /**
   * Handle message-based SEND_CV_TASK_DONE
   */
  async handleSendCvTaskDoneMessage(request, sender, sendResponse) {
    try {
      console.log("Handling CV task completion from message:", request);

      // Add to submitted links with success status
      this.store.submittedLinks.push({
        url: request.url || sender.tab.url,
        details: request.data || null,
        status: "SUCCESS",
        timestamp: Date.now(),
      });

      const userId = this.store.session?.userId;

      try {
        const apiPromises = [];

        if (userId) {
          apiPromises.push(
            fetch(`${HOST}/api/applications`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                userId,
              }),
            }).then((response) => {
              if (!response.ok) {
                throw new Error(`API returned ${response.status}`);
              }
              return response;
            })
          );
        }

        if (request.data) {
          request.data.userId = userId;
          request.data.applicationPlatform = "Breezy";

          apiPromises.push(
            fetch(`${HOST}/api/applied-jobs`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify(request.data),
            }).then((response) => {
              if (!response.ok) {
                throw new Error(`API returned ${response.status}`);
              }
              return response;
            })
          );
        }

        if (apiPromises.length > 0) {
          await Promise.all(apiPromises);
          console.log("All API calls completed successfully");
        }
      } catch (apiError) {
        console.error("API error:", apiError);
      }

      // Try to close the tab
      try {
        if (sender.tab?.id) {
          await chrome.tabs.remove(sender.tab.id);
        } else if (this.store.tasks.sendCv.tabId) {
          await chrome.tabs.remove(this.store.tasks.sendCv.tabId);
        }
      } catch (tabError) {
        console.error("Tab removal error:", tabError);
      }

      // Save old URL before resetting
      const oldUrl = this.store.tasks.sendCv.url || request.url || sender.tab.url;

      // Reset task state
      this.store.tasks.sendCv = {
        url: null,
        tabId: null,
        active: false,
        finalUrl: null,
        startTime: null,
      };
      this.store.isProcessingJob = false;
      this.store.applyTabOpened = null;

      // Increment application counter
      this.store.tasks.search.current = (this.store.tasks.search.current || 0) + 1;

      sendResponse({ status: "success" });

      const currentLifts = this.store.tasks.search.current;
      const maxLifts = this.store.tasks.search.limit || 100;

      // Check if we've reached the limit
      if (currentLifts >= maxLifts) {
        await this.finishSuccess("lifts-out");
      } else {
        // Notify search tab to continue to next job
        try {
          if (this.store.tasks.search.tabId) {
            await chrome.tabs.sendMessage(this.store.tasks.search.tabId, {
              type: "SEARCH_NEXT",
              data: { url: oldUrl, status: "SUCCESS" },
            });
          }
        } catch (messageError) {
          console.error("Error sending searchNext message:", messageError);
        }
      }
    } catch (error) {
      console.error("Error handling sendCvTaskDone message:", error);
      sendResponse({ status: "error", message: error.message });

      // Try to reset state and continue
      try {
        this.store.tasks.sendCv = {
          url: null,
          tabId: null,
          active: false,
          finalUrl: null,
          startTime: null,
        };
        this.store.isProcessingJob = false;
        this.store.applyTabOpened = null;

        if (this.store.tasks.search.tabId) {
          await chrome.tabs.sendMessage(this.store.tasks.search.tabId, {
            type: "SEARCH_NEXT",
            data: {
              url: request.url || sender.tab.url,
              status: "ERROR",
              message: error.message,
            },
          });
        }
      } catch (recoveryError) {
        console.error("Error in recovery attempt:", recoveryError);
      }
    }
  },

  /**
   * Handler for SEND_CV_TASK_ERROR messages
   */
  async handleSendCvTaskError(errorData, port) {
    try {
      console.log("CV task error:", errorData);

      // Add to submitted links with error status
      this.store.submittedLinks.push({
        url: this.store.tasks.sendCv.url,
        error: errorData,
        status: "ERROR",
        timestamp: Date.now(),
      });

      // Try to close the tab
      try {
        if (this.store.tasks.sendCv.tabId) {
          await chrome.tabs.remove(this.store.tasks.sendCv.tabId);
        }
      } catch (tabError) {
        console.warn("Error closing tab:", tabError);
      }

      // Send response to port
      this.trySendResponse(port, {
        type: "SUCCESS",
        message: "Error acknowledged",
      });

      // Save URL before resetting
      const oldUrl = this.store.tasks.sendCv.url;

      // Reset task state
      this.store.tasks.sendCv = {
        url: null,
        tabId: null,
        active: false,
        finalUrl: null,
        startTime: null,
      };
      this.store.isProcessingJob = false;
      this.store.applyTabOpened = null;

      // Notify search tab to continue
      this.sendSearchNextMessage({
        url: oldUrl,
        status: "ERROR",
        message: typeof errorData === "string" ? errorData : "Application error",
      });
    } catch (error) {
      console.error("Error handling CV task error:", error);
    }
  },

  /**
   * Handle message-based SEND_CV_TASK_ERROR
   */
  async handleSendCvTaskErrorMessage(request, sender, sendResponse) {
    try {
      console.log("Handling CV task error from message:", request);

      // Add to submitted links with error status
      this.store.submittedLinks.push({
        url: request.url || sender.tab.url,
        error: request.message,
        status: "ERROR",
        timestamp: Date.now(),
      });

      // Try to close the tab
      try {
        if (sender.tab?.id) {
          await chrome.tabs.remove(sender.tab.id);
        } else if (this.store.tasks.sendCv.tabId) {
          await chrome.tabs.remove(this.store.tasks.sendCv.tabId);
        }
      } catch (tabError) {
        console.error("Tab removal error:", tabError);
      }

      // Save old URL before resetting
      const oldUrl = this.store.tasks.sendCv.url || request.url || sender.tab.url;

      // Reset task state
      this.store.tasks.sendCv = {
        url: null,
        tabId: null,
        active: false,
        finalUrl: null,
        startTime: null,
      };
      this.store.isProcessingJob = false;
      this.store.applyTabOpened = null;

      sendResponse({ status: "success" });

      // Notify search tab to continue
      try {
        if (this.store.tasks.search.tabId) {
          await chrome.tabs.sendMessage(this.store.tasks.search.tabId, {
            type: "SEARCH_NEXT",
            data: {
              url: oldUrl,
              status: "ERROR",
              message: request.message || "Application error",
            },
          });
        }
      } catch (messageError) {
        console.error("Error sending searchNext message:", messageError);
      }
    } catch (error) {
      console.error("Error handling sendCvTaskError message:", error);
      sendResponse({ status: "error", message: error.message });
    }
  },

  /**
   * Handler for SEND_CV_TASK_SKIP messages
   */
  async handleSendCvTaskSkip(skipReason, port) {
    try {
      console.log("CV task skipped:", skipReason);

      // Add to submitted links with skipped status
      this.store.submittedLinks.push({
        url: this.store.tasks.sendCv.url,
        reason: skipReason,
        status: "SKIPPED",
        timestamp: Date.now(),
      });

      // Try to close the tab
      try {
        if (this.store.tasks.sendCv.tabId) {
          await chrome.tabs.remove(this.store.tasks.sendCv.tabId);
        }
      } catch (tabError) {
        console.warn("Error closing tab:", tabError);
      }

      // Send response to port
      this.trySendResponse(port, {
        type: "SUCCESS",
        message: "Skip acknowledged",
      });

      // Save URL before resetting
      const oldUrl = this.store.tasks.sendCv.url;

      // Reset task state
      this.store.tasks.sendCv = {
        url: null,
        tabId: null,
        active: false,
        finalUrl: null,
        startTime: null,
      };
      this.store.isProcessingJob = false;
      this.store.applyTabOpened = null;

      // Notify search tab to continue
      this.sendSearchNextMessage({
        url: oldUrl,
        status: "SKIPPED",
        message: skipReason,
      });
    } catch (error) {
      console.error("Error handling CV task skip:", error);
    }
  },

  /**
   * Handle message-based SEND_CV_TASK_SKIP
   */
  async handleSendCvTaskSkipMessage(request, sender, sendResponse) {
    try {
      console.log("Handling CV task skip from message:", request);

      // Add to submitted links with skipped status
      this.store.submittedLinks.push({
        url: request.url || sender.tab.url,
        reason: request.message,
        status: "SKIPPED",
        timestamp: Date.now(),
      });

      // Try to close the tab
      try {
        if (sender.tab?.id) {
          await chrome.tabs.remove(sender.tab.id);
        } else if (this.store.tasks.sendCv.tabId) {
          await chrome.tabs.remove(this.store.tasks.sendCv.tabId);
        }
      } catch (tabError) {
        console.error("Tab removal error:", tabError);
      }

      // Save old URL before resetting
      const oldUrl = this.store.tasks.sendCv.url || request.url || sender.tab.url;

      // Reset task state
      this.store.tasks.sendCv = {
        url: null,
        tabId: null,
        active: false,
        finalUrl: null,
        startTime: null,
      };
      this.store.isProcessingJob = false;
      this.store.applyTabOpened = null;

      sendResponse({ status: "success" });

      // Notify search tab to continue
      try {
        if (this.store.tasks.search.tabId) {
          await chrome.tabs.sendMessage(this.store.tasks.search.tabId, {
            type: "SEARCH_NEXT",
            data: {
              url: oldUrl,
              status: "SKIPPED",
              message: request.message || "Skipped application",
            },
          });
        }
      } catch (messageError) {
        console.error("Error sending searchNext message:", messageError);
      }
    } catch (error) {
      console.error("Error handling sendCvTaskSkip message:", error);
      sendResponse({ status: "error", message: error.message });
    }
  },

  /**
   * Handle timer ended message
   */
  async handleSendCvTabTimerEndedMessage(request, sender, sendResponse) {
    try {
      console.log("CV tab timer ended for:", request.url || sender.tab.url);

      // Add to submitted links with timeout status
      this.store.submittedLinks.push({
        url: request.url || sender.tab.url,
        status: "TIMEOUT",
        error: "Application timed out",
        timestamp: Date.now(),
      });

      // Try to close the tab
      try {
        if (sender.tab?.id) {
          await chrome.tabs.remove(sender.tab.id);
        } else if (this.store.tasks.sendCv.tabId) {
          await chrome.tabs.remove(this.store.tasks.sendCv.tabId);
        }
      } catch (tabError) {
        console.error("Tab removal error:", tabError);
      }

      // Save old URL before resetting
      const oldUrl = this.store.tasks.sendCv.url || request.url || sender.tab.url;

      // Reset task state
      this.store.tasks.sendCv = {
        url: null,
        tabId: null,
        active: false,
        finalUrl: null,
        startTime: null,
      };
      this.store.isProcessingJob = false;
      this.store.applyTabOpened = null;

      sendResponse({ status: "success" });

      // Notify search tab to continue
      try {
        if (this.store.tasks.search.tabId) {
          await chrome.tabs.sendMessage(this.store.tasks.search.tabId, {
            type: "SEARCH_NEXT",
            data: {
              url: oldUrl,
              status: "ERROR",
              message: "Application timed out",
            },
          });
        }
      } catch (messageError) {
        console.error("Error sending searchNext message:", messageError);
      }
    } catch (error) {
      console.error("Error handling timer ended message:", error);
      sendResponse({ status: "error", message: error.message });
    }
  },

  /**
   * Safely send SEARCH_NEXT message using all available methods
   */
  sendSearchNextMessage(data) {
    console.log("Sending SEARCH_NEXT message:", data);
    let sent = false;

    // Try using the search connection if available
    if (this.connections.search) {
      try {
        this.connections.search.postMessage({
          type: "SEARCH_NEXT",
          data,
        });
        sent = true;
        console.log("Sent SEARCH_NEXT via search connection");
      } catch (searchError) {
        console.warn("Error sending via search connection:", searchError);
      }
    }

    // If that failed, try using tabs API
    if (!sent && this.store.tasks.search.tabId) {
      try {
        chrome.tabs.sendMessage(this.store.tasks.search.tabId, {
          type: "SEARCH_NEXT",
          data,
        });
        sent = true;
        console.log("Sent SEARCH_NEXT via tabs API");
      } catch (tabError) {
        console.warn("Error sending via tabs API:", tabError);
      }
    }

    // If still not sent, log warning
    if (!sent) {
      console.warn("Failed to send SEARCH_NEXT message. Will rely on timeout recovery.");
    }

    return sent;
  },

  /**
   * Handler for SEARCH_TASK_DONE messages
   */
  async handleSearchTaskDone() {
    try {
      console.log("Search task completed");

      // Show completion notification
      try {
        chrome.notifications.create({
          type: "basic",
          iconUrl: "icon.png", // Update with your extension's icon
          title: "Breezy Job Search Completed",
          message: `Successfully processed ${this.store.tasks.search.current} job listings.`,
        });
      } catch (notificationError) {
        console.warn("Error showing notification:", notificationError);
      }

      // Reset state for next run
      this.store.started = false;

      // Keep the window open but mark as completed
      console.log("Job search automation completed successfully");
    } catch (error) {
      console.error("Error in handleSearchTaskDone:", error);
    }
  },

  /**
   * Handler for SEARCH_TASK_ERROR messages
   */
  async handleSearchTaskError(errorData) {
    try {
      console.error("Search task error:", errorData);

      // Show error notification
      try {
        chrome.notifications.create({
          type: "basic",
          iconUrl: "icon.png", // Update with your extension's icon
          title: "Breezy Job Search Error",
          message: typeof errorData === "string" ? errorData : "An error occurred during job search.",
        });
      } catch (notificationError) {
        console.warn("Error showing notification:", notificationError);
      }

      // Try to reload the search tab
      try {
        if (this.store.tasks.search.tabId) {
          await chrome.tabs.reload(this.store.tasks.search.tabId);
        }
      } catch (reloadError) {
        console.warn("Error reloading search tab:", reloadError);
      }
    } catch (error) {
      console.error("Error handling search task error:", error);
    }
  },

  /**
   * Handler for when CV tab is not responding
   */
  async handleSendCvTabNotRespond() {
    try {
      console.warn("CV tab not responding");

      // Add to submitted links with timeout error
      this.store.submittedLinks.push({
        url: this.store.tasks.sendCv.url,
        error: "Tab not responding timeout",
        status: "ERROR",
        timestamp: Date.now(),
      });

      // Try to close the tab
      try {
        if (this.store.tasks.sendCv.tabId) {
          await chrome.tabs.remove(this.store.tasks.sendCv.tabId);
        }
      } catch (tabError) {
        console.warn("Error closing tab:", tabError);
      }

      // Save URL before resetting
      const oldUrl = this.store.tasks.sendCv.url;

      // Reset task state
      this.store.tasks.sendCv = {
        url: null,
        tabId: null,
        active: false,
        finalUrl: null,
        startTime: null,
      };
      this.store.isProcessingJob = false;
      this.store.applyTabOpened = null;

      // Notify search tab to continue
      this.sendSearchNextMessage({
        url: oldUrl,
        status: "ERROR",
        message: "Tab not responding timeout",
      });
    } catch (error) {
      console.error("Error handling CV tab not respond:", error);
    }
  },

  /**
   * Handle profile data request via message
   */
  async handleGetProfileDataMessage(request, sender, sendResponse) {
    try {
      console.log("Handling getProfileData request");

      // Check if we already have profile data cached
      if (this.store.profile) {
        console.log("Returning cached profile data");
        sendResponse({
          success: true,
          data: this.store.profile,
        });
        return;
      }

      // Get userId from store
      const userId = this.store.userId || this.store.session?.userId;
      if (!userId) {
        throw new Error("User ID not available");
      }

      // Make sure we have a serverBaseUrl
      if (!this.store.serverBaseUrl) {
        this.store.serverBaseUrl = HOST;
        console.log("Set default serverBaseUrl");
      }

      console.log("Fetching user data from API", {
        userId,
        serverBaseUrl: this.store.serverBaseUrl,
      });

      // Fetch user data from API
      const response = await fetch(`${this.store.serverBaseUrl}/api/user/${userId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch user details: ${response.status}`);
      }

      const userData = await response.json();
      console.log("User data fetched successfully");

      // Format the data using your formatter function
      const formattedData = formatUserDataForJobApplication(
        userData,
        userId,
        this.store.sessionToken,
        this.store.tasks.search.limit || 10,
        "breezy",
        this.store.serverBaseUrl,
        this.store.devMode || false
      );

      // Cache the profile data
      this.store.profile = formattedData.profile;

      // Return the profile data
      sendResponse({
        success: true,
        data: this.store.profile,
      });

      console.log("Profile data sent as response");
    } catch (error) {
      console.error("Error fetching profile data:", error);
      sendResponse({
        success: false,
        message: error.message,
      });
    }
  },

  /**
   * Handle job tab status check via message
   */
  handleCheckJobTabStatusMessage(request, sender, sendResponse) {
    console.log("Checking job tab status via message");

    // Check if a job tab is currently open
    const isJobTabOpen = this.store.tasks.sendCv.tabId !== null && this.store.tasks.sendCv.active === true;

    console.log("Job tab status:", {
      isJobTabOpen,
      jobTabId: this.store.tasks.sendCv.tabId,
      jobActive: this.store.tasks.sendCv.active,
    });

    sendResponse({
      status: "success",
      isJobTabOpen: isJobTabOpen,
      jobTabId: this.store.tasks.sendCv.tabId,
    });
  },

  /**
   * Handler for the CHECK_JOB_TAB_STATUS message
   */
  handleCheckJobTabStatus(port, message) {
    console.log("Checking job tab status");

    // Initialize isProcessingJob if not already defined
    if (this.store.isProcessingJob === undefined) {
      this.store.isProcessingJob = false;
    }

    if (this.store.tasks.sendCv.tabId !== null && this.store.tasks.sendCv.active === true) {
      // Job tab is open and active - set processing flag to true
      console.log("Job tab is open and active", {
        tabId: this.store.tasks.sendCv.tabId,
      });

      // If there's an active job, ensure the processing flag is true
      this.store.isProcessingJob = true;

      port.postMessage({
        type: "JOB_TAB_STATUS",
        data: {
          isOpen: true,
          tabId: this.store.tasks.sendCv.tabId,
          isProcessing: true,
        },
      });
    } else {
      // No job tab is currently active
      console.log("No job tab is currently active");

      // Clear the processing flag
      this.store.isProcessingJob = false;

      port.postMessage({
        type: "JOB_TAB_STATUS",
        data: {
          isOpen: false,
          isProcessing: false,
        },
      });
    }
  },

  /**
   * Handler for the SEARCH_NEXT_READY message
   */
  handleSearchNextReady(port, message) {
    console.log("Search next ready signal received");

    // Reset the processing flag
    this.store.isProcessingJob = false;

    port.postMessage({
      type: "NEXT_READY_ACKNOWLEDGED",
      data: {
        status: "success",
      },
    });
  },

  /**
   * Handler for successful completion of the automation
   */
  async finishSuccess(reason) {
    try {
      console.log("Automation completed successfully:", reason);

      // Show completion notification
      try {
        chrome.notifications.create({
          type: "basic",
          iconUrl: "icon.png", // Update with your extension's icon
          title: "Breezy Job Search Completed",
          message: `Successfully completed ${this.store.tasks.search.current} applications.`,
        });
      } catch (notificationError) {
        console.warn("Error showing notification:", notificationError);
      }

      // Reset state
      this.store.started = false;

      // Keep window open but mark as completed
      console.log("All tasks completed successfully");
    } catch (error) {
      console.error("Error in finishSuccess:", error);
    }
  },
};

// Initialize the manager
export { BreezyJobApplyManager };