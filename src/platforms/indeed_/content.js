import { IndeedFileHandler } from "@shared/linkedInUtils";
import { IndeedFormHandler } from "./indeedFormHandler";
import { HOST } from "@shared/constants";
import { StateManager } from "@shared/stateManager";
import { canApplyMore } from "@shared/checkAuthorization";
import { getJobURL } from "@shared/utils";

// Debugging helpers
function debugLog(message, ...args) {
  console.log(`[IndeedApply] ${message}`, ...args);
}

function errorLog(message, error) {
  console.error(`[IndeedApply Error] ${message}`, error);
  if (error?.stack) {
    console.error(error.stack);
  }
}

// Custom error types
class ApplicationError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "ApplicationError";
    this.details = details;
  }
}

class SkipApplicationError extends ApplicationError {
  constructor(message) {
    super(message);
    this.name = "SkipApplicationError";
  }
}

// Configuration
const CONFIG = {
  SELECTORS: {
    JOB_CARDS: ".job_seen_beacon",
    JOB_TITLE: ".jcs-JobTitle span[id^='jobTitle-']",
    COMPANY_NAME: "[data-testid='company-name']",
    LOCATION: "[data-testid='text-location']",
    SALARY: "[data-testid='salary-snippet']",
    APPLY_BUTTON: "#indeedApplyButton",
    APPLY_BUTTON_TEXT: ".jobsearch-IndeedApplyButton-newDesign",
    JOB_LINK: ".jcs-JobTitle",
    JOB_DESCRIPTION: "#jobDescriptionText",

    // Application form selectors
    RESUME_UPLOAD: "input[type=file]",
    FORM_INPUT: "input:not([type=hidden]), textarea, select",
    CONTINUE_BUTTON: "button[type=submit], button.ia-continueButton",
    SUBMIT_BUTTON: "button:contains('Submit'), button:contains('Apply')",
    RESUME_SELECT: ".ia-ResumeSelection-resume",
    RESUME_UPLOAD_BUTTON: "button.ia-ResumeSearch-uploadButton",

    // Search results navigation
    NEXT_PAGE: "[data-testid='pagination-page-next']",
    EASY_APPLY_FILTER: "#filter-epiccapplication",

    // Popups
    POPUP_CLOSE: ".popover-x-button-close",

    // External application indicators
    EXTERNAL_INDICATORS: [
      ".indeed-apply-status-not-applied",
      ".indeed-apply-status-applied",
      ".indeed-apply-status-rejected",
    ],
  },
  TIMEOUTS: {
    STANDARD: 2000,
    EXTENDED: 5000,
    MAX_TIMEOUT: 300000, // 5 minutes
    APPLICATION_TIMEOUT: 3 * 60 * 1000, // 3 minutes
  },
  PLAN_LIMITS: {
    FREE: 10,
    STARTER: 50,
    PRO: 500,
  },
  DEBUG: true,
  BRAND_COLOR: "#4a90e2", // FastApply brand blue
};

/**
 * IndeedJobAutomation - Content script for automating Indeed job applications
 */
class IndeedJobAutomation {
  constructor() {
    debugLog("Initializing IndeedJobAutomation");

    // State tracking
    this.state = {
      initialized: false,
      ready: false,
      isRunning: false,
      isApplicationInProgress: false,
      applicationStartTime: null,
      processedUrls: new Set(),
      processedLinksCount: 0,
      countDown: null,
      lastCheckedUrl: null,
      debounceTimers: {},
      currentJobIndex: 0,
      pendingApplication: false,
    };

    // User data and job management
    this.userData = null;
    this.profile = null;
    this.jobsToApply = [];
    this.stateManager = new StateManager();

    // Connection to background script
    this.port = null;
    this.portReconnectTimer = null;
    this.messageQueue = [];
    this.isProcessingQueue = false;

    // Search data
    this.searchData = {
      limit: null,
      current: null,
      domain: null,
      submittedLinks: [],
      searchLinkPattern: null,
    };

    // Create status overlay
    this.createStatusOverlay();

    // Create file handler for resume uploads
    this.fileHandler = new IndeedFileHandler({
      show: (message, type) => {
        debugLog(`[${type || "info"}] ${message}`);
        this.appendStatusMessage(message);
      },
    });

    // Set the API host
    this.HOST = HOST || "https://fastapply.co";

    // Initialize based on page type
    this.initializeConnection();
    this.detectPageTypeAndInitialize();

    // Set up health check timer
    this.healthCheckTimer = setInterval(() => this.checkHealth(), 30000);
  }

  /**
   * Initialize connection with the background script
   */
  initializeConnection() {
    try {
      debugLog("Initializing communication with background script");

      // Clean up existing connection if any
      if (this.port) {
        try {
          this.port.disconnect();
        } catch (e) {
          // Ignore errors when disconnecting
        }
        this.port = null;
      }

      // Determine port name based on the current page type
      const isApplyPage = window.location.href.match(
        /(indeed\.com\/viewjob|indeed\.com\/apply)/i
      );
      const tabId = Date.now(); // Using timestamp as a unique identifier
      const portName = isApplyPage
        ? `indeed-apply-${tabId}`
        : `indeed-search-${tabId}`;

      debugLog(`Creating connection with port name: ${portName}`);

      // Create the connection
      this.port = chrome.runtime.connect({ name: portName });

      if (!this.port) {
        throw new Error(
          "Failed to establish connection with background script"
        );
      }

      // Set up message listener
      this.port.onMessage.addListener((message) =>
        this.handlePortMessage(message)
      );

      // Handle disconnection
      this.port.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError;
        if (error) {
          debugLog("Port disconnected due to error:", error);
        } else {
          debugLog("Port disconnected");
        }

        this.port = null;

        // Schedule reconnection after a delay
        if (!this.portReconnectTimer) {
          this.portReconnectTimer = setTimeout(() => {
            debugLog("Attempting to reconnect");
            this.initializeConnection();
            this.portReconnectTimer = null;
          }, 5000);
        }
      });

      // Start keepalive interval
      this.startKeepAliveInterval();

      // Process any queued messages
      if (this.messageQueue.length > 0 && !this.isProcessingQueue) {
        this.processMessageQueue();
      }

      return true;
    } catch (error) {
      errorLog("Error initializing connection:", error);

      // Schedule reconnection after a delay
      if (!this.portReconnectTimer) {
        this.portReconnectTimer = setTimeout(() => {
          debugLog("Attempting to reconnect after error");
          this.initializeConnection();
          this.portReconnectTimer = null;
        }, 5000);
      }

      return false;
    }
  }

  /**
   * Start keepalive interval to maintain connection
   */
  startKeepAliveInterval() {
    // Clear any existing interval
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
    }

    // Send keepalive every 25 seconds
    this.keepAliveInterval = setInterval(() => {
      this.safeSendMessage({ type: "KEEPALIVE" });
    }, 25000);
  }

  /**
   * Queue a message to be sent when connection is available
   */
  safeSendMessage(message) {
    // Add message to queue with timestamp
    this.messageQueue.push({
      ...message,
      timestamp: Date.now(),
    });

    // Start processing queue if not already in progress
    if (!this.isProcessingQueue) {
      this.processMessageQueue();
    }
  }

  /**
   * Process queued messages
   */
  async processMessageQueue() {
    if (this.isProcessingQueue || this.messageQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    try {
      // Check if we have a connection
      if (!this.port) {
        debugLog("No connection available, attempting to reconnect");
        this.initializeConnection();

        // Wait for connection to establish
        await new Promise((resolve) => setTimeout(resolve, 500));

        // If still no connection, try again later
        if (!this.port) {
          this.isProcessingQueue = false;
          setTimeout(() => this.processMessageQueue(), 2000);
          return;
        }
      }

      // Process the oldest message in the queue
      const message = this.messageQueue.shift();

      try {
        this.port.postMessage(message);
        debugLog("Sent message:", message.type);
      } catch (error) {
        debugLog("Error sending message, reconnecting:", error);

        // Put the message back in the queue
        this.messageQueue.unshift(message);

        // Try to reconnect
        this.initializeConnection();

        // Delay before trying again
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      // Continue processing queue after a small delay
      setTimeout(() => {
        this.isProcessingQueue = false;
        this.processMessageQueue();
      }, 100);
    } catch (error) {
      errorLog("Error processing message queue:", error);

      // Reset processing flag and try again later
      setTimeout(() => {
        this.isProcessingQueue = false;
        this.processMessageQueue();
      }, 2000);
    }
  }

  /**
   * Handle messages received through the port
   */
  handlePortMessage(message) {
    try {
      debugLog("Received port message:", message);

      const { type, data } = message || {};

      if (!type) {
        debugLog("Received message without type, ignoring");
        return;
      }

      switch (type) {
        case "SEARCH_TASK_DATA":
          this.handleSearchTaskData(data);
          break;

        case "APPLICATION_TASK_DATA":
          this.handleApplicationTaskData(data);
          break;

        case "APPLICATION_STARTING":
          this.handleApplicationStarting(data);
          break;

        case "APPLICATION_STATUS":
          this.handleApplicationStatus(data);
          break;

        case "PROFILE_DATA":
          this.handleProfileData(data);
          break;

        case "DUPLICATE":
          this.handleDuplicate(data);
          break;

        case "SEARCH_NEXT":
          this.handleSearchNext(data);
          break;

        case "ERROR":
          this.handleError(message);
          break;

        case "KEEPALIVE_RESPONSE":
          // Just a ping-pong response, no action needed
          break;

        default:
          debugLog(`Unhandled message type: ${type}`);
      }
    } catch (error) {
      errorLog("Error handling port message:", error);
    }
  }

  /**
   * Handle search task data
   */
  handleSearchTaskData(data) {
    try {
      debugLog("Processing search task data:", data);

      if (!data) {
        debugLog("No search task data provided");
        return;
      }

      // Extract and store search parameters
      const { limit, current, domain, submittedLinks, searchLinkPattern } =
        data;

      this.searchData.limit = limit;
      this.searchData.current = current;
      this.searchData.domain = domain;

      // Process submitted links to include tries count
      this.searchData.submittedLinks = submittedLinks
        ? submittedLinks.map((link) => ({ ...link, tries: 0 }))
        : [];

      // Convert search link pattern string to RegExp if needed
      if (searchLinkPattern) {
        try {
          if (typeof searchLinkPattern === "string") {
            const patternParts =
              searchLinkPattern.match(/^\/(.*?)\/([gimy]*)$/);
            if (patternParts) {
              this.searchData.searchLinkPattern = new RegExp(
                patternParts[1],
                patternParts[2]
              );
            } else {
              this.searchData.searchLinkPattern = new RegExp(searchLinkPattern);
            }
          } else {
            this.searchData.searchLinkPattern = searchLinkPattern;
          }
        } catch (regexErr) {
          errorLog("Error parsing search link pattern:", regexErr);
          this.searchData.searchLinkPattern = null;
        }
      }

      debugLog("Search data initialized:", this.searchData);

      // Update state
      this.state.ready = true;
      this.state.initialized = true;

      this.appendStatusMessage("Search initialization complete");
      this.updateStatusIndicator("ready");

      // Apply filters to the search results before proceeding
      this.applySearchFilters();
    } catch (error) {
      errorLog("Error processing search task data:", error);
      this.appendStatusErrorMessage(error);
    }
  }

  /**
   * Handle application task data
   */
  handleApplicationTaskData(data) {
    try {
      debugLog("Processing application task data:", data);

      if (!data) {
        debugLog("No application task data provided");
        return;
      }

      // Store profile data for application
      this.profile = data.profile;
      this.devMode = data.devMode;
      this.session = data.session;
      this.avatarUrl = data.avatarUrl;

      // Update state
      this.state.ready = true;
      this.state.initialized = true;

      this.appendStatusMessage("Application initialization complete");
      this.updateStatusIndicator("ready");

      // Start application process after a short delay
      this.debounce("startApplying", () => this.startApplying(), 1000);
    } catch (error) {
      errorLog("Error processing application task data:", error);
      this.appendStatusErrorMessage(error);
    }
  }

  /**
   * Handle application starting confirmation
   */
  handleApplicationStarting(data) {
    try {
      debugLog("Application starting confirmation received:", data);

      // Set application in progress state
      this.state.isApplicationInProgress = true;
      this.state.applicationStartTime = Date.now();

      this.appendStatusMessage(
        "Application starting for: " + (data?.url || "unknown URL")
      );
      this.updateStatusIndicator("applying");
    } catch (error) {
      errorLog("Error handling application starting:", error);
      this.appendStatusErrorMessage(error);
    }
  }

  /**
   * Handle application status response
   */
  handleApplicationStatus(data) {
    try {
      debugLog("Application status received:", data);

      // Update local state based on background state
      if (data.inProgress !== this.state.isApplicationInProgress) {
        debugLog("Synchronizing application state with background");
        this.state.isApplicationInProgress = data.inProgress;

        if (data.inProgress) {
          this.state.applicationStartTime = Date.now();
          this.appendStatusMessage(
            "Application is in progress according to background"
          );
          this.updateStatusIndicator("applying");
        } else {
          this.state.applicationStartTime = null;
          this.appendStatusMessage(
            "No application in progress according to background"
          );
          this.updateStatusIndicator("ready");

          // Continue search if we're on a search page
          if (window.location.href.includes("indeed.com/jobs")) {
            this.debounce(
              "continueAutomation",
              () => this.startAutomation(),
              1000
            );
          }
        }
      }
    } catch (error) {
      errorLog("Error handling application status:", error);
      this.appendStatusErrorMessage(error);
    }
  }

  /**
   * Handle profile data response
   */
  handleProfileData(data) {
    try {
      debugLog("Profile data received");

      // Resolve the profile data promise if it exists
      if (this.profileDataResolver) {
        this.profileDataResolver(data);
        this.profileDataResolver = null;
        this.profileDataRejecter = null;
      } else {
        // Store for later use
        this.profile = data;
      }
    } catch (error) {
      errorLog("Error handling profile data:", error);

      // Reject the profile data promise if it exists
      if (this.profileDataRejecter) {
        this.profileDataRejecter(error);
        this.profileDataResolver = null;
        this.profileDataRejecter = null;
      }

      this.appendStatusErrorMessage(error);
    }
  }

  /**
   * Handle duplicate job response
   */
  handleDuplicate(data) {
    try {
      debugLog("Duplicate job detected:", data);

      // Reset application state
      this.state.isApplicationInProgress = false;
      this.state.applicationStartTime = null;

      this.appendStatusMessage(
        "Job already processed: " + (data?.url || "Unknown URL")
      );
      this.updateStatusIndicator("ready");

      // Continue the automation
      if (this.state.isRunning) {
        this.appendStatusMessage("Moving to next job");
        this.moveToNextJob();
      }
    } catch (error) {
      errorLog("Error handling duplicate:", error);
      this.appendStatusErrorMessage(error);
    }
  }

  /**
   * Handle search next event
   */
  handleSearchNext(data) {
    try {
      debugLog("Handling search next:", data);

      // Reset application state
      this.state.isApplicationInProgress = false;
      this.state.applicationStartTime = null;

      // Increment processed count
      this.state.processedLinksCount++;

      // Acknowledge that we're ready for the next job
      this.safeSendMessage({ type: "SEARCH_NEXT_READY" });

      if (!data || !data.url) {
        debugLog("No URL data in handleSearchNext");
        this.appendStatusMessage("Job processed, searching next...");
        return;
      }

      const url = data.url;

      // Find and update job card status in the page
      const jobCards = this.findAllJobCardElements();
      let cardFound = false;

      for (const card of jobCards) {
        const link = card.querySelector(CONFIG.SELECTORS.JOB_LINK);
        if (!link) continue;

        if (this.isUrlMatch(link.href, url)) {
          // Update visual status based on result
          if (data.status === "SUCCESS") {
            this.markCardAsColor(card, "green", "Completed");
            this.appendStatusMessage("Successfully submitted: " + url);
          } else if (data.status === "ERROR") {
            this.markCardAsColor(card, "red", "Error");
            this.appendStatusMessage(
              "Error with: " + url + (data.message ? ` - ${data.message}` : "")
            );
          } else {
            this.markCardAsColor(card, "orange", "Skipped");
            this.appendStatusMessage(
              "Skipped: " + url + (data.message ? ` - ${data.message}` : "")
            );
          }

          cardFound = true;
          break;
        }
      }

      if (!cardFound) {
        debugLog("Link not found in current page:", url);
      }

      // Add to local processed cache
      this.state.processedUrls.add(this.normalizeUrl(url));

      // Continue with the automation
      if (this.state.isRunning) {
        this.moveToNextJob();
      }
    } catch (error) {
      errorLog("Error handling search next:", error);
      this.appendStatusErrorMessage(error);

      // Reset application state and continue
      this.state.isApplicationInProgress = false;
      this.state.applicationStartTime = null;

      // Try to continue with the automation
      if (this.state.isRunning) {
        this.moveToNextJob();
      }
    }
  }

  /**
   * Handle error message
   */
  handleError(message) {
    const errorMessage =
      message.message || "Unknown error from background script";
    errorLog("Error from background script:", errorMessage);
    this.appendStatusErrorMessage("Background error: " + errorMessage);

    // Continue the automation if we're running
    if (this.state.isRunning) {
      this.moveToNextJob();
    }
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

    if (url.includes("indeed.com/jobs")) {
      debugLog("On Indeed search page");
      this.appendStatusMessage("Indeed search page detected");
      this.safeSendMessage({ type: "GET_SEARCH_TASK" });
    } else if (
      url.includes("indeed.com/viewjob") ||
      url.includes("indeed.com/apply")
    ) {
      debugLog("On Indeed job page");
      this.appendStatusMessage("Indeed job page detected");
      this.safeSendMessage({ type: "GET_APPLICATION_TASK" });
    }
  }

  /**
   * Apply search filters to narrow down results
   */
  applySearchFilters() {
    try {
      this.appendStatusMessage("Applying search filters...");

      // Wait for page to fully load
      setTimeout(async () => {
        // Check for Easy Apply filter
        const easyApplyFilter = document.querySelector(
          CONFIG.SELECTORS.EASY_APPLY_FILTER
        );
        if (easyApplyFilter && !easyApplyFilter.checked) {
          this.appendStatusMessage("Selecting Easy Apply filter");
          easyApplyFilter.click();
          await this.sleep(2000);
        }

        // Check for Date Posted filter (last 24 hours)
        const datePostedDropdown = document.querySelector(
          "#filter-dateposted-menu"
        );
        if (datePostedDropdown) {
          this.appendStatusMessage("Opening Date Posted filter");
          datePostedDropdown.click();
          await this.sleep(1000);

          const last24HoursOption = document.querySelector(
            '#filter-dateposted-menu [value="1"]'
          );
          if (last24HoursOption) {
            this.appendStatusMessage("Selecting last 24 hours filter");
            last24HoursOption.click();
            await this.sleep(2000);
          }
        }

        // Continue with the automation
        this.appendStatusMessage("Filters applied, starting job search");
        this.startAutomation();
      }, 2000);
    } catch (error) {
      errorLog("Error applying search filters:", error);
      this.appendStatusErrorMessage(error);

      // Continue with automation anyway
      setTimeout(() => this.startAutomation(), 3000);
    }
  }

  /**
   * Check health of automation and recover if needed
   */
  checkHealth() {
    try {
      // Check for stuck application
      if (
        this.state.isApplicationInProgress &&
        this.state.applicationStartTime
      ) {
        const now = Date.now();
        const applicationTime = now - this.state.applicationStartTime;

        // If application has been active for over timeout threshold, it's probably stuck
        if (applicationTime > CONFIG.TIMEOUTS.APPLICATION_TIMEOUT) {
          debugLog(
            "Application appears to be stuck for over 3 minutes, resetting state"
          );

          this.state.isApplicationInProgress = false;
          this.state.applicationStartTime = null;
          this.state.pendingApplication = false;

          this.appendStatusMessage(
            "Application timeout detected - resetting state"
          );
          this.updateStatusIndicator("error");

          // Continue with automation if we're running
          if (this.state.isRunning) {
            this.moveToNextJob();
          }
        }
      }

      // Check for inactivity - if we're running but no recent activity
      if (this.state.isRunning) {
        const now = Date.now();
        const lastActivity =
          this.state.lastActivity || this.state.applicationStartTime || now;
        const inactiveTime = now - lastActivity;

        if (inactiveTime > 60000) {
          // 1 minute of inactivity
          debugLog("Detected inactivity, checking state");

          // Check for pendingApplication status
          this.safeSendMessage({ type: "CHECK_APPLICATION_STATUS" });

          // Update last activity
          this.state.lastActivity = now;
        }
      }
    } catch (error) {
      errorLog("Error in health check:", error);
    }
  }

  /**
   * Start application process (for individual job apply pages)
   */
  async startApplying() {
    try {
      debugLog("Starting application process");
      this.appendStatusMessage("Starting application process");
      this.updateStatusIndicator("applying");

      // Check if page is valid
      if (
        document.body.innerText.includes("Page not found") ||
        document.body.innerText.includes("Job is no longer available")
      ) {
        throw new SkipApplicationError(
          "Cannot start application: Page error or job no longer available"
        );
      }

      // Set application state
      this.state.isApplicationInProgress = true;
      this.state.applicationStartTime = Date.now();

      // Extract job details
      const jobDetails = this.extractJobDetails();
      debugLog("Extracted job details:", jobDetails);

      // Start countdown timer
      this.state.countDown = this.startCountDownTimer(60 * 5, () => {
        this.safeSendMessage({
          type: "APPLICATION_ERROR",
          data: "Application timed out after 5 minutes",
        });
      });

      // Wait a moment for page to fully load
      await this.sleep(3000);

      // Apply for the job
      const applied = await this.apply();

      if (applied) {
        // Send completion message
        this.safeSendMessage({
          type: "APPLICATION_COMPLETED",
          data: jobDetails,
        });

        // Reset application state
        this.state.isApplicationInProgress = false;
        this.state.applicationStartTime = null;

        debugLog("Application completed successfully");
        this.appendStatusMessage("Application completed successfully");
        this.updateStatusIndicator("success");
      }
    } catch (error) {
      if (error instanceof SkipApplicationError) {
        errorLog("Application skipped:", error.message);
        this.appendStatusMessage("Application skipped: " + error.message);
        this.safeSendMessage({
          type: "APPLICATION_SKIPPED",
          data: error.message,
        });
      } else {
        errorLog("Application error:", error);
        this.appendStatusErrorMessage(error);
        this.safeSendMessage({
          type: "APPLICATION_ERROR",
          data: this.errorToString(error),
        });
      }

      // Reset application state
      this.state.isApplicationInProgress = false;
      this.state.applicationStartTime = null;
    }
  }

  /**
   * Extract job details from the page
   */
  extractJobDetails() {
    const jobId = this.getJobIdFromURL(window.location.href);
    const jobTitle =
      document.querySelector("h1")?.textContent?.trim() || "Job on Indeed";
    const companyName =
      document
        .querySelector(CONFIG.SELECTORS.COMPANY_NAME)
        ?.textContent?.trim() || "Company on Indeed";
    const location =
      document.querySelector(CONFIG.SELECTORS.LOCATION)?.textContent?.trim() ||
      "Not specified";
    const salary =
      document.querySelector(CONFIG.SELECTORS.SALARY)?.textContent?.trim() ||
      "Not specified";

    // Get workplace type (Remote, On-site, etc.)
    let workplace = "Not specified";
    const remoteTag = document.querySelector('[data-testid="remote-location"]');
    if (remoteTag) {
      workplace = remoteTag.textContent.trim();
    }

    // Get posted date
    let postedDate = "Not specified";
    const dateElement = document.querySelector('[data-testid="job-date"]');
    if (dateElement) {
      postedDate = dateElement.textContent.trim();
    }

    return {
      jobId,
      title: jobTitle,
      company: companyName,
      location,
      jobUrl: window.location.href,
      salary,
      workplace,
      postedDate,
      applicants: "Not specified",
    };
  }

  /**
   * Get job ID from URL
   */
  getJobIdFromURL(url) {
    try {
      // Format: https://www.indeed.com/viewjob?jk=12345abcdef
      const jobIdMatch = url.match(/jk=([^&]+)/);
      if (jobIdMatch && jobIdMatch[1]) {
        return jobIdMatch[1];
      }

      return "";
    } catch (error) {
      return "";
    }
  }

  /**
   * Apply for the job
   */
  async apply() {
    try {
      this.appendStatusMessage("Starting the application process");

      // Find the apply button
      const applyButton = await this.findApplyButton();
      if (!applyButton) {
        throw new SkipApplicationError("Cannot find apply button");
      }

      this.appendStatusMessage("Found apply button, clicking it");
      applyButton.click();

      // Wait for application form to load
      await this.sleep(5000);

      // Check if we're already on a special Indeed apply page
      if (window.location.href.includes("indeed.com/apply")) {
        await this.handleIndeedApplyPage();
      } else {
        // Wait for and check if any modals appeared
        const modal = document.querySelector(".ia-ApplyFormScreen");
        if (modal) {
          await this.handleIndeedApplyModal();
        } else {
          throw new SkipApplicationError(
            "Cannot find application form after clicking apply button"
          );
        }
      }

      this.appendStatusMessage("Application successfully submitted!");
      return true;
    } catch (error) {
      if (error instanceof SkipApplicationError) {
        throw error;
      } else {
        errorLog("Error in apply:", error);
        throw new ApplicationError(
          "Error during application process: " + this.errorToString(error)
        );
      }
    }
  }

  /**
   * Check if this is an external application (not Indeed Easy Apply)
   */
  isExternalApplication() {
    // Check for the specific external apply button shown in the example
    const externalButton = document.querySelector(
      'button[disclaimer*="You must create an Indeed account"]'
    );
    if (externalButton && this.isElementVisible(externalButton)) {
      debugLog("Found external apply button with disclaimer");
      return true;
    }

    // Check for any button with an external link icon (SVG)
    const buttonWithSvg = document.querySelector(
      "button.css-1k5a7vm span + svg"
    );
    if (
      buttonWithSvg &&
      this.isElementVisible(buttonWithSvg.closest("button"))
    ) {
      debugLog("Found external apply button with SVG icon");
      return true;
    }

    // Check for apply buttons with href attributes (links to external sites)
    const applyButtonWithHref = document.querySelector(
      'button[aria-label*="Apply now"][href]'
    );
    if (applyButtonWithHref && this.isElementVisible(applyButtonWithHref)) {
      debugLog("Found apply button with href attribute");
      return true;
    }

    // Check for text indicating external application
    const externalText = document.querySelector(
      '.jobsearch-ContentBlock [data-testid="inlineCompanyApply"]'
    );
    if (externalText && this.isElementVisible(externalText)) {
      debugLog("Found 'Apply on company site' indicator");
      return true;
    }

    // Check for the standard external indicators from config
    for (const selector of CONFIG.SELECTORS.EXTERNAL_INDICATORS) {
      const element = document.querySelector(selector);
      if (element && this.isElementVisible(element)) {
        debugLog("Found external indicator using selector: " + selector);
        return true;
      }
    }

    return false;
  }

  /**
   * Find the apply button on the job page
   */
  async findApplyButton() {
    // First check for the specific Easy Apply button structure from the example
    const easyApplyButton = document.querySelector(
      'button.css-jiauqs[aria-label="Apply now opens in a new tab"]'
    );
    if (easyApplyButton && this.isElementVisible(easyApplyButton)) {
      debugLog("Found Indeed Easy Apply button with specific class");
      return easyApplyButton;
    }

    // Try to find by the nested div/span structure
    const nestedStructureButtons = document.querySelectorAll(
      "button > div > span.css-1ebo7dz"
    );
    for (const span of nestedStructureButtons) {
      const button = span.closest("button");
      if (
        button &&
        this.isElementVisible(button) &&
        span.textContent.toLowerCase().includes("apply") &&
        !button.hasAttribute("href")
      ) {
        debugLog("Found Indeed Easy Apply button with nested structure");
        return button;
      }
    }

    // Check for the standard Easy Apply button
    const indeedApplyButton = document.querySelector(
      CONFIG.SELECTORS.APPLY_BUTTON
    );
    if (indeedApplyButton && this.isElementVisible(indeedApplyButton)) {
      // Verify it's an Easy Apply button by checking for the wrapper
      const hasWrapper = indeedApplyButton.querySelector(
        ".jobsearch-IndeedApplyButton-contentWrapper"
      );
      if (hasWrapper) {
        debugLog("Found standard Indeed Easy Apply button");
        return indeedApplyButton;
      }
    }

    // Try all fallback selectors if specific detection fails
    const fallbackSelectors = [
      ".ia-IndeedApplyButton",
      ".jobsearch-IndeedApplyButton-newDesign",
      'button[data-testid="indeed-apply-button"]',
      // Add more selectors that could match Easy Apply buttons
      'button[data-testid*="apply-button"]',
      "button.css-jiauqs",
      "button.jobsearch-apply-button",
    ];

    for (const selector of fallbackSelectors) {
      try {
        const buttons = document.querySelectorAll(selector);
        for (const btn of buttons) {
          if (
            this.isElementVisible(btn) &&
            btn.textContent.toLowerCase().includes("apply") &&
            !this.hasExternalIndicators(btn)
          ) {
            debugLog("Found apply button with selector: " + selector);
            return btn;
          }
        }
      } catch (e) {
        // Continue to next selector
      }
    }

    // Only look for generic "apply" buttons if we're confident this isn't an external application
    if (!this.isExternalApplication()) {
      const allButtons = document.querySelectorAll("button, a.icl-Button");
      for (const btn of allButtons) {
        if (
          this.isElementVisible(btn) &&
          btn.textContent.toLowerCase().includes("apply") &&
          !this.hasExternalIndicators(btn)
        ) {
          debugLog("Found generic apply button as last resort");
          return btn;
        }
      }
    }

    debugLog("No Indeed Easy Apply button found");
    return null;
  }

  /**
   * Check if a button has indicators that it's for external application
   */
  hasExternalIndicators(button) {
    // Check for SVG (external link icon)
    if (button.querySelector("svg")) {
      return true;
    }

    // Check for href attribute
    if (button.hasAttribute("href")) {
      return true;
    }

    // Check for disclaimer attribute
    if (button.hasAttribute("disclaimer")) {
      return true;
    }

    // Check for text implying external application
    const lowerText = button.textContent.toLowerCase();
    const externalPhrases = [
      "company site",
      "external",
      "website",
      "continue to",
    ];
    if (externalPhrases.some((phrase) => lowerText.includes(phrase))) {
      return true;
    }

    return false;
  }
//this.findApplyButton
  /**
   * Handle Indeed's dedicated apply page
   */
  async handleIndeedApplyPage() {
    this.appendStatusMessage("Processing Indeed Apply page");

    // Wait for profile data if not loaded
    if (!this.profile) {
      this.profile = await this.getProfileData();
    }

    // Initialize form handler
    const formHandler = new IndeedFormHandler({
      logger: (message) => this.appendStatusMessage(message),
      host: this.HOST,
      userData: this.profile,
      jobDescription:
        document.querySelector(CONFIG.SELECTORS.JOB_DESCRIPTION)?.textContent ||
        "",
    });

    // Handle resume upload first
    try {
      await this.handleResumeUpload();
    } catch (resumeError) {
      this.appendStatusMessage("Resume upload issue: " + resumeError.message);
      // Continue with application even if resume upload fails
    }

    // Handle multi-step application
    let isLastStep = false;
    let maxSteps = 10;
    let currentStep = 0;

    while (!isLastStep && currentStep < maxSteps) {
      currentStep++;
      this.appendStatusMessage(`Processing application step ${currentStep}`);

      // Find the form on current page
      const form = document.querySelector("form") || document.body;

      // Fill all fields on current page
      await formHandler.fillFormWithProfile(form, this.profile);

      // Handle required checkboxes
      await formHandler.handleRequiredCheckboxes(form);

      // Find and click the continue button
      const continueButton = formHandler.findSubmitButton(form);
      if (!continueButton) {
        // No button found, might be the last step or an error
        this.appendStatusMessage(
          "No continue button found, waiting for confirmation"
        );
        await this.sleep(3000);

        // Check for submission confirmation
        if (formHandler.checkSubmissionResult()) {
          this.appendStatusMessage("Application submitted successfully!");
          isLastStep = true;
        } else {
          throw new Error("Cannot find continue button on step " + currentStep);
        }
      } else {
        // Check if this is the final submit button
        const buttonText = continueButton.textContent.trim().toLowerCase();
        if (
          buttonText.includes("submit") ||
          buttonText.includes("apply") ||
          buttonText === "submit application"
        ) {
          this.appendStatusMessage(
            "Found final submit button, submitting application"
          );
          isLastStep = true;
        }

        // Click the button
        this.appendStatusMessage(`Clicking ${buttonText} button`);
        continueButton.click();

        // Wait for next page to load
        await this.sleep(3000);
      }
    }

    // Final wait to confirm submission
    await this.sleep(5000);

    if (currentStep >= maxSteps) {
      throw new Error(
        "Maximum steps exceeded, application may not be complete"
      );
    }

    return true;
  }

  /**
   * Handle Indeed apply modal
   */
  async handleIndeedApplyModal() {
    this.appendStatusMessage("Processing Indeed Apply modal");

    // Wait for profile data if not loaded
    if (!this.profile) {
      this.profile = await this.getProfileData();
    }

    // Initialize form handler
    const formHandler = new IndeedFormHandler({
      logger: (message) => this.appendStatusMessage(message),
      host: this.HOST,
      userData: this.profile,
      jobDescription:
        document.querySelector(CONFIG.SELECTORS.JOB_DESCRIPTION)?.textContent ||
        "",
    });

    // Handle resume upload first
    try {
      await this.handleResumeUpload();
    } catch (resumeError) {
      this.appendStatusMessage("Resume upload issue: " + resumeError.message);
      // Continue with application even if resume upload fails
    }

    // Handle multi-step application in modal
    let isLastStep = false;
    let maxSteps = 10;
    let currentStep = 0;

    while (!isLastStep && currentStep < maxSteps) {
      currentStep++;
      this.appendStatusMessage(`Processing modal step ${currentStep}`);

      // Find the form in modal
      const form =
        document.querySelector(".ia-ApplyFormScreen form") ||
        document.querySelector(".ia-ApplyFormScreen");

      // Fill all fields on current modal page
      await formHandler.fillFormWithProfile(form, this.profile);

      // Handle required checkboxes
      await formHandler.handleRequiredCheckboxes(form);

      // Find and click the continue button
      const continueButton = formHandler.findSubmitButton(form);
      if (!continueButton) {
        // No button found, might be the last step or an error
        this.appendStatusMessage(
          "No continue button found in modal, waiting for confirmation"
        );
        await this.sleep(3000);

        // Check for submission confirmation
        if (formHandler.checkSubmissionResult()) {
          this.appendStatusMessage("Application submitted successfully!");
          isLastStep = true;
        } else {
          throw new Error(
            "Cannot find continue button on modal step " + currentStep
          );
        }
      } else {
        // Check if this is the final submit button
        const buttonText = continueButton.textContent.trim().toLowerCase();
        if (
          buttonText.includes("submit") ||
          buttonText.includes("apply") ||
          buttonText === "submit application"
        ) {
          this.appendStatusMessage(
            "Found final submit button in modal, submitting application"
          );
          isLastStep = true;
        }

        // Click the button
        this.appendStatusMessage(`Clicking ${buttonText} button in modal`);
        continueButton.click();

        // Wait for next page to load
        await this.sleep(3000);
      }
    }

    // Final wait to confirm submission
    await this.sleep(5000);

    if (currentStep >= maxSteps) {
      throw new Error(
        "Maximum modal steps exceeded, application may not be complete"
      );
    }

    return true;
  }

  /**
   * Handle resume upload process
   */
  async handleResumeUpload() {
    try {
      this.appendStatusMessage("Checking for resume upload option");

      // Check if there's a resume selection screen
      const resumeSelections = document.querySelectorAll(
        CONFIG.SELECTORS.RESUME_SELECT
      );
      if (resumeSelections.length > 0) {
        // If there are resume options already available, select the first one
        this.appendStatusMessage("Resume already uploaded, selecting it");
        resumeSelections[0].click();
        await this.sleep(1000);

        // Find and click continue after selection
        const continueButton = document.querySelector(
          CONFIG.SELECTORS.CONTINUE_BUTTON
        );
        if (continueButton) {
          continueButton.click();
          await this.sleep(2000);
        }
        return true;
      }

      // Check for upload button
      const uploadButton = document.querySelector(
        CONFIG.SELECTORS.RESUME_UPLOAD_BUTTON
      );
      if (uploadButton) {
        this.appendStatusMessage("Clicking resume upload button");
        uploadButton.click();
        await this.sleep(1000);
      }

      // Look for file input
      const fileInput = document.querySelector(CONFIG.SELECTORS.RESUME_UPLOAD);
      if (!fileInput) {
        this.appendStatusMessage("No resume upload field found");
        return false;
      }

      // Make sure we have resume URL
      if (!this.profile?.resumeUrl) {
        this.appendStatusMessage("No resume URL in profile");
        return false;
      }

      // Upload resume using file handler
      this.appendStatusMessage("Uploading resume");
      const uploaded = await this.fileHandler.handleResumeUpload(this.profile, {
        querySelector: () => fileInput,
      });

      if (uploaded) {
        this.appendStatusMessage("Resume uploaded successfully");
        await this.sleep(3000);
        return true;
      } else {
        this.appendStatusMessage("Resume upload failed");
        return false;
      }
    } catch (error) {
      this.appendStatusMessage("Error during resume upload: " + error.message);
      return false;
    }
  }

  /**
   * Get profile data from background script
   */
  async getProfileData() {
    try {
      this.appendStatusMessage("Requesting profile data");

      // Return cached profile if available
      if (this.profile) {
        return this.profile;
      }

      // Create a promise to handle the response
      const profilePromise = new Promise((resolve, reject) => {
        this.profileDataResolver = resolve;
        this.profileDataRejecter = reject;

        // Set timeout to prevent hanging
        setTimeout(() => {
          if (this.profileDataResolver) {
            this.profileDataRejecter(
              new Error("Profile data request timed out")
            );
            this.profileDataResolver = null;
            this.profileDataRejecter = null;
          }
        }, 15000);
      });

      // Request profile data
      this.safeSendMessage({
        type: "GET_PROFILE_DATA",
        data: { url: window.location.href },
      });

      // Wait for response
      const profile = await profilePromise;
      return profile;
    } catch (error) {
      this.appendStatusMessage("Error getting profile data: " + error.message);
      throw error;
    }
  }

  /**
   * Initialize for automation
   */
  async initialize(userId) {
    try {
      debugLog("Initializing with userId:", userId);
      const userDetails = await this.fetchUserDetailsFromBackend(userId);

      await this.stateManager.saveState({
        userId,
        userDetails,
        preferences: userDetails.jobPreferences || {},
        availableCredits: userDetails.credits || 0,
        applicationsUsed: userDetails.applicationsUsed || 0,
        userRole: userDetails.plan,
        isProcessing: false,
        currentJobIndex: 0,
        subscription: userDetails.subscription || null,
      });

      this.userData = userDetails;
      return userDetails;
    } catch (error) {
      errorLog("Error in initialization:", error);
      throw error;
    }
  }

  /**
   * Fetch user details from backend
   */
  async fetchUserDetailsFromBackend(userId) {
    try {
      const response = await fetch(`${this.HOST}/api/user/${userId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch user details: ${response.statusText}`);
      }
      const data = await response.json();
      if (!data) throw new Error("No user data received from backend");
      return data;
    } catch (error) {
      errorLog("Error fetching user details:", error);
      throw error;
    }
  }

  /**
   * Wait for job search page to load
   */
  async waitForJobSearchPage() {
    const maxWaitTime = 120000; // 2 minutes timeout - giving user time to solve CAPTCHA
    const startTime = Date.now();
    let captchaDetected = false;
    let lastStatusUpdate = 0;

    while (Date.now() - startTime < maxWaitTime) {
      // Check if we've reached the job search homepage
      if (document.querySelector("#jobsearch-HomePage")) {
        if (captchaDetected) {
          this.appendStatusMessage(
            "CAPTCHA solved successfully. Proceeding with job search."
          );
        }
        return true;
      }

      // Check for CAPTCHA
      const captchaElement =
        document.querySelector('iframe[src*="captcha"]') ||
        document.querySelector('iframe[src*="recaptcha"]');

      if (captchaElement && !captchaDetected) {
        captchaDetected = true;
        this.appendStatusMessage(
          "CAPTCHA detected. Please solve the CAPTCHA to continue."
        );
        debugLog("CAPTCHA detected, waiting for user to solve...");
      }

      // Update status every 10 seconds if still waiting
      const now = Date.now();
      if (now - lastStatusUpdate > 10000) {
        lastStatusUpdate = now;
        const timeElapsed = Math.round((now - startTime) / 1000);
        this.appendStatusMessage(
          `Waiting for job search page... (${timeElapsed}s elapsed${
            captchaDetected ? ", CAPTCHA needs to be solved" : ""
          })`
        );
      }

      await this.sleep(500); // Check more frequently
    }

    // If we reach here, we timed out waiting for the page
    this.appendStatusMessage(
      "Timed out waiting for job search page. Please reload and try again."
    );
    return false;
  }

  /**
   * Perform job search based on preferences
   */
  async performJobSearch() {
    try {
      // First check if we're on the job search homepage
      const isOnHomePage =
        document.querySelector("#jobsearch-HomePage") &&
        document.querySelector("#jobsearch-HomepageBody.dd-privacy-allow");

      if (!isOnHomePage) {
        // Send status update that we're checking for the page
        this.appendStatusMessage(
          "Waiting for Indeed job search homepage to load..."
        );

        // Navigate to Indeed homepage if not already there
        if (!window.location.href.includes("indeed.com")) {
          window.location.href = getJobURL(this.userData?.country || "us");
          return false; // Exit and wait for page to reload
        }

        // Wait for the page to load with support for CAPTCHA solving
        const pageLoaded = await this.waitForJobSearchPage();

        if (!pageLoaded) {
          debugLog("Not on job search homepage after waiting, aborting search");
          return false;
        }
      }

      const state = await this.stateManager.getState();
      const preferences = state?.preferences || {};

      // Build search URL with all parameters in exact order
      const searchParams = new URLSearchParams();

      // 1. Search query (q)
      const searchQuery = Array.isArray(preferences.positions)
        ? preferences.positions[0]
        : preferences.role || "jobs";
      searchParams.append("q", searchQuery);

      // 2. Location (l)
      const location = preferences.location || "remote";
      searchParams.append("l", location);

      // 3. Job type filter
      if (
        Array.isArray(preferences.jobType) &&
        preferences.jobType.length > 0
      ) {
        // Remove hyphen and spaces, convert to lowercase
        const jobType = preferences.jobType[0]
          .replace(/[-\\s]+/g, "")
          .toLowerCase();
        searchParams.append("sc", `0kf:jt(${jobType});`);
      }

      // 4. Date posted (fromage)
      if (preferences.datePosted) {
        const datePostedMapping = {
          "Last 24 hours": "1",
          "Last 3 days": "3",
          "Last 7 days": "7",
          "Last 14 days": "14",
        };
        const fromage = datePostedMapping[preferences.datePosted] || "3";
        searchParams.append("fromage", fromage);
      }

      await this.stateManager.updateState({
        pendingSearch: true,
        lastActionTime: new Date().toISOString(),
      });

      const searchUrl = `${getJobURL(
        this.userData?.country || "us"
      )}/jobs?${searchParams.toString()}`;

      this.appendStatusMessage("Navigating to search results");
      window.location.href = searchUrl;
      return true;
    } catch (error) {
      errorLog("Error performing job search:", error);
      this.appendStatusErrorMessage(error);
      return false;
    }
  }

  /**
   * Start automation process
   */
  async startAutomation() {
    try {
      this.appendStatusMessage("Starting job automation");
      this.updateStatusIndicator("searching");

      if (this.state.isRunning) {
        this.appendStatusMessage("Automation already running");
        return;
      }

      // First check if we can apply more
      const currentState = await this.stateManager.getState();
      if (currentState && !(await canApplyMore(currentState))) {
        this.appendStatusMessage(
          `Cannot apply: ${
            currentState.userPlan === "credit"
              ? `Insufficient credits (${currentState.availableCredits} remaining)`
              : `Daily limit reached`
          }`
        );
        return "limit_reached";
      }

      this.state.isRunning = true;
      this.state.lastActivity = Date.now();

      // Get all visible job cards
      this.jobsToApply = await this.getVisibleJobs();

      if (this.jobsToApply.length === 0) {
        this.appendStatusMessage("No jobs found to process");
        throw new Error("No jobs found to process");
      }

      // Calculate maximum jobs to process based on plan
      let maxJobs = this.jobsToApply.length;
      if (currentState) {
        switch (currentState.userRole) {
          case "free":
            maxJobs = Math.min(
              CONFIG.PLAN_LIMITS.FREE - (currentState.applicationsUsed || 0),
              maxJobs
            );
            break;
          case "starter":
            maxJobs = Math.min(
              CONFIG.PLAN_LIMITS.STARTER - (currentState.applicationsUsed || 0),
              maxJobs
            );
            break;
          case "credit":
            maxJobs = Math.min(currentState.availableCredits || 0, maxJobs);
            break;
          case "pro":
            maxJobs = Math.min(
              CONFIG.PLAN_LIMITS.PRO - (currentState.applicationsUsed || 0),
              maxJobs
            );
            break;
        }
      }

      this.appendStatusMessage(
        `Processing ${maxJobs} out of ${this.jobsToApply.length} jobs found`
      );

      // Start with the first job
      this.state.currentJobIndex = 0;
      await this.processCurrentJob();
    } catch (error) {
      errorLog("Error in startAutomation:", error);
      this.appendStatusErrorMessage(
        "Error starting automation: " + error.message
      );
      this.state.isRunning = false;
    }
  }

  /**
   * Get visible jobs on the page
   */
  async getVisibleJobs() {
    try {
      const jobCards = document.querySelectorAll(CONFIG.SELECTORS.JOB_CARDS);
      return Array.from(jobCards).map((card) => ({
        id:
          card.querySelector(CONFIG.SELECTORS.JOB_LINK)?.dataset?.jk ||
          (card
            .querySelector(CONFIG.SELECTORS.JOB_LINK)
            ?.href?.match(/jk=([^&]+)/) || [])[1] ||
          "",
        element: card,
        title: card
          .querySelector(CONFIG.SELECTORS.JOB_TITLE)
          ?.textContent?.trim(),
        company: card
          .querySelector(CONFIG.SELECTORS.COMPANY_NAME)
          ?.textContent?.trim(),
        location: card
          .querySelector(CONFIG.SELECTORS.LOCATION)
          ?.textContent?.trim(),
        url:
          card.querySelector(CONFIG.SELECTORS.JOB_LINK)?.href ||
          window.location.href,
        description: card
          .querySelector(CONFIG.SELECTORS.JOB_DESCRIPTION)
          ?.textContent?.trim(),
        salary: card
          .querySelector(CONFIG.SELECTORS.JOB_SALARY)
          ?.textContent?.trim(),
      }));
    } catch (error) {
      errorLog("Error getting visible jobs:", error);
      return [];
    }
  }

  /**
   * Process the current job
   */
  async processCurrentJob() {
    try {
      if (!this.state.isRunning) {
        this.appendStatusMessage("Automation stopped, not processing job");
        return;
      }

      // Make sure we're not exceeding the available jobs
      if (this.state.currentJobIndex >= this.jobsToApply.length) {
        this.appendStatusMessage("All jobs processed, automation complete");
        this.state.isRunning = false;
        return;
      }

      const job = this.jobsToApply[this.state.currentJobIndex];

      // Skip if the job URL is already processed
      if (this.isUrlProcessed(job.url)) {
        this.appendStatusMessage(
          `Job already processed: ${job.title}, skipping`
        );
        this.markCardAsColor(job.element, "orange", "Already Processed");
        this.moveToNextJob();
        return;
      }

      this.appendStatusMessage(
        `Processing job ${this.state.currentJobIndex + 1}: ${job.title} at ${
          job.company
        }`
      );

      // Mark card as in progress
      this.markCardAsColor(job.element, "blue", "Processing");

      // Click the job link to show details
      const jobLink = job.element.querySelector(CONFIG.SELECTORS.JOB_LINK);
      if (!jobLink) {
        this.appendStatusMessage("Job link not found, skipping");
        this.markCardAsColor(job.element, "red", "No Link");
        this.moveToNextJob();
        return;
      }

      this.appendStatusMessage("Clicking job link to view details");
      jobLink.click();
      await this.sleep(CONFIG.TIMEOUTS.STANDARD);

      // Handle any popups
      await this.handlePopups();

      // Find and verify the apply button
      const applyButton = await this.findApplyButton();
      console.log("BUTTON", applyButton)
      if (!applyButton) {
        this.appendStatusMessage("No Easy Apply button found, skipping job");
        this.markCardAsColor(job.element, "orange", "No Easy Apply");
        this.moveToNextJob();
        return;
      }

      // Check if it's an external application
      if (this.isExternalApplication()) {
        this.appendStatusMessage("External application detected, skipping");
        this.markCardAsColor(job.element, "orange", "External");
        this.moveToNextJob();
        return;
      }

      // Store job data in state
      await this.stateManager.updateState({
        currentJobIndex: this.state.currentJobIndex,
        lastActionTime: new Date().toISOString(),
        currentJob: {
          id: job.id,
          title: job.title,
          company: job.company,
          location: job.location,
          url: job.url,
          description:
            document.querySelector(CONFIG.SELECTORS.JOB_DESCRIPTION)
              ?.textContent || job.description,
        },
        pendingApplication: true,
      });

      // Set application state
      this.state.isApplicationInProgress = true;
      this.state.applicationStartTime = Date.now();
      this.state.pendingApplication = true;

      // Mark job as in progress
      this.markCardAsColor(job.element, "green", "Applying");

      // Click the apply button
      this.appendStatusMessage("Clicking Easy Apply button");
      applyButton.click();

      // Wait for application form
      await this.sleep(CONFIG.TIMEOUTS.STANDARD);

      // Handle the application form
      if (document.querySelector(".ia-ApplyFormScreen")) {
        this.appendStatusMessage("Application form detected, filling...");
        await this.handleIndeedApplyModal();

        // Send completion notification
        this.safeSendMessage({
          type: "APPLICATION_COMPLETED",
          data: {
            jobId: job.id,
            title: job.title,
            company: job.company,
            location: job.location,
            jobUrl: job.url,
            salary: job.salary || "Not specified",
            workplace: "Not specified",
            postedDate: "Not specified",
            applicants: "Not specified",
          },
        });

        // Mark as success
        this.markCardAsColor(job.element, "green", "Applied");
        this.appendStatusMessage("Application submitted successfully!");

        // Update application status
        this.state.isApplicationInProgress = false;
        this.state.applicationStartTime = null;
        this.state.pendingApplication = false;
        this.state.processedUrls.add(this.normalizeUrl(job.url));

        // Move to next job after a delay
        await this.sleep(1000);
        this.moveToNextJob();
      } else {
        // No form detected, might be an error or external application
        this.appendStatusMessage("No application form found, skipping");
        this.safeSendMessage({
          type: "APPLICATION_SKIPPED",
          data: "No application form found after clicking apply button",
        });

        // Mark as skipped
        this.markCardAsColor(job.element, "orange", "Skipped");

        // Reset application state
        this.state.isApplicationInProgress = false;
        this.state.applicationStartTime = null;
        this.state.pendingApplication = false;
        this.state.processedUrls.add(this.normalizeUrl(job.url));

        // Move to next job
        this.moveToNextJob();
      }
    } catch (error) {
      errorLog("Error processing job:", error);
      this.appendStatusErrorMessage("Error: " + error.message);

      // Reset application state
      this.state.isApplicationInProgress = false;
      this.state.applicationStartTime = null;
      this.state.pendingApplication = false;

      // Try to mark current job as error if we can
      if (this.state.currentJobIndex < this.jobsToApply.length) {
        const job = this.jobsToApply[this.state.currentJobIndex];
        this.markCardAsColor(job.element, "red", "Error");
        this.state.processedUrls.add(this.normalizeUrl(job.url));
      }

      // Move to next job after a delay
      await this.sleep(1000);
      this.moveToNextJob();
    }
  }

  /**
   * Move to the next job
   */
  async moveToNextJob() {
    try {
      if (!this.state.isRunning) {
        this.appendStatusMessage("Automation stopped, not moving to next job");
        return;
      }

      // Increment the job index
      this.state.currentJobIndex++;

      // Update the state
      await this.stateManager.updateState({
        currentJobIndex: this.state.currentJobIndex,
        lastActionTime: new Date().toISOString(),
      });

      // Check if we've processed all jobs
      if (this.state.currentJobIndex >= this.jobsToApply.length) {
        this.appendStatusMessage(
          "All jobs processed, checking for more jobs..."
        );

        // Try to load more jobs by clicking next page
        const nextPageButton = this.findNextPageButton();
        if (nextPageButton) {
          this.appendStatusMessage("Moving to next page of job results");
          nextPageButton.click();

          // Wait for page to load and restart automation
          setTimeout(() => {
            this.startAutomation();
          }, 3000);
        } else {
          // No more pages, we're done
          this.appendStatusMessage("No more job pages, automation complete!");
          this.updateStatusIndicator("success");
          this.state.isRunning = false;

          // Notify completion
          this.safeSendMessage({ type: "SEARCH_COMPLETED" });
        }
      } else {
        // Process the next job
        this.appendStatusMessage("Moving to next job...");

        // Add a short delay between jobs
        const delay = Math.floor(Math.random() * (3000 - 1000) + 1000);
        await this.sleep(delay);

        // Process the next job
        this.processCurrentJob();
      }
    } catch (error) {
      errorLog("Error moving to next job:", error);
      this.appendStatusErrorMessage("Error: " + error.message);

      // Try to continue anyway after a delay
      setTimeout(() => {
        if (this.state.isRunning) {
          this.processCurrentJob();
        }
      }, 3000);
    }
  }

  /**
   * Handle popups that might appear
   */
  async handlePopups() {
    try {
      const popupCloseButton = document.querySelector(
        CONFIG.SELECTORS.POPUP_CLOSE
      );
      if (popupCloseButton) {
        this.appendStatusMessage("Closing popup");
        popupCloseButton.click();
        await this.sleep(500);
      }
    } catch (error) {
      // Ignore errors with popups
    }
  }

  /**
   * Find all job card elements on the page
   */
  findAllJobCardElements() {
    try {
      const jobCards = document.querySelectorAll(CONFIG.SELECTORS.JOB_CARDS);
      return Array.from(jobCards);
    } catch (error) {
      errorLog("Error finding job cards:", error);
      return [];
    }
  }

  /**
   * Find the "Next" button for pagination
   */
  findNextPageButton() {
    try {
      // Try selector for pagination next button
      const nextButton = document.querySelector(CONFIG.SELECTORS.NEXT_PAGE);
      if (nextButton && this.isElementVisible(nextButton)) {
        return nextButton;
      }

      // Try generic selectors
      const nextSelectors = [
        'a[aria-label="Next"]',
        'button[aria-label="Next"]',
        '.pagination a:contains("Next")',
        ".pagination-list a:last-child",
        "a.pn-next",
      ];

      for (const selector of nextSelectors) {
        try {
          const button = document.querySelector(selector);
          if (button && this.isElementVisible(button)) {
            return button;
          }
        } catch (e) {
          // Continue to next selector
        }
      }

      // Look for any link or button with "Next" text
      const allButtons = document.querySelectorAll("a, button");
      for (const btn of allButtons) {
        if (
          this.isElementVisible(btn) &&
          (btn.textContent.trim() === "Next" ||
            btn.getAttribute("aria-label") === "Next")
        ) {
          return btn;
        }
      }

      return null;
    } catch (error) {
      errorLog("Error finding next button:", error);
      return null;
    }
  }

  /**
   * Wait for an element to appear
   */
  async waitForElement(selector, timeout = 5000) {
    return new Promise((resolve) => {
      if (document.querySelector(selector)) {
        return resolve(document.querySelector(selector));
      }

      const observer = new MutationObserver((mutations) => {
        if (document.querySelector(selector)) {
          resolve(document.querySelector(selector));
          observer.disconnect();
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });

      setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeout);
    });
  }

  /**
   * Check if an element is visible
   */
  isElementVisible(element) {
    if (!element) return false;

    try {
      const style = window.getComputedStyle(element);

      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0"
      ) {
        return false;
      }

      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if a URL has already been processed
   */
  isUrlProcessed(url) {
    // Check local cache
    if (this.state.processedUrls.has(this.normalizeUrl(url))) {
      return true;
    }

    // Check against submitted links
    return (
      this.searchData.submittedLinks?.some((link) =>
        this.isUrlMatch(link.url, url)
      ) || false
    );
  }

  /**
   * Check if two URLs match
   */
  isUrlMatch(url1, url2) {
    if (!url1 || !url2) return false;

    const normalized1 = this.normalizeUrl(url1);
    const normalized2 = this.normalizeUrl(url2);

    return (
      normalized1 === normalized2 ||
      normalized1.includes(normalized2) ||
      normalized2.includes(normalized1)
    );
  }

  /**
   * Normalize a URL for comparison
   */
  normalizeUrl(url) {
    try {
      if (!url) return "";

      // Handle URLs without protocol
      if (!url.startsWith("http")) {
        url = "https://" + url;
      }

      const urlObj = new URL(url);

      // Extract the job ID if present
      const jobIdMatch = url.match(/jk=([^&]+)/);
      if (jobIdMatch && jobIdMatch[1]) {
        return jobIdMatch[1]; // Use job ID as normalized value for Indeed URLs
      }

      // Remove trailing slashes and query parameters
      return (urlObj.origin + urlObj.pathname)
        .toLowerCase()
        .trim()
        .replace(/\/+$/, "");
    } catch (error) {
      return url.toLowerCase().trim();
    }
  }

  /**
   * Start a countdown timer
   */
  startCountDownTimer(duration, callback) {
    try {
      debugLog("Starting countdown timer", { duration });

      // Find or create timer container
      let timerContainer = document.getElementById("indeed-automation-timer");

      if (!timerContainer) {
        timerContainer = document.createElement("div");
        timerContainer.id = "indeed-automation-timer";
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

      // Update timer display function
      const updateTimerDisplay = () => {
        const minutes = Math.floor(timeLeft / 60);
        const seconds = timeLeft % 60;

        // Format as MM:SS
        timerDisplay.textContent = `${minutes
          .toString()
          .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;

        // Change color when time is running low
        if (timeLeft <= 60) {
          timerDisplay.style.color = "#FFA500"; // Orange
        }

        if (timeLeft <= 30) {
          timerDisplay.style.color = "#FF0000"; // Red
        }

        // Decrement time
        timeLeft--;

        // If time's up, execute callback
        if (timeLeft < 0) {
          stop();
          if (typeof callback === "function") {
            debugLog("Countdown timer ended, executing callback");
            callback();
          }
        }
      };

      // Start timer
      updateTimerDisplay();
      timerId = setInterval(updateTimerDisplay, 1000);

      // Stop function
      const stop = () => {
        if (timerId) {
          clearInterval(timerId);
          timerId = null;

          // Hide the timer
          timerContainer.style.display = "none";

          debugLog("Countdown timer stopped");
        }
      };

      // Add time function
      const addTime = (additionalTime) => {
        timeLeft += additionalTime;
        debugLog("Added time to countdown timer", {
          additionalTime,
          newTimeLeft: timeLeft,
        });
        updateTimerDisplay();
      };

      // Return control object
      return { stop, addTime };
    } catch (error) {
      debugLog("Error starting countdown timer", { error: error.toString() });

      // Return dummy object
      return {
        stop: () => {},
        addTime: () => {},
      };
    }
  }

  /**
   * Mark a job card with a color border
   */
  markCardAsColor(card, color, customText) {
    if (!CONFIG.DEBUG) return;

    try {
      if (!card) return;

      // Create highlight container
      const highlight = document.createElement("div");
      highlight.className = "indeed-result-highlight";
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

      // Set text
      let statusText =
        customText ||
        (color === "green"
          ? "Applied"
          : color === "orange"
          ? "Skipped"
          : color === "red"
          ? "Error"
          : color === "blue"
          ? "Processing"
          : "Unknown");

      highlight.textContent = statusText;

      // Give card relative positioning if it doesn't have it
      if (window.getComputedStyle(card).position === "static") {
        card.style.position = "relative";
      }

      // Apply colorful border
      card.style.cssText += `
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

      // Remove any existing highlights
      const existingHighlight = card.querySelector(".indeed-result-highlight");
      if (existingHighlight) {
        existingHighlight.remove();
      }

      // Add highlight
      card.appendChild(highlight);
    } catch (error) {
      errorLog("Error marking card:", error);
    }
  }

  /**
   * Create a status overlay on the page
   */
  createStatusOverlay() {
    // Create container
    const container = document.createElement("div");
    container.id = "indeed-status-overlay";
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

    // Logo/name
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
    this.logContainer.id = "indeed-log-container";
    this.logContainer.style.cssText = `
      margin-top: 10px;
      max-height: 220px;
      overflow-y: auto;
      font-size: 12px;
      line-height: 1.4;
    `;

    // Create timer container
    const timerContainer = document.createElement("div");
    timerContainer.id = "indeed-automation-status-content";
    container.appendChild(timerContainer);

    container.appendChild(this.logContainer);

    // Append to document
    document.body.appendChild(container);

    // Set initial status
    this.updateStatusIndicator("initializing");

    // Add animation style
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

  /**
   * Update the status indicator
   */
  updateStatusIndicator(status, details = "") {
    if (!this.statusIndicator) return;

    let statusText;
    let statusColor;
    let bgColor;

    switch (status) {
      case "initializing":
        statusText = "Initializing";
        statusColor = "#ff9800";
        bgColor = "rgba(255, 152, 0, 0.2)";
        break;
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

  /**
   * Append a status message to the log
   */
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

    // Keep only last 50 messages
    while (this.logContainer.children.length > 50) {
      this.logContainer.removeChild(this.logContainer.firstChild);
    }
  }

  /**
   * Append an error message to the log
   */
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
   * Wait for a specified amount of time
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Debounce a function call
   */
  debounce(key, fn, delay) {
    // Clear existing timer
    if (this.state.debounceTimers[key]) {
      clearTimeout(this.state.debounceTimers[key]);
    }

    // Set new timer
    this.state.debounceTimers[key] = setTimeout(() => {
      delete this.state.debounceTimers[key];
      fn();
    }, delay);
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
   * Verify application status with background script
   */
  async verifyApplicationStatus() {
    return new Promise((resolve) => {
      if (!this.port) {
        this.state.isApplicationInProgress = false;
        resolve(false);
        return;
      }

      const requestId = "status_" + Date.now();
      let resolved = false;

      // Set timeout to prevent hanging
      const timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.state.isApplicationInProgress = false;
          resolve(false);
        }
      }, 3000);

      // Add one-time listener for response
      const responseHandler = (message) => {
        if (
          message.type === "APPLICATION_STATUS" &&
          message.requestId === requestId
        ) {
          // Remove the listener to avoid memory leaks
          if (this.port && this.port.onMessage) {
            try {
              this.port.onMessage.removeListener(responseHandler);
            } catch (e) {
              // Ignore errors removing listener
            }
          }

          clearTimeout(timeoutId);

          if (!resolved) {
            resolved = true;

            // Update application state
            const wasInProgress = this.state.isApplicationInProgress;
            this.state.isApplicationInProgress = message.data.inProgress;

            // Log state change if it happened
            if (wasInProgress !== this.state.isApplicationInProgress) {
              debugLog(
                `Application state changed from ${wasInProgress} to ${this.state.isApplicationInProgress}`
              );

              if (this.state.isApplicationInProgress) {
                this.state.applicationStartTime = Date.now();
                this.updateStatusIndicator("applying");
              } else {
                this.state.applicationStartTime = null;
                this.updateStatusIndicator("ready");
              }
            }

            resolve(this.state.isApplicationInProgress);
          }
        }
      };

      // Add the listener
      if (this.port && this.port.onMessage) {
        this.port.onMessage.addListener(responseHandler);
      }

      // Send the status check request
      this.safeSendMessage({
        type: "CHECK_APPLICATION_STATUS",
        requestId,
      });
    });
  }
}

// Initialize the automation
debugLog("Creating IndeedJobAutomation instance");
const indeedAutomation = new IndeedJobAutomation();

// Add message listener for backward compatibility
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    const { action, type } = message;
    const messageType = action || type;

    switch (messageType) {
      case "SEARCH_NEXT":
        indeedAutomation.handleSearchNext(message.data);
        sendResponse({ success: true });
        break;

      case "startJobSearch":
        if (!message.userId) {
          sendResponse({
            status: "error",
            message: "Missing required user data",
          });
          return;
        }

        // Initialize and start job search
        indeedAutomation
          .initialize(message.userId)
          .then(() => indeedAutomation.performJobSearch())
          .then(() => {
            // Response already sent in method
          })
          .catch((error) => {
            sendResponse({ status: "error", message: error.message });
          });

        // Send immediate response
        sendResponse({ status: "processing" });
        break;

      case "processJobs":
        indeedAutomation
          .startAutomation()
          .then(() => {
            // Response already sent in method
          })
          .catch((error) => {
            sendResponse({ status: "error", message: error.message });
          });
        sendResponse({ status: "processing" });
        break;

      case "checkStatus":
        sendResponse({
          success: true,
          data: {
            initialized: indeedAutomation.state.initialized,
            isApplicationInProgress:
              indeedAutomation.state.isApplicationInProgress,
            processedCount: indeedAutomation.state.processedLinksCount,
            isRunning: indeedAutomation.state.isRunning,
          },
        });
        break;

      case "resetState":
        indeedAutomation.state.isApplicationInProgress = false;
        indeedAutomation.state.applicationStartTime = null;
        indeedAutomation.state.processedUrls = new Set();
        indeedAutomation.state.processedLinksCount = 0;
        indeedAutomation.state.isRunning = false;
        indeedAutomation.updateStatusIndicator("ready");
        indeedAutomation.appendStatusMessage("State reset complete");
        sendResponse({ success: true, message: "State reset" });
        break;

      case "stop":
        indeedAutomation.state.isRunning = false;
        indeedAutomation.appendStatusMessage("Automation stopped by user");
        indeedAutomation.updateStatusIndicator("ready");
        sendResponse({ status: "stopped" });
        break;

      default:
        sendResponse({
          success: false,
          message: `Unknown message type: ${messageType}`,
        });
    }
  } catch (error) {
    console.error("Error handling message:", error);
    sendResponse({ success: false, message: error.message });
  }

  return true; // Keep message channel open for async response
});

// Check for pending applications when the page loads
document.addEventListener("readystatechange", async (event) => {
  if (document.readyState === "complete") {
    await new Promise((resolve) => setTimeout(resolve, 1000));

    try {
      // Get current state
      const state = await indeedAutomation.stateManager.getState();

      console.log("Page loaded, checking for pending tasks");

      // Send pageLoaded message
      chrome.runtime.sendMessage({
        action: "pageLoaded",
        url: window.location.href,
      });

      // Check for pending search
      if (
        state?.pendingSearch &&
        window.location.href.includes("indeed.com/jobs")
      ) {
        console.log("Pending search detected, continuing automation");

        await indeedAutomation.stateManager.updateState({
          pendingSearch: false,
          lastActionTime: new Date().toISOString(),
        });

        // Continue with automation
        setTimeout(() => {
          indeedAutomation.startAutomation();
        }, 2000);
      }

      // Handle application form if detected
      if (
        state?.pendingApplication &&
        (window.location.href.includes("indeed.com/apply") ||
          document.querySelector(".ia-ApplyFormScreen"))
      ) {
        console.log("Application form detected, starting form fill");

        // Reset pending flag
        await indeedAutomation.stateManager.updateState({
          pendingApplication: false,
          lastActionTime: new Date().toISOString(),
        });

        // Start applying
        indeedAutomation.startApplying();
      }
    } catch (error) {
      console.error("Error in page load handler:", error);
    }
  }
});
