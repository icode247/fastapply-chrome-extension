import { WorkableFileHandler } from "@shared/linkedInUtils";
import { WorkableFormHandler } from "./workableFormHandler";
import { HOST } from "@shared/constants";

function debugLog(message, ...args) {
  console.log(`[WorkableApply] ${message}`, ...args);
}

function errorLog(message, error) {
  console.error(`[WorkableApply Error] ${message}`, error);
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
    JOB_LINKS:
      "a[href*='workable.com/j/'], a[href*='workable.com/jobs/'], a[href*='apply.workable.com']",
    GOOGLE_RESULTS:
      "#search .g, #rso .g, div[data-sokoban-container], #rso div[data-hveid], div[data-hveid], .g, .MjjYud, .Gx5Zad",
    NEXT_BUTTON:
      "button.btn-primary, button.btn-submit, button[type='submit'], button.button--primary, button.next-step, button.submit",
    SUCCESS_MESSAGE:
      "div.application-confirmation, div.success-message, h1.success-message, div[class*='success'], div.thank-you, div[class*='thankyou']",
  },
  TIMEOUTS: {
    STANDARD: 2000,
    EXTENDED: 5000,
    MAX_TIMEOUT: 300000, // 5 minutes
  },
  DEBUG: true,
  BRAND_COLOR: "#4a90e2", // FastApply brand blue
};

/**
 * WorkableJobAutomation - Content script for automating Workable job applications
 * with simplified robust communication
 */
class WorkableJobAutomation {
  constructor() {
    debugLog("Initializing WorkableJobAutomation");

    // State tracking
    this.state = {
      initialized: false,
      ready: false,
      isApplicationInProgress: false,
      applicationStartTime: null,
      processedUrls: new Set(),
      processedLinksCount: 0,
      countDown: null,
      lastCheckedUrl: null,
      debounceTimers: {},
    };

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
    this.fileHandler = new WorkableFileHandler({
      show: (message, type) => {
        debugLog(`[${type || "info"}] ${message}`);
        this.appendStatusMessage(message);
      },
    });

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
        /(workable\.com\/(j|jobs)|apply\.workable\.com)/i
      );
      const tabId = Date.now(); // Using timestamp as a unique identifier
      const portName = isApplyPage
        ? `workable-apply-${tabId}`
        : `workable-search-${tabId}`;

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

      // Start processing search results after a short delay
      this.debounce("searchNext", () => this.searchNext(), 1000);
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
          if (window.location.href.includes("google.com/search")) {
            this.debounce("searchNext", () => this.searchNext(), 1000);
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

      // Continue search after a short delay
      this.debounce("searchNext", () => this.searchNext(), 1000);
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
        this.debounce("searchNext", () => this.searchNext(), 1000);
        return;
      }

      const url = data.url;

      // Find and update link status in the page
      const links = this.findAllLinksElements();
      let linkFound = false;

      for (const link of links) {
        if (this.isUrlMatch(link.href, url)) {
          // Update visual status based on result
          if (data.status === "SUCCESS") {
            this.markLinkAsColor(link, "orange", "Completed");
            this.appendStatusMessage("Successfully submitted: " + url);
          } else if (data.status === "ERROR") {
            this.markLinkAsColor(link, "red", "Error");
            this.appendStatusMessage(
              "Error with: " + url + (data.message ? ` - ${data.message}` : "")
            );
          } else {
            this.markLinkAsColor(link, "orange", "Skipped");
            this.appendStatusMessage(
              "Skipped: " + url + (data.message ? ` - ${data.message}` : "")
            );
          }

          linkFound = true;
          break;
        }
      }

      if (!linkFound) {
        debugLog("Link not found in current page:", url);
      }

      // Add to local processed cache
      this.state.processedUrls.add(this.normalizeUrl(url));

      // Continue search after a delay to prevent rapid firing
      this.debounce("searchNext", () => this.searchNext(), 2000);
    } catch (error) {
      errorLog("Error handling search next:", error);
      this.appendStatusErrorMessage(error);

      // Reset application state and continue
      this.state.isApplicationInProgress = false;
      this.state.applicationStartTime = null;

      this.debounce("searchNext", () => this.searchNext(), 5000);
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

    // If we're on a search page, continue after a delay
    if (window.location.href.includes("google.com/search")) {
      this.debounce("searchNext", () => this.searchNext(), 5000);
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

    if (url.includes("google.com/search")) {
      debugLog("On Google search page");
      this.appendStatusMessage("Google search page detected");
      this.safeSendMessage({ type: "GET_SEARCH_TASK" });
    } else if (url.match(/(workable\.com\/(j|jobs)|apply\.workable\.com)/i)) {
      debugLog("On Workable job page");
      this.appendStatusMessage("Workable job page detected");
      this.safeSendMessage({ type: "GET_APPLICATION_TASK" });
    }
  }

  /**
   * Check health of automation and recover if needed
   */
  checkHealth() {
    try {
      // Verify application state with background script
      if (window.location.href.includes("google.com/search")) {
        // On search page, check if application is in progress
        this.safeSendMessage({ type: "CHECK_APPLICATION_STATUS" });
      }

      // Check for stuck application
      if (
        this.state.isApplicationInProgress &&
        this.state.applicationStartTime
      ) {
        const now = Date.now();
        const applicationTime = now - this.state.applicationStartTime;

        // If application has been active for over 5 minutes, it's probably stuck
        if (applicationTime > 5 * 60 * 1000) {
          debugLog(
            "Application appears to be stuck for over 5 minutes, resetting state"
          );

          this.state.isApplicationInProgress = false;
          this.state.applicationStartTime = null;

          this.appendStatusMessage(
            "Application timeout detected - resetting state"
          );
          this.updateStatusIndicator("error");

          if (window.location.href.includes("google.com/search")) {
            // Continue search on search page
            this.debounce("searchNext", () => this.searchNext(), 2000);
          }
        }
      }
    } catch (error) {
      errorLog("Error in health check:", error);
    }
  }

  /**
   * Start application process
   */
  async startApplying() {
    try {
      debugLog("Starting application process");
      this.appendStatusMessage("Starting application process");
      this.updateStatusIndicator("applying");

      // Check if page is valid
      if (
        document.body.innerText.includes("Cannot GET") ||
        document.location.search.includes("not_found=true") ||
        document.body.innerText.includes("Job is no longer available")
      ) {
        throw new SkipApplicationError(
          "Cannot start application: Page error or job no longer available"
        );
      }

      // Set application state
      this.state.isApplicationInProgress = true;
      this.state.applicationStartTime = Date.now();

      // Extract job ID from URL
      const jobId = window.location.pathname.split("/").pop() || "unknown";
      debugLog("Extracted job ID:", jobId);

      // Start countdown timer
      this.state.countDown = this.startCountDownTimer(60 * 5, () => {
        this.safeSendMessage({
          type: "APPLICATION_ERROR",
          data: "Application timed out after 5 minutes",
        });
      });

      // Wait a moment for page to fully load
      await this.wait(3000);

      // Apply for the job
      const applied = await this.apply();

      await this.wait(8000);
      if (applied) {
        // Get job details from page
        const jobTitle =
          document.title.split(" - ")[0] || document.title || "Job on Workable";

        // Extract company name from URL or page
        const companyName =
          this.extractCompanyFromUrl(window.location.href) ||
          document.querySelector('meta[property="og:site_name"]')?.content ||
          "Company on Workable";

        // Try to extract location from the page
        let location = "Not specified";
        const locationEl = document.querySelector(
          '.section--location, .job-location, [data-ui="location"]'
        );
        if (locationEl) {
          location = locationEl.textContent.trim();
        }

        // Send completion message
        this.safeSendMessage({
          type: "APPLICATION_COMPLETED",
          data: {
            jobId,
            title: jobTitle,
            company: companyName,
            location,
            jobUrl: window.location.href,
            salary: "Not specified",
            workplace: "Not specified",
            postedDate: "Not specified",
            applicants: "Not specified",
          },
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
   * Extract job description from Workable job posting page
   * @returns {string} - Formatted job description for AI context
   */
  extractJobDescription() {
    try {
      this.appendStatusMessage("Extracting job description from Workable page");

      // Initialize job details object
      const jobDetails = {
        title: "",
        location: "",
        department: "",
        workplace: "",
        company: "",
      };

      // Extract job title
      const titleElement = document.querySelector('h1[data-ui="job-title"]');
      if (titleElement) {
        jobDetails.title = titleElement.textContent.trim();
        this.appendStatusMessage(`Found job title: ${jobDetails.title}`);
      }

      // Extract workplace type (Remote/Hybrid/Onsite)
      const workplaceElement = document.querySelector(
        'span[data-ui="job-workplace"]'
      );
      if (workplaceElement) {
        jobDetails.workplace = workplaceElement.textContent.trim();
        this.appendStatusMessage(`Workplace type: ${jobDetails.workplace}`);
      }

      // Extract department
      const departmentElement = document.querySelector(
        'span[data-ui="job-department"]'
      );
      if (departmentElement) {
        jobDetails.department = departmentElement.textContent.trim();
        this.appendStatusMessage(`Department: ${jobDetails.department}`);
      }

      // Extract location
      const locationElement = document.querySelector(
        'div[data-ui="job-location"]'
      );
      if (locationElement) {
        jobDetails.location = locationElement.textContent.trim();
        this.appendStatusMessage(`Location: ${jobDetails.location}`);
      }

      // Extract company name from logo alt text
      const logoElement = document.querySelector("img[alt]");
      if (logoElement && logoElement.alt) {
        jobDetails.company = logoElement.alt.trim();
      }

      // If no company name found from logo, try extracting from URL
      if (!jobDetails.company) {
        const companyMatch = window.location.hostname.match(
          /([^\.]+)\.workable\.com/i
        );
        if (companyMatch && companyMatch[1]) {
          jobDetails.company = companyMatch[1].replace(/-/g, " ");
          // Capitalize the company name
          jobDetails.company = jobDetails.company
            .split(" ")
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(" ");
        }
      }

      // Fallback extraction for critical fields if specific selectors failed
      if (!jobDetails.title) {
        const h1Elements = document.querySelectorAll("h1");
        for (const h1 of h1Elements) {
          if (h1.textContent.length > 5 && h1.textContent.length < 100) {
            jobDetails.title = h1.textContent.trim();
            this.appendStatusMessage(
              `Found fallback title: ${jobDetails.title}`
            );
            break;
          }
        }
      }

      // If still no title, use document title
      if (!jobDetails.title) {
        jobDetails.title =
          document.title.split("-")[0]?.trim() || document.title;
        this.appendStatusMessage(`Using document title: ${jobDetails.title}`);
      }

      // Format the details into a single job description string for AI context
      const formattedDescription = `
Job Title: ${jobDetails.title}
Company: ${jobDetails.company}
Location: ${jobDetails.location}
Department: ${jobDetails.department}
Workplace Type: ${jobDetails.workplace}`.trim();

      debugLog(
        "Extracted job description length: " + formattedDescription.length
      );
      return formattedDescription;
    } catch (error) {
      errorLog("Error extracting job description:", error);
      this.appendStatusMessage(
        `Error extracting job details: ${error.message}`
      );

      // Return minimal info even if extraction fails
      return `Job Title: ${document.title || "Job Position"}`;
    }
  }

  /**
   * Apply for the job >
   */
  async apply() {
    try {
      this.appendStatusMessage("Starting to apply for job");

      // Check if we're on an apply page by looking for form
      const form = this.findApplicationForm();
      if (!form) {
        this.appendStatusMessage("Looking for 'Apply' button on job page");

        // This might be a job details page, not the application form
        const applyButtons = Array.from(
          document.querySelectorAll("a, button")
        ).filter((el) => {
          const text = el.textContent.toLowerCase().trim();
          return (
            text === "apply" ||
            text === "apply for this job" ||
            text === "apply now" ||
            text.includes("apply for") ||
            el.classList.contains("apply-button") ||
            el.classList.contains("careers-apply-button")
          );
        });

        if (applyButtons.length > 0) {
          this.appendStatusMessage("Found 'Apply' button, clicking it");
          applyButtons[0].click();

          // Wait for page to load
          await this.wait(5000);

          // Try to find the form again
          const retryForm = this.findApplicationForm();
          if (!retryForm) {
            throw new SkipApplicationError(
              "Cannot find application form after clicking Apply button"
            );
          }

          // Get profile data if not already loaded
          if (!this.profile) {
            this.profile = await this.getProfileData();
          }

          // Extract job description >
          const jobDescription = this.extractJobDescription();
          console.log(jobDescription);
          // Process the form
          const result = await this.processApplicationForm(
            retryForm,
            this.profile,
            jobDescription
          );
          this.appendStatusMessage(
            "Form submission result: " + (result ? "SUCCESS" : "FAILED")
          );
          return result;
        } else {
          throw new SkipApplicationError(
            "Cannot find application form or Apply button"
          );
        }
      }

      // Get profile data if not already loaded
      if (!this.profile) {
        this.profile = await this.getProfileData();
      }

      // Extract job description
      const jobDescription = this.extractJobDescription();

      // Process the form
      const result = await this.processApplicationForm(
        form,
        this.profile,
        jobDescription
      );
      this.appendStatusMessage(
        "Form submission result: " + (result ? "SUCCESS" : "FAILED")
      );
      return result;
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
   * Process the application form
   */
  async processApplicationForm(form, profile, jobDescription) {
    this.appendStatusMessage("Found application form, beginning to fill out");

    try {
      // Get the API host
      const aiApiHost = HOST || "https://fastapply.co";

      // Initialize form handler
      this.formHandler = new WorkableFormHandler({
        logger: (message) => this.appendStatusMessage(message),
        host: aiApiHost,
        userData: profile,
        jobDescription,
      });

      // 1. Handle file uploads (resume)
      await this.fileHandler.handleResumeUpload(profile, form);

      // 2. Fill out phone number
      await this.handlePhoneInputWithCountryCode(form, profile);

      // 3. Handle custom select with modal
      await this.handleCustomSelectWithModal(form, profile);

      // 4. Fill out form fields using AI-enhanced WorkableFormHandler
      await this.formHandler.fillFormWithProfile(form, profile);

      // 5. Handle required checkboxes
      await this.formHandler.handleRequiredCheckboxes(form);

      // 6. Find submit button
      const submitButton = this.formHandler.findSubmitButton(form);
      if (!submitButton) {
        throw new ApplicationError("Cannot find submit button");
      }

      // 7. Submit the form
      const submitted = await this.formHandler.submitForm(form);
      return submitted;
    } catch (error) {
      errorLog("Error processing application form:", error);
      this.appendStatusErrorMessage(
        "Error processing form: " + this.errorToString(error)
      );
      return false;
    }
  }

  /**
   * Handle phone input with country code
   */
  async handlePhoneInputWithCountryCode(form, profile) {
    try {
      this.appendStatusMessage("Handling phone input with country code");

      // Make sure we have phone data
      if (!profile.phone && !profile.phoneNumber) {
        this.appendStatusMessage("No phone number available in profile");
        return false;
      }

      const phoneNumber = profile.phone || profile.phoneNumber;
      const phoneCountryCode = profile.phoneCountryCode;

      this.appendStatusMessage(
        `Setting phone: ${phoneNumber} with country code: ${
          phoneCountryCode || "default"
        }`
      );

      // Find phone input field
      const phoneInput = form.querySelector(
        'input[name="phone"], input[type="tel"]'
      );
      if (!phoneInput) {
        this.appendStatusMessage("No phone input field found");
        return false;
      }

      // Find country selector dropdown
      const countrySelector = phoneInput.parentElement.querySelector(
        ".iti__selected-flag"
      );
      if (!countrySelector) {
        this.appendStatusMessage(
          "No country selector found, setting direct phone number"
        );
        await this.setPhoneValue(phoneInput, phoneNumber);
        return true;
      }

      await this.wait(300);
      countrySelector.click();
      await this.wait(500);

      // Get dropdown list
      const countryList = document.querySelector(".iti__country-list");
      if (!countryList) {
        this.appendStatusMessage(
          "Country dropdown not found, setting direct phone number"
        );
        await this.setPhoneValue(phoneInput, phoneNumber);
        return true;
      }

      // Get all country items and extract codes
      const countryItems = countryList.querySelectorAll("li.iti__country");
      const countryCodesMap = {};

      for (const item of countryItems) {
        const codeSpan = item.querySelector(".iti__dial-code");
        if (codeSpan) {
          const code = codeSpan.textContent.trim();
          countryCodesMap[code] = item;
        }
      }

      // Find matching country code
      let targetItem = null;
      let selectedCountryCode = null;

      if (phoneCountryCode) {
        // Make sure it has the plus sign
        const formattedCode = phoneCountryCode.startsWith("+")
          ? phoneCountryCode
          : `+${phoneCountryCode}`;

        targetItem = countryCodesMap[formattedCode];
        selectedCountryCode = formattedCode;
      }

      if (targetItem) {
        // Click the matching country code
        this.appendStatusMessage(
          `Selecting country code: ${selectedCountryCode}`
        );
        targetItem.click();
        await this.wait(300);

        // Process phone number to remove country code if present
        let phoneNumberWithoutCode = phoneNumber;

        if (
          selectedCountryCode &&
          phoneNumber.startsWith(selectedCountryCode)
        ) {
          phoneNumberWithoutCode = phoneNumber
            .substring(selectedCountryCode.length)
            .trim()
            .replace(/^[\s\-\(\)]+/, "");
        } else if (phoneNumber.startsWith("+")) {
          // Extract and remove any country code
          const genericCodeMatch = phoneNumber.match(/^\+\d{1,4}/);
          if (genericCodeMatch) {
            phoneNumberWithoutCode = phoneNumber
              .substring(genericCodeMatch[0].length)
              .trim()
              .replace(/^[\s\-\(\)]+/, "");
          }
        }

        this.appendStatusMessage(
          `Setting phone number part: ${phoneNumberWithoutCode}`
        );
        await this.setPhoneValue(phoneInput, phoneNumberWithoutCode);
      } else {
        // No matching country found, set full phone number
        this.appendStatusMessage(
          "No matching country code found, setting full phone number"
        );
        await this.setPhoneValue(phoneInput, phoneNumber);
      }

      return true;
    } catch (error) {
      this.appendStatusMessage(`Error handling phone field: ${error.message}`);
      return false;
    }
  }

  /**
   * Method for setting phone input values
   */
  async setPhoneValue(input, value) {
    if (!input || value === undefined) return;

    try {
      // Wait briefly
      await this.wait(200);

      // Focus input
      input.focus();
      await this.wait(100);

      // Clear existing value
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await this.wait(100);

      // Set new value
      input.value = value;

      // Dispatch events
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.dispatchEvent(new Event("blur", { bubbles: true }));

      // For international phone input
      if (input.classList.contains("iti__tel-input")) {
        setTimeout(() => {
          input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
        }, 100);
      }

      await this.wait(200);

      // Verify value set correctly
      if (input.value !== value) {
        this.appendStatusMessage(
          "Value didn't set correctly, trying alternative method"
        );

        // Direct approach as fallback
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value"
        ).set;

        nativeInputValueSetter.call(input, value);

        // Dispatch synthetic input event
        const event = new Event("input", { bubbles: true });
        input.dispatchEvent(event);

        await this.wait(100);
        this.appendStatusMessage(`Final value: ${input.value}`);
      }
    } catch (error) {
      this.appendStatusMessage(`Error setting phone value: ${error.message}`);
    }
  }

  /**
   * Handle custom select fields that use modals
   */
  async handleCustomSelectWithModal(form, profile) {
    try {
      // Find custom selects
      const customSelects = form.querySelectorAll(
        'input[role="combobox"][aria-owns]'
      );

      for (const element of customSelects) {
        // Get listbox ID
        const listboxId = element.getAttribute("aria-owns");
        if (!listboxId) {
          this.appendStatusMessage(
            `No listbox ID found for element ${element.id}`
          );
          continue;
        }

        // Get question text
        const labelId = element.getAttribute("aria-labelledby");
        const labelElement = labelId ? document.getElementById(labelId) : null;
        const question = labelElement
          ? labelElement.textContent.trim()
          : "Select an option";

        // Click to open modal
        element.click();
        await this.wait(500);

        // Find listbox
        const listbox = document.getElementById(listboxId);
        if (!listbox) {
          this.appendStatusMessage(`No listbox found for ${listboxId}`);
          continue;
        }

        // Extract options
        const options = [];
        const optionElements = listbox.querySelectorAll('[role="option"]');
        optionElements.forEach((opt) => {
          const span = opt.querySelector("span.styles--f-uLT");
          if (span) options.push(span.textContent.trim());
        });

        // Close modal
        element.click();
        await this.wait(300);

        // Skip if no options
        if (options.length === 0) {
          this.appendStatusMessage(`No options found for listbox ${listboxId}`);
          continue;
        }

        // Request AI to choose best option
        let valueToSelect = "N/A - Does not apply to me";
        try {
          const response = await fetch(`${HOST}/api/ai-answer`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              question,
              options,
              userData: profile,
              description: "",
            }),
          });

          if (!response.ok) {
            throw new Error(`AI service error: ${response.status}`);
          }

          const data = await response.json();
          valueToSelect = data.answer;
        } catch (aiError) {
          this.appendStatusMessage(
            `AI selection failed for ${question}: ${aiError.message}`
          );
        }

        // Reopen modal and select option
        element.click();
        await this.wait(500);

        const updatedListbox = document.getElementById(listboxId);
        if (updatedListbox) {
          const valueStr = String(valueToSelect).toLowerCase();
          const optionsToSelect =
            updatedListbox.querySelectorAll('[role="option"]');

          let optionSelected = false;
          for (const option of optionsToSelect) {
            const span = option.querySelector("span.styles--f-uLT");
            if (span) {
              const optionText = span.textContent.toLowerCase();
              if (
                optionText === valueStr ||
                optionText.includes(valueStr) ||
                valueStr.includes(optionText)
              ) {
                option.click();
                await this.wait(300);
                optionSelected = true;
                break;
              }
            }
          }

          // Select first option as fallback
          if (!optionSelected && optionsToSelect.length > 0) {
            optionsToSelect[0].click();
            await this.wait(300);
            this.appendStatusMessage(
              `No matching option for "${valueToSelect}", selected first option`
            );
          }
        }
      }
    } catch (error) {
      this.appendStatusMessage(
        `Error handling custom select with modal: ${error.message}`
      );
    }
  }

  /**
   * Extract company name from URL
   */
  extractCompanyFromUrl(url) {
    try {
      // Pattern: https://[company].workable.com/j/...
      const matches = url.match(/\/\/([^\.]+)\.workable\.com\//);
      if (matches && matches[1]) {
        return matches[1].charAt(0).toUpperCase() + matches[1].slice(1); // Capitalize
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Find application form on the page
   */
  findApplicationForm() {
    // Try specific Workable form selectors
    const formSelectors = [
      ".application-form",
      'form[action*="workable"]',
      'form[action*="apply"]',
      'form[action*="jobs"]',
      "form.whr-form",
      "form#application-form",
      "form",
    ];

    // Create form handler if needed
    if (!this.formHandler) {
      this.formHandler = new WorkableFormHandler({
        logger: (message) => this.appendStatusMessage(message),
      });
    }

    // Try each selector
    for (const selector of formSelectors) {
      const forms = document.querySelectorAll(selector);
      if (forms.length) {
        for (const form of forms) {
          if (this.formHandler.isElementVisible(form)) {
            return form;
          }
        }
      }
    }

    // Try any form with input fields
    const allForms = document.querySelectorAll("form");
    for (const form of allForms) {
      if (
        this.formHandler.isElementVisible(form) &&
        form.querySelectorAll("input, select, textarea").length > 0
      ) {
        return form;
      }
    }

    return null;
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
        url: window.location.href,
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
   * Find all job link elements on the page
   */
  findAllLinksElements() {
    try {
      const domains = Array.isArray(this.searchData.domain)
        ? this.searchData.domain
        : [this.searchData.domain];

      if (!domains || domains.length === 0) {
        debugLog("No domains specified for link search");
        return [];
      }

      // Create combined selector for all domains
      const selectors = domains.map((domain) => {
        const cleanDomain = domain
          .replace(/^https?:\/\//, "")
          .replace(/\/$/, "");
        return `#rso a[href*="${cleanDomain}"], #botstuff a[href*="${cleanDomain}"]`;
      });

      const selector = selectors.join(",");
      const links = document.querySelectorAll(selector);

      return Array.from(links);
    } catch (error) {
      errorLog("Error finding links:", error);
      return [];
    }
  }

  /**
   * Find the "More results" button
   */
  findLoadMoreElement() {
    try {
      // Check if on last page
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

      // Method 3: Try navigation buttons at bottom
      const navLinks = [
        ...document.querySelectorAll(
          '#botstuff table a[href^="/search?q=site:"]'
        ),
      ];

      // Return the last one
      return navLinks[navLinks.length - 1];
    } catch (error) {
      errorLog("Error finding load more button:", error);
      return null;
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
    return this.searchData.submittedLinks.some((link) =>
      this.isUrlMatch(link.url, url)
    );
  }

  /**
   * Check if a URL is a valid Workable job link
   */
  isValidWorkableJobLink(url) {
    if (!url) return false;

    return /https?:\/\/(?:[^.]+\.workable\.com\/(?:j|jobs)\/|apply\.workable\.com\/[^\/]+\/j\/)[A-Za-z0-9]+/.test(
      url
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
      let timerContainer = document.getElementById("workable-automation-timer");

      if (!timerContainer) {
        timerContainer = document.createElement("div");
        timerContainer.id = "workable-automation-timer";
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
   * Mark a link with a color border
   */
  markLinkAsColor(linkEl, color, customText) {
    if (!CONFIG.DEBUG) return;

    try {
      if (!linkEl || !linkEl.parentElement) return;

      // Clean up existing highlights
      const existingHighlight = linkEl.parentElement.querySelector(
        ".workable-result-highlight"
      );
      if (existingHighlight) {
        existingHighlight.remove();
      }

      // Create highlight container
      const highlight = document.createElement("div");
      highlight.className = "workable-result-highlight";
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
          ? "In Progress"
          : color === "orange"
          ? "Completed"
          : color === "red"
          ? "Skipped"
          : color === "blue"
          ? "Next"
          : "Unknown");

      highlight.textContent = statusText;

      // Apply colorful border
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

      // Add highlight
      linkEl.parentElement.appendChild(highlight);

      // Style the link
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
    } catch (error) {
      errorLog("Error marking link:", error);
    }
  }

  /**
   * Create a status overlay on the page
   */
  createStatusOverlay() {
    // Create container
    const container = document.createElement("div");
    container.id = "workable-status-overlay";
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
    this.logContainer.id = "workable-log-container";
    this.logContainer.style.cssText = `
      margin-top: 10px;
      max-height: 220px;
      overflow-y: auto;
      font-size: 12px;
      line-height: 1.4;
    `;

    // Create timer container
    const timerContainer = document.createElement("div");
    timerContainer.id = "workable-automation-status-content";
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
  wait(ms) {
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
   * Modified searchNext() function to fix the race condition and communication issues
   */
  async searchNext() {
    try {
      debugLog("Executing searchNext");

      // Skip if not ready or an application is in progress
      if (!this.state.ready || !this.state.initialized) {
        debugLog("Not ready or initialized yet, delaying search");
        this.debounce("searchNext", () => this.searchNext(), 1000);
        return;
      }

      // First check application status with background script
      await this.verifyApplicationStatus();

      // Skip if an application is now in progress
      if (this.state.isApplicationInProgress) {
        debugLog("Application in progress, not searching for next link");
        this.appendStatusMessage(
          "Application in progress, waiting to complete..."
        );
        return;
      }

      this.appendStatusMessage("Searching for job links...");
      this.updateStatusIndicator("searching");

      // Find matching links
      const links = this.findAllLinksElements();
      debugLog(`Found ${links.length} links`);

      // If no links, try to load more
      if (links.length === 0) {
        debugLog("No links found, trying to load more");
        this.appendStatusMessage("No links found, trying to load more...");

        // Double-check application status
        await this.verifyApplicationStatus();
        if (this.state.isApplicationInProgress) {
          return;
        }

        await this.wait(1000);

        // Find and click "More results" button
        const loadMoreBtn = this.findLoadMoreElement();
        if (loadMoreBtn) {
          // Final check before clicking
          await this.verifyApplicationStatus();
          if (this.state.isApplicationInProgress) {
            return;
          }

          this.appendStatusMessage('Clicking "More results" button');
          loadMoreBtn.click();
          await this.wait(3000);

          // Refresh search task data
          this.safeSendMessage({ type: "GET_SEARCH_TASK" });
          return;
        } else {
          this.appendStatusMessage("No more results to load");
          this.safeSendMessage({ type: "SEARCH_COMPLETED" });
          return;
        }
      }

      // Track whether we found an unprocessed link
      let foundUnprocessedLink = false;

      // First pass: mark all processed links
      for (const link of links) {
        // Skip Google search result links
        if (this.isGoogleSearchUrl(link.href)) {
          continue;
        }

        const url = this.normalizeUrl(link.href);

        // Check if already processed
        const isProcessed = this.isUrlProcessed(url);

        if (isProcessed) {
          // Mark as already processed
          const processedLink = this.searchData.submittedLinks.find((link) =>
            this.isUrlMatch(link.url, url)
          );

          if (processedLink && processedLink.status === "SUCCESS") {
            this.markLinkAsColor(link, "orange", "Completed");
          } else if (processedLink && processedLink.status === "ERROR") {
            this.markLinkAsColor(link, "red", "Error");
          } else {
            this.markLinkAsColor(link, "orange", "Processed");
          }

          this.appendStatusMessage(`Skipping already processed: ${url}`);
          continue;
        }

        // Check if valid Workable job link
        if (!this.isValidWorkableJobLink(link.href)) {
          debugLog(`Link ${url} is not a valid Workable job link`);
          this.markLinkAsColor(link, "red", "Invalid");

          // Add to processed URLs
          this.state.processedUrls.add(url);

          this.appendStatusMessage(`Skipping invalid job link: ${url}`);
          continue;
        }

        // Found an unprocessed valid link
        foundUnprocessedLink = true;
      }

      // Check application status again before second pass
      await this.verifyApplicationStatus();
      if (this.state.isApplicationInProgress) {
        return;
      }

      // Second pass: find first unprocessed valid link
      for (const link of links) {
        // Skip Google search result links
        if (this.isGoogleSearchUrl(link.href)) {
          continue;
        }

        const url = this.normalizeUrl(link.href);

        // Skip if already processed
        if (this.isUrlProcessed(url)) {
          continue;
        }

        // Skip if not a valid Workable job link
        if (!this.isValidWorkableJobLink(link.href)) {
          continue;
        }

        // Found an unprocessed valid link - process it
        this.appendStatusMessage("Found job to apply: " + url);

        // Final check before proceeding
        await this.verifyApplicationStatus();
        if (this.state.isApplicationInProgress) {
          return;
        }

        // Mark as processing and add to cache immediately to prevent double processing
        this.markLinkAsColor(link, "green", "In Progress");
        this.state.processedUrls.add(url);
        this.state.lastCheckedUrl = url;

        // Request to start application
        try {
          const response = await this.requestStartApplication(
            link.href,
            link.textContent.trim() || "Job Application"
          );

          if (response && response.success) {
            // Application started successfully - flag already set by handleApplicationStarting
            foundUnprocessedLink = true;
            return;
          } else if (response && response.duplicate) {
            // Job was already processed (race condition)
            this.markLinkAsColor(link, "orange", "Duplicate");
            this.appendStatusMessage(`Job was already processed: ${url}`);
            // Continue to next link
          } else {
            // Error starting application
            this.markLinkAsColor(link, "red", "Error");
            this.appendStatusMessage(
              `Error starting application: ${
                response?.message || "Unknown error"
              }`
            );
            // Continue to next link
          }
        } catch (error) {
          // Error in request - mark link and continue
          this.markLinkAsColor(link, "red", "Error");
          this.appendStatusMessage(
            `Failed to start application: ${error.message}`
          );
          errorLog("Error requesting start application:", error);
        }
      }

      // If we couldn't find any unprocessed links
      if (!foundUnprocessedLink) {
        // Check application status before navigation
        await this.verifyApplicationStatus();
        if (this.state.isApplicationInProgress) {
          return;
        }

        // Try to load more results
        this.appendStatusMessage(
          "No new job links found, trying to load more..."
        );
        const loadMoreBtn = this.findLoadMoreElement();

        if (loadMoreBtn) {
          // Final check before clicking
          await this.verifyApplicationStatus();
          if (this.state.isApplicationInProgress) {
            return;
          }

          // Click "More results" and wait
          this.appendStatusMessage('Clicking "More results" button');
          loadMoreBtn.click();

          // Check again after page loads
          setTimeout(() => {
            if (!this.state.isApplicationInProgress) {
              this.searchNext();
            }
          }, 3000);
        } else {
          // No more results and no unprocessed links - we're done
          this.appendStatusMessage("All jobs processed, search completed!");
          this.safeSendMessage({ type: "SEARCH_COMPLETED" });
        }
      }
    } catch (error) {
      errorLog("Error in searchNext:", error);
      this.appendStatusErrorMessage(error);

      // Reset application state on error
      this.state.isApplicationInProgress = false;
      this.state.applicationStartTime = null;

      // Try again after a delay
      setTimeout(() => this.searchNext(), 5000);
    }
  }

  /**
   * Request to start an application with promise-based response
   */
  requestStartApplication(url, title) {
    return new Promise((resolve, reject) => {
      // Create a unique ID for this request
      const requestId =
        "req_" + Date.now() + "_" + Math.random().toString(36).substring(2, 9);

      // Store the resolver
      this.pendingResponses = this.pendingResponses || {};
      this.pendingResponses[requestId] = { resolve, reject };

      // Set timeout to prevent hanging
      const timeoutId = setTimeout(() => {
        if (this.pendingResponses[requestId]) {
          delete this.pendingResponses[requestId];
          reject(new Error("Request timed out after 10 seconds"));
        }
      }, 10000);

      // Send the message
      this.safeSendMessage({
        type: "START_APPLICATION",
        requestId,
        data: {
          url,
          title,
        },
      });

      // Add listener for this specific request if not already added
      if (!this.hasAddedResponseListener) {
        this.hasAddedResponseListener = true;

        // Add a message listener for responses
        chrome.runtime.onMessage.addListener(
          (message, sender, sendResponse) => {
            if (
              message.type === "APPLICATION_START_RESPONSE" &&
              message.requestId &&
              this.pendingResponses[message.requestId]
            ) {
              // Clear timeout
              clearTimeout(this.pendingResponses[message.requestId].timeoutId);

              // Resolve or reject based on response
              if (message.success) {
                this.pendingResponses[message.requestId].resolve(message);
              } else {
                this.pendingResponses[message.requestId].resolve(message); // Still resolve but with error info
              }

              // Remove from pending responses
              delete this.pendingResponses[message.requestId];

              // Return true to keep the channel open for async response
              return true;
            }
          }
        );
      }
    });
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

  /**
   * Check if a URL is a Google search page URL
   */
  isGoogleSearchUrl(url) {
    return (
      url &&
      (url.startsWith("https://www.google.com/search") ||
        url.startsWith("https://google.com/search") ||
        url.startsWith("http://www.google.com/search") ||
        url.startsWith("http://google.com/search"))
    );
  }
}


// Initialize the automation
debugLog("Creating WorkableJobAutomation instance");
const workableAutomation = new WorkableJobAutomation();

// Add message listener for backward compatibility
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    const type = message.type || message.action;

    switch (type) {
      case "SEARCH_NEXT":
        workableAutomation.handleSearchNext(message.data);
        sendResponse({ success: true });
        break;

      case "checkStatus":
        sendResponse({
          success: true,
          data: {
            initialized: workableAutomation.state.initialized,
            isApplicationInProgress:
              workableAutomation.state.isApplicationInProgress,
            processedCount: workableAutomation.state.processedLinksCount,
          },
        });
        break;

      case "resetState":
        workableAutomation.state.isApplicationInProgress = false;
        workableAutomation.state.applicationStartTime = null;
        workableAutomation.state.processedUrls = new Set();
        workableAutomation.state.processedLinksCount = 0;
        workableAutomation.updateStatusIndicator("ready");
        workableAutomation.appendStatusMessage("State reset complete");
        sendResponse({ success: true, message: "State reset" });
        break;

      default:
        sendResponse({
          success: false,
          message: `Unknown message type: ${type}`,
        });
    }
  } catch (error) {
    console.error("Error handling message:", error);
    sendResponse({ success: false, message: error.message });
  }

  return true; // Keep message channel open for async response
});
