import { BreezyFileHandler } from "@shared/linkedInUtils"; // Assuming this utility exists
import { BreezyFormHandler } from "./breezyFormHandler";
import { HOST } from "@shared/constants";
//fillFormWithProfile
//breezy.hr
/**
 * Helper function for debug logging
 */
function debugLog(message, ...args) {
  console.log(`[BreezyApply] ${message}`, ...args);
}

/**
 * Helper function for error logging
 */
function errorLog(message, error) {
  console.error(`[BreezyApply Error] ${message}`, error);
  if (error?.stack) {
    console.error(error.stack);
  }
}

// Custom error types
class SendCvError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "SendCvError";
    this.details = details;
  }
}

class SendCvSkipError extends SendCvError {
  constructor(message) {
    super(message);
    this.name = "SendCvSkipError";
  }
}

// Configuration
const CONFIG = {
  SELECTORS: {
    JOB_LINKS: "a[href*='breezy.hr/p/'], a[href*='app.breezy.hr/jobs/']",
    GOOGLE_RESULTS:
      "#search .g, #rso .g, div[data-sokoban-container], #rso div[data-hveid], div[data-hveid], .g, .MjjYud, .Gx5Zad",
    FORM_FIELDS:
      "input[type='text'], input[type='email'], input[type='tel'], input[type='number'], select, textarea, input[type='checkbox'], input[type='radio'], input[type='date']",
    DROPZONE:
      "div.dropzone, div[class*='dropzone'], div[class*='upload'], input[type='file'][accept*='pdf']",
    FILE_INPUT: "input[type='file']",
    SUBMIT_BUTTON: "button[type='submit']",
    NEXT_BUTTON:
      "button.btn-primary, button.btn-submit, button[type='submit'], button.button--primary, button.next-step, button.submit",
    SUCCESS_MESSAGE:
      "div.application-confirmation, div.success-message, h1.success-message, div[class*='success'], div.thank-you, div[class*='thankyou']",
    CHECKBOX_CONTAINER:
      ".form-group.checkbox, div[class*='checkbox'], label[class*='checkbox']",
    ERROR_MESSAGE:
      ".error-message, .alert-error, div[class*='error'], .invalid-feedback",
  },
  TIMEOUTS: {
    STANDARD: 2000,
    EXTENDED: 5000,
    MAX_TIMEOUT: 300000, // 5 minutes
    KEEPALIVE_INTERVAL: 10000, // 10 seconds
  },
  DEBUG: true,
  BRAND_COLOR: "#4a90e2", // FastApply brand blue
};

/**
 * BreezyJobAutomation - Content script for automating Breezy job applications
 */
class BreezyJobAutomation {
  constructor() {
    debugLog("Initializing BreezyJobAutomation");

    this.processedLinksCount = 0;
    this.STATUS_BLOCK_POSITION = "top-right";
    this.sendCvPageNotRespondTimeout = null;
    this.countDown = null;
    this.ready = false;
    this.initialized = false;

    // CRITICAL STATE TRACKING FLAGS
    this.isApplicationInProgress = false;
    this.applicationStartTime = null;
    this.processedUrls = new Set();

    // Create connection to background script
    this.initializeConnection();

    // Initialize search data
    this.SEARCH_DATA = {
      tabId: null,
      limit: null,
      domain: null,
      current: null,
      submittedLinks: [],
      searchLinkPattern: null,
    };

    // Set up state checking timer
    // this.stuckStateTimer = setInterval(() => {
    //   if (this.isApplicationInProgress && this.applicationStartTime) {
    //     const now = Date.now();
    //     const elapsedTime = now - this.applicationStartTime;

    //     // If application has been in progress for over 5 minutes, it's probably stuck
    //     if (elapsedTime > 5 * 60 * 1000) {
    //       debugLog(
    //         "Application appears to be stuck for over 5 minutes, forcing reset"
    //       );
    //       this.isApplicationInProgress = false;
    //       this.applicationStartTime = null;
    //       this.appendStatusMessage(
    //         "Application timeout detected - resetting state"
    //       );
    //       setTimeout(() => this.searchNext(), 1000);
    //     }
    //   }
    // }, 60000);

    // CRITICAL: Add state verification interval
    this.stateVerificationInterval = setInterval(() => {
      if (this.isApplicationInProgress && this.port) {
        try {
          debugLog("Verifying application status with background script");
          this.port.postMessage({ type: "VERIFY_APPLICATION_STATUS" });
        } catch (e) {
          debugLog("Error in periodic state verification:", e);
        }
      }
    }, 180000); // Every 30 seconds

    // Create status overlay
    this.createStatusOverlay();

    // Create file handler for resume uploads
    this.fileHandler = new BreezyFileHandler({
      show: (message, type) => {
        debugLog(`[${type || "info"}] ${message}`);
        this.appendStatusMessage(message);
      },
    });

    // We'll initialize the form handler when we have the job data and profile
    this.formHandler = null;

    // Initialize based on page type
    this.detectPageTypeAndInitialize();
  }

  /**
   * Initialize connection with the background script
   */
  initializeConnection() {
    try {
      debugLog("Initializing communication with background script");

      // Create a long-lived connection to the background script
      if (this.port) {
        try {
          this.port.disconnect();
        } catch (e) {
          // Ignore errors when disconnecting
        }
      }

      // Determine the port name based on the current page type
      const isApplyPage =
        window.location.href.includes("breezy.hr/p/") ||
        window.location.href.includes("app.breezy.hr/jobs/");

      // Generate a unique name for this connection
      const timestamp = Date.now();
      const portName = isApplyPage
        ? `breezy-apply-${timestamp}`
        : `breezy-search-${timestamp}`;

      debugLog(`Creating connection with port name: ${portName}`);

      // Create the connection
      this.port = chrome.runtime.connect({
        name: portName,
      });

      if (!this.port) {
        throw new Error(
          "Failed to establish connection with background script"
        );
      }

      // Listen for messages from the background script
      this.port.onMessage.addListener((message) => {
        this.handlePortMessage(message);
      });

      // Handle port disconnection
      this.port.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError;
        if (error) {
          debugLog("Port disconnected due to error:", error);
        } else {
          debugLog("Port disconnected");
        }

        this.port = null;

        // Attempt to reconnect after a short delay
        if (!this.reconnectTimeout) {
          this.reconnectTimeout = setTimeout(() => {
            debugLog("Attempting to reconnect...");
            this.initializeConnection();
            this.reconnectTimeout = null;
          }, 5000);
        }
      });

      // Set up visibility handler to detect when page is hidden/shown
      if (document.visibilityState !== undefined) {
        const visibilityHandler = () => {
          if (document.visibilityState === "visible") {
            debugLog("Page became visible, checking connection");
            // Check if we need to reestablish connection
            if (!this.port) {
              debugLog("Connection lost while page was hidden, reconnecting");
              this.initializeConnection();
            }
          }
        };

        // Remove any existing handler
        document.removeEventListener(
          "visibilitychange",
          this.visibilityHandler
        );

        // Store reference to handler for later removal
        this.visibilityHandler = visibilityHandler;

        // Add new handler
        document.addEventListener("visibilitychange", visibilityHandler);
      }

      this.startKeepAliveInterval();

      return true;
    } catch (error) {
      errorLog("Error initializing connection:", error);
      return false;
    }
  }

  /**
   * Start a keep-alive interval to prevent connection timeouts
   */
  startKeepAliveInterval() {
    // Clear any existing interval
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
    }

    // Send a keepalive message every 25 seconds
    this.keepAliveInterval = setInterval(() => {
      try {
        if (this.port) {
          this.safeSendMessage({ type: "KEEPALIVE" });
        } else {
          // If port is null, try to reconnect
          debugLog("Port is null during keepalive, attempting to reconnect");
          this.initializeConnection();
        }
      } catch (error) {
        debugLog("Error sending keepalive, reconnecting:", error);
        // If error occurs, assume connection is broken and try to reconnect
        this.initializeConnection();
      }
    }, 25000);
  }

  /**
   * Safely send a message through the port
   */
  safeSendMessage(message) {
    try {
      if (!this.port) {
        debugLog("Port not available, attempting to reconnect");
        this.initializeConnection();

        // Wait briefly for connection to establish
        setTimeout(() => {
          if (this.port) {
            this.port.postMessage(message);
          } else {
            debugLog(
              "Failed to send message - port still unavailable after reconnect attempt"
            );
          }
        }, 500);
        return;
      }

      this.port.postMessage(message);
    } catch (error) {
      debugLog("Error sending message:", error);
      // Try to reestablish connection
      this.initializeConnection();
    }
  }

  /**
   * Handle messages received through the port
   */
  handlePortMessage(message) {
    debugLog("Received port message:", message);

    try {
      const { type, data } = message || {};

      if (!type) {
        debugLog("Received message without type, ignoring");
        return;
      }

      switch (type) {
        // CRITICAL: Add case for application status verification
        case "APPLICATION_STATUS_RESPONSE":
          debugLog("Received application status response:", data);
          if (data && data.active === false && this.isApplicationInProgress) {
            debugLog(
              "State mismatch detected! Resetting application progress flag"
            );
            this.isApplicationInProgress = false;
            this.applicationStartTime = null;
            this.appendStatusMessage(
              "Detected state mismatch - resetting flags"
            );

            // Continue search after brief delay
            setTimeout(() => this.searchNext(), 1000);
          }
          break;

        case "DUPLICATE":
          debugLog("Duplicate job detected, resetting application state");
          this.isApplicationInProgress = false;
          if (this.sendCvPageNotRespondTimeout) {
            clearTimeout(this.sendCvPageNotRespondTimeout);
            this.sendCvPageNotRespondTimeout = null;
          }
          this.applicationStartTime = null;
          this.appendStatusMessage(
            "Job already processed: " + (data?.url || "Unknown URL")
          );

          // Continue to next job after a short delay
          setTimeout(() => this.searchNext(), 1000);
          break;

        case "SUCCESS":
          // If this is a response to GET_SEARCH_TASK or GET_SEND_CV_TASK
          if (data) {
            if (data.submittedLinks !== undefined) {
              debugLog("Processing search task data");
              this.processSearchTaskData(data);
            } else if (data.profile !== undefined) {
              debugLog("Processing send CV task data");
              this.processSendCvTaskData(data);
            }
          }
          break;

        case "SEARCH_NEXT":
          debugLog("Handling search next:", data);
          this.handleSearchNext(data);
          break;

        case "ERROR":
          // Fix: Handle the case where data or data.message might be undefined
          const errorMessage =
            data && data.message
              ? data.message
              : "Unknown error from background script";
          errorLog("Error from background script:", errorMessage);
          this.appendStatusErrorMessage("Background error: " + errorMessage);
          break;

        case "JOB_TAB_STATUS":
          this.handleJobTabStatus(data || {});
          break;

        case "NEXT_READY_ACKNOWLEDGED":
          debugLog("Next ready acknowledged by background script");
          // No specific action needed, just an acknowledgment
          break;

        case "PROFILE_DATA_RESPONSE":
          debugLog("Received profile data response");
          if (this.profileDataCallback) {
            try {
              if (message.success === false) {
                this.profileDataCallback(
                  new Error(message.message || "Failed to get profile data")
                );
              } else {
                this.profileDataCallback(null, message.data);
              }
            } catch (e) {
              debugLog("Error calling profile data callback:", e);
            }
            this.profileDataCallback = null;
          }
          break;

        default:
          debugLog(`Unhandled message type: ${type}`);
      }
    } catch (error) {
      errorLog("Error handling port message:", error);
    }
  }

  /**
   * Handle job tab status response from background script
   */
  handleJobTabStatus(data) {
    debugLog("Received job tab status:", data);

    if (data.isOpen === true && data.isProcessing === true) {
      // Job tab is open and active - ensure we know we're waiting
      this.isApplicationInProgress = true;
      this.appendStatusMessage("Job application in progress, waiting...");

      // Check again after a delay
      setTimeout(() => {
        if (this.isApplicationInProgress) {
          this.safeSendMessage({ type: "CHECK_JOB_TAB_STATUS" });
        }
      }, 10000); // Check every 10 seconds
    } else {
      // No job tab is active
      if (this.isApplicationInProgress) {
        debugLog(
          "Resetting application in progress flag as no job tab is active"
        );
        this.isApplicationInProgress = false;
        this.applicationStartTime = null;
        this.appendStatusMessage("No active job application, resuming search");

        // Resume search after a short delay
        setTimeout(() => this.searchNext(), 1000);
      }
    }
  }

  /**
   * Create a status overlay on the page
   */
  createStatusOverlay() {
    // Create the status overlay container
    const container = document.createElement("div");
    container.id = "breezy-status-overlay";
    container.style.cssText = `
        position: fixed;
        top: 10px;
        right: 10px;
        width: 320px;
        max-height: 300px;
        overflow-y: auto;
        background: rgba(0,0,0,0.85);
        color: white;
        padding: 15px;
        font-family: 'Segoe UI', Arial, sans-serif;
        font-size: 13px;
        z-index: 9999999;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.25);
        border-left: 4px solid ${CONFIG.BRAND_COLOR};
        transition: all 0.3s ease;
      `;

    // Create header
    const header = document.createElement("div");
    header.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 10px;
        padding-bottom: 8px;
        border-bottom: 1px solid rgba(255,255,255,0.2);
      `;

    // FastApply logo/name
    const logoDiv = document.createElement("div");
    logoDiv.style.cssText = `
        display: flex;
        align-items: center;
        font-weight: bold;
        font-size: 15px;
      `;

    // Create a simple logo element
    const logoIcon = document.createElement("span");
    logoIcon.textContent = "⚡"; // Lightning bolt emoji
    logoIcon.style.cssText = `
        margin-right: 6px;
        font-size: 18px;
        color: ${CONFIG.BRAND_COLOR};
      `;

    const logoText = document.createElement("span");
    logoText.textContent = "FastApply";
    logoText.style.color = CONFIG.BRAND_COLOR;

    logoDiv.appendChild(logoIcon);
    logoDiv.appendChild(logoText);
    header.appendChild(logoDiv);

    // Status indicator
    this.statusIndicator = document.createElement("span");
    this.statusIndicator.textContent = "Initializing...";
    this.statusIndicator.style.cssText = `
        font-size: 12px;
        padding: 3px 8px;
        background: rgba(74, 144, 226, 0.2);
        border-radius: 12px;
        color: ${CONFIG.BRAND_COLOR};
      `;
    header.appendChild(this.statusIndicator);

    container.appendChild(header);

    // Create log container
    this.logContainer = document.createElement("div");
    this.logContainer.id = "breezy-log-container";
    this.logContainer.style.cssText = `
        margin-top: 10px;
        max-height: 220px;
        overflow-y: auto;
        font-size: 12px;
        line-height: 1.4;
      `;

    const timerContainer = document.createElement("div");
    timerContainer.id = "breezy-automation-status-content";
    container.appendChild(timerContainer);

    container.appendChild(this.logContainer);

    // Append to document
    document.body.appendChild(container);

    // Set initial status
    this.updateStatusIndicator("ready");
  }

  updateStatusIndicator(status, details = "") {
    if (!this.statusIndicator) return;

    let statusText;
    let statusColor;
    let bgColor;

    switch (status) {
      case "ready":
        statusText = "Ready";
        statusColor = "#4caf50";
        bgColor = "rgba(76, 175, 80, 0.2)";
        break;
      case "searching":
        statusText = "Searching";
        statusColor = "#ff9800";
        bgColor = "rgba(255, 152, 0, 0.2)";
        break;
      case "applying":
        statusText = "Applying";
        statusColor = CONFIG.BRAND_COLOR;
        bgColor = `rgba(74, 144, 226, 0.2)`;
        break;
      case "success":
        statusText = "Success";
        statusColor = "#4caf50";
        bgColor = "rgba(76, 175, 80, 0.2)";
        break;
      case "error":
        statusText = "Error";
        statusColor = "#f44336";
        bgColor = "rgba(244, 67, 54, 0.2)";
        break;
      default:
        statusText = status.charAt(0).toUpperCase() + status.slice(1);
        statusColor = CONFIG.BRAND_COLOR;
        bgColor = `rgba(74, 144, 226, 0.2)`;
    }

    this.statusIndicator.textContent = details
      ? `${statusText}: ${details}`
      : statusText;
    this.statusIndicator.style.color = statusColor;
    this.statusIndicator.style.background = bgColor;
  }

  appendStatusMessage(message) {
    if (!this.logContainer) return;

    const timestamp = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    const messageElement = document.createElement("div");
    messageElement.style.cssText = `
        padding: 4px 0;
        border-bottom: 1px solid rgba(255,255,255,0.08);
        animation: fastApplyFadeIn 0.3s ease-in;
      `;

    const timeSpan = document.createElement("span");
    timeSpan.textContent = timestamp;
    timeSpan.style.cssText = `
        color: rgba(255,255,255,0.5);
        margin-right: 8px;
        font-size: 11px;
      `;

    const messageSpan = document.createElement("span");
    messageSpan.textContent = message;

    messageElement.appendChild(timeSpan);
    messageElement.appendChild(messageSpan);

    this.logContainer.appendChild(messageElement);
    this.logContainer.scrollTop = this.logContainer.scrollHeight;

    // Add animation style if not already added
    if (!document.getElementById("fastapply-animation-style")) {
      const style = document.createElement("style");
      style.id = "fastapply-animation-style";
      style.textContent = `
          @keyframes fastApplyFadeIn {
            from { opacity: 0; transform: translateY(-8px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `;
      document.head.appendChild(style);
    }

    // Keep only the last 50 messages
    while (this.logContainer.children.length > 50) {
      this.logContainer.removeChild(this.logContainer.firstChild);
    }
  }

  appendStatusErrorMessage(error) {
    if (!this.logContainer) return;

    const message =
      typeof error === "string" ? error : error.message || "Unknown error";

    const messageElement = document.createElement("div");
    messageElement.style.cssText = `
        padding: 4px 0;
        border-bottom: 1px solid rgba(255,255,255,0.08);
        color: #ff6b6b;
        animation: fastApplyFadeIn 0.3s ease-in;
      `;

    const timestamp = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    const timeSpan = document.createElement("span");
    timeSpan.textContent = timestamp;
    timeSpan.style.cssText = `
        color: rgba(255,255,255,0.5);
        margin-right: 8px;
        font-size: 11px;
      `;

    const errorSpan = document.createElement("span");
    errorSpan.textContent = "ERROR: " + message;

    messageElement.appendChild(timeSpan);
    messageElement.appendChild(errorSpan);

    this.logContainer.appendChild(messageElement);
    this.logContainer.scrollTop = this.logContainer.scrollHeight;

    // Update status indicator
    this.updateStatusIndicator("error");
  }

  /**
   * Detect the page type and initialize accordingly
   */
  detectPageTypeAndInitialize() {
    const url = window.location.href;
    debugLog("Detecting page type for:", url);

    // Wait for page to load fully
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () =>
        this.initializeByPageType(url)
      );
    } else {
      this.initializeByPageType(url);
    }
  }

  /**
   * Initialize based on detected page type
   */
  initializeByPageType(url) {
    debugLog("Initializing by page type:", url);

    if (url.includes("google.com/search")) {
      debugLog("On Google search page");
      this.appendStatusMessage("Google search page detected");
      this.fetchSearchTaskData();
    } else if (
      url.includes("breezy.hr/p/") ||
      url.includes("app.breezy.hr/jobs/")
    ) {
      debugLog("On Breezy job page");
      this.appendStatusMessage("Breezy job page detected");
      this.fetchSendCvTaskData();
    }
  }

  /**
   * Fetch search task data from background script
   */
  fetchSearchTaskData() {
    try {
      debugLog("Fetching search task data");
      this.appendStatusMessage("Fetching search task data...");

      // Send message through the port
      this.port.postMessage({
        type: "GET_SEARCH_TASK",
      });
    } catch (err) {
      errorLog("Error fetching search task data:", err);
      this.appendStatusErrorMessage(err);

      // Try again after a delay
      setTimeout(() => this.fetchSearchTaskData(), 3000);
    }
  }

  /**
   * Fetch send CV task data from background script
   */
  fetchSendCvTaskData() {
    try {
      debugLog("Fetching send CV task data");
      this.appendStatusMessage("Fetching CV task data...");

      // Send message through the port
      this.port.postMessage({
        type: "GET_SEND_CV_TASK",
      });
    } catch (err) {
      errorLog("Error fetching send CV task data:", err);
      this.appendStatusErrorMessage(err);

      // Try again after a delay
      setTimeout(() => this.fetchSendCvTaskData(), 3000);
    }
  }

  /**
   * Process search task data received from background script
   */
  processSearchTaskData(data) {
    try {
      debugLog("Processing search task data:", data);

      if (!data) {
        debugLog("No search task data provided");
        return;
      }

      const {
        tabId,
        limit,
        current,
        domain,
        submittedLinks,
        searchLinkPattern,
      } = data;

      this.SEARCH_DATA.tabId = tabId;
      this.SEARCH_DATA.limit = limit;
      this.SEARCH_DATA.current = current;
      this.SEARCH_DATA.domain = domain;
      this.SEARCH_DATA.submittedLinks = submittedLinks
        ? submittedLinks.map((link) => ({ ...link, tries: 0 }))
        : [];

      if (searchLinkPattern) {
        try {
          // Convert string regex back to RegExp
          if (typeof searchLinkPattern === "string") {
            const patternParts =
              searchLinkPattern.match(/^\/(.*?)\/([gimy]*)$/);
            if (patternParts) {
              this.SEARCH_DATA.searchLinkPattern = new RegExp(
                patternParts[1],
                patternParts[2]
              );
            } else {
              this.SEARCH_DATA.searchLinkPattern = new RegExp(
                searchLinkPattern
              );
            }
          } else {
            this.SEARCH_DATA.searchLinkPattern = searchLinkPattern;
          }
        } catch (regexErr) {
          errorLog("Error parsing search link pattern:", regexErr);
          this.SEARCH_DATA.searchLinkPattern = null;
        }
      } else {
        this.SEARCH_DATA.searchLinkPattern = null;
      }

      debugLog("Search data initialized:", this.SEARCH_DATA);
      this.ready = true;
      this.initialized = true;

      this.appendStatusMessage("Search initialization complete");

      // Start processing search results
      setTimeout(() => this.searchNext(), 1000);
    } catch (err) {
      errorLog("Error processing search task data:", err);
      this.appendStatusErrorMessage(err);
    }
  }

  /**
   * Process send CV task data received from background script
   */
  processSendCvTaskData(data) {
    try {
      debugLog("Processing send CV task data:", data);

      if (!data) {
        debugLog("No send CV task data provided");
        return;
      }

      this.ready = true;
      this.initialized = true;
      this.appendStatusMessage("Apply initialization complete");

      // Start the application process
      setTimeout(() => this.startApplying(data), 1000);
    } catch (err) {
      errorLog("Error processing send CV task data:", err);
      this.appendStatusErrorMessage(err);
    }
  }

  extractCompanyFromUrl(url) {
    try {
      // Pattern for Breezy URLs: https://company-name.breezy.hr/p/job-id
      const matches = url.match(/\/\/([^\.]+)\.breezy\.hr\//);
      if (matches && matches[1]) {
        return matches[1]
          .replace(/-/g, " ")
          .split(" ")
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(" "); // Convert hyphenated to title case
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Handle search next event (after a job application completes)
   */
  handleSearchNext(data) {
    debugLog("Handling search next:", data);

    try {
      // CRITICAL: Always clear the timeout first thing
      if (this.sendCvPageNotRespondTimeout) {
        clearTimeout(this.sendCvPageNotRespondTimeout);
        this.sendCvPageNotRespondTimeout = null;
      }

      // CRITICAL: Always reset the application in progress flag
      this.isApplicationInProgress = false;
      this.applicationStartTime = null;

      this.processedLinksCount++;

      // Notify the search page we're ready for the next job
      this.safeSendMessage({ type: "SEARCH_NEXT_READY" });

      if (!data || !data.url) {
        debugLog("No URL data in handleSearchNext");
        this.appendStatusMessage("Job processed, searching next...");
        // Continue with next search result after a slightly longer delay
        setTimeout(() => this.searchNext(), 2500);
        return;
      }

      const normalizedUrl = this.normalizeUrlFully(data.url);

      // Find and update the visual status of the processed link
      const links = this.findAllLinksElements();
      let linkFound = false;

      for (let i = 0; i < links.length; i++) {
        const linkUrl = this.normalizeUrlFully(links[i].href);

        if (
          linkUrl === normalizedUrl ||
          linkUrl.includes(normalizedUrl) ||
          normalizedUrl.includes(linkUrl)
        ) {
          // Update the visual status based on the result
          if (data.status === "SUCCESS") {
            this.markLinkAsColor(links[i], "orange"); // Mark as completed/processed
            this.appendStatusMessage("Successfully submitted: " + data.url);
          } else if (data.status === "ERROR") {
            this.markLinkAsColor(links[i], "red");
            this.appendStatusMessage(
              "Error with: " +
                data.url +
                (data.message ? ` - ${data.message}` : "")
            );
          } else {
            this.markLinkAsColor(links[i], "orange");
            this.appendStatusMessage(
              "Skipped: " +
                data.url +
                (data.message ? ` - ${data.message}` : "")
            );
          }

          linkFound = true;
          break;
        }
      }

      if (!linkFound) {
        debugLog("Link not found in current page:", normalizedUrl);
      }

      // Record submission if not already in the list
      if (
        !this.SEARCH_DATA.submittedLinks.some((link) => {
          const linkUrl = this.normalizeUrlFully(link.url);
          return (
            linkUrl === normalizedUrl ||
            linkUrl.includes(normalizedUrl) ||
            normalizedUrl.includes(linkUrl)
          );
        })
      ) {
        this.SEARCH_DATA.submittedLinks.push({ ...data });
      }

      setTimeout(() => this.searchNext(), 2500);
    } catch (err) {
      errorLog("Error in handleSearchNext:", err);
      this.appendStatusErrorMessage(err);

      // CRITICAL: Reset application in progress even on error
      this.isApplicationInProgress = false;
      this.applicationStartTime = null;

      // Try to continue anyway
      setTimeout(() => this.searchNext(), 5000);
    }
  }

  normalizeUrlFully(url) {
    try {
      if (!url) return "";

      // Handle URLs with or without protocol
      if (!url.startsWith("http")) {
        url = "https://" + url;
      }

      const urlObj = new URL(url);
      // Remove trailing slashes and query parameters
      return (urlObj.origin + urlObj.pathname)
        .toLowerCase()
        .trim()
        .replace(/\/+$/, "");
    } catch (e) {
      debugLog("Error normalizing URL:", e);
      return url.toLowerCase().trim();
    }
  }

  /**
   * Start the job application process
   */
  async startApplying(data) {
    try {
      debugLog("Starting application process with data:", data);
      this.appendStatusMessage("Starting application process");

      if (
        document.body.innerText.includes("Cannot GET") ||
        document.location.search.includes("not_found=true") ||
        document.body.innerText.includes("Job is no longer available") ||
        document.body.innerText.includes("Position Closed")
      ) {
        throw new SendCvSkipError(
          "Cannot start send cv: Page error or job no longer available"
        );
      }

      // Extract job ID from URL
      const jobId =
        window.location.pathname.split("/").pop() ||
        window.location.href.split("/").pop() ||
        "unknown";

      debugLog("Extracted job ID:", jobId);

      this.countDown = this.startCountDownInStatusBlock(60 * 5, () => {
        this.safeSendMessage({
          type: "SEND_CV_TAB_TIMER_ENDED",
          data: {
            url: window.location.href,
          },
        });
      });

      await new Promise((resolve, reject) => {
        setTimeout(async () => {
          try {
            const applied = await this.apply(data);
            if (applied) {
              // Get job details from page
              const jobTitle = this.extractJobTitle() || "Job on Breezy";

              // Extract company name from URL or page
              const companyName =
                this.extractCompanyName() || "Company on Breezy";

              // Try to extract location from the page
              const location = this.extractJobLocation() || "Not specified";

              // Try to extract other job details
              const salary = this.extractJobSalary() || "Not specified";
              const workplace = this.extractWorkplaceType() || "Not specified";

              this.safeSendMessage({
                type: "SEND_CV_TASK_DONE",
                data: {
                  jobId: jobId,
                  title: jobTitle,
                  company: companyName,
                  location: location,
                  jobUrl: window.location.href,
                  salary: salary,
                  workplace: workplace,
                  postedDate: "Not specified",
                  applicants: "Not specified",
                },
              });

              this.isApplicationInProgress = false;

              debugLog("Application completed successfully");
            }
            resolve();
          } catch (e) {
            reject(e);
          }
        }, 3000);
      });
    } catch (e) {
      if (e instanceof SendCvSkipError) {
        errorLog("Application skipped:", e.message);
        this.safeSendMessage({ type: "SEND_CV_TASK_SKIP", data: e.message });
      } else {
        errorLog("SEND CV ERROR", e);
        this.appendStatusErrorMessage(e);
        this.safeSendMessage({
          type: "SEND_CV_TASK_ERROR",
          data: this.errorToString(e),
        });
      }
      this.isApplicationInProgress = false;
    }
  }

  /**
   * Apply for the job
   */
  async apply(data) {
    try {
      this.appendStatusMessage("Starting job application");
      debugLog("Starting job application", data);

      // Set application in progress
      this.isApplicationInProgress = true;
      this.applicationStartTime = Date.now();

      // Check if we're already on an application page
      const isOnApplyPage = window.location.href.includes("/apply");

      // Only look for Apply button if we're not already on an apply page
      if (!isOnApplyPage) {
        // For Breezy, we need to check if there's an "Apply Now" button to click
        const applyButton = this.findApplyButton();
        if (applyButton) {
          // Make sure it's not an "Apply with LinkedIn" button
          const buttonText = applyButton.textContent.toLowerCase().trim();
          if (
            !buttonText.includes("linkedin") &&
            !buttonText.includes("sign in")
          ) {
            this.appendStatusMessage("Clicking 'Apply' button");
            applyButton.click();
            await this.wait(3000);
          } else {
            this.appendStatusMessage("Skipping 'Apply with LinkedIn' button");
          }
        }
      } else {
        this.appendStatusMessage(
          "Already on application page, looking for form"
        );
      }

      // Check if we're on an apply page by looking for form
      const form = this.findApplicationForm();
      if (!form) {
        throw new SendCvSkipError("Cannot find application form");
      }

      // Get profile data
      const profile = await this.getProfileData(window.location.href);

      // Extract job description from the page
      const jobDescription = this.extractJobDescription();

      // Initialize the form handler if not already done
      if (!this.formHandler) {
        this.formHandler = new BreezyFormHandler({
          logger: (message) => this.appendStatusMessage(message),
          host: data.host || HOST,
          userData: profile,
          jobDescription: jobDescription,
        });
      }

      // Process the application form
      const result = await this.processApplicationForm(
        form,
        profile,
        jobDescription
      );
      this.appendStatusMessage(
        "Form submission result: " + (result ? "SUCCESS" : "FAILED")
      );
      return result;
    } catch (e) {
      if (e instanceof SendCvSkipError) {
        throw e;
      } else {
        errorLog("Error in apply:", e);
        throw new SendCvError(
          "Error during application process: " + this.errorToString(e)
        );
      }
    }
  }

  /**
   * Extract job title from the page
   */
  extractJobTitle() {
    try {
      // Try various selectors for job title
      const titleSelectors = [
        "h1.position-title",
        "h1.job-title",
        'h1[data-id="position-name"]',
        ".position h1",
        "h1.position",
        ".job-header h1",
        "h1",
      ];

      for (const selector of titleSelectors) {
        const element = document.querySelector(selector);
        if (element && element.textContent.trim()) {
          return element.textContent.trim();
        }
      }

      return (
        document.title.split(" - ")[0] || document.title || "Job on Breezy"
      );
    } catch (error) {
      debugLog("Error extracting job title:", error);
      return "Job on Breezy";
    }
  }

  /**
   * Extract company name from the page
   */
  extractCompanyName() {
    try {
      // Try various selectors for company name
      const companySelectors = [
        ".company-name",
        ".company h2",
        ".company-card h3",
        ".position-company",
        'a[data-id="company-name"]',
      ];

      for (const selector of companySelectors) {
        const element = document.querySelector(selector);
        if (element && element.textContent.trim()) {
          return element.textContent.trim();
        }
      }

      return (
        this.extractCompanyFromUrl(window.location.href) ||
        document.title.split(" - ")[1] ||
        "Company on Breezy"
      );
    } catch (error) {
      debugLog("Error extracting company name:", error);
      return "Company on Breezy";
    }
  }

  /**
   * Extract job location from the page
   */
  extractJobLocation() {
    try {
      // Try various selectors for location
      const locationSelectors = [
        ".location",
        ".job-location",
        '[data-id="location"]',
        ".position-meta .location",
        ".job-meta .location",
      ];

      for (const selector of locationSelectors) {
        const element = document.querySelector(selector);
        if (element && element.textContent.trim()) {
          return element.textContent.trim();
        }
      }

      return "Not specified";
    } catch (error) {
      debugLog("Error extracting job location:", error);
      return "Not specified";
    }
  }

  /**
   * Extract job salary from the page
   */
  extractJobSalary() {
    try {
      // Try various selectors for salary
      const salarySelectors = [
        ".salary",
        ".compensation",
        '[data-id="salary"]',
        ".position-meta .salary",
        ".job-meta .salary",
      ];

      for (const selector of salarySelectors) {
        const element = document.querySelector(selector);
        if (element && element.textContent.trim()) {
          return element.textContent.trim();
        }
      }

      // Look for salary in job description
      const description = document.querySelector(
        ".description, .job-description"
      );
      if (description) {
        const text = description.textContent;
        const salaryRegex =
          /\$\d{1,3}(,\d{3})*(\.\d{2})?(\s*[-–—to]\s*\$\d{1,3}(,\d{3})*(\.\d{2})?)?/g;
        const match = text.match(salaryRegex);
        if (match) {
          return match[0];
        }
      }

      return "Not specified";
    } catch (error) {
      debugLog("Error extracting job salary:", error);
      return "Not specified";
    }
  }

  /**
   * Extract workplace type from the page
   */
  extractWorkplaceType() {
    try {
      // Try various selectors for workplace type
      const workplaceSelectors = [
        ".remote",
        ".workplace-type",
        '[data-id="workplace"]',
        ".position-meta .remote",
        ".job-meta .remote",
      ];

      for (const selector of workplaceSelectors) {
        const element = document.querySelector(selector);
        if (element && element.textContent.trim()) {
          return element.textContent.trim();
        }
      }

      // Check if specific keywords are present in the job description
      const description = document.querySelector(
        ".description, .job-description"
      );
      if (description) {
        const text = description.textContent.toLowerCase();
        if (text.includes("remote")) return "Remote";
        if (text.includes("hybrid")) return "Hybrid";
        if (
          text.includes("on-site") ||
          text.includes("onsite") ||
          text.includes("in office")
        )
          return "On-site";
      }

      return "Not specified";
    } catch (error) {
      debugLog("Error extracting workplace type:", error);
      return "Not specified";
    }
  }

  /**
   * Find the apply button on a Breezy job page
   */
  findApplyButton() {
    try {
      // Try various selectors for apply buttons on Breezy
      const applyButtonSelectors = [
        'a.btn-primary[href*="apply"]',
        "a.apply-button",
        "a.btn.apply",
        "button.apply-button",
        "button.btn-apply",
        "a.btn-apply",
        // More generic fallbacks
        'a[href*="apply"]',
        "a.btn-primary",
        "button.btn-primary",
      ];

      for (const selector of applyButtonSelectors) {
        const buttons = document.querySelectorAll(selector);
        for (const button of buttons) {
          const buttonText = button.textContent.toLowerCase().trim();

          // Skip buttons that mention LinkedIn or sign in
          if (
            buttonText.includes("linkedin") ||
            buttonText.includes("sign in")
          ) {
            continue;
          }

          if (
            buttonText.includes("apply") ||
            buttonText.includes("submit") ||
            buttonText === "apply" ||
            buttonText === "apply now"
          ) {
            // Make sure the button doesn't have LinkedIn in its parent element
            const parentText =
              button
                .closest(".button-container, .apply-buttons")
                ?.textContent.toLowerCase() || "";
            if (!parentText.includes("linkedin")) {
              return button;
            }
          }
        }
      }

      return null;
    } catch (error) {
      debugLog("Error finding apply button:", error);
      return null;
    }
  }

  /**
   * Check if a URL is a valid Breezy job link
   */
  isValidBreezyJobLink(url) {
    if (!url) return false;

    // Pattern matches:
    // - https://company-name.breezy.hr/p/job-id
    // - https://company-name.breezy.hr/p/job-id-position-title
    // - https://company-name.breezy.hr/p/job-id-position-title/apply
    // - https://app.breezy.hr/jobs/job-id

    // Updated regex to include position titles and /apply path
    return /https?:\/\/(?:[^.]+\.breezy\.hr\/p\/[A-Za-z0-9\-]+(?:\/apply)?|app\.breezy\.hr\/jobs\/[A-Za-z0-9\-]+(?:\/apply)?)/.test(
      url
    );
  }

  /**
   * Find all job link elements on the page
   */
  findAllLinksElements() {
    try {
      const domains = Array.isArray(this.SEARCH_DATA.domain)
        ? this.SEARCH_DATA.domain
        : [this.SEARCH_DATA.domain];

      if (!domains || domains.length === 0) {
        debugLog("No domains specified for link search");
        return [];
      }

      debugLog("Searching for links with domains:", domains);

      // Create a combined selector for all domains
      const selectors = domains.map((domain) => {
        // Handle missing protocol, clean domain
        const cleanDomain = domain
          .replace(/^https?:\/\//, "")
          .replace(/\/$/, "");
        return `#rso a[href*="${cleanDomain}"], #botstuff a[href*="${cleanDomain}"]`;
      });

      const selector = selectors.join(",");
      const links = document.querySelectorAll(selector);

      debugLog(`Found ${links.length} matching links`);
      return Array.from(links);
    } catch (err) {
      errorLog("Error finding links:", err);
      return [];
    }
  }

  /**
   * Find the "More results" button
   */
  findLoadMoreElement() {
    try {
      // If we're on the last page (prev button but no next button)
      if (
        document.getElementById("pnprev") &&
        !document.getElementById("pnnext")
      ) {
        return null;
      }

      // Method 1: Find "More results" button
      const moreResultsBtn = Array.from(document.querySelectorAll("a")).find(
        (a) => a.textContent.includes("More results")
      );

      if (moreResultsBtn) {
        return moreResultsBtn;
      }

      // Method 2: Look for "Next" button
      const nextBtn = document.getElementById("pnnext");
      if (nextBtn) {
        return nextBtn;
      }

      // Method 3: Try to find any navigation button at the bottom
      const navLinks = [
        ...document.querySelectorAll(
          "#botstuff table a[href^='/search?q=site:']"
        ),
      ];
      debugLog(`Found ${navLinks.length} potential navigation links`);

      // Return the last one (typically "More results" or similar)
      return navLinks[navLinks.length - 1];
    } catch (err) {
      errorLog("Error finding load more button:", err);
      return null;
    }
  }

  /**
   * Mark a link with a color border
   */
  markLinkAsColor(linkEl, color, customText) {
    if (CONFIG.DEBUG) {
      try {
        if (!linkEl || !linkEl.parentElement) return;

        // Clean up any existing highlights
        const existingHighlight = linkEl.parentElement.querySelector(
          ".breezy-result-highlight"
        );
        if (existingHighlight) {
          existingHighlight.remove();
        }

        // Create highlight container
        const highlight = document.createElement("div");
        highlight.className = "breezy-result-highlight";
        highlight.style.cssText = `
            position: absolute;
            right: 0;
            top: 0;
            background-color: ${
              color === "green"
                ? "rgba(76, 175, 80, 0.9)"
                : color === "orange"
                ? "rgba(255, 152, 0, 0.9)"
                : color === "red"
                ? "rgba(244, 67, 54, 0.9)"
                : color === "blue"
                ? "rgba(33, 150, 243, 0.9)"
                : "rgba(0, 0, 0, 0.7)"
            };
            color: white;
            padding: 2px 8px;
            border-radius: 3px;
            font-size: 12px;
            font-weight: bold;
            z-index: 1000;
            box-shadow: 0 1px 3px rgba(0,0,0,0.3);
          `;

        // Set text based on color with clearer labels
        let statusText;
        if (customText) {
          statusText = customText;
        } else {
          statusText =
            color === "green"
              ? "In Progress"
              : color === "orange"
              ? "Completed"
              : color === "red"
              ? "Skipped"
              : color === "blue"
              ? "Next"
              : "Unknown";
        }
        highlight.textContent = statusText;

        // Apply colorful border to the parent element
        linkEl.parentElement.style.cssText = `
            position: relative;
            border: 3px solid ${
              color === "green"
                ? "#4CAF50"
                : color === "orange"
                ? "#FF9800"
                : color === "red"
                ? "#F44336"
                : color === "blue"
                ? "#2196F3"
                : "#000000"
            };
            border-radius: 4px;
            padding: 4px;
            margin: 4px 0;
            transition: all 0.3s ease;
          `;

        // Add highlight to the parent
        linkEl.parentElement.appendChild(highlight);

        // Make sure the link itself looks different
        linkEl.style.cssText = `
            font-weight: bold;
            text-decoration: none;
            color: ${
              color === "green"
                ? "#2E7D32"
                : color === "orange"
                ? "#E65100"
                : color === "red"
                ? "#B71C1C"
                : color === "blue"
                ? "#0D47A1"
                : ""
            };
          `;

        // Update position if the window resizes
        const updatePosition = () => {
          highlight.style.right = "0";
          highlight.style.top = "0";
        };

        window.addEventListener("resize", updatePosition);
      } catch (err) {
        errorLog("Error marking link:", err);
      }
    }
  }

  /**
   * Search for the next job to apply to
   */
  async searchNext() {
    try {
      debugLog("Executing searchNext");

      if (!this.ready || !this.initialized) {
        debugLog("Not ready or initialized yet, delaying search");
        setTimeout(() => this.searchNext(), 1000);
        return;
      }

      // CRITICAL: If an application is in progress, do not continue
      if (this.isApplicationInProgress) {
        debugLog("Application in progress, not searching for next link");
        this.appendStatusMessage(
          "Application in progress, waiting to complete..."
        );

        // Verify with background script that an application is actually in progress
        this.safeSendMessage({ type: "CHECK_JOB_TAB_STATUS" });

        // Always return immediately when an application is in progress
        return;
      }

      this.appendStatusMessage("Searching for job links...");

      // Find all matching links
      let links = this.findAllLinksElements();
      debugLog(`Found ${links.length} links`);

      // If no links on page, try to load more
      if (links.length === 0) {
        debugLog("No links found, trying to load more");
        this.appendStatusMessage("No links found, trying to load more...");

        // CRITICAL: Check again that we're not processing an application
        // before trying to navigate to a new page
        if (this.isApplicationInProgress) {
          debugLog("Application became in progress, aborting navigation");
          return;
        }

        await this.wait(2000);

        // Check again before trying to find load more button
        if (this.isApplicationInProgress) {
          debugLog("Application became in progress, aborting navigation");
          return;
        }

        const loadMoreBtn = this.findLoadMoreElement();
        if (loadMoreBtn) {
          // Final check before clicking
          if (this.isApplicationInProgress) {
            debugLog("Application became in progress, aborting navigation");
            return;
          }

          this.appendStatusMessage('Clicking "More results" button');
          loadMoreBtn.click();
          await this.wait(3000);

          // Don't call fetchSearchTaskData immediately if an application started
          if (!this.isApplicationInProgress) {
            this.fetchSearchTaskData();
          }
          return;
        } else {
          this.appendStatusMessage("No more results to load");
          this.safeSendMessage({ type: "SEARCH_TASK_DONE" });
          debugLog("Search task completed");
          return;
        }
      }

      // Process links one by one - USE URL-BASED TRACKING!
      let foundUnprocessedLink = false;

      // First pass: mark all already processed links
      for (let i = 0; i < links.length; i++) {
        // Process this link
        let url = this.normalizeUrlFully(links[i].href);

        // Check if this URL is already in processed links
        const processedLink = this.SEARCH_DATA.submittedLinks.find((link) => {
          if (!link.url) return false;
          const normalizedLinkUrl = this.normalizeUrlFully(link.url);
          return (
            normalizedLinkUrl === url ||
            url.includes(normalizedLinkUrl) ||
            normalizedLinkUrl.includes(url)
          );
        });

        // Also check local cache
        const inLocalCache = this.processedUrls && this.processedUrls.has(url);

        if (processedLink || inLocalCache) {
          // Mark as already processed with the appropriate color
          if (processedLink && processedLink.status === "SUCCESS") {
            this.markLinkAsColor(links[i], "orange", "Completed"); // Mark all completed jobs as orange
          } else if (processedLink && processedLink.status === "ERROR") {
            this.markLinkAsColor(links[i], "red", "Skipped");
          } else {
            this.markLinkAsColor(links[i], "orange", "Completed");
          }

          this.appendStatusMessage(`Skipping already processed: ${url}`);
          continue;
        }

        // Check if URL matches valid Breezy job pattern
        const isValid = this.isValidBreezyJobLink(links[i].href);
        if (!isValid) {
          debugLog(`Link ${url} is not a valid Breezy job link`);
          this.markLinkAsColor(links[i], "red", "Invalid");

          // Add to processed URLs to avoid rechecking
          if (!this.processedUrls) this.processedUrls = new Set();
          this.processedUrls.add(url);

          // Add to SEARCH_DATA to maintain consistency
          this.SEARCH_DATA.submittedLinks.push({
            url,
            status: "SKIP",
            message: "Not a valid Breezy job link",
          });

          this.appendStatusMessage(`Skipping invalid job link: ${url}`);
          continue;
        }

        // Found an unprocessed link that is valid
        foundUnprocessedLink = true;
      }

      // CRITICAL: Check for application in progress before second pass
      if (this.isApplicationInProgress) {
        debugLog("Application became in progress during first pass, aborting");
        return;
      }

      // Second pass: find the first unprocessed link that meets criteria
      for (let i = 0; i < links.length; i++) {
        // Process this link
        let url = this.normalizeUrlFully(links[i].href);

        // Check if this URL is already in processed links
        const alreadyProcessed = this.SEARCH_DATA.submittedLinks.some(
          (link) => {
            if (!link.url) return false;
            const normalizedLinkUrl = this.normalizeUrlFully(link.url);
            return (
              normalizedLinkUrl === url ||
              url.includes(normalizedLinkUrl) ||
              normalizedLinkUrl.includes(url)
            );
          }
        );

        // Also check local cache
        const inLocalCache = this.processedUrls && this.processedUrls.has(url);

        if (alreadyProcessed || inLocalCache) {
          // Already handled in the first pass
          continue;
        }

        // Check if URL is a valid Breezy job link
        if (!this.isValidBreezyJobLink(links[i].href)) {
          continue;
        }

        // Found an unprocessed link that is valid - process it!
        this.appendStatusMessage("Found job to apply: " + url);

        // CRITICAL: Check one more time before proceeding
        if (this.isApplicationInProgress) {
          debugLog("Application became in progress, aborting new task");
          return;
        }

        // Mark as processing and add to local cache immediately
        this.markLinkAsColor(links[i], "green", "In Progress");

        // Set the application flag BEFORE sending task
        this.isApplicationInProgress = true;
        this.applicationStartTime = Date.now();

        // Add to local cache immediately to prevent double processing
        if (!this.processedUrls) this.processedUrls = new Set();
        this.processedUrls.add(url);

        // Set timeout for detecting stuck applications BEFORE sending message
        if (this.sendCvPageNotRespondTimeout) {
          clearTimeout(this.sendCvPageNotRespondTimeout);
        }

        this.sendCvPageNotRespondTimeout = setTimeout(() => {
          if (this.isApplicationInProgress) {
            this.appendStatusMessage(
              "No response from job page, resuming search"
            );
            this.safeSendMessage({ type: "SEND_CV_TAB_NOT_RESPOND" });
            this.isApplicationInProgress = false;
            this.applicationStartTime = null;
            setTimeout(() => this.searchNext(), 2000);
          }
        }, 60000); // 60 second timeout

        // Send message to the background script
        try {
          this.safeSendMessage({
            type: "SEND_CV_TASK",
            data: {
              url,
              title: links[i].textContent.trim() || "Job Application",
            },
          });
        } catch (err) {
          // Error handling for message sending
          errorLog(`Error sending CV task for ${url}:`, err);
          this.appendStatusErrorMessage(err);

          // Reset flags on error
          this.isApplicationInProgress = false;
          this.applicationStartTime = null;
          if (this.sendCvPageNotRespondTimeout) {
            clearTimeout(this.sendCvPageNotRespondTimeout);
            this.sendCvPageNotRespondTimeout = null;
          }

          // Remove from processed URLs since we couldn't process it
          if (this.processedUrls) {
            this.processedUrls.delete(url);
          }

          // Mark as error and continue with next link
          this.markLinkAsColor(links[i], "red", "Error");
          continue;
        }

        // We found a suitable link and sent the message successfully
        foundUnprocessedLink = true;
        return; // Exit after sending one job for processing
      }

      // CRITICAL: If we couldn't find any unprocessed links
      if (!foundUnprocessedLink) {
        // Check one more time before trying to navigate
        if (this.isApplicationInProgress) {
          debugLog("Application became in progress, aborting navigation");
          return;
        }

        // Try to load more results
        this.appendStatusMessage(
          "No new job links found, trying to load more..."
        );
        const loadMoreBtn = this.findLoadMoreElement();

        if (loadMoreBtn) {
          // Final check before clicking
          if (this.isApplicationInProgress) {
            debugLog("Application became in progress, aborting navigation");
            return;
          }

          // Click the "More results" button and wait
          this.appendStatusMessage('Clicking "More results" button');
          loadMoreBtn.click();

          // Set a timeout to check again after page loads
          // but only if we're not processing an application
          setTimeout(() => {
            if (!this.isApplicationInProgress) {
              this.searchNext();
            }
          }, 3000);
        } else {
          // No more results and no unprocessed links - we're done!
          this.appendStatusMessage("All jobs processed, search completed!");
          this.safeSendMessage({ type: "SEARCH_TASK_DONE" });
        }
      }
    } catch (err) {
      errorLog("Error in searchNext:", err);
      this.appendStatusErrorMessage(err);

      // Reset application state on error
      this.isApplicationInProgress = false;
      this.applicationStartTime = null;
      if (this.sendCvPageNotRespondTimeout) {
        clearTimeout(this.sendCvPageNotRespondTimeout);
        this.sendCvPageNotRespondTimeout = null;
      }

      // Try again after a delay
      setTimeout(() => this.searchNext(), 5000);
    }
  }

  /**
   * Extract job description from the page
   */
  extractJobDescription() {
    try {
      this.appendStatusMessage("Extracting job description");
      let description = "";

      // Try to find the job description section
      const descriptionSelectors = [
        ".job-description",
        ".description",
        ".position-description",
        "#job-description",
        ".job-details",
        ".position",
      ];

      for (const selector of descriptionSelectors) {
        const descElement = document.querySelector(selector);
        if (descElement) {
          description = descElement.textContent.trim();
          break;
        }
      }

      // If still no description, try to get the whole main content
      if (!description) {
        const mainContent = document.querySelector(
          "main, #content, .content, .job-content"
        );
        if (mainContent) {
          description = mainContent.textContent.trim();
        }
      }

      // Get title and company as fallback
      if (!description) {
        const jobTitle = this.extractJobTitle() || document.title || "";
        const companyName = this.extractCompanyName() || "";
        description = `Job: ${jobTitle} at ${companyName}`;
      }

      debugLog("Extracted job description length: " + description.length);
      return description;
    } catch (error) {
      debugLog("Error extracting job description: " + error.message);
      return "";
    }
  }

  /**
   * Process the application form
   */
  async processApplicationForm(form, profile, jobDescription) {
    this.appendStatusMessage("Found application form, beginning to fill out");

    try {
      // Get the API host (url to our AI service)
      const aiApiHost = HOST || "https://fastapply.co";

      // Make sure form handler is initialized
      if (!this.formHandler) {
        this.formHandler = new BreezyFormHandler({
          logger: (message) => this.appendStatusMessage(message),
          host: aiApiHost,
          userData: profile,
          jobDescription: jobDescription,
        });
      }

      const projects = [
        {
          title: "Reestruturação do Ciclo de Manutenção",
          description:
            "Projeto voltado à revisão do ciclo de manutenção das ferramentas de perfuração direcionais com suporte de softwares, tais como Relia Soft e Maps, com o intuito de reduzir custos e aumentar confiabilidade do produto. Redução de custos: ~ US$500k.",
          startDate: "April 2017",
          endDate: "February 2015",
        },
        {
          title: "Laboratório de Manutenção de Ferramentas Direcionais",
          description:
            "Implementação de laboratório para manutenção e calibração de ferramentas direcionais utilizadas em perfuração de poços de petróleo, minimizando assim, custos de transporte e reparo no exterior.",
          startDate: "February 2009",
          endDate: "October 2016",
        },
        {
          title: "Laboratório de Manutenção de Ferramentas Direcionais",
          description:
            "Implementação de laboratório para manutenção e calibração de ferramentas direcionais utilizadas em perfuração de poços de petróleo, minimizando assim, custos de transporte e reparo no exterior.",
          startDate: "February 2009",
          endDate: "October 2016",
        },
        {
          title: "Laboratório de Manutenção de Ferramentas Direcionais",
          description:
            "Implementação de laboratório para manutenção e calibração de ferramentas direcionais utilizadas em perfuração de poços de petróleo, minimizando assim, custos de transporte e reparo no exterior.",
          startDate: "February 2009",
          endDate: "October 2016",
        },
      ];

      const educationData = {
        education: profile.education,
        educationEndMonth: profile.educationEndMonth,
        educationEndYear: profile.educationEndYear,
        educationStartMonth: profile.educationStartMonth,
        educationStartYear: profile.educationStartYear,
      };

      // 1. Handle file uploads (resume)
      await this.fileHandler.handleResumeUpload(profile, form);
      await this.formHandler.fillWorkHistory(form, projects);
      await this.formHandler.fillEducation(form, educationData);

      // 2. Fill out form fields using AI-enhanced BreezyFormHandler
      await this.formHandler.fillFormWithProfile(form, profile);

      // 3. Handle required checkboxes (privacy policy, terms, etc.)
      await this.formHandler.handleRequiredCheckboxes(form);

      // 4. Find and click the submit button
      const submitButton = this.formHandler.findSubmitButton(form);
      if (!submitButton) {
        throw new SendCvError("Cannot find submit button");
      }

      // 5. Submit the form
      return await this.formHandler.submitForm(form);
    } catch (error) {
      //   errorLog("Error processing application form:", error);
      //   this.appendStatusErrorMessage(
      //     "Error processing form: " + this.errorToString(error)
      //   );
      //   return false;
    }
  }

  /**
   * Find the application form
   */
  findApplicationForm() {
    // Try specific Breezy form selectors
    const formSelectors = [
      "form.application-form",
      "form#application-form",
      'form[action*="apply"]',
      'form[action*="positions"]',
      ".application-form form",
      "#application form",
      "#application-wrapper form",
      ".vacancy-application form",
      "form",
    ];

    // Create form handler if it doesn't exist yet
    if (!this.formHandler) {
      this.formHandler = new BreezyFormHandler({
        logger: (message) => this.appendStatusMessage(message),
      });
    }

    // First try to find a form with direct selectors
    for (const selector of formSelectors) {
      const forms = document.querySelectorAll(selector);
      if (forms.length) {
        for (const form of forms) {
          if (this.formHandler.isElementVisible(form)) {
            // Check if the form has input fields
            if (form.querySelectorAll("input, select, textarea").length > 0) {
              debugLog(`Found application form with selector: ${selector}`);
              return form;
            }
          }
        }
      }
    }

    // If still not found, look for a container that might be a form-like element
    const formContainerSelectors = [
      ".application-form",
      "#application",
      "#application-wrapper",
      ".vacancy-application",
      ".application",
      ".apply-form",
    ];

    for (const selector of formContainerSelectors) {
      const container = document.querySelector(selector);
      if (container && this.formHandler.isElementVisible(container)) {
        // Check if it has input fields
        if (container.querySelectorAll("input, select, textarea").length > 0) {
          // This container acts like a form
          debugLog(`Found form-like container with selector: ${selector}`);
          return container;
        }
      }
    }

    // Last resort: check for any visible forms with input fields
    const allForms = document.querySelectorAll("form");
    for (const form of allForms) {
      if (
        this.formHandler.isElementVisible(form) &&
        form.querySelectorAll("input, select, textarea").length > 0
      ) {
        debugLog("Found generic form with inputs");
        return form;
      }
    }

    // Extra last resort: if we're on an apply page but can't find a form,
    // look for any element that contains multiple inputs
    if (window.location.href.includes("/apply")) {
      const potentialContainers = [
        "main",
        "#main",
        ".main-content",
        "#content",
        ".content",
        ".application-container",
        ".apply-container",
      ];

      for (const selector of potentialContainers) {
        const container = document.querySelector(selector);
        if (
          container &&
          this.formHandler.isElementVisible(container) &&
          container.querySelectorAll("input, select, textarea").length >= 3
        ) {
          debugLog(`Found potential form container: ${selector}`);
          return container;
        }
      }
    }

    return null;
  }

  /**
   * Get profile data from background script
   */
  async getProfileData(url) {
    return new Promise((resolve, reject) => {
      try {
        this.appendStatusMessage(
          "Requesting profile data from background script"
        );

        if (this.port) {
          // Set callback to process response
          this.profileDataCallback = (error, data) => {
            if (error) {
              this.appendStatusMessage(
                "Failed to get profile data: " + error.message
              );
              reject(error);
            } else {
              this.appendStatusMessage("Profile data received");
              resolve(data);
            }
          };

          // Request data via port
          this.safeSendMessage({
            type: "GET_PROFILE_DATA",
            url: url,
          });
        } else {
          // Fallback to one-time message
          chrome.runtime.sendMessage(
            {
              type: "getProfileData",
              url: url,
            },
            (response) => {
              if (chrome.runtime.lastError) {
                const error = chrome.runtime.lastError;
                this.appendStatusMessage(
                  "Failed to get profile data: " + error.message
                );
                reject(error);
                return;
              }

              if (!response || !response.success) {
                const error = new Error(
                  response?.message || "Failed to get profile data"
                );
                this.appendStatusMessage(
                  "Failed to get profile data: " + error.message
                );
                reject(error);
                return;
              }

              this.appendStatusMessage("Profile data received");
              resolve(response.data);
            }
          );
        }
      } catch (error) {
        this.appendStatusMessage(
          "Error requesting profile data: " + error.message
        );
        reject(error);
      }
    });
  }

  /**
   * Start countdown timer
   */
  startCountDownInStatusBlock(duration, countDownEnded) {
    try {
      debugLog("Starting countdown timer", { duration });

      // Find or create the timer container
      let timerContainer = document.getElementById("breezy-automation-timer");

      if (!timerContainer) {
        timerContainer = document.createElement("div");
        timerContainer.id = "breezy-automation-timer";
        timerContainer.style.cssText = `
            position: fixed;
            top: 70px;
            right: 20px;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 10px 15px;
            border-radius: 8px;
            font-family: system-ui, -apple-system, sans-serif;
            font-size: 14px;
            z-index: 9999;
            display: flex;
            flex-direction: column;
            align-items: center;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
          `;
        document.body.appendChild(timerContainer);
      }

      // Create timer elements
      const timerLabel = document.createElement("div");
      timerLabel.textContent = "Application Timeout";
      timerLabel.style.cssText = `
          font-weight: bold;
          margin-bottom: 5px;
          font-size: 12px;
        `;

      const timerDisplay = document.createElement("div");
      timerDisplay.style.cssText = `
          font-size: 18px;
          font-weight: bold;
          margin-bottom: 5px;
        `;

      // Clear existing content
      timerContainer.innerHTML = "";
      timerContainer.appendChild(timerLabel);
      timerContainer.appendChild(timerDisplay);

      // Set up timer variables
      let timeLeft = duration;
      let timerId = null;

      // Function to update the timer display
      const updateTimerDisplay = () => {
        const minutes = Math.floor(timeLeft / 60);
        const seconds = timeLeft % 60;

        // Format as MM:SS
        timerDisplay.textContent = `${minutes
          .toString()
          .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;

        // Change color when time is running low
        if (timeLeft <= 60) {
          // Last minute
          timerDisplay.style.color = "#FFA500"; // Orange
        }

        if (timeLeft <= 30) {
          // Last 30 seconds
          timerDisplay.style.color = "#FF0000"; // Red
        }

        // Decrement time
        timeLeft--;

        // If time's up, execute callback
        if (timeLeft < 0) {
          stop();
          if (typeof countDownEnded === "function") {
            debugLog("Countdown timer ended, executing callback");
            countDownEnded();
          }
        }
      };

      // Start the timer and update immediately
      updateTimerDisplay();
      timerId = setInterval(updateTimerDisplay, 1000);

      // Function to stop the timer
      const stop = () => {
        if (timerId) {
          clearInterval(timerId);
          timerId = null;
          debugLog("Countdown timer stopped");
        }
      };

      // Function to add time to the timer
      const addTime = (additionalTime) => {
        timeLeft += additionalTime;
        debugLog("Added time to countdown timer", {
          additionalTime,
          newTimeLeft: timeLeft,
        });
        updateTimerDisplay();
      };

      // Return control object
      return {
        stop,
        addTime,
      };
    } catch (error) {
      debugLog("Error starting countdown timer", {
        error: error.toString(),
      });
      console.error("Error starting countdown timer:", error);
      // Return dummy object to prevent errors if methods are called
      return {
        stop: () => {},
        addTime: () => {},
      };
    }
  }

  /**
   * Wait for specified milliseconds
   */
  wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Convert error to string
   */
  errorToString(e) {
    if (e instanceof Error) {
      if (e.stack) {
        return e.stack;
      }
      return e.message;
    }
    return String(e);
  }

  /**
   * Handle message events from Chrome runtime
   */
  handleMessage(message, sender, sendResponse) {
    try {
      debugLog("Handling message:", message);

      // Handle message types
      const type = message.type || message.action;

      if (!type) {
        sendResponse({ success: false, message: "Missing message type" });
        return true;
      }

      switch (type) {
        case "checkStatus":
          sendResponse({
            success: true,
            data: {
              initialized: this.initialized,
              isApplicationInProgress: this.isApplicationInProgress,
              processedCount: this.processedLinksCount,
            },
          });
          break;

        case "resetState":
          this.resetState();
          sendResponse({ success: true, message: "State reset" });
          break;

        default:
          sendResponse({
            success: false,
            message: `Unknown message type: ${type}`,
          });
      }
    } catch (error) {
      errorLog("Error handling message:", error);
      sendResponse({
        success: false,
        message: "Error handling message: " + this.errorToString(error),
      });
    }

    return true; // Keep message channel open for async response
  }

  /**
   * Reset the automation state
   */
  resetState() {
    try {
      debugLog("Resetting state");
      this.appendStatusMessage("Resetting automation state");

      // Reset critical flags
      this.isApplicationInProgress = false;
      this.applicationStartTime = null;

      // Clear timeouts
      if (this.sendCvPageNotRespondTimeout) {
        clearTimeout(this.sendCvPageNotRespondTimeout);
        this.sendCvPageNotRespondTimeout = null;
      }

      // Reset processed data
      this.processedUrls = new Set();
      this.processedLinksCount = 0;

      // Reset status
      this.updateStatusIndicator("ready");
      this.appendStatusMessage("State reset complete");
    } catch (error) {
      errorLog("Error resetting state:", error);
      this.appendStatusErrorMessage("Error resetting state: " + error.message);
    }
  }
}

// Initialize the automation
debugLog("Creating BreezyJobAutomation instance");
const breezyAutomation = new BreezyJobAutomation();

// Send a final notification that the script is fully loaded
debugLog("Breezy content script fully loaded");

// Add message listener for backward compatibility
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  breezyAutomation.handleMessage(message, sender, sendResponse);
  return true; // Keep channel open for async response
});
