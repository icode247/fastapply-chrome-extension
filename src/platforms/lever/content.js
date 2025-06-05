import { StateManager } from "@shared/stateManager";
import { canApplyMore } from "@shared/checkAuthorization";
import { HOST } from "@shared/constants";
import { LeverFileHandler } from "@shared/linkedInUtils";

function debugLog(message, ...args) {
  console.log(`[Lever Debug] ${message}`, ...args);
}

// Error logging helper
function errorLog(message, error) {
  console.error(`[Lever Error] ${message}`, error);
  if (error?.stack) {
    console.error(error.stack);
  }
}

// Immediately log that the script is loaded
debugLog("Content script loading...");

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
    JOB_LINKS: "a[href*='lever.co'], a[href*='jobs.lever.co']",
    GOOGLE_RESULTS:
      "#search .g, #rso .g, div[data-sokoban-container], #rso div[data-hveid], div[data-hveid], .g, .MjjYud, .Gx5Zad",
    FORM_FIELDS:
      "input[type='text'], input[type='email'], input[type='tel'], input[type='number'], select, textarea, input[type='checkbox'], input[type='radio'], input[type='date']",
    DROPZONE:
      "div.dropzone, div[class*='dropzone'], div[class*='upload'], input[type='file'][accept*='pdf']",
    FILE_INPUT: "input[type='file']",
    SUBMIT_BUTTON: "button[type='submit']",
    NEXT_BUTTON:
      "button.btn-primary, button.btn-submit, button[type='submit'], button.button--primary, button.next-step",
    SUCCESS_MESSAGE:
      "div.application-confirmation, div.success-message, h1.success-message, div[class*='success'], div.thank-you",
    CHECKBOX_CONTAINER:
      ".field-type-Boolean, div[class*='checkbox'], label[class*='checkbox']",
    ERROR_MESSAGE: ".error-message, .alert-error, div[class*='error']",
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
//process
/**
 * LeverJobAutomation - Content script for automating Lever job applications
 * Improved with reliable communication system using long-lived connections
 */

//Auto-close timer active
class LeverJobAutomation {
  constructor() {
    debugLog("Initializing LeverJobAutomation");

    // Initialize state manager
    this.stateManager = new StateManager();
    this.processedLinksCount = 0;
    this.STATUS_BLOCK_POSITION = "top-right";
    this.sendCvPageNotRespondTimeout = null;
    this.countDown = null;
    this.ready = false;
    this.initialized = false;

    // CRITICAL FIX: Add flag to track application in progress state
    this.isApplicationInProgress = false;

    // CRITICAL FIX: Add local cache for processed URLs to prevent duplicates
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

    this.stuckStateTimer = setInterval(() => {
      if (this.isApplicationInProgress && this.applicationStartTime) {
        const now = Date.now();
        const elapsedTime = now - this.applicationStartTime;

        // If application has been in progress for over 5 minutes, it's probably stuck
        if (elapsedTime > 5 * 60 * 1000) {
          debugLog(
            "Application appears to be stuck for over 5 minutes, forcing reset"
          );
          this.isApplicationInProgress = false;
          this.applicationStartTime = null;
          this.appendStatusMessage(
            "Application timeout detected - resetting state"
          );
          setTimeout(() => this.searchNext(), 1000);
        }
      }
    }, 60000);

    // CRITICAL FIX: Add state verification interval
    this.stateVerificationInterval = setInterval(() => {
      if (this.isApplicationInProgress && this.port) {
        try {
          debugLog("Verifying application status with background script");
          this.port.postMessage({ type: "VERIFY_APPLICATION_STATUS" });
        } catch (e) {
          debugLog("Error in periodic state verification:", e);
        }
      }
    }, 30000); // Every 30 seconds

    // Create status overlay
    this.createStatusOverlay();

    // Create file handler for resume uploads
    this.fileHandler = new LeverFileHandler({
      show: (message, type) => {
        debugLog(`[${type || "info"}] ${message}`);
        this.appendStatusMessage(message);
      },
    });

    // Initialize based on page type
    this.detectPageTypeAndInitialize();
  }

  /**
   * Initialize communication with the background script
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
        window.location.href.includes("/apply") ||
        window.location.pathname.includes("/apply");

      // Generate a unique name for this connection
      const timestamp = Date.now();
      const portName = isApplyPage
        ? `lever-apply-${timestamp}`
        : `lever-search-${timestamp}`;

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
        // CRITICAL FIX: Add new case for application status verification
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
    container.id = "fastapply-status-overlay";
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

    const logoIcon = document.createElement("img");
    logoIcon.src =
      "https://fastapply.co/_next/image?url=%2Ftest.png&w=256&q=75";
    logoIcon.textContent = ""; // Lightning bolt emoji
    logoIcon.style.cssText = `
      margin-right: 6px;
      font-size: 18px;
      width: 100px !important; 
      height: 37px !important; 
      display: block !important;
    `;

    logoDiv.appendChild(logoIcon);
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
    this.logContainer.id = "fastapply-log-container";
    this.logContainer.style.cssText = `
      margin-top: 10px;
      max-height: 220px;
      overflow-y: auto;
      font-size: 12px;
      line-height: 1.4;
    `;

    const timerContainer = document.createElement("div");
    timerContainer.id = "lever-automation-status-content";
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

    // messageElement.appendChild(timeSpan);
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
    } else if (url.includes("lever.co")) {
      debugLog("On Lever job page");
      this.appendStatusMessage("Lever job page detected");
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
      this.SEARCH_DATA.domain = domain;
      this.SEARCH_DATA.current = current;
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
      debugLog("processSendCvTaskData: Received data with profile:", data.profile);
      debugLog("processSendCvTaskData: Full data object:", data);
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
      // Pattern: https://jobs.lever.co/[COMPANY]/...
      const matches = url.match(/\/\/jobs\.lever\.co\/([^\/]+)/);
      if (matches && matches[1]) {
        return matches[1].charAt(0).toUpperCase() + matches[1].slice(1); // Capitalize company name
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
      // CRITICAL FIX: Always clear the timeout first thing
      if (this.sendCvPageNotRespondTimeout) {
        clearTimeout(this.sendCvPageNotRespondTimeout);
        this.sendCvPageNotRespondTimeout = null;
      }

      // CRITICAL FIX: Always reset the application in progress flag
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
            this.markLinkAsColor(links[i], "orange"); // Also mark skipped as completed/processed
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

      // Continue with next search result after a slightly longer delay
      // to ensure background script has time to complete its processing
      setTimeout(() => this.searchNext(), 2500);
    } catch (err) {
      errorLog("Error in handleSearchNext:", err);
      this.appendStatusErrorMessage(err);

      // CRITICAL FIX: Reset application in progress even on error
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

      // Remove /apply suffix commonly found in Lever job URLs
      url = url.replace(/\/apply$/, "");

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
        document.location.search.includes("not_found=true")
      ) {
        throw new SendCvSkipError("Cannot start send cv: Page error");
      }

      // Extract job ID from URL
      const jobId = this.extractJobIdFromUrl(window.location.href);
      debugLog("Extracted job ID:", jobId);

      this.countDown = this.startCountDownInStatusBlock(60 * 5, () => {
        this.safeSendMessage({
          type: "SEND_CV_TAB_TIMER_ENDED",
          data: {
            url: window.location.href,
          },
        });
      });

      const applied = this.checkSubmissionSuccess();
      if (applied) {
        this.safeSendMessage({
          type: "SEND_CV_TASK_DONE",
          data: {
            jobId: jobId, // Use the extracted jobId variable
            title: document.title || "Job on Lever",
            company:
              this.extractCompanyFromUrl(window.location.href) ||
              "Company on Lever",
            location: "Not specified",
            jobUrl: window.location.href,
            salary: "Not specified",
            workplace: "Not specified",
            postedDate: "Not specified",
            applicants: "Not specified",
          },
        });

        this.isApplicationInProgress = false;

        debugLog("Application completed successfully");
      }
      await new Promise((resolve, reject) => {
        setTimeout(async () => {
          try {
            const applied = await this.apply(data);

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

        // CRITICAL FIX: Check again that we're not processing an application
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

        // Check if URL matches pattern
        if (this.SEARCH_DATA.searchLinkPattern) {
          const pattern =
            typeof this.SEARCH_DATA.searchLinkPattern === "string"
              ? new RegExp(
                  this.SEARCH_DATA.searchLinkPattern.replace(
                    /^\/|\/[gimy]*$/g,
                    ""
                  )
                )
              : this.SEARCH_DATA.searchLinkPattern;

          if (!pattern.test(url)) {
            debugLog(`Link ${url} does not match pattern`);
            this.markLinkAsColor(links[i], "red", "Invalid");

            // Add to processed URLs to avoid rechecking
            if (!this.processedUrls) this.processedUrls = new Set();
            this.processedUrls.add(url);

            // Add to SEARCH_DATA to maintain consistency
            this.SEARCH_DATA.submittedLinks.push({
              url,
              status: "SKIP",
              message: "Link does not match pattern",
            });

            this.appendStatusMessage(
              `Skipping link that doesn't match pattern: ${url}`
            );
            continue;
          }
        }

        // Found an unprocessed link that matches the pattern
        foundUnprocessedLink = true;
      }

      // CRITICAL FIX: Check for application in progress before second pass
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

        // Check if URL matches pattern
        if (this.SEARCH_DATA.searchLinkPattern) {
          const pattern =
            typeof this.SEARCH_DATA.searchLinkPattern === "string"
              ? new RegExp(
                  this.SEARCH_DATA.searchLinkPattern.replace(
                    /^\/|\/[gimy]*$/g,
                    ""
                  )
                )
              : this.SEARCH_DATA.searchLinkPattern;

          if (!pattern.test(url)) {
            // Already handled in the first pass
            continue;
          }
        }

        // Found an unprocessed link that matches the pattern - process it!
        this.appendStatusMessage("Found job to apply: " + url);

        // CRITICAL FIX: Check one more time before proceeding
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
        }, 180000);

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

      // CRITICAL FIX: If we couldn't find any unprocessed links
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
          ".lever-result-highlight"
        );
        if (existingHighlight) {
          existingHighlight.remove();
        }

        // Create highlight container
        const highlight = document.createElement("div");
        highlight.className = "lever-result-highlight";
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

  async handleRequiredCheckboxes(form, profile) {
    try {
      this.appendStatusMessage("Checking required checkboxes");

      // First identify checkbox groups to handle them differently
      const checkboxGroups = this.identifyCheckboxGroups(form);

      // Process checkbox groups (like pronouns, ethnicity, etc.)
      for (const group of checkboxGroups) {
        await this.handleCheckboxGroup(group, profile);
      }

      // Find individual checkboxes (not part of groups)
      const individual = this.getIndividualCheckboxes(form, checkboxGroups);

      // Process individual checkboxes
      for (const checkbox of individual) {
        await this.handleIndividualCheckbox(checkbox, profile);
      }
    } catch (error) {
      debugLog("Error handling checkboxes:", error);
      this.appendStatusMessage(
        `Warning: Some checkboxes may not have been processed correctly - ${error.message}`
      );
    }
  }

  // Identify checkbox groups on the page
  identifyCheckboxGroups(form) {
    const groups = [];

    // Method 1: Find groups by common container with multiple checkboxes with same name
    const checkboxes = form.querySelectorAll('input[type="checkbox"]');
    const nameGroups = {};

    // Group checkboxes by name
    checkboxes.forEach((checkbox) => {
      if (checkbox.name) {
        if (!nameGroups[checkbox.name]) {
          nameGroups[checkbox.name] = [];
        }
        nameGroups[checkbox.name].push(checkbox);
      }
    });

    // Filter for groups with multiple checkboxes
    Object.entries(nameGroups).forEach(([name, groupCheckboxes]) => {
      if (groupCheckboxes.length > 1) {
        // Find the common container
        const container = this.findCommonAncestor(groupCheckboxes);

        // Get the group label
        let groupLabel = "";
        const labelEl = container.querySelector(
          ".application-label, legend, h3, h4"
        );
        if (labelEl) {
          groupLabel = labelEl.textContent.trim();
        }

        groups.push({
          name,
          label: groupLabel,
          checkboxes: groupCheckboxes,
          container,
        });
      }
    });

    // Method 2: Find groups by specific containers
    const groupContainers = form.querySelectorAll(
      'ul[data-qa="checkboxes"], ul[data-qa*="Checkboxes"], div.checkbox-group'
    );

    groupContainers.forEach((container) => {
      const containerCheckboxes = Array.from(
        container.querySelectorAll('input[type="checkbox"]')
      );
      if (containerCheckboxes.length > 1) {
        // Get the group label
        let groupLabel = "";
        const labelEl =
          container.closest("li")?.querySelector(".application-label") ||
          container.previousElementSibling?.querySelector(
            ".application-label"
          ) ||
          container.parentElement?.querySelector(
            ".application-label, legend, h3, h4"
          );

        if (labelEl) {
          groupLabel = labelEl.textContent.trim();
        }

        // Check if this group is already included
        const alreadyIncluded = groups.some((group) => {
          return group.checkboxes.some((cb) =>
            containerCheckboxes.includes(cb)
          );
        });

        if (!alreadyIncluded) {
          groups.push({
            name: containerCheckboxes[0].name || "",
            label: groupLabel,
            checkboxes: containerCheckboxes,
            container,
          });
        }
      }
    });

    this.appendStatusMessage(`Found ${groups.length} checkbox groups`);
    return groups;
  }

  // Find common ancestor for a set of elements
  findCommonAncestor(elements) {
    if (elements.length === 0) return null;
    if (elements.length === 1) return elements[0].parentElement;

    let ancestor = elements[0].parentElement;

    while (ancestor) {
      let containsAll = true;
      for (let i = 1; i < elements.length; i++) {
        if (!ancestor.contains(elements[i])) {
          containsAll = false;
          break;
        }
      }

      if (containsAll) return ancestor;
      ancestor = ancestor.parentElement;
    }

    return document.body; // Fallback if no common ancestor found
  }

  // Get individual checkboxes not part of groups
  getIndividualCheckboxes(form, groups) {
    const allCheckboxes = Array.from(
      form.querySelectorAll('input[type="checkbox"]')
    );
    const groupCheckboxes = groups.flatMap((group) => group.checkboxes);

    // Filter out checkboxes that are part of groups
    return allCheckboxes.filter(
      (checkbox) => !groupCheckboxes.includes(checkbox)
    );
  }

  // Handle checkbox groups (pronouns, ethnicity, etc.)
  async handleCheckboxGroup(group, profile) {
    try {
      this.appendStatusMessage(`Processing checkbox group: "${group.label}"`);

      // Extract options from the group into {text, value} structure
      const structuredOptions = group.checkboxes.map((checkbox) => {
        const label = checkbox.closest("label");
        const span = label?.querySelector("span");
        const text = span
          ? span.textContent.trim()
          : label?.textContent.trim() || checkbox.value;
        return { text: text, value: checkbox.value };
      });

      // Skip empty groups
      if (structuredOptions.length === 0) {
        this.appendStatusMessage("No options found in group, skipping");
        return;
      }

      this.appendStatusMessage(`Group options for "${group.label}": ${structuredOptions.map(o => o.text).join(", ")}`);

      // For all other groups, ask AI what to select
      try {
        // Get answer from AI, passing structuredOptions
        const answerFromAI = await this.getAnswer(group.label, structuredOptions, profile);
        debugLog("handleCheckboxGroup: Group:", group.label, "AI Answer:", answerFromAI);

        if (answerFromAI) {
          this.appendStatusMessage(`AI recommendation for "${group.label}": ${answerFromAI}`);
          // Parse the answer - could be multiple selections. Pass structuredOptions for parsing.
          const textsToSelect = this.parseSelectedOptions(answerFromAI, structuredOptions);

          if (textsToSelect.length > 0) {
            for (const textToSelect of textsToSelect) {
              await this.checkSpecificOption(group.checkboxes, textToSelect, group.label);
            }
          } else {
            debugLog("handleCheckboxGroup: No specific option checked by AI for '"+group.label+"'. Group left untouched.");
            this.appendStatusMessage(`No specific options from "${answerFromAI}" clearly matched available options for "${group.label}", leaving untouched.`);
          }
        } else {
          debugLog("handleCheckboxGroup: No specific option checked by AI for '"+group.label+"'. Group left untouched.");
          this.appendStatusMessage(`AI did not provide an answer for checkbox group "${group.label}", leaving untouched.`);
        }
      } catch (error) {
        debugLog(
          `Error getting AI answer for checkbox group "${group.label}": ${error.message}`
        );
        this.appendStatusMessage(
          `Error getting AI answer for checkbox group "${group.label}", leaving untouched. Error: ${error.message}`
        );
        // Do not apply any fallback, leave untouched
      }
    } catch (error) {
      debugLog(
        `Error handling checkbox group "${group.label}": ${error.message}`
      );
    }
  }

  // Check if a question is demographic in nature
  isDemographicQuestion(question) {
    if (!question) return false;

    const questionLower = question.toLowerCase();
    const demographicKeywords = [
      "race",
      "ethnicity",
      "gender",
      "sex",
      "veteran",
      "disability",
      "orientation",
      "demographic",
      "equal opportunity",
      "diversity",
      "affirmative action",
      "eeo",
    ];

    return demographicKeywords.some((keyword) =>
      questionLower.includes(keyword)
    );
  }

  // Parse selected options from AI answer
  parseSelectedOptions(answerFromAI, availableOptionsOnForm) { // availableOptionsOnForm is now array of {text, value}
    if (!answerFromAI) return [];

    const individualAnswers = answerFromAI.split(',').map(s => s.trim().toLowerCase());
    const matchedDisplayTexts = new Set(); // Use a Set to store unique display texts

    for (const optionOnForm of availableOptionsOnForm) { // optionOnForm is {text, value}
      const optionTextLower = optionOnForm.text.toLowerCase();
      const optionValueLower = optionOnForm.value ? optionOnForm.value.toLowerCase() : ""; // Handle cases where value might be null/undefined

      for (const individualAnswer of individualAnswers) {
        if (individualAnswer === optionTextLower || (optionValueLower && individualAnswer === optionValueLower)) {
          matchedDisplayTexts.add(optionOnForm.text); // Add the display text to the set
          break; // Found a match for this optionOnForm, move to the next
        }
      }
    }
    return Array.from(matchedDisplayTexts); // Convert Set to array
  }

  // Check a specific option in a checkbox group
  async checkSpecificOption(checkboxes, optionTextFromParse, groupLabelForDebug = "") {
    for (const checkbox of checkboxes) {
      const label = checkbox.closest("label");
      const span = label?.querySelector("span");
      const checkboxLabel = span
        ? span.textContent.trim()
        : label?.textContent.trim() || checkbox.value;
      const checkboxValue = checkbox.value;

      if (checkboxLabel.toLowerCase() === optionTextFromParse.toLowerCase() ||
          (checkboxValue && checkboxValue.toLowerCase() === optionTextFromParse.toLowerCase())) {
        debugLog("handleCheckboxGroup: Checking option '"+ checkboxLabel +"' (value: '"+checkboxValue+"') for group '"+groupLabelForDebug+"' based on AI answer '"+optionTextFromParse+"'");
        this.appendStatusMessage(`Selecting option: "${checkboxLabel}"`);

        // Scroll to the checkbox
        this.scrollToTargetAdjusted(checkbox, 100);
        await this.wait(100);

        // Click the label if available (more reliable)
        if (label) {
          label.click();
        } else {
          checkbox.click();
        }

        await this.wait(200);

        // Verify if checkbox was checked
        if (!checkbox.checked) {
          checkbox.checked = true;
          checkbox.dispatchEvent(new Event("change", { bubbles: true }));
        }

        return true;
      }
    }

    this.appendStatusMessage(`Option "${optionText}" not found in checkboxes`);
    return false;
  }

  // Handle individual checkboxes (not part of groups)
  async handleIndividualCheckbox(checkbox, profile) {
    try {
      // Skip if already checked or not visible
      if (
        checkbox.checked ||
        checkbox.offsetParent === null ||
        checkbox.style.display === "none" ||
        checkbox.style.visibility === "hidden"
      ) {
        return;
      }

      // Get checkbox label
      const label =
        checkbox.closest("label") ||
        document.querySelector(`label[for="${checkbox.id}"]`);
      const checkboxText = label ? label.textContent.trim() : "";

      if (!checkboxText) {
        debugLog("No text found for individual checkbox, skipping");
        return;
      }

      this.appendStatusMessage(
        `Processing individual checkbox: "${checkboxText.substring(0, 50)}${
          checkboxText.length > 50 ? "..." : ""
        }"`
      );

      // Check if required by attributes
      const isRequired =
        checkbox.hasAttribute("required") ||
        checkbox.getAttribute("aria-required") === "true" ||
        checkbox.classList.contains("required") ||
        checkboxText.includes("*") ||
        checkbox.closest(".required-field") !== null;

      if (isRequired) {
        this.appendStatusMessage("Checkbox is required, checking it");
        await this.checkIndividualCheckbox(checkbox, label);
        return;
      }

      // Get AI recommendation for this checkbox
      try {
        const options = ["Yes (check the box)", "No (leave unchecked)"];
        const question = `Should I check this checkbox in a job application? The checkbox says: "${checkboxText}"`;

        const answer = await this.getAnswer(question, options, profile);
        const shouldCheck = answer.toLowerCase().includes("yes");

        if (shouldCheck) {
          this.appendStatusMessage("AI recommends checking this box");
          await this.checkIndividualCheckbox(checkbox, label);
        } else {
          this.appendStatusMessage("AI recommends leaving this box unchecked");
        }
      } catch (error) {
        debugLog(
          `Error getting AI answer for individual checkbox: ${error.message}`
        );

        // No fallback if AI doesn't provide an answer, unless it's required (handled by isRequired logic)
        this.appendStatusMessage(
          `AI did not provide a clear recommendation for "${checkboxText}", leaving as is (unless required).`
        );
      }
    } catch (error) {
      debugLog(`Error handling individual checkbox "${checkboxText}": ${error.message}`);
    }
  }

  // Check an individual checkbox
  async checkIndividualCheckbox(checkbox, label) {
    try {
      // Scroll to the checkbox
      this.scrollToTargetAdjusted(checkbox, 100);
      await this.wait(100);

      // Click the label if available
      if (label) {
        label.click();
      } else {
        checkbox.click();
      }

      await this.wait(200);

      // Ensure it's checked
      if (!checkbox.checked) {
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event("change", { bubbles: true }));
      }

      return checkbox.checked;
    } catch (error) {
      debugLog(`Error checking individual checkbox: ${error.message}`);
      return false;
    }
  }

  /**
   * Utility function to check if any of the field identifiers match any of the provided keywords
   * Used for identifying form field types based on labels, placeholders, names, etc.
   *
   * @param {...string} fields - Variable number of field identifiers (labels, placeholders, etc.)
   * @param {string[]} keywords - Array of keywords to match against
   * @returns {boolean} - True if any field matches any keyword
   */
  matchesAny(...args) {
    // Last argument should be the keywords array
    if (args.length < 1) return false;
    const keywords = args.pop();

    if (!Array.isArray(keywords)) {
      debugLog("matchesAny: keywords not an array");
      return false;
    }

    // Check if any field matches any keyword
    return args.some((field) => {
      if (!field) return false;
      const fieldLower = String(field).toLowerCase();
      return keywords.some(
        (keyword) =>
          fieldLower === keyword.toLowerCase() ||
          fieldLower.includes(keyword.toLowerCase())
      );
    });
  }

  /**
   * Map profile data to fields - more direct approach for Lever
   */
  mapProfileToFields(profile) {
    return {
      "first name": profile.firstName,
      "last name": profile.lastName,
      "full name": `${profile.firstName} ${profile.lastName}`,
      name: `${profile.firstName} ${profile.lastName}`,
      email: profile.email,
      phone: profile.phone || profile.phoneNumber,
      linkedin: profile.linkedIn || profile.linkedinUrl,
      github: profile.github || profile.githubUrl,
      website: profile.website || profile.websiteUrl,
      portfolio: profile.portfolio || profile.websiteUrl,
      address: profile.streetAddress,
      city:
        profile.city ||
        (profile.currentCity ? profile.currentCity.split(",")[0].trim() : ""),
      country: profile.country,
      company: profile.currentCompany || "Not currently employed",
      "current company": profile.currentCompany,
      position: profile.fullPosition,
      title: profile.fullPosition,
      experience: profile.yearsOfExperience,
      salary: profile.desiredSalary,
      "notice period": profile.noticePeriod || "2 weeks",
      "cover letter": profile.coverLetter,
    };
  }

  /**
   * Select option by value or text in a select element
   * Makes a best effort to find and select the correct option
   */
  async selectOptionByValue(select, value) {
    if (!select || !value) return false;

    try {
      this.scrollToTargetAdjusted(select, 100);
      await this.wait(100);

      // Try to find the option by exact value first
      let matchingOption = Array.from(select.options).find(
        (option) => option.value.toLowerCase() === value.toLowerCase()
      );

      // If no exact match, try substring match on value
      if (!matchingOption) {
        matchingOption = Array.from(select.options).find((option) =>
          option.value.toLowerCase().includes(value.toLowerCase())
        );
      }

      // If still no match, try matching by option text
      if (!matchingOption) {
        matchingOption = Array.from(select.options).find(
          (option) =>
            option.text.toLowerCase() === value.toLowerCase() ||
            option.text.toLowerCase().includes(value.toLowerCase())
        );
      }

      // If we found a match, select it
      if (matchingOption) {
        select.value = matchingOption.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        this.appendStatusMessage(`Selected option: ${matchingOption.text}`);
        return true;
      }

      debugLog(`No matching option found for value: ${value}`);
      return false;
    } catch (error) {
      debugLog("Error selecting option:", error);
      return false;
    }
  }

  /**
   * Utility function to check if a field matches any of the provided regex patterns
   * More powerful than matchesAny for complex pattern matching
   *
   * @param {string} field - Field to check
   * @param {RegExp[]} patterns - Array of regex patterns to match against
   * @returns {boolean} - True if field matches any pattern
   */
  matchesRegex(field, patterns) {
    if (!field) return false;

    if (!Array.isArray(patterns)) {
      debugLog("matchesRegex: patterns not an array");
      return false;
    }

    const fieldStr = String(field).toLowerCase();

    return patterns.some((pattern) => {
      if (pattern instanceof RegExp) {
        return pattern.test(fieldStr);
      } else if (typeof pattern === "string") {
        // Create regex from string pattern
        try {
          const regex = new RegExp(pattern, "i");
          return regex.test(fieldStr);
        } catch (e) {
          debugLog(`Invalid regex pattern: ${pattern}`, e);
          return false;
        }
      }
      return false;
    });
  }

  /**
   * Check if this is a resume upload field
   */
  isResumeField(labelText, container) {
    const resumeKeywords = [
      "resume",
      "cv",
      "curriculum vitae",
      "upload resume",
      "upload cv",
      "attach resume",
      "attach cv",
      "upload your resume",
      "upload your cv",
    ];

    return resumeKeywords.some((keyword) =>
      labelText.toLowerCase().includes(keyword)
    );
  }

  /**
   * Normalize URL by removing query parameters and hash
   */
  normalizeUrl(link) {
    try {
      const url = new URL(link);
      return url.origin + url.pathname;
    } catch (e) {
      errorLog("Error normalizing URL:", e);
      return link;
    }
  }

  /**
   * Wait for specified time
   */
  wait(timeout) {
    return new Promise((resolve) => setTimeout(resolve, timeout));
  }

  /**
   * Append status message to overlay
   */
  appendStatusMessage(message) {
    debugLog(`Status: ${message}`);

    try {
      const contentElement = document.getElementById(
        "lever-automation-status-content"
      );
      if (contentElement) {
        const messageElement = document.createElement("div");
        messageElement.textContent = `${new Date().toLocaleTimeString()}: ${message}`;
        messageElement.style.marginBottom = "5px";

        contentElement.appendChild(messageElement);

        // Auto-scroll to bottom
        contentElement.scrollTop = contentElement.scrollHeight;
      }
    } catch (err) {
      errorLog("Error appending status message:", err);
    }
  }

  /**
   * Append error message to overlay
   */
  appendStatusErrorMessage(error) {
    const errorMessage = this.errorToString(error);
    errorLog("Error status:", errorMessage);

    try {
      const contentElement = document.getElementById(
        "lever-automation-status-content"
      );
      if (contentElement) {
        const messageElement = document.createElement("div");
        messageElement.textContent = `${new Date().toLocaleTimeString()}: ERROR: ${errorMessage}`;
        messageElement.style.marginBottom = "5px";
        messageElement.style.color = "red";
        messageElement.style.fontWeight = "bold";

        contentElement.appendChild(messageElement);

        // Auto-scroll to bottom
        contentElement.scrollTop = contentElement.scrollHeight;
      }
    } catch (err) {
      errorLog("Error appending error message:", err);
    }
  }

  /**
   * Convert error to string representation
   */
  errorToString(e) {
    if (!e) return "Unknown error (no details)";

    if (e instanceof Error) {
      return e.message + (e.stack ? `\n${e.stack}` : "");
    }

    return String(e);
  }

  /**
   * Match a field label against common application question patterns
   */
  matchesCommonQuestion(label, keywords) {
    if (!label) return false;

    // For questions, we need a more flexible matching algorithm
    // First, check for exact matches
    for (const keyword of keywords) {
      if (label.includes(keyword)) {
        return true;
      }
    }

    // Then, check for semantic matches
    // e.g., "Tell us about your background" should match "experience"
    for (const keyword of keywords) {
      // Create variations of the keyword
      const variations = [
        keyword,
        `your ${keyword}`,
        `about ${keyword}`,
        `about your ${keyword}`,
        `tell us about ${keyword}`,
        `tell us about your ${keyword}`,
        `describe ${keyword}`,
        `describe your ${keyword}`,
        `share ${keyword}`,
        `share your ${keyword}`,
      ];

      for (const variation of variations) {
        if (label.includes(variation)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check if a label element indicates the field is required
   */
  isRequired(labelEl) {
    if (!labelEl) return false;

    // Check for asterisk in label or parent containers
    const hasAsterisk =
      labelEl.textContent.includes("*") ||
      labelEl.querySelector("strong")?.textContent?.includes("*") ||
      labelEl.parentNode?.querySelector("strong")?.textContent?.trim() === "*";

    // Check for "required" text
    const hasRequiredText =
      labelEl.textContent.toLowerCase().includes("required") ||
      labelEl.parentNode?.textContent.toLowerCase().includes("required");

    // Check for required attribute in nearby input
    const nearbyInput =
      labelEl.parentNode?.querySelector("input, textarea, select") ||
      document.querySelector(
        `input[aria-labelledby="${labelEl.id}"], textarea[aria-labelledby="${labelEl.id}"], select[aria-labelledby="${labelEl.id}"]`
      );

    const inputHasRequired =
      nearbyInput?.hasAttribute("required") ||
      nearbyInput?.getAttribute("aria-required") === "true";

    return hasAsterisk || hasRequiredText || inputHasRequired;
  }

  /**
   * Parses Lever form questions using the actual HTML structure
   * This specifically addresses the "cards" fields that use a hidden template with the real questions
   */

  /**
   * Extract all questions from the Lever form including hidden template data
   * @param {HTMLElement} form - The form element
   * @returns {Object} - Mapping of field names to their questions
   */
  extractLeverFormQuestions(form) {
    // Store all field name to question mappings
    const fieldQuestions = {};

    try {
      this.appendStatusMessage("Extracting form questions...");

      // First, look for the hidden template fields that contain question definitions
      const templateFields = form.querySelectorAll(
        'input[name*="baseTemplate"]'
      );

      templateFields.forEach((templateField) => {
        try {
          // Extract the card ID from the name attribute (e.g., cards[UUID][baseTemplate])
          const cardIdMatch = templateField.name.match(/cards\[(.*?)\]/);
          if (!cardIdMatch) return;

          const cardId = cardIdMatch[1];
          const templateValue = templateField.value;

          // Parse the JSON template data
          if (templateValue) {
            const template = JSON.parse(templateValue.replace(/&quot;/g, '"'));

            // Check if it has fields defined
            if (template.fields && Array.isArray(template.fields)) {
              // Map each field to its corresponding input name
              template.fields.forEach((field, index) => {
                const fieldName = `cards[${cardId}][field${index}]`;
                fieldQuestions[fieldName] = {
                  question: field.text,
                  templateOptions: field.options || null,
                  type: field.type,
                };
                this.appendStatusMessage(
                  `Found template question: "${field.text}", Type: ${field.type}, Options: ${field.options ? field.options.length : 0}`
                );
              });
            }
          }
        } catch (error) {
          debugLog("Error parsing template field:", error);
        }
      });

      // Now scan all application-question elements to find visible questions
      const questionElements = form.querySelectorAll(".application-question");

      questionElements.forEach((questionEl) => {
        try {
          // Find the label/question text
          const labelEl = questionEl.querySelector(".application-label");
          const textEl = labelEl?.querySelector(".text") || labelEl;

          if (!textEl) return;

          // Get the text content without the required asterisk
          let questionText = textEl.textContent.trim();
          questionText = questionText.replace(/✱$/, "").trim();

          // Find the corresponding input/textarea/select
          const inputEl = questionEl.querySelector(
            'input:not([type="hidden"]), textarea, select'
          );

          if (inputEl && questionText && !fieldQuestions[inputEl.name] /* Only add if not already from template */) {
            fieldQuestions[inputEl.name] = {
              question: questionText,
              templateOptions: null, // No template options for these
              type: inputEl.type || inputEl.tagName.toLowerCase(),
            };
            this.appendStatusMessage(
              `Found visible question: "${questionText}", Type: ${inputEl.type || inputEl.tagName.toLowerCase()}`
            );
          }
        } catch (error) {
          debugLog("Error processing question element:", error);
        }
      });

      this.appendStatusMessage(
        `Extracted ${Object.keys(fieldQuestions).length} questions from form`
      );
      return fieldQuestions;
    } catch (error) {
      debugLog("Error extracting form questions:", error);
      return {};
    }
  }

  /**
   * Enhanced method to match field names to their questions
   * @param {HTMLElement} element - The form field element
   * @param {Object} fieldQuestions - Mapping of field names to questions
   * @returns {Object | null} - The field info object or null if not found
   */
  getQuestionForField(element, fieldQuestions) {
    if (!element || !element.name) return null;

    // Direct lookup by field name
    if (fieldQuestions[element.name]) {
      return fieldQuestions[element.name]; // Returns the object { question, templateOptions, type }
    }

    // For fields with no direct match, try the closest application-question container
    // This part might become less relevant if templates are comprehensive
    const questionContainer = element.closest(".application-question");
    if (questionContainer) {
      const labelEl = questionContainer.querySelector(".application-label");
      const textEl = labelEl?.querySelector(".text") || labelEl;

      if (textEl) {
        let questionText = textEl.textContent.trim();
        questionText = questionText.replace(/✱$/, "").trim();
        const inputEl = questionContainer.querySelector('input:not([type="hidden"]), textarea, select');


        if (questionText) {
          // Return a similar structured object for consistency, though templateOptions will be null
          return {
            question: questionText,
            templateOptions: null,
            type: inputEl ? (inputEl.type || inputEl.tagName.toLowerCase()) : (element.type || element.tagName.toLowerCase()),
          };
        }
      }
    }
    return null;
  }

  /**
   * Improved handling for radio buttons and select fields
   */

  /**
   * Enhanced method to handle radio button selection
   * Uses multiple approaches to ensure the radio button is actually clicked
   */
  async handleRadioButtonSelection(radioButtons, value) {
    if (!radioButtons || !radioButtons.length || !value) {
      return false;
    }

    this.appendStatusMessage(`Selecting radio option: "${value}"`);
    let selected = false;

    // First convert boolean values to strings for comparison
    const valueText =
      value === true
        ? "yes"
        : value === false
        ? "no"
        : String(value).toLowerCase();

    // Try multiple approaches to select the correct radio button
    for (const radioBtn of radioButtons) {
      try {
        // Get label text in various ways
        const labelEl =
          radioBtn.closest("label") ||
          document.querySelector(`label[for="${radioBtn.id}"]`);

        let labelText = "";

        if (labelEl) {
          const specificSpan = labelEl.querySelector('span.application-answer-alternative');
          if (specificSpan) {
              labelText = specificSpan.textContent.trim().toLowerCase();
          } else {
              labelText = labelEl.textContent.trim().toLowerCase();
          }
        } else {
          // Try to find text near the radio button
          const parentEl = radioBtn.parentElement;
          if (parentEl) {
            // Get text content but exclude text from child inputs
            const childInputs = parentEl.querySelectorAll("input");
            let parentText = parentEl.textContent;
            childInputs.forEach((input) => {
              if (input !== radioBtn && input.value) {
                parentText = parentText.replace(input.value, "");
              }
            });
            labelText = parentText.trim().toLowerCase();
          }
        }

        // Try to match by value
        if (
          radioBtn.value &&
          (radioBtn.value.toLowerCase() === valueText ||
            radioBtn.value.toLowerCase().includes(valueText) ||
            valueText.includes(radioBtn.value.toLowerCase()))
        ) {
          this.appendStatusMessage(
            `Found matching radio button by value: ${radioBtn.value}`
          );
          await this.clickRadioButtonEffectively(radioBtn);
          selected = true;
          break;
        }

        // Try to match by label text
        if (
          labelText &&
          (labelText === valueText ||
            labelText.includes(valueText) ||
            valueText.includes(labelText))
        ) {
          this.appendStatusMessage(
            `Found matching radio button by label: ${labelText}`
          );
          await this.clickRadioButtonEffectively(radioBtn);
          selected = true;
          break;
        }

        // Special handling for yes/no options
        if (
          (labelText === "yes" &&
            (valueText === "yes" || valueText === "true")) ||
          (labelText === "no" && (valueText === "no" || valueText === "false"))
        ) {
          this.appendStatusMessage(
            `Found matching yes/no radio button: ${labelText}`
          );
          await this.clickRadioButtonEffectively(radioBtn);
          selected = true;
          break;
        }
      } catch (error) {
        debugLog(`Error processing radio button: ${error.message}`);
        // Continue with next radio button
      }
    }

    // If no match found by specific matching, try to select the first option as fallback
    if (!selected && radioButtons.length > 0) {
      this.appendStatusMessage(
        `No exact match found, selecting first radio option as fallback`
      );
      await this.clickRadioButtonEffectively(radioButtons[0]);
      selected = true;
    }

    return selected;
  }

  /**
   * Click a radio button effectively using multiple approaches
   * This ensures the radio button is actually selected
   */
  async clickRadioButtonEffectively(radioBtn) {
    // First scroll to the element
    this.scrollToTargetAdjusted(radioBtn, 100);
    await this.wait(300);

    // Try several approaches to ensure the radio button is clicked

    // Approach 1: Standard click
    radioBtn.click();
    await this.wait(300);

    // Check if successful
    if (radioBtn.checked) {
      return true;
    }

    // Approach 2: Click the label if available
    const labelEl =
      radioBtn.closest("label") ||
      document.querySelector(`label[for="${radioBtn.id}"]`);
    if (labelEl) {
      labelEl.click();
      await this.wait(300);
    }

    // Check if successful
    if (radioBtn.checked) {
      return true;
    }

    // Approach 3: Try setting checked property directly
    radioBtn.checked = true;
    radioBtn.dispatchEvent(new Event("change", { bubbles: true }));
    await this.wait(300);

    // Approach 4: Click parent element if still not checked
    if (!radioBtn.checked && radioBtn.parentElement) {
      radioBtn.parentElement.click();
      await this.wait(300);
    }

    // Approach 5: Try using MouseEvents for more browser compatibility
    if (!radioBtn.checked) {
      const mouseDown = new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        view: window,
      });

      const mouseUp = new MouseEvent("mouseup", {
        bubbles: true,
        cancelable: true,
        view: window,
      });

      radioBtn.dispatchEvent(mouseDown);
      await this.wait(50);
      radioBtn.dispatchEvent(mouseUp);
      await this.wait(50);
      radioBtn.click();
      await this.wait(300);
    }

    return radioBtn.checked;
  }

  /**
   * Enhanced method to handle select/dropdown fields
   * Supports both native select elements and custom dropdown implementations
   */
  async handleSelectFieldSelection(selectElement, value) {
    if (!selectElement || !value) {
      return false;
    }

    this.appendStatusMessage(`Setting select/dropdown field to: "${value}"`);
    const valueText = String(value).toLowerCase();

    // Handle native select elements
    if (selectElement.tagName === "SELECT") {
      return await this.selectOptionByValueEnhanced(selectElement, value);
    }

    // Handle custom dropdown implementations

    // First scroll to the element
    this.scrollToTargetAdjusted(selectElement, 100);
    await this.wait(300);

    // Click to open the dropdown
    selectElement.click();
    await this.wait(700); // Longer wait for dropdown to fully open

    // Find all possible dropdown containers
    let dropdownContainer = null;

    // Try various dropdown container selectors
    const possibleContainers = [
      document.querySelector("dialog[open]"),
      document.querySelector(".dropdown-options"),
      document.querySelector(".options"),
      document.querySelector('ul[role="listbox"]'),
      document.querySelector('div[role="listbox"]'),
      selectElement
        .closest('div[data-input-type="select"]')
        ?.querySelector("ul, .options"),
      selectElement.closest(".select-container")?.querySelector("ul, .options"),
      selectElement.parentElement?.querySelector("ul, .options"),
      document.querySelector(".dropdown-content"),
      document.querySelector(".select-options"),
      document.querySelector(".lever-dropdown"),
    ];

    for (const container of possibleContainers) {
      if (container && container.offsetParent !== null) {
        dropdownContainer = container;
        break;
      }
    }

    // If we found a dropdown container, look for matching options
    if (dropdownContainer) {
      // Find all option elements that might be in the dropdown
      const options = dropdownContainer.querySelectorAll(
        'li, .option, .dropdown-item, option, [role="option"]'
      );

      this.appendStatusMessage(`Found dropdown with ${options.length} options`);

      // Try to find and click a matching option
      let matchFound = false;

      for (const option of options) {
        const optionText = option.textContent.trim().toLowerCase();

        // Match by exact text or partial text
        if (
          optionText === valueText ||
          optionText.includes(valueText) ||
          valueText.includes(optionText)
        ) {
          this.appendStatusMessage(
            `Selecting dropdown option: "${option.textContent.trim()}"`
          );
          this.scrollToTargetAdjusted(option, 100);
          await this.wait(300);

          // Try clicking the option
          option.click();
          await this.wait(500);

          // Check if the dropdown is now closed (indication of successful selection)
          if (dropdownContainer.offsetParent === null) {
            matchFound = true;
            break;
          }

          // Try clicking again with MouseEvents if still open
          const mouseDown = new MouseEvent("mousedown", {
            bubbles: true,
            cancelable: true,
            view: window,
          });

          const mouseUp = new MouseEvent("mouseup", {
            bubbles: true,
            cancelable: true,
            view: window,
          });

          option.dispatchEvent(mouseDown);
          await this.wait(50);
          option.dispatchEvent(mouseUp);
          await this.wait(300);

          matchFound = true;
          break;
        }
      }

      // If no match was found, try selecting the first option as fallback
      if (!matchFound && options.length > 0) {
        this.appendStatusMessage(
          `No matching option found, selecting first option as fallback`
        );
        options[0].click();
        await this.wait(500);
      }

      // If dropdown is still open, click outside to close it
      if (dropdownContainer.offsetParent !== null) {
        document.body.click();
        await this.wait(300);
      }

      return matchFound || options.length > 0;
    } else {
      // Dropdown container not found
      this.appendStatusMessage(
        `Could not find dropdown container - trying to set value directly`
      );

      // Try to set the value directly on the input
      if (selectElement.tagName === "INPUT") {
        await this.setAdvancedInputValue(selectElement, value);
        return true;
      }

      return false;
    }
  }

  /**
   * Enhanced version of selectOptionByValue that uses multiple approaches
   */
  async selectOptionByValueEnhanced(select, value) {
    if (!select || !value) return false;

    try {
      this.scrollToTargetAdjusted(select, 100);
      await this.wait(300);

      // Convert value to lowercase string for comparison
      const valueText = String(value).toLowerCase();
      let matchFound = false;

      // Try each option to find a match
      for (let i = 0; i < select.options.length; i++) {
        const option = select.options[i];
        const optionText = option.text.toLowerCase();
        const optionValue = option.value.toLowerCase();

        // Try to match by text or value
        if (
          optionText === valueText ||
          optionValue === valueText ||
          optionText.includes(valueText) ||
          valueText.includes(optionText)
        ) {
          // Multiple approaches to set the selected option

          // Approach 1: Set the selectedIndex
          select.selectedIndex = i;
          select.dispatchEvent(new Event("change", { bubbles: true }));
          await this.wait(300);

          // Approach 2: Set the value
          select.value = option.value;
          select.dispatchEvent(new Event("change", { bubbles: true }));
          await this.wait(300);

          // Approach 3: Set the selected property
          option.selected = true;
          select.dispatchEvent(new Event("change", { bubbles: true }));

          this.appendStatusMessage(`Selected option: ${option.text}`);
          matchFound = true;
          break;
        }
      }

      // If no match was found, try selecting the first non-placeholder option as fallback
      if (!matchFound && select.options.length > 0) {
        // Skip the first option if it looks like a placeholder
        const startIndex =
          select.options[0].value === "" ||
          select.options[0].text.includes("Select") ||
          select.options[0].text.includes("Choose")
            ? 1
            : 0;

        if (startIndex < select.options.length) {
          select.selectedIndex = startIndex;
          select.dispatchEvent(new Event("change", { bubbles: true }));
          this.appendStatusMessage(
            `No matching option found, selected: ${select.options[startIndex].text}`
          );
          return true;
        }
      }

      return matchFound;
    } catch (error) {
      debugLog("Error in selectOptionByValueEnhanced:", error);
      return false;
    }
  }

  /**
   * Modified fillApplicationFields function with enhanced radio and select handling
   */
  async fillApplicationFields(form, profile) {
    try {
      this.appendStatusMessage("Filling form fields...");

      // Extract all questions from the form first
      const fieldQuestions = this.extractLeverFormQuestions(form);

      // Create a mapping for basic profile fields only (for simple fields)

      const basicProfileFields = {
        "first name": profile.firstName,
        "last name": profile.lastName,
        "full name": `${profile.firstName} ${profile.lastName}`,
        name: `${profile.firstName} ${profile.lastName}`,
        email: profile.email,
        phone: profile.phone || profile.phoneNumber,
        linkedin: profile.linkedIn || profile.linkedinUrl,
        github: profile.github || profile.githubUrl,
        website: profile.website || profile.websiteUrl,
        location: profile.currentCity || profile.city || profile.location,
        address: profile.streetAddress,
        city:
          profile.city ||
          (profile.currentCity ? profile.currentCity.split(",")[0].trim() : ""),
      };

      // Field selector for form elements
      const FIELDS_SELECTOR =
        'fieldset[aria-labelledby], div[role="group"][aria-labelledby], ' +
        'input[aria-labelledby]:not([aria-hidden="true"],[type="file"]), ' +
        'textarea[aria-labelledby], input[texts]:not([aria-hidden="true"],[type="file"]), ' +
        'input[placeholder][inputmode="tel"]:not([aria-hidden="true"],[type="file"]), ' +
        'input[type="text"], input[type="email"], input[type="tel"], input[type="url"], ' +
        "textarea, select, div.select-container, " +
        'fieldset:has(input[type="radio"]), fieldset:has(input[type="checkbox"]), ' +
        'div:has(input[type="radio"]), div:has(input[type="checkbox"])';

      // Gather all form fields
      const formElements = [...form.querySelectorAll(FIELDS_SELECTOR)];
      debugLog(`Found ${formElements.length} form fields to process`);

      // Process each form element
      for (const el of formElements) {
        // Skip location autocomplete (handled separately)
        if (
          el.classList.contains("location-input") ||
          el.id === "location-input" ||
          (el.name === "location" &&
            el.parentElement.querySelector('input[name="selectedLocation"]'))
        ) {
          this.appendStatusMessage(
            "Found location field - using simplified approach"
          );
          let locationValue =
            profile.currentCity || profile.city || profile.location;

          // First try the simple approach
          const simpleApproachWorked = await this.handleLocationAutocomplete(
            el,
            locationValue
          );

          // If it didn't work, try the alternative approach
          if (!simpleApproachWorked || !el.value) {
            this.appendStatusMessage(
              "Simple approach failed, trying alternative method"
            );
            await this.handleLeverLocation(form, profile);
          }

          continue;
        }

        // Skip hidden elements
        if (
          el.style.display === "none" ||
          el.offsetParent === null ||
          el.style.visibility === "hidden" ||
          el.getAttribute("aria-hidden") === "true"
        ) {
          continue;
        }

        // Initialize field info
        const field = {
          element: el,
          type: "",
          label: "",
          required: false,
          options: [],
        };

        // Get field label/question text
        const fieldInfo = this.getQuestionForField(el, fieldQuestions);

        if (fieldInfo) {
          field.label = fieldInfo.question;
          // Use template type if available, otherwise fallback to DOM scraping
          field.type = fieldInfo.type || el.type || el.tagName.toLowerCase();
        } else {
          // Fallback to older label detection if fieldInfo is not found (should be rare)
          const ariaLabelledBy = el.getAttribute("aria-labelledby");
          const labelEl = ariaLabelledBy
            ? document.getElementById(ariaLabelledBy)
            : el.closest("label") ||
              document.querySelector(`label[for="${el.id}"]`) ||
              el.parentElement?.querySelector("label");

          if (labelEl) {
            field.label = labelEl.textContent.trim();
            field.required = this.isRequired(labelEl);
          } else {
            // Try other ways to get the label
            const container =
              el.closest(".application-field") || el.parentElement;
            if (container) {
              const labelText = container
                .querySelector("label, .field-label, .label")
                ?.textContent.trim();
              if (labelText) {
                field.label = labelText;
              }
            }

            // Fallback label sources
            if (!field.label) {
              field.label =
                el.getAttribute("placeholder") ||
                el.getAttribute("aria-label") ||
                el.getAttribute("name") ||
                el.id ||
                "";
            }
          }
        }

        field.type = fieldInfo?.type || el.type || el.tagName.toLowerCase();


        // Check if required
        field.required =
          field.required ||
          el.hasAttribute("required") ||
          el.getAttribute("aria-required") === "true" ||
          (field.label && field.label.includes("*")) ||
          el.closest(".required-field") !== null;

        // Clean up label by removing required asterisk
        if(field.label) field.label = field.label.replace(/✱$/, "").trim();

        if (!field.label && field.type !== 'radio' && field.type !== 'checkbox') { // Radio/checkbox groups might not have a single top-level label
          debugLog("No label found for field, skipping unless it's a radio/checkbox group", el);
          continue;
        }

        // Construct field.options for getAnswer
        if (fieldInfo && fieldInfo.templateOptions && Array.isArray(fieldInfo.templateOptions)) {
          field.options = fieldInfo.templateOptions.map(opt => ({
            text: opt.text,
            value: opt.optionId || opt.text // Use optionId if available, else text
          }));
        } else if (field.type === "select" && el.nodeName === "SELECT") {
          field.options = [...el.querySelectorAll("option")]
            .filter(opt => opt.value && opt.text.trim() !== "") // Filter out empty/placeholder options
            .map(opt => ({ text: opt.text.trim(), value: opt.value }));
        } else if (field.type === "radio" || field.type === "checkbox") {
          // For radio/checkboxes not from template, find associated labels
          const inputs = Array.isArray(field.element) ? field.element : [field.element];
          inputs.forEach(input => {
            const labelElement = input.closest('label') || form.querySelector(`label[for="${input.id}"]`);
            const text = labelElement ? labelElement.textContent.trim() : input.value;
            // Ensure not to add duplicates if already populated from a group
            if (!field.options.find(o => o.value === input.value)) {
              field.options.push({ text: text, value: input.value });
            }
          });
        }


        this.appendStatusMessage(
          `Processing field: ${field.label || field.type} (${field.type})`
        );

        // Get value for the field - PRIORITIZE USING getAnswer
        let value = null;

        // For critical profile fields, use direct mapping
        const labelLower = field.label.toLowerCase();
        if (basicProfileFields[labelLower]) {
          value = basicProfileFields[labelLower];
          debugLog(
            `Using direct profile field mapping for ${field.label}: ${value}`
          );
        }
        // For contact info patterns, match without using getAnswer
        else if (
          this.matchesAny(labelLower, [
            "first name",
            "given name",
            "firstname",
          ]) ||
          (labelLower.includes("first") && labelLower.includes("name"))
        ) {
          value = profile.firstName;
        } else if (
          this.matchesAny(labelLower, ["last name", "surname", "lastname"]) ||
          (labelLower.includes("last") && labelLower.includes("name"))
        ) {
          value = profile.lastName;
        } else if (
          this.matchesAny(labelLower, ["email", "e-mail", "electronic mail"]) ||
          labelLower.includes("email")
        ) {
          value = profile.email;
        } else if (
          this.matchesAny(labelLower, [
            "phone",
            "telephone",
            "mobile",
            "cell",
          ]) ||
          labelLower.includes("phone") ||
          labelLower.includes("tel")
        ) {
          value = profile.phone || profile.phoneNumber;
        }
        // Skip resume upload fields
        else if (labelLower.includes("resume") || labelLower.includes("cv")) {
          debugLog("Skipping resume field - handled separately");
          continue;
        }
        // For all other fields (especially text inputs and textareas), use getAnswer
        else {
          try {
            // Use getAnswer for most fields, passing the field label, options array, and profile
            debugLog(`Getting AI answer for: "${field.label}"`);
            value = await this.getAnswer(field.label, field.options, profile);
            debugLog(
              `Received answer: ${
                value
                  ? value.length > 50
                    ? value.substring(0, 50) + "..."
                    : value
                  : "null"
              }`
            );
          } catch (error) {
            debugLog(`Error getting AI answer: ${error.message}`);
            // If getAnswer fails, fall back to generateGenericAnswer
            if (
              el.nodeName === "TEXTAREA" ||
              (el.nodeName === "INPUT" && el.type === "text")
            ) {
              value = this.generateGenericAnswer(field.label);
            }
          }
        }

        // Skip if no value to fill
        debugLog("fillApplicationFields: For field label '"+ field.label +"', AI value received:", value, "Field Type:", field.type);
        if (value === null || value === undefined || value === "") {
          debugLog("fillApplicationFields: No valid AI value for '"+ field.label +"'. Field will be skipped.");
          debugLog(`No value (null, undefined, or empty) found for field: "${field.label}", skipping`);
          continue;
        }

        this.appendStatusMessage(`Filling field: ${field.label} with value`);
        debugLog("fillApplicationFields: Attempting to fill '"+ field.label +"' of type '"+field.type+"' with value:", value);

        // Fill the field based on its type
        await this.wait(100);

        try {
          if (field.type === "radio" && Array.isArray(field.element)) {
            debugLog("fillApplicationFields: Attempting to fill '"+ field.label +"' of type '"+field.type+"' with value:", value);
            await this.handleRadioButtonSelection(field.element, value);
          } else if (
            field.type === "checkbox" &&
            Array.isArray(field.element)
          ) {
            debugLog("fillApplicationFields: Attempting to fill '"+ field.label +"' of type '"+field.type+"' with value:", value);
            for (const el of field.element) {
              this.scrollToTargetAdjusted(el, 100);
              const labelText =
                el.closest("label")?.textContent.trim() ||
                document
                  .querySelector(`label[for="${el.id}"]`)
                  ?.textContent.trim() ||
                el.parentNode?.parentNode?.textContent.trim() ||
                "";

              if (
                labelText === value ||
                labelText.toLowerCase() === value.toLowerCase() ||
                (Array.isArray(value) && value.includes(labelText))
              ) {
                // Check the box
                el.click();
                await this.wait(300);

                if (!el.checked) {
                  const labelEl =
                    el.closest("label") ||
                    document.querySelector(`label[for="${el.id}"]`);
                  if (labelEl) {
                    labelEl.click();
                    await this.wait(300);
                  }
                }

                if (!el.checked) {
                  el.checked = true;
                  el.dispatchEvent(new Event("change", { bubbles: true }));
                }
              }
            }
          } else if (field.type === "select") {
            await this.handleSelectFieldSelection(field.element, value);
          } else {
            debugLog("fillApplicationFields: Attempting to fill '"+ field.label +"' of type '"+field.type+"' with value:", value);
            await this.setAdvancedInputValue(field.element, value);
          }
        } catch (inputError) {
          debugLog(`Error filling field ${field.label}:`, inputError);
        }
      }

      // Special handling for phone fields with country code
      if (profile.phone && profile.phoneCountryCode) {
        const phoneInput = form.querySelector(
          'input[type="tel"], input[name="phone"], input[placeholder*="phone"]'
        );
        if (phoneInput) {
          const countryCodeElement =
            phoneInput.parentElement.querySelector('[role="combobox"]');
          if (countryCodeElement) {
            countryCodeElement.click();
            await this.wait(500);

            const countryItems = document.querySelectorAll(
              ".iti__dropdown-content li.iti__country, .country-code-dropdown li"
            );
            for (const item of countryItems) {
              const dialCode = item.querySelector(
                ".iti__dial-code, .dial-code"
              )?.textContent;
              if (dialCode === profile.phoneCountryCode) {
                item.click();
                break;
              }
            }

            const phoneValueWithoutCountry = profile.phone.replace(
              profile.phoneCountryCode,
              ""
            );
            await this.setAdvancedInputValue(
              phoneInput,
              phoneValueWithoutCountry
            );
          }
        }
      }

      // Handle GDPR/consent checkboxes
      await this.handleRequiredCheckboxes(form);
    } catch (error) {
      debugLog("Error filling application fields:", error);
      this.appendStatusMessage(
        `Warning: Some fields may not have been filled correctly - ${error.message}`
      );
    }
  }

  /**
   * Matches a specific question exactly
   */
  matchesSpecificQuestion(labelText, questionFragment) {
    if (!labelText || !questionFragment) return false;

    const normalizedLabel = labelText.toLowerCase().trim();
    const normalizedQuestion = questionFragment.toLowerCase().trim();

    return normalizedLabel.includes(normalizedQuestion);
  }

  /**
   * Enhanced debug function that shows the template extraction and question mapping
   */
  debugFormFieldsEnhanced(form, profile) {
    try {
      this.appendStatusMessage(
        "🔍 ENHANCED DEBUGGING: Analyzing Lever form with template extraction..."
      );

      // Create a debug panel in the UI
      this.createDebugPanel();
      const debugPanel = document.getElementById("lever-debug-panel-content");

      // Clear any existing content
      if (debugPanel) {
        debugPanel.innerHTML = "";

        // Add header
        const header = document.createElement("div");
        header.innerHTML = "<strong>Enhanced Lever Form Analysis</strong>";
        header.style.marginBottom = "10px";
        debugPanel.appendChild(header);
      }

      // Step 1: Extract the template questions
      const fieldQuestions = this.extractLeverFormQuestions(form);

      // Display the extracted questions
      if (debugPanel) {
        const templateSection = document.createElement("div");
        templateSection.style.marginBottom = "20px";
        templateSection.style.padding = "10px";
        templateSection.style.backgroundColor = "#f0f8ff";
        templateSection.style.borderRadius = "5px";

        const templateTitle = document.createElement("div");
        templateTitle.innerHTML =
          "<strong>Extracted Questions from Templates:</strong>";
        templateTitle.style.marginBottom = "8px";
        templateSection.appendChild(templateTitle);

        if (Object.keys(fieldQuestions).length > 0) {
          const questionsList = document.createElement("ul");
          questionsList.style.margin = "0";
          questionsList.style.paddingLeft = "20px";

          Object.entries(fieldQuestions).forEach(
            ([fieldName, questionText]) => {
              const item = document.createElement("li");
              item.innerHTML = `<code>${fieldName}</code>: "${questionText}"`;
              questionsList.appendChild(item);
            }
          );

          templateSection.appendChild(questionsList);
        } else {
          const noTemplates = document.createElement("div");
          noTemplates.textContent = "No template questions found";
          noTemplates.style.fontStyle = "italic";
          templateSection.appendChild(noTemplates);
        }

        debugPanel.appendChild(templateSection);
      }

      // Use the comprehensive field selector
      const FIELDS_SELECTOR =
        'fieldset[aria-labelledby], div[role="group"][aria-labelledby], ' +
        'input[aria-labelledby]:not([aria-hidden="true"],[type="file"]), ' +
        'textarea[aria-labelledby], input[texts]:not([aria-hidden="true"],[type="file"]), ' +
        'input[placeholder][inputmode="tel"]:not([aria-hidden="true"],[type="file"]), ' +
        'input[type="text"], input[type="email"], input[type="tel"], input[type="url"], ' +
        "textarea, select, div.select-container, " +
        'fieldset:has(input[type="radio"]), fieldset:has(input[type="checkbox"]), ' +
        'div:has(input[type="radio"]), div:has(input[type="checkbox"])';

      // Find all form elements
      const formElements = [...form.querySelectorAll(FIELDS_SELECTOR)];

      // Create field mapping from profile data
      const fieldsValue = this.mapProfileToFields(profile);

      // Log to console for reference
      console.log(`🔍 DEBUG: Found ${formElements.length} form elements`);
      console.log("Extracted field questions:", fieldQuestions);

      // Process each element
      const fieldDetails = [];

      if (debugPanel) {
        // Add fields section header
        const fieldsHeader = document.createElement("div");
        fieldsHeader.innerHTML = `<strong>Form Fields Analysis (${formElements.length} fields):</strong>`;
        fieldsHeader.style.marginBottom = "10px";
        fieldsHeader.style.marginTop = "10px";
        debugPanel.appendChild(fieldsHeader);
      }

      for (let i = 0; i < formElements.length; i++) {
        const el = formElements[i];

        // Skip hidden elements
        if (
          el.style.display === "none" ||
          el.offsetParent === null ||
          el.style.visibility === "hidden" ||
          el.getAttribute("aria-hidden") === "true"
        ) {
          continue;
        }

        // Get basic element info
        const elementType = el.nodeName.toLowerCase();
        const elementSubType = el.type || "unknown";

        // Find the question for this field using our new extraction method
        const extractedQuestion = this.getQuestionForField(el, fieldQuestions);
        let questionSource = extractedQuestion ? "template extraction" : "none";

        // Try original label finding methods if not found from template
        const ariaLabelledBy = el.getAttribute("aria-labelledby");
        const labelEl = ariaLabelledBy
          ? document.getElementById(ariaLabelledBy)
          : el.closest("label") ||
            document.querySelector(`label[for="${el.id}"]`) ||
            el.parentElement?.querySelector("label");

        let labelText = extractedQuestion || "";
        let labelSource = extractedQuestion ? "template extraction" : "";
        let isRequired = false;

        if (!labelText && labelEl) {
          labelText = labelEl.textContent.trim();
          labelSource = "explicit label";
          questionSource = "explicit label";
          isRequired = this.isRequired(labelEl);
        } else if (!labelText) {
          // Try to get label from container or nearby elements
          const container =
            el.closest(".application-field") || el.parentElement;
          if (container) {
            const containerLabelText = container
              .querySelector("label, .field-label, .label")
              ?.textContent.trim();
            if (containerLabelText) {
              labelText = containerLabelText;
              labelSource = "container label";
              questionSource = "container label";
            }
          }

          // If still no label, try placeholder, aria-label, or name
          if (!labelText) {
            if (el.getAttribute("placeholder")) {
              labelText = el.getAttribute("placeholder");
              labelSource = "placeholder";
              questionSource = "placeholder";
            } else if (el.getAttribute("aria-label")) {
              labelText = el.getAttribute("aria-label");
              labelSource = "aria-label";
              questionSource = "aria-label";
            } else if (el.getAttribute("name")) {
              labelText = el.getAttribute("name");
              labelSource = "name attribute";
              questionSource = "name attribute";
            } else if (el.id) {
              labelText = el.id;
              labelSource = "id";
              questionSource = "id";
            }
          }

          // Check if required from other indicators
          isRequired =
            el.hasAttribute("required") ||
            el.getAttribute("aria-required") === "true" ||
            labelText.includes("*") ||
            (container?.textContent || "").includes("*required") ||
            el.closest(".required-field") !== null;
        }

        // Clean up label by removing required asterisk if present
        labelText = labelText.replace(/✱$/, "").trim();

        // Determine field type and options
        let fieldType = elementSubType;
        let options = [];

        // Special handling for different field types
        if (
          elementType === "input" &&
          (el.getAttribute("role") === "combobox" ||
            el.parentElement?.querySelector(".dropdown-icon"))
        ) {
          fieldType = "select/dropdown";

          // Try to find and extract options
          const selectContainer =
            el.closest('div[data-input-type="select"]') ||
            el.closest(".select-container") ||
            el.parentElement;
          if (selectContainer) {
            const optionElements = selectContainer.querySelectorAll(
              "dialog ul li, .dropdown-options li, .options li"
            );
            if (optionElements.length) {
              options = [...optionElements].map((el) => el.textContent.trim());
            }
          }
        } else if (elementType === "select") {
          fieldType = "select/dropdown";
          options = [...el.querySelectorAll("option")].map((opt) =>
            opt.textContent.trim()
          );
        } else if (elementType === "div" || elementType === "fieldset") {
          // Check if contains radio or checkbox inputs
          const inputs = el.querySelectorAll("input");
          if (inputs.length > 0) {
            fieldType = inputs[0].type + " group";
            options = [...el.querySelectorAll("label")].map((l) =>
              l.textContent.trim()
            );
          }
        }

        // Find what value would be used for this field
        let value = fieldsValue[labelText.toLowerCase()];
        let valueSource = "direct mapping";

        // If no value found by direct mapping, try our matching methods
        if (!value) {
          const labelLower = labelText.toLowerCase();

          // Try standard profile fields
          if (
            this.matchesAny(labelLower, [
              "first name",
              "given name",
              "firstname",
            ])
          ) {
            value = profile.firstName;
            valueSource = "first name match";
          } else if (
            this.matchesAny(labelLower, ["last name", "surname", "lastname"])
          ) {
            value = profile.lastName;
            valueSource = "last name match";
          } else if (this.matchesAny(labelLower, ["full name", "name"])) {
            value = `${profile.firstName} ${profile.lastName}`;
            valueSource = "full name match";
          } else if (this.matchesAny(labelLower, ["email", "e-mail"])) {
            value = profile.email;
            valueSource = "email match";
          } else if (
            this.matchesAny(labelLower, ["phone", "telephone", "mobile"])
          ) {
            value = profile.phone || profile.phoneNumber;
            valueSource = "phone match";
          } else if (this.matchesAny(labelLower, ["linkedin", "linked in"])) {
            value = profile.linkedIn || profile.linkedinUrl;
            valueSource = "linkedin match";
          } else if (
            this.matchesAny(labelLower, [
              "location",
              "city",
              "address",
              "current location",
            ])
          ) {
            value = profile.currentCity || profile.city || "";
            valueSource = "location match";
          } else if (
            this.matchesSpecificQuestion(
              labelLower,
              "how did you hear about this role"
            )
          ) {
            value = profile.referral || "LinkedIn";
            valueSource = "specific question match: referral";
          } else if (
            this.matchesSpecificQuestion(
              labelLower,
              "why do you want to work at"
            )
          ) {
            value =
              this.generateWhyCompanyAnswer(labelLower) ||
              profile.whyJoin ||
              profile.coverLetter;
            valueSource = "generated why company answer";
          } else if (
            this.matchesSpecificQuestion(
              labelLower,
              "something impressive you've built or done"
            )
          ) {
            value =
              this.generateImpressionAnswer() ||
              profile.achievements ||
              profile.coverLetter;
            valueSource = "generated achievement answer";
          } else if (
            el.nodeName === "TEXTAREA" ||
            (el.nodeName === "INPUT" && el.type === "text")
          ) {
            value = this.generateGenericAnswer(labelText);
            valueSource = "generated generic answer";
          }
        }

        // Add details to array for console logging
        fieldDetails.push({
          index: i + 1,
          elementType,
          fieldType,
          label: labelText,
          labelSource,
          questionSource,
          isRequired,
          options: options.length > 0 ? options : undefined,
          value: value
            ? typeof value === "string" && value.length > 50
              ? value.substring(0, 50) + "..."
              : value
            : "N/A",
          valueSource: value ? valueSource : "N/A",
          id: el.id || "none",
          name: el.name || "none",
          placeholder: el.placeholder || "none",
        });

        // Add to debug panel if available
        if (debugPanel) {
          const fieldInfo = document.createElement("div");
          fieldInfo.style.border = "1px solid #ccc";
          fieldInfo.style.padding = "10px";
          fieldInfo.style.marginBottom = "12px";
          fieldInfo.style.borderRadius = "4px";
          fieldInfo.style.position = "relative";

          // Color coding based on source and value
          if (questionSource === "template extraction") {
            fieldInfo.style.borderLeft = "4px solid #4CAF50"; // Green for template extraction
          } else if (isRequired) {
            fieldInfo.style.borderLeft = "4px solid #f44336"; // Red for required
          }

          if (value) {
            fieldInfo.style.backgroundColor = "#f9f9f9"; // Light gray for fields with values
          }

          // Create field label
          const fieldLabel = document.createElement("div");
          fieldLabel.style.fontWeight = "bold";
          fieldLabel.style.marginBottom = "5px";
          fieldLabel.style.fontSize = "14px";
          fieldLabel.textContent = `${i + 1}. ${labelText || "[NO LABEL]"}`;

          if (isRequired) {
            const requiredBadge = document.createElement("span");
            requiredBadge.textContent = "Required";
            requiredBadge.style.backgroundColor = "#f44336";
            requiredBadge.style.color = "white";
            requiredBadge.style.padding = "2px 6px";
            requiredBadge.style.borderRadius = "3px";
            requiredBadge.style.fontSize = "10px";
            requiredBadge.style.marginLeft = "8px";
            fieldLabel.appendChild(requiredBadge);
          }

          // Create field metadata
          const fieldMeta = document.createElement("div");
          fieldMeta.style.fontSize = "12px";
          fieldMeta.style.color = "#666";
          fieldMeta.innerHTML =
            `Type: <code>${elementType} (${fieldType})</code><br>` +
            `Label Source: <code>${labelSource}</code><br>` +
            `Question Source: <code>${questionSource}</code><br>` +
            `Element: <code>${el.name || el.id || elementType}</code>`;

          // Add value information if available
          if (value) {
            const valueInfo = document.createElement("div");
            valueInfo.style.marginTop = "8px";
            valueInfo.style.padding = "8px";
            valueInfo.style.backgroundColor = "#e8f5e9";
            valueInfo.style.borderRadius = "4px";

            const valueTitle = document.createElement("div");
            valueTitle.innerHTML = `<strong>Will fill with:</strong> <span style="color:#2e7d32">(${valueSource})</span>`;
            valueTitle.style.marginBottom = "4px";
            valueInfo.appendChild(valueTitle);

            const valueContent = document.createElement("div");
            valueContent.style.fontSize = "12px";
            valueContent.style.maxHeight = "60px";
            valueContent.style.overflow = "auto";

            if (typeof value === "string" && value.length > 100) {
              valueContent.textContent = value.substring(0, 100) + "...";
              valueContent.title = value; // Full text on hover
            } else {
              valueContent.textContent = value;
            }

            valueInfo.appendChild(valueContent);
            fieldMeta.appendChild(valueInfo);
          } else {
            const noValueInfo = document.createElement("div");
            noValueInfo.style.marginTop = "8px";
            noValueInfo.style.fontStyle = "italic";
            noValueInfo.style.color = "#999";
            noValueInfo.textContent = "No value will be filled for this field";
            fieldMeta.appendChild(noValueInfo);
          }

          // Add options if available
          if (options.length > 0) {
            const optionsEl = document.createElement("div");
            optionsEl.style.fontSize = "12px";
            optionsEl.style.marginTop = "8px";
            optionsEl.innerHTML = `<strong>Options:</strong> ${options
              .slice(0, 5)
              .join(", ")}${options.length > 5 ? "..." : ""}`;
            fieldMeta.appendChild(optionsEl);
          }

          // Append elements
          fieldInfo.appendChild(fieldLabel);
          fieldInfo.appendChild(fieldMeta);
          debugPanel.appendChild(fieldInfo);
        }
      }

      // Log detailed information to console for analysis
      console.table(fieldDetails);

      this.appendStatusMessage(
        `🔍 ENHANCED DEBUG: Found ${fieldDetails.length} form fields with ${
          Object.keys(fieldQuestions).length
        } extracted questions`
      );

      return fieldDetails;
    } catch (error) {
      console.error("Error in debugFormFieldsEnhanced:", error);
      this.appendStatusMessage(`Error analyzing form fields: ${error.message}`);
      return [];
    }
  }

  /**
   * Creates a debug panel on the page
   */
  createDebugPanel() {
    try {
      // Check if panel already exists
      if (document.getElementById("lever-debug-panel")) {
        return;
      }

      // Create debug panel
      const debugPanel = document.createElement("div");
      debugPanel.id = "lever-debug-panel";
      debugPanel.style.cssText = `
        position: fixed;
        top: 10px;
        left: 10px;
        background-color: rgba(255, 255, 255, 0.95);
        border: 2px solid #007bff;
        color: #333;
        padding: 10px;
        border-radius: 5px;
        z-index: 10000;
        width: 350px;
        max-height: 80vh;
        overflow-y: auto;
        font-family: Arial, sans-serif;
        font-size: 12px;
        box-shadow: 0 0 10px rgba(0,0,0,0.2);
      `;

      // Add header with controls
      const header = document.createElement("div");
      header.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid #ccc;
        padding-bottom: 8px;
        margin-bottom: 10px;
      `;

      // Add title
      const title = document.createElement("div");
      title.textContent = "🔍 Form Field Analyzer";
      title.style.fontWeight = "bold";

      // Add control buttons
      const controls = document.createElement("div");

      // Minimize button
      const minimizeBtn = document.createElement("button");
      minimizeBtn.textContent = "_";
      minimizeBtn.style.cssText = `
        background: none;
        border: 1px solid #ccc;
        border-radius: 3px;
        margin-left: 5px;
        cursor: pointer;
        padding: 0 5px;
      `;
      minimizeBtn.onclick = () => {
        const content = document.getElementById("lever-debug-panel-content");
        if (content.style.display === "none") {
          content.style.display = "block";
          minimizeBtn.textContent = "_";
        } else {
          content.style.display = "none";
          minimizeBtn.textContent = "□";
        }
      };

      // Close button
      const closeBtn = document.createElement("button");
      closeBtn.textContent = "X";
      closeBtn.style.cssText = `
        background: none;
        border: 1px solid #ccc;
        border-radius: 3px;
        margin-left: 5px;
        cursor: pointer;
        padding: 0 5px;
      `;
      closeBtn.onclick = () => {
        document.body.removeChild(debugPanel);
      };

      controls.appendChild(minimizeBtn);
      controls.appendChild(closeBtn);

      header.appendChild(title);
      header.appendChild(controls);
      debugPanel.appendChild(header);

      // Add content container
      const content = document.createElement("div");
      content.id = "lever-debug-panel-content";
      debugPanel.appendChild(content);

      // Add to page
      document.body.appendChild(debugPanel);
    } catch (error) {
      console.error("Error creating debug panel:", error);
    }
  }

  /**
   * Enhanced radio button handling specifically for Lever's format
   */

  /**
   * Process the hidden template data to extract question information
   * This helps us understand the structure of radio buttons and multi-choice options
   * @param {HTMLElement} form - The form element
   * @returns {Object} - Mapping of field names to their questions and options
   */
  extractLeverTemplateData(form) {
    const templateData = {};

    try {
      // Find all hidden template fields
      const templateInputs = form.querySelectorAll(
        'input[name*="baseTemplate"]'
      );

      templateInputs.forEach((input) => {
        try {
          // Extract card ID from input name
          const cardIdMatch = input.name.match(/cards\[(.*?)\]/);
          if (!cardIdMatch) return;

          const cardId = cardIdMatch[1];
          const templateValue = input.value;

          // Parse the JSON template data
          if (templateValue) {
            // Fix escaped quotes
            const cleanedValue = templateValue.replace(/&quot;/g, '"');
            const template = JSON.parse(cleanedValue);

            // Process fields from the template
            if (template.fields && Array.isArray(template.fields)) {
              template.fields.forEach((field, index) => {
                const fieldName = `cards[${cardId}][field${index}]`;

                templateData[fieldName] = {
                  question: field.text,
                  type: field.type,
                  required: field.required,
                  options: field.options || [],
                };

                this.appendStatusMessage(
                  `Found template field: "${field.text}" (${field.type})`
                );
              });
            }
          }
        } catch (error) {
          debugLog("Error parsing template data:", error);
        }
      });

      debugLog("Extracted template data:", templateData);
      return templateData;
    } catch (error) {
      debugLog("Error extracting template data:", error);
      return {};
    }
  }

  async handleLeverRadioButtons(form, profile) {
    try {
      this.appendStatusMessage("Processing radio button fields");

      // Extract template data for better understanding of radio fields
      // const templateData = this.extractLeverTemplateData(form); // Keep if needed for other logic, but not for fallback

      // Find all multiple-choice question containers
      const radioGroups = form.querySelectorAll(
        '.application-question ul[data-qa="multiple-choice"]'
      );

      for (const radioGroup of radioGroups) {
        // Find the parent question container
        const questionContainer = radioGroup.closest(".application-question");
        if (!questionContainer) continue;

        // Get the question text
        const questionEl = questionContainer.querySelector(
          ".application-label .text"
        );
        if (!questionEl) continue;

        // Clean up the question text (remove the required asterisk)
        const questionText = questionEl.textContent.replace(/✱$/, "").trim();

        // Find the radio inputs in this group
        const radioInputs = radioGroup.querySelectorAll('input[type="radio"]');
        if (!radioInputs.length) continue;

        // Get the name of the first radio which identifies the group
        // const radioName = radioInputs[0].name; // Keep if needed for other logic

        // Get radio options for passing to getAnswer
        const radioOptions = Array.from(radioInputs).map((input) => {
          const label = input.closest("label");
          return label ? label.textContent.trim() : input.value;
        });

        this.appendStatusMessage(
          `Radio question: "${questionText}" with options: ${radioOptions.join(
            ", "
          )}`
        );

        // Decide what value to use for this radio group
        let selectedValue = null;
        let answer = null; // Store AI answer

        // First try to get answer from AI
        try {
          // Use getAnswer to get the appropriate value
          answer = await this.getAnswer(
            questionText,
            radioOptions,
            profile
          );
          debugLog("handleLeverRadioButtons: Question:", questionText, "AI Answer:", answer);

          if (answer) { // Only proceed if AI provided an answer
            // Try to match the answer to one of the radio values or labels
            for (const radio of radioInputs) {
              const label = radio.closest("label");
              const labelText = label ? label.textContent.trim() : "";

              if (
                (radio.value && radio.value.toLowerCase() === answer.toLowerCase()) ||
                (labelText && labelText.toLowerCase() === answer.toLowerCase()) ||
                (labelText && labelText.toLowerCase().includes(answer.toLowerCase())) ||
                (answer.toLowerCase().includes(labelText.toLowerCase()) && labelText) // Ensure labelText is not empty
              ) {
                selectedValue = radio.value;
                debugLog("handleLeverRadioButtons: Selecting radio for '"+ questionText +"':", selectedValue, "Matched option label/value:", radio.value);
                this.appendStatusMessage(
                  `AI selected value: ${selectedValue} for question "${questionText}" based on answer: "${answer}"`
                );
                break;
              }
            }
          } else {
            debugLog("handleLeverRadioButtons: No matching radio option or no AI answer for '"+ questionText +"'. Group left untouched.");
            this.appendStatusMessage(`AI did not provide an answer for "${questionText}", leaving untouched.`);
          }
        } catch (error) {
          debugLog(`Error getting AI answer for radio group "${questionText}": ${error.message}`);
          // Do not apply any fallback, leave untouched
          this.appendStatusMessage(`Error getting AI answer for "${questionText}", leaving untouched.`);
        }

        // Only click if a selectedValue was determined from a clear AI answer
        if (selectedValue) {
          let radioClicked = false;

          for (const radio of radioInputs) {
            if (radio.value === selectedValue) {
              // Scroll to the radio
              this.scrollToTargetAdjusted(radio, 100);
              await this.wait(300);

              // Try clicking the label (more reliable in Lever forms)
              const label = radio.closest("label");
              if (label) {
                label.click();
                this.appendStatusMessage(
                  `Clicked label for option: ${selectedValue}`
                );
              } else {
                radio.click();
                this.appendStatusMessage(
                  `Clicked radio button: ${selectedValue}`
                );
              }

              // Wait for potential UI updates
              await this.wait(500);

              // Verify the radio was actually selected
              if (!radio.checked) {
                radio.checked = true;
                radio.dispatchEvent(new Event("change", { bubbles: true }));
                this.appendStatusMessage(`Set radio checked property directly`);
              }

              radioClicked = true;
              break;
            }
          }

          if (!radioClicked) {
            this.appendStatusMessage(
              `Warning: Could not find radio option "${selectedValue}" for question "${questionText}"`
            );
          }
        } else {
          // This log is slightly redundant if AI answer was null, but good for clarity if selectedValue is null for other reasons.
          debugLog("handleLeverRadioButtons: No matching radio option or no AI answer for '"+ questionText +"'. Group left untouched.");
        }
      }
    } catch (error) {
      debugLog("Error handling Lever radio buttons:", error);
      this.appendStatusMessage(
        `Warning: Error processing radio buttons - ${error.message}`
      );
    }
  }

  // Helper method to get radio value by label
  getRadioValueByLabel(radioInputs, targetLabel) {
    for (const radio of radioInputs) {
      const label = radio.closest("label");
      const labelText = label ? label.textContent.trim() : "";

      if (
        labelText.toLowerCase() === targetLabel.toLowerCase() ||
        labelText.includes(targetLabel) ||
        radio.value.toLowerCase() === targetLabel.toLowerCase() ||
        radio.value.includes(targetLabel)
      ) {
        return radio.value;
      }
    }

    // If no match, return the first radio's value if available
    return radioInputs.length > 0 ? radioInputs[0].value : null;
  }

  async handleLeverSelectFields(form, profile) {
    try {
      this.appendStatusMessage("Processing select fields");

      // Find all select elements
      const selectElements = form.querySelectorAll("select");
      this.appendStatusMessage(
        `Found ${selectElements.length} select elements`
      );

      for (const select of selectElements) {
        // Skip hidden selects
        if (select.offsetParent === null || select.style.display === "none")
          continue;

        // Get the question text using multiple approaches
        let questionText = "";
        let questionContainer = null;

        // Approach 1: Standard Lever structure
        questionContainer = select.closest(".application-question, label");
        if (questionContainer) {
          const labelEl = questionContainer.querySelector(".application-label");
          if (labelEl) {
            const textEl = labelEl.querySelector(".text");
            if (textEl) {
              questionText = textEl.textContent.replace(/✱$/, "").trim();
            } else {
              // If no .text element, use the label element text directly
              questionText = labelEl.textContent.replace(/✱$/, "").trim();
            }
          }
        }

        // If we still don't have question text, try going up to parent elements
        if (!questionText) {
          // Go up to parent divs until we find one with text content
          let parent = select.parentElement;
          let depth = 0;
          while (parent && depth < 3) {
            // Limit search depth
            const labelEl = parent.querySelector(".application-label, label");
            if (labelEl) {
              questionText = labelEl.textContent.replace(/✱$/, "").trim();
              break;
            }
            parent = parent.parentElement;
            depth++;
          }
        }

        // If still no question text, try using the name attribute
        if (!questionText && select.name) {
          questionText = select.name.replace(/.*\[([^\]]+)\]$/, "$1");
        }

        this.appendStatusMessage(
          `Processing select field: "${
            questionText || select.name || "Unnamed field"
          }"`
        );

        // Extract options for the select
        const selectOptions = Array.from(select.options)
          .filter((opt) => opt.value && opt.value !== "") // Filter out empty options
          .map((opt) => opt.text.trim());

        // Log available options
        const optionsText = selectOptions.join(", ");
        this.appendStatusMessage(
          `Options: ${optionsText.substring(0, 100)}${
            optionsText.length > 100 ? "..." : ""
          }`
        );

        // Determine a value to select based on the question
        let selectedValue = null;
        let selectedOption = null;
        let answer = null; // For logging

        // First try getting answer from AI
        try {
          // Use getAnswer to determine the best option
          answer = await this.getAnswer( // Assign to 'answer'
            questionText,
            selectOptions,
            profile
          );
          debugLog("handleLeverSelectFields: Question:", questionText, "AI Answer:", answer);
          this.appendStatusMessage(`AI suggested answer for "${questionText}": ${answer}`);

          // Try to match the answer to an option
          if (answer) { // Only proceed if AI provided an answer
            for (const option of select.options) {
              if (option.value === "" || option.disabled) continue;

              const optionText = option.text.trim();
              if (
                optionText.toLowerCase() === answer.toLowerCase() ||
                (optionText.includes(answer) && answer.length > 2) || // Be a bit stricter for includes
                (answer.includes(optionText) && optionText.length > 2)
              ) {
                selectedValue = option.value;
                selectedOption = option;
                debugLog("handleLeverSelectFields: Selecting option '"+ selectedOption.text +"' for '"+questionText+"'");
                this.appendStatusMessage(`AI matched option for "${questionText}": ${optionText}`);
                break;
              }
            }

            // If no direct match but answer is a value, try that
            if (!selectedValue) {
              const valueOption = Array.from(select.options).find(
                (opt) =>
                  opt.value && opt.value.toLowerCase() === answer.toLowerCase()
              );

              if (valueOption) {
                selectedValue = valueOption.value;
                selectedOption = valueOption;
                debugLog("handleLeverSelectFields: Selecting option '"+ selectedOption.text +"' for '"+questionText+"'");
                this.appendStatusMessage(
                  `AI matched by value for "${questionText}": ${valueOption.text}`
                );
              }
            }
          } else {
            // AI provided no answer
            debugLog("handleLeverSelectFields: No matching select option or no AI answer for '"+questionText+"'. Field left untouched.");
          }
        } catch (error) {
          debugLog(
            `Error getting AI answer for select field: ${error.message}`
          );
          // Continue to fallback logic
        }

        // If AI didn't provide a suitable answer, or no clear match was found from the AI's answer
        if (!selectedValue) {
          debugLog("handleLeverSelectFields: No matching select option or no AI answer for '"+questionText+"'. Field left untouched.");
          this.appendStatusMessage(
            `No clear AI match or answer for select field "${questionText}", leaving untouched.`
          );
        }

        this.appendStatusMessage(
          `Final selected option for "${questionText}": ${
            selectedOption
              ? selectedOption.text
              : selectedValue || "none (left untouched)"
          }`
        );

        // If we've determined a value to use from AI, select it
        if (selectedValue && selectedOption) { // Ensure both selectedValue and selectedOption are truthy
          await this.selectOptionByValueEnhanced(select, selectedValue);
        }
        // No default selection if AI doesn't provide a clear answer or match.
      }
    } catch (error) {
      // Ensure questionText is defined for the error log, or use a generic placeholder
      const qTextForError = typeof questionText !== 'undefined' ? questionText : "unknown select field";
      debugLog(`Error handling Lever select fields for question "${qTextForError}":`, error);
      this.appendStatusMessage(
        `Warning: Error processing select fields - ${error.message}`
      );
    }
  }

  /**
   * Improved scrollToTargetAdjusted method that checks if element is valid before scrolling
   */
  scrollToTargetAdjusted(element, offset) {
    if (!element) {
      debugLog("Warning: Attempted to scroll to null element");
      return;
    }

    try {
      // Handle case where element might be an array
      if (Array.isArray(element)) {
        debugLog("Element is an array, using first element");
        if (element.length > 0) {
          element = element[0];
        } else {
          debugLog("Empty array provided to scrollToTargetAdjusted");
          return;
        }
      }

      // Check if element has the necessary methods and properties
      if (
        !element.getBoundingClientRect ||
        typeof element.getBoundingClientRect !== "function"
      ) {
        debugLog(`Cannot scroll to element: ${typeof element}, ${element}`);
        return;
      }

      const rect = element.getBoundingClientRect();
      const scrollTop =
        window.pageYOffset || document.documentElement.scrollTop;

      window.scrollTo({
        top: rect.top + scrollTop - offset,
        behavior: "smooth",
      });
    } catch (err) {
      debugLog("Error scrolling to element:", err);
      // Continue execution even if scrolling fails
    }
  }

  /**
   * Improved setAdvancedInputValue with better error handling
   */
  async setAdvancedInputValue(input, value) {
    if (!input || value === undefined || value === null) return;

    try {
      // Handle case where input might be an array
      if (Array.isArray(input)) {
        debugLog("Input is an array, using first element");
        if (input.length > 0) {
          input = input[0];
        } else {
          debugLog("Empty array provided to setAdvancedInputValue");
          return;
        }
      }

      // Verify input is a proper element with value property
      if (!input.value && typeof input.value !== "string") {
        debugLog(`Cannot set value for element: ${typeof input}, ${input}`);
        return;
      }

      // Scroll to the element first (with error handling)
      try {
        this.scrollToTargetAdjusted(input, 100);
      } catch (scrollError) {
        debugLog(
          "Error scrolling, but continuing with value setting:",
          scrollError
        );
      }

      await this.wait(100);

      // Safely attempt to click and focus
      try {
        // Only call methods if they exist
        if (typeof input.click === "function") {
          input.click();
        }

        if (typeof input.focus === "function") {
          input.focus();
        }

        await this.wait(50);
      } catch (focusError) {
        debugLog(
          "Error clicking/focusing input, continuing anyway:",
          focusError
        );
      }

      // Clear any existing value first
      input.value = "";

      try {
        input.dispatchEvent(new Event("input", { bubbles: true }));
      } catch (eventError) {
        debugLog("Error dispatching input event:", eventError);
      }

      // Handle special date inputs
      if (
        input.parentElement?.querySelector('[data-ui="calendar-icon"]') ||
        input.parentElement?.querySelector(".calendar-icon")
      ) {
        try {
          input.click();
          input.dispatchEvent(new Event("keydown", { bubbles: true }));
        } catch (calendarError) {
          debugLog("Error handling date input:", calendarError);
        }
      }

      // Set the value using both direct and native approaches
      input.value = value;

      try {
        this.setNativeValue(input, value);
      } catch (nativeError) {
        debugLog("Error setting native value:", nativeError);
        // Continue anyway since we've already set the value directly
      }

      // Dispatch events
      const events = ["input", "change", "blur"];
      for (const eventName of events) {
        try {
          input.dispatchEvent(new Event(eventName, { bubbles: true }));
          await this.wait(50);
        } catch (eventError) {
          debugLog(`Error dispatching ${eventName} event:`, eventError);
        }
      }

      // Extra check - if value didn't stick
      if (input.value !== value) {
        try {
          if (typeof input.click === "function") {
            input.click();
          }
          await this.wait(50);
          input.value = value;

          // Try again with the native approach
          try {
            this.setNativeValue(input, value);
          } catch (retryError) {
            debugLog("Error in retry of native value setting:", retryError);
          }

          // Dispatch events again
          for (const eventName of events) {
            try {
              input.dispatchEvent(new Event(eventName, { bubbles: true }));
              await this.wait(50);
            } catch (eventError) {
              debugLog(
                `Error dispatching ${eventName} event on retry:`,
                eventError
              );
            }
          }
        } catch (retryError) {
          debugLog("Error in value setting retry:", retryError);
        }
      }
    } catch (error) {
      debugLog(`Error setting value for input:`, error);
      // We don't throw here to allow the form filling to continue with other fields
    }
  }

  /**
   * Improved setNativeValue with better error handling
   */
  setNativeValue(element, value) {
    try {
      // Handle case where element might be an array
      if (Array.isArray(element)) {
        if (element.length > 0) {
          element = element[0];
        } else {
          return;
        }
      }

      // Check if element has value property
      if (typeof element.value === "undefined") {
        return;
      }

      const ownPropertyDescriptor = Object.getOwnPropertyDescriptor(
        element,
        "value"
      );

      if (!ownPropertyDescriptor) {
        element.value = value;
        this.dispatchInputEvent(element);
        return;
      }

      const valueSetter = ownPropertyDescriptor.set;
      const prototype = Object.getPrototypeOf(element);

      // Protection against properties not existing
      if (!prototype) {
        element.value = value;
        this.dispatchInputEvent(element);
        return;
      }

      const prototypePropertyDescriptor = Object.getOwnPropertyDescriptor(
        prototype,
        "value"
      );

      if (!prototypePropertyDescriptor || !prototypePropertyDescriptor.set) {
        element.value = value;
        this.dispatchInputEvent(element);
        return;
      }

      const prototypeValueSetter = prototypePropertyDescriptor.set;

      if (valueSetter && valueSetter !== prototypeValueSetter) {
        prototypeValueSetter.call(element, value);
      } else {
        valueSetter.call(element, value);
      }

      this.dispatchInputEvent(element);
    } catch (error) {
      debugLog("Error in setNativeValue:", error);
      // Fallback to direct setting
      try {
        element.value = value;
      } catch (fallbackError) {
        debugLog("Error in fallback value setting:", fallbackError);
      }
    }
  }

  /**
   * Safe dispatch input event
   */
  dispatchInputEvent(element) {
    try {
      if (element && typeof element.dispatchEvent === "function") {
        element.dispatchEvent(new Event("input", { bubbles: true }));
      }
    } catch (error) {
      debugLog("Error dispatching input event:", error);
    }
  }

  extractJobIdFromUrl(url) {
    try {
      // Extract job ID from Lever URL format (e.g., jobs.lever.co/company/[JOB_ID])
      const matches = url.match(/\/([a-f0-9-]{36})\/?$/);
      if (matches && matches[1]) {
        return matches[1];
      }

      // Fallback to a timestamp-based ID if we can't find a UUID
      return "job-" + Date.now();
    } catch (error) {
      debugLog("Error extracting job ID:", error);
      return "job-" + Date.now();
    }
  }

  /**
   * Find the application form on the page
   */
  findApplicationForm() {
    try {
      // Lever forms usually have specific patterns
      const formSelectors = [
        'form[action*="lever"]',
        "form.application-form",
        "form#application-form",
        "form.lever-apply-form",
        'form[data-qa="application-form"]',
        "form",
      ];

      for (const selector of formSelectors) {
        const forms = document.querySelectorAll(selector);
        if (forms.length > 0) {
          // Return the first visible form
          for (const form of forms) {
            if (form.offsetParent !== null) {
              return form;
            }
          }
        }
      }

      // No form found with selectors, look for form elements more deeply
      const allForms = document.querySelectorAll("form");
      if (allForms.length > 0) {
        // Return the first visible form
        for (const form of allForms) {
          if (form.offsetParent !== null) {
            return form;
          }
        }
      }

      return null;
    } catch (e) {
      debugLog("Error finding application form:", e);
      return null;
    }
  }

  /**
   * Extract and format a simplified job description from the page
   * Only extracts basic job metadata: title, location, commitment, department
   */
  async extractJobDescription() {
    try {
      this.appendStatusMessage("Extracting job details...");

      let jobDescription = {
        title: "",
        location: "",
        department: "",
        commitment: "",
        workplaceType: "",
      };

      // Extract job title from heading
      const titleElement = document.querySelector(
        ".posting-header h2, .section h2, h2"
      );
      if (titleElement) {
        jobDescription.title = titleElement.textContent.trim();
        this.appendStatusMessage(`Job title: ${jobDescription.title}`);
      }

      // Extract categories (location, department, etc.) from the posting categories
      const locationElement = document.querySelector(
        ".posting-category.location, .location"
      );
      if (locationElement) {
        jobDescription.location = locationElement.textContent.trim();
      }

      const departmentElement = document.querySelector(
        ".posting-category.department, .department"
      );
      if (departmentElement) {
        jobDescription.department = departmentElement.textContent.trim();
      }

      const commitmentElement = document.querySelector(
        ".posting-category.commitment, .commitment"
      );
      if (commitmentElement) {
        jobDescription.commitment = commitmentElement.textContent.trim();
      }

      const workplaceElement = document.querySelector(
        ".posting-category.workplaceTypes, .workplaceTypes"
      );
      if (workplaceElement) {
        jobDescription.workplaceType = workplaceElement.textContent.trim();
      }

      // If we couldn't find structured elements, try text-based extraction as fallback
      if (!jobDescription.title) {
        const possibleTitleElements = document.querySelectorAll("h1, h2, h3");
        for (const element of possibleTitleElements) {
          if (
            element.textContent.length > 5 &&
            element.textContent.length < 100
          ) {
            jobDescription.title = element.textContent.trim();
            break;
          }
        }
      }

      // Extract company name from URL or page content if possible
      const companyMatch = window.location.hostname.match(
        /jobs\.lever\.co\/([^\/]+)/i
      );
      if (companyMatch && companyMatch[1]) {
        jobDescription.company = companyMatch[1].replace(/-/g, " ");
        // Capitalize the company name
        jobDescription.company = jobDescription.company
          .split(" ")
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(" ");
      }

      this.appendStatusMessage(`Job details extracted successfully`);
      return jobDescription;
    } catch (error) {
      errorLog("Error extracting job details:", error);
      this.appendStatusMessage(
        `Error extracting job details: ${error.message}`
      );

      // Return minimal info even if extraction fails
      return {
        title: document.title || "Job Position",
      };
    }
  }

  /**
   * Gets an AI-generated answer for a form question
   * This implementation is similar to the LinkedIn platform's getAnswer method
   */
  async getAnswer(label, options = [], profile) {
    debugLog("getAnswer: Called for label:", label, "Options:", options, "Profile data:", profile);
    try {
      // Normalize the label for better matching
      const normalizedLabel = label.toLowerCase().trim();

      debugLog(`Requesting AI answer for "${label}"`);

      // Build user data object from profile
      const userData = profile || {};

      // Get formatted job description
      let jobDescription = {};
      if (!this.cachedJobDescription) {
        this.cachedJobDescription = await this.extractJobDescription();
      }
      jobDescription = this.cachedJobDescription;

      // Make API request to get answer
      const response = await fetch(`${HOST}/api/ai-answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: normalizedLabel,
          options,
          userData,
          description: jobDescription,
        }),
      });

      if (!response.ok) {
        throw new Error(`AI service error: ${response.status}`);
      }

      const data = await response.json();

      // Cache the answer for future use
      // this.answerCache[normalizedLabel] = data.answer;

      debugLog("getAnswer: AI response for label '" + label + "':", data.answer);
      return data.answer;
    } catch (error) {
      errorLog("AI Answer Error:", error);
      // As per user requirements, do not return fallback or generic answers.
      // Return null, so the calling function knows AI did not provide an answer.
      debugLog("getAnswer: API call failed for label '" + label + "'. Returning null.");
      return null;
    }
  }

  /**
   * Start countdown timer in status block
   */
  startCountDownInStatusBlock(duration, countDownEnded) {
    try {
      debugLog("Starting countdown in status block");
      const timerElement = document.createElement("div");
      timerElement.style.cssText = `
        margin-top: 15px;
        background: rgba(0, 0, 0, 0.6);
        padding: 10px;
        border-radius: 4px;
        text-align: center;
        font-weight: bold;
        display: flex;
        flex-direction: column;
        align-items: center;
      `;

      const timerDisplay = document.createElement("div");
      timerDisplay.style.cssText = `
        font-size: 24px;
        margin-bottom: 10px;
        color: #ffffff;
      `;

      const btnRow = document.createElement("div");
      btnRow.style.cssText = `
        display: flex;
        gap: 10px;
        margin-top: 5px;
      `;

      const addTimeBtn = document.createElement("button");
      addTimeBtn.textContent = "+30s";
      addTimeBtn.style.cssText = `
        background: #4a90e2;
        border: none;
        color: white;
        padding: 5px 10px;
        border-radius: 4px;
        cursor: pointer;
      `;

      const add2MinBtn = document.createElement("button");
      add2MinBtn.textContent = "+2m";
      add2MinBtn.style.cssText = `
        background: #4a90e2;
        border: none;
        color: white;
        padding: 5px 10px;
        border-radius: 4px;
        cursor: pointer;
      `;

      const statusIndicator = document.createElement("div");
      statusIndicator.textContent = "Auto-close timer active";
      statusIndicator.style.cssText = `
        margin-top: 5px;
        font-size: 12px;
        color: #aaa;
      `;

      // timerElement.appendChild(timerDisplay);
      // btnRow.appendChild(addTimeBtn);
      // btnRow.appendChild(add2MinBtn);
      // timerElement.appendChild(btnRow);
      // timerElement.appendChild(statusIndicator);

      // const contentElement = document.getElementById(
      //   "lever-automation-status-content"
      // );
      // if (contentElement) {
      //   contentElement.appendChild(timerElement);
      // }

      let timeLeft = duration;
      let intervalId = null;

      const updateTimerDisplay = () => {
        const minutes = Math.floor(timeLeft / 60);
        const seconds = timeLeft % 60;
        timerDisplay.textContent = `${minutes}:${
          seconds < 10 ? "0" : ""
        }${seconds}`;

        if (timeLeft <= 30) {
          timerDisplay.style.color = "#ff6b6b";
        } else if (timeLeft <= 60) {
          timerDisplay.style.color = "#ffaf40";
        } else {
          timerDisplay.style.color = "#ffffff";
        }

        timeLeft--;

        if (timeLeft < 0) {
          stop();
          timerDisplay.textContent = "Time's up!";
          timerDisplay.style.color = "#ff6b6b";
          if (typeof countDownEnded === "function") {
            countDownEnded();
          }
        }
      };

      updateTimerDisplay();
      intervalId = setInterval(updateTimerDisplay, 1000);

      const stop = () => {
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
      };

      const addTime = (additionalTime) => {
        timeLeft += additionalTime;
        updateTimerDisplay();
      };

      addTimeBtn.addEventListener("click", () => addTime(30));
      add2MinBtn.addEventListener("click", () => addTime(120));

      return {
        stop,
        addTime,
        element: timerElement,
      };
    } catch (err) {
      errorLog("Error starting countdown:", err);
      return {
        stop: () => {},
        addTime: () => {},
        element: null,
      };
    }
  }

  /**
   * Find the submit button in the form
   */

  findSubmitButton(form) {
    const submitSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button[data-qa="submit-application-button"]',
      'button[data-qa="btn-submit"]',
      "button#btn-submit",
      "button.submit-app-btn",
      "button.submit-application",
    ];

    for (const selector of submitSelectors) {
      try {
        const btns = form.querySelectorAll(selector);
        if (btns.length > 0) {
          for (const btn of btns) {
            if (
              btn.offsetParent !== null &&
              !btn.disabled &&
              !btn.classList.contains("disabled")
            ) {
              return btn;
            }
          }
        }
      } catch (e) {
        // Continue to next selector
      }
    }

    // Try to find any button that looks like a submit button
    const allButtons = form.querySelectorAll(
      'button, input[type="button"], input[type="submit"]'
    );
    for (const btn of allButtons) {
      const text = btn.textContent.toLowerCase();
      if (
        (text.includes("submit") || text.includes("apply")) &&
        btn.offsetParent !== null &&
        !btn.disabled &&
        !btn.classList.contains("disabled")
      ) {
        return btn;
      }
    }

    // If no specific submit button found, return the last button in the form
    const buttons = form.querySelectorAll("button");
    if (buttons.length > 0) {
      return buttons[buttons.length - 1];
    }

    return null;
  }

  async submitForm(submitButton) {
    this.appendStatusMessage("Submitting application...");

    // Scroll to the button
    this.scrollToTargetAdjusted(submitButton, 300);
    await this.wait(600);

    try {
      console.log(submitButton);
      console.log(submitButton.click());
      submitButton.click();

      this.appendStatusMessage("Clicked submit button");
    } catch (e) {
      debugLog("Standard click failed:", e);
    }
    return true;
  }

  checkSubmissionSuccess() {
    // Check if URL changed to a success/confirmation page
    if (
      window.location.href.includes("success") ||
      window.location.href.includes("confirmation") ||
      window.location.href.includes("thanks")
    ) {
      this.appendStatusMessage(
        "URL indicates success page - application submitted"
      );
      return true;
    }

    // Check for error messages
    const errorElements = document.querySelectorAll(
      ".error, .error-message, .form-error, .alert-error, .validation-error"
    );

    if (errorElements.length > 0) {
      const errorMessages = Array.from(errorElements)
        .map((el) => el.textContent.trim())
        .filter((text) => text.length > 0);

      if (errorMessages.length > 0) {
        this.appendStatusMessage(
          "Form has validation errors: " + errorMessages.join(", ")
        );
        return false;
      }
    }

    // If we can't confirm success, report failure
    this.appendStatusMessage(
      "Unable to confirm submission success - status uncertain"
    );
    return false; // Be cautious and report failure if we can't confirm success
  }

  /**
   * Process the application form
   */

  async processApplicationForm(form, data) {
    this.appendStatusMessage("Found application form, beginning to fill out");

    // Extract profile data
    const profile = data.profile || {};

    // Handle file uploads
    await this.fileHandler.handleResumeUpload(profile, form);

    // Process form fields
    await this.fillApplicationFields(form, profile);

    // Handle Lever-specific radio buttons
    await this.handleLeverRadioButtons(form, profile);

    // Handle Lever-specific select fields
    await this.handleLeverSelectFields(form, profile);

    // Handle consent and required checkboxes
    await this.handleRequiredCheckboxes(form, profile);

    // Check for any unfilled required fields
    const requiredFields = this.findUnfilledRequiredFields(form);
    if (requiredFields.length > 0) {
      this.appendStatusMessage(
        `Warning: ${requiredFields.length} required fields are not filled`
      );

      // Try to fill them with generic values
      for (const field of requiredFields) {
        await this.fillRequiredField(field, profile);
      }
    }

    // Find submit button
    const submitButton = this.findSubmitButton(form);

    if (!submitButton) {
      throw new SendCvError("Cannot find submit button");
    }

    // Enable the submit button if disabled
    if (submitButton.disabled) {
      submitButton.disabled = false;
    }

    // Use our new, more robust submit method
    const submitted = await this.submitForm(submitButton);
    return submitted;
  }

  findUnfilledRequiredFields(form) {
    const requiredSelectors = [
      'input[required]:not([type="file"])',
      "textarea[required]",
      "select[required]",
      '.required input:not([type="file"])',
      ".required textarea",
      ".required select",
      '[aria-required="true"]:not([type="file"])',
    ];

    const allRequiredFields = [];

    for (const selector of requiredSelectors) {
      const fields = form.querySelectorAll(selector);
      for (const field of fields) {
        // Skip hidden fields
        if (field.offsetParent === null) continue;

        // Skip already filled fields
        if (field.tagName === "SELECT") {
          if (
            field.value &&
            field.value !== "" &&
            !field.selectedOptions[0]?.disabled
          ) {
            continue;
          }
        } else {
          if (field.value && field.value.trim() !== "") {
            continue;
          }
        }

        // This field needs to be filled
        allRequiredFields.push(field);
      }
    }

    return allRequiredFields;
  }

  async fillRequiredField(field, profile) {
    const fieldType = field.tagName.toLowerCase();
    const inputType = field.type ? field.type.toLowerCase() : "";

    // Get field label/name
    let fieldName = "";
    const labelEl =
      field.closest("label") ||
      document.querySelector(`label[for="${field.id}"]`);
    if (labelEl) {
      fieldName = labelEl.textContent.trim();
    } else {
      fieldName =
        field.name || field.id || field.placeholder || "Unknown field";
    }

    this.appendStatusMessage(`Filling required field: ${fieldName}`);

    // For select elements
    if (fieldType === "select") {
      // Find first non-empty option
      const options = Array.from(field.options).filter(
        (opt) => opt.value && !opt.disabled
      );
      if (options.length > 0) {
        field.value = options[0].value;
        field.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
    // For text/email inputs
    else if (inputType === "text" || inputType === "email") {
      // Try to determine what kind of field this is
      const fieldNameLower = fieldName.toLowerCase();

      // Name field
      if (fieldNameLower.includes("name")) {
        if (
          fieldNameLower.includes("first") ||
          fieldNameLower.includes("given")
        ) {
          await this.setAdvancedInputValue(field, profile.firstName || "John");
        } else if (
          fieldNameLower.includes("last") ||
          fieldNameLower.includes("surname")
        ) {
          await this.setAdvancedInputValue(field, profile.lastName || "Doe");
        } else {
          await this.setAdvancedInputValue(
            field,
            profile.firstName && profile.lastName
              ? `${profile.firstName} ${profile.lastName}`
              : "John Doe"
          );
        }
      }
      // Email field
      else if (fieldNameLower.includes("email") || inputType === "email") {
        await this.setAdvancedInputValue(
          field,
          profile.email || "applicant@example.com"
        );
      }
      // Phone field
      else if (
        fieldNameLower.includes("phone") ||
        fieldNameLower.includes("mobile")
      ) {
        await this.setAdvancedInputValue(field, profile.phone || "5551234567");
      }
      // Generic text field - use placeholder text or generic value
      else {
        await this.setAdvancedInputValue(
          field,
          field.placeholder || "Required field"
        );
      }
    }
    // For textareas
    else if (fieldType === "textarea") {
      await this.setAdvancedInputValue(
        field,
        "I am very interested in this position and believe my skills and experience make me a strong candidate. I look forward to discussing this opportunity further."
      );
    }
    // For radio buttons
    else if (inputType === "radio") {
      // Find all radio buttons in the same group
      const name = field.name;
      const radioGroup = form.querySelectorAll(
        `input[type="radio"][name="${name}"]`
      );
      if (radioGroup.length > 0) {
        // Select the first one by default
        await this.clickRadioButtonEffectively(radioGroup[0]);
      }
    }
    // For checkboxes
    else if (inputType === "checkbox") {
      // If it's required, we probably need to check it
      if (!field.checked) {
        await this.clickRadioButtonEffectively(field);
      }
    }
  }

  async apply(data) {
    try {
      this.appendStatusMessage("Starting application process");
      debugLog("Starting application process", data);

      // Identify the form on the page
      const form = this.findApplicationForm();

      // Check if form was found
      if (!form) {
        debugLog("No application form found on the page");

        // Check if we're on an intermediate page
        if (document.querySelector('a[href*="/apply"]')) {
          // This might be a job description page, not the actual application
          this.appendStatusMessage(
            "This appears to be a job description page, not the application form"
          );
          const applyLinks = document.querySelectorAll('a[href*="/apply"]');

          if (applyLinks.length > 0) {
            this.appendStatusMessage("Found an 'Apply' link, clicking it");
            applyLinks[0].click();

            // Wait for page to load - increase from 3000ms to 5000ms
            await new Promise((resolve) => setTimeout(resolve, 5000));

            // Try to find the form again
            const retryForm = this.findApplicationForm();
            if (!retryForm) {
              throw new SendCvSkipError(
                "Cannot find application form after clicking Apply link"
              );
            }

            // Continue with the newly found form
            const result = await this.processApplicationForm(retryForm, data);
            // Log whether submission was successful
            this.appendStatusMessage(
              "Form submission result: " + (result ? "SUCCESS" : "FAILED")
            );
            return result;
          } else {
            throw new SendCvSkipError("Cannot find application form");
          }
        } else {
          // No form and no apply link found
          throw new SendCvSkipError("Cannot find application form");
        }
      }

      const result = await this.processApplicationForm(form, data);
      // Log whether submission was successful
      this.appendStatusMessage(
        "Form submission result: " + (result ? "SUCCESS" : "FAILED")
      );
      return result;
    } catch (e) {
      if (e instanceof SendCvError) {
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
   * Simplified approach to handle location fields - just sets the value directly
   */
  async handleLocationAutocomplete(locationInput, locationValue) {
    try {
      if (!locationInput || !locationValue) return false;

      this.appendStatusMessage(`Setting location field to: ${locationValue}`);

      // Scroll to the element
      this.scrollToTargetAdjusted(locationInput, 100);
      await this.wait(300);

      // Verify we have a proper location field
      if (
        !locationInput.tagName ||
        !["INPUT", "TEXTAREA"].includes(locationInput.tagName)
      ) {
        this.appendStatusMessage("Warning: Not a valid input element");
        return false;
      }

      // Direct approach: set the value property and dispatch events
      this.appendStatusMessage("Setting location value directly");
      locationInput.value = locationValue;
      locationInput.dispatchEvent(new Event("input", { bubbles: true }));
      await this.wait(500);

      // Verify the value was set
      this.appendStatusMessage(`Current field value: "${locationInput.value}"`);

      // Handle hidden field if present (often stores the actual location data)
      const hiddenField = locationInput.parentElement.querySelector(
        'input[type="hidden"][name="selectedLocation"]'
      );
      if (hiddenField) {
        this.appendStatusMessage("Setting hidden location field");

        // Format expected by Lever
        const locationData = JSON.stringify({
          name: locationValue,
          formattedAddress: locationValue,
        });

        hiddenField.value = locationData;
        hiddenField.dispatchEvent(new Event("change", { bubbles: true }));
      }

      // Simulate pressing Enter key to finalize the selection
      locationInput.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
          keyCode: 13,
        })
      );

      // Dispatch events to ensure the value is registered
      locationInput.dispatchEvent(new Event("change", { bubbles: true }));
      locationInput.dispatchEvent(new Event("blur", { bubbles: true }));

      await this.wait(300);

      // Final check to make sure the value stuck
      if (locationInput.value !== locationValue) {
        this.appendStatusMessage(
          `Warning: Value changed to "${locationInput.value}"`
        );

        // Try one more direct approach
        locationInput.value = locationValue;
        locationInput.dispatchEvent(new Event("change", { bubbles: true }));
      }

      return true;
    } catch (error) {
      this.appendStatusMessage(`Error setting location: ${error.message}`);
      return false;
    }
  }

  /**
   * Alternative method specifically for Lever location fields
   * Use this as a fallback if the simplified approach doesn't work
   */
  async handleLeverLocation(form, profile) {
    try {
      this.appendStatusMessage("Using alternative location handling method");

      // Locate the location field through multiple selectors
      const locationSelectors = [
        'input[name="location"]',
        "input.location-input",
        "#location-input",
        'input[placeholder*="location"]',
        'input[placeholder*="Location"]',
      ];

      let locationInput = null;
      for (const selector of locationSelectors) {
        locationInput = form.querySelector(selector);
        if (locationInput) break;
      }

      if (!locationInput) {
        this.appendStatusMessage("Could not find location input field");
        return false;
      }

      // Get location value from profile
      const locationValue =
        profile.currentCity ||
        profile.city ||
        profile.location ||
        "New York, NY";

      this.appendStatusMessage(`Using location value: ${locationValue}`);

      // Handle hidden field first (this is what Lever actually reads)
      const hiddenField = form.querySelector('input[name="selectedLocation"]');
      if (hiddenField) {
        this.appendStatusMessage("Setting hidden location field data");

        // Format the data as Lever expects
        const locationData = JSON.stringify({
          name: locationValue,
          formattedAddress: locationValue,
        });

        hiddenField.value = locationData;
        hiddenField.dispatchEvent(new Event("change", { bubbles: true }));
      }

      // Set the visible field value
      locationInput.value = locationValue;
      locationInput.dispatchEvent(new Event("input", { bubbles: true }));
      locationInput.dispatchEvent(new Event("change", { bubbles: true }));

      // Give time for any UI updates
      await this.wait(500);

      // Click away from the field to ensure it's not in focus
      const otherField = form.querySelector('input:not([name="location"])');
      if (otherField) {
        otherField.click();
        await this.wait(300);
      }

      this.appendStatusMessage("Location field handling completed");
      return true;
    } catch (error) {
      this.appendStatusMessage(
        `Error in alternative location handling: ${error.message}`
      );
      return false;
    }
  }
}

// Initialize the automation
debugLog("Creating LeverJobAutomation instance");
const leverAutomation = new LeverJobAutomation();

// Send a final notification that the script is fully loaded
debugLog("Lever content script fully loaded");
