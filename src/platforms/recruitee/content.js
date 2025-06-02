import { RecruiteeFileHandler } from "@shared/linkedInUtils";
import { RecruiteeFormHandler } from "./recruiteeFormHandler";
import { HOST } from "@shared/constants";

// Debugging helpers
function debugLog(message, ...args) {
  console.log(`[RecruiteeApply] ${message}`, ...args);
}

function errorLog(message, error) {
  console.error(`[RecruiteeApply Error] ${message}`, error);
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
    JOB_LINKS: "a[href*='recruitee.com/o/'], a[href*='recruitee.com/career/']",
    GOOGLE_RESULTS:
      "#search .g, #rso .g, div[data-sokoban-container], #rso div[data-hveid], div[data-hveid], .g, .MjjYud, .Gx5Zad",
    NEXT_BUTTON:
      "button.btn-primary, button.btn-submit, button[type='submit'], button.button--primary, button.next-step, button.submit, button[data-ui='next'], button.c-button--primary",
    SUCCESS_MESSAGE:
      "div.application-confirmation, div.success-message, h1.success-message, div[class*='success'], div.thank-you, div[class*='thankyou'], div.c-application__done",
    APPLY_BUTTON:
      "a.c-button--primary, a.c-button--apply, a.cta-button, button.c-button--apply",
    FORM: "form.c-form, form#new_job_application, form.careers-form, form.application-form",
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
 * RecruiteeJobAutomation - Content script for automating Recruitee job applications
 * with simplified robust communication
 */
class RecruiteeJobAutomation {
  constructor() {
    debugLog("Initializing RecruiteeJobAutomation");

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
    this.fileHandler = new RecruiteeFileHandler({
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
        /(recruitee\.com\/(o|career))/i
      );
      const tabId = Date.now(); // Using timestamp as a unique identifier
      const portName = isApplyPage
        ? `recruitee-apply-${tabId}`
        : `recruitee-search-${tabId}`;

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
    } else if (url.match(/(recruitee\.com\/(o|career))/i)) {
      debugLog("On Recruitee job page");
      this.appendStatusMessage("Recruitee job page detected");
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
        document.body.innerText.includes("404 Not Found") ||
        document.body.innerText.includes("No longer available")
      ) {
        throw new SkipApplicationError(
          "Cannot start application: Page error or job no longer available"
        );
      }

      // Set application state
      this.state.isApplicationInProgress = true;
      this.state.applicationStartTime = Date.now();

      // Extract job ID from URL
      const urlParts = window.location.pathname.split("/");
      const jobId = urlParts[urlParts.length - 1] || "unknown";
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

      // Check if we're on a job details page or application form page
      const applyButton = document.querySelector(CONFIG.SELECTORS.APPLY_BUTTON);
      if (applyButton) {
        this.appendStatusMessage("Found apply button, clicking it");
        applyButton.click();
        await this.wait(3000);
      }

      // Apply for the job
      const applied = await this.apply();

      if (applied) {
        // Get job details from page
        const jobTitle =
          document.querySelector("h1")?.textContent.trim() ||
          document.title.split(" - ")[0] ||
          document.title ||
          "Job on Recruitee";

        // Extract company name from URL or page
        const companyName =
          this.extractCompanyFromUrl(window.location.href) ||
          document.querySelector('meta[property="og:site_name"]')?.content ||
          "Company on Recruitee";

        // Try to extract location from the page
        let location = "Not specified";
        const locationEl = document.querySelector(
          '.job-location, .c-job__info-item, [data-ui="location"]'
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
   * Apply for the job
   */
  async apply() {
    try {
      this.appendStatusMessage("Starting to apply for job");

      // Check if we're on an apply page by looking for form
      const form = this.findApplicationForm();
      if (!form) {
        throw new SkipApplicationError("Cannot find application form");
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
      this.formHandler = new RecruiteeFormHandler({
        logger: (message) => this.appendStatusMessage(message),
        host: aiApiHost,
        userData: profile,
        jobDescription,
      });

      // Handle multi-step form if present
      const isMultiStep = form.querySelector(".c-step, .steps-indicator");

      if (isMultiStep) {
        return await this.handleMultiStepForm(form, profile, jobDescription);
      }

      // 1. Handle file uploads (resume)
      // await this.fileHandler.handleResumeUpload(profile, form);

      // 2. Fill out form fields using AI-enhanced RecruiteeFormHandler
      // await this.formHandler.fillFormWithProfile(form, profile);

      // 3. Handle required checkboxes
      // await this.formHandler.handleRequiredCheckboxes(form);

      // 5. Submit the form
      return await this.formHandler.submitForm(form);
    } catch (error) {
      errorLog("Error processing application form:", error);
      this.appendStatusErrorMessage(
        "Error processing form: " + this.errorToString(error)
      );
      return false;
    }
  }

  /**
   * Handle multi-step application form
   */
  async handleMultiStepForm(form, profile, jobDescription) {
    this.appendStatusMessage("Detected multi-step application form");

    try {
      // Get the API host
      const aiApiHost = HOST || "https://fastapply.co";

      // Initialize form handler if not already done
      if (!this.formHandler) {
        this.formHandler = new RecruiteeFormHandler({
          logger: (message) => this.appendStatusMessage(message),
          host: aiApiHost,
          userData: profile,
          jobDescription,
        });
      }

      // Handle resume upload - typically on first step
      await this.fileHandler.handleResumeUpload(profile, form);

      // Process each step until we reach the end
      let isComplete = false;
      let stepCount = 0;
      const maxSteps = 10; // Safety limit

      while (!isComplete && stepCount < maxSteps) {
        stepCount++;
        this.appendStatusMessage(`Processing form step ${stepCount}`);

        // Fill out visible form fields
        await this.formHandler.fillFormWithProfile(form, profile);

        // Handle required checkboxes
        await this.formHandler.handleRequiredCheckboxes(form);

        // Find next/submit button
        const nextButton = this.formHandler.findSubmitButton(form);
        if (!nextButton) {
          throw new ApplicationError(
            `Cannot find next/submit button on step ${stepCount}`
          );
        }

        // Click the button
        this.appendStatusMessage(
          `Clicking next/submit button on step ${stepCount}`
        );
        nextButton.click();

        // Wait for page to update
        await this.wait(3000);

        // Check if we're done
        const successMessage = document.querySelector(
          CONFIG.SELECTORS.SUCCESS_MESSAGE
        );
        if (successMessage) {
          this.appendStatusMessage(
            "Found success message, application complete"
          );
          isComplete = true;
          return true;
        }

        // Check if there was an error
        const errorMessage = document.querySelector(
          ".error-message, .field_with_errors, .invalid-feedback"
        );
        if (errorMessage) {
          this.appendStatusMessage(
            `Error on step ${stepCount}: ${errorMessage.textContent.trim()}`
          );
          // Try to fix the error and continue
        }

        // Find form again (might have changed)
        form = this.findApplicationForm();
        if (!form) {
          this.appendStatusMessage(
            "Form no longer found, checking if application completed"
          );
          // Check alternative success indicators
          if (
            document.body.textContent.includes("Thank you") ||
            document.body.textContent.includes("Successfully")
          ) {
            isComplete = true;
            return true;
          } else {
            throw new ApplicationError(
              "Form disappeared without success message"
            );
          }
        }
      }

      if (stepCount >= maxSteps) {
        throw new ApplicationError("Exceeded maximum number of form steps");
      }

      return isComplete;
    } catch (error) {
      errorLog("Error in multi-step form:", error);
      throw error;
    }
  }

  /**
   * Extract job description from page
   */
  extractJobDescription() {
    try {
      this.appendStatusMessage("Extracting job description");
      let description = "";

      // Try various selectors specific to Recruitee
      const descriptionSelectors = [
        ".c-job__description",
        ".job-description",
        ".description",
        '[data-ui="job-description"]',
        ".vacancy-description",
        "#job-details",
      ];

      for (const selector of descriptionSelectors) {
        const descElement = document.querySelector(selector);
        if (descElement) {
          description = descElement.textContent.trim();
          break;
        }
      }

      // Fallback to main content
      if (!description) {
        const mainContent = document.querySelector(
          "main, #content, .content, .job-content"
        );
        if (mainContent) {
          description = mainContent.textContent.trim();
        }
      }

      // Title and company as fallback
      if (!description) {
        const jobTitle = document.title || "";
        const companyName =
          this.extractCompanyFromUrl(window.location.href) || "";
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
   * Extract company name from URL
   */
  extractCompanyFromUrl(url) {
    try {
      // Pattern for Recruitee URLs
      const matches = url.match(/\/\/(.+?)\.recruitee\.com\//);
      if (matches && matches[1]) {
        return (
          matches[1].charAt(0).toUpperCase() +
          matches[1].slice(1).replace(/-/g, " ")
        ); // Capitalize and replace hyphens
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
    // Try specific Recruitee form selectors
    const formSelectors = CONFIG.SELECTORS.FORM.split(", ");

    // Create form handler if needed
    if (!this.formHandler) {
      this.formHandler = new RecruiteeFormHandler({
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
   * Check if a URL is a valid Recruitee job link
   */
  isValidRecruiteeJobLink(url) {
    if (!url) return false;

    return /https?:\/\/([^.]+)\.recruitee\.com\/(o|career)\/([^\/]+)/.test(url);
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
      let timerContainer = document.getElementById(
        "recruitee-automation-timer"
      );

      if (!timerContainer) {
        timerContainer = document.createElement("div");
        timerContainer.id = "recruitee-automation-timer";
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
        ".recruitee-result-highlight"
      );
      if (existingHighlight) {
        existingHighlight.remove();
      }

      // Create highlight container
      const highlight = document.createElement("div");
      highlight.className = "recruitee-result-highlight";
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
    container.id = "recruitee-status-overlay";
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
    this.logContainer.id = "recruitee-log-container";
    this.logContainer.style.cssText = `
      margin-top: 10px;
      max-height: 220px;
      overflow-y: auto;
      font-size: 12px;
      line-height: 1.4;
    `;

    // Create timer container
    const timerContainer = document.createElement("div");
    timerContainer.id = "recruitee-automation-status-content";
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

  /**
   * Search for the next job to apply to
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
            this.appendStatusMessage("Already submitted: " + url);
          } else if (processedLink && processedLink.status === "ERROR") {
            this.markLinkAsColor(link, "red", "Error");
            this.appendStatusMessage(
              "Previous error with: " +
                url +
                (processedLink.error ? ` - ${processedLink.error}` : "")
            );
          } else {
            this.markLinkAsColor(link, "orange", "Processed");
            this.appendStatusMessage(`Already processed: ${url}`);
          }

          continue;
        }

        // Check if valid Recruitee job link
        if (!this.isValidRecruiteeJobLink(link.href)) {
          debugLog(`Link ${url} is not a valid Recruitee job link`);
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

        // Skip if not a valid Recruitee job link
        if (!this.isValidRecruiteeJobLink(link.href)) {
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
   * Apply for the job - with enhanced form and button detection
   */
  async apply() {
    try {
      this.appendStatusMessage("Starting to apply for job");

      // First check if we're on a job details page that needs to click Apply button
      const applyButton = this.findApplyButton();
      if (applyButton) {
        this.appendStatusMessage("Found apply button, clicking it");
        applyButton.click();

        // Wait longer for the form to load after clicking apply
        await this.wait(5000);
      }

      // Check if we're on an apply page by looking for form
      let form = this.findApplicationForm();

      // If no form found, try again with a bit more time
      if (!form) {
        this.appendStatusMessage(
          "Form not found on first try, waiting longer..."
        );
        await this.wait(3000);
        form = this.findApplicationForm();
      }

      // If still no form, look for other potential apply buttons
      if (!form) {
        this.appendStatusMessage("Looking for alternative apply buttons...");
        const alternativeButton = this.findAlternativeApplyButton();
        if (alternativeButton) {
          this.appendStatusMessage(
            "Found alternative apply button, clicking it"
          );
          alternativeButton.click();
          await this.wait(4000);
          form = this.findApplicationForm();
        }
      }

      // Final check - if we still don't have a form, we'll skip this job
      if (!form) {
        // Check if there's any indication that applications need to be submitted elsewhere
        if (
          document.body.textContent.includes("apply via website") ||
          document.body.textContent.includes("apply on company website") ||
          document.body.textContent.includes("external application")
        ) {
          throw new SkipApplicationError(
            "Application requires going to external website"
          );
        }

        throw new SkipApplicationError("Cannot find application form");
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
   * Find any button that looks like an Apply button
   */
  findApplyButton() {
    try {
      // First check using the configured selectors
      const primaryButton = document.querySelector(
        CONFIG.SELECTORS.APPLY_BUTTON
      );
      if (primaryButton && this.isElementVisible(primaryButton)) {
        return primaryButton;
      }

      // Look for buttons/links with the word "Apply" in them
      const applyTexts = [
        "apply",
        "apply now",
        "apply for this job",
        "submit application",
      ];

      // Check both buttons and links
      const allButtons = [
        ...document.querySelectorAll(
          'button, a.button, a.btn, a[role="button"], .button, .btn'
        ),
      ];

      for (const button of allButtons) {
        if (!this.isElementVisible(button)) continue;

        const buttonText = button.textContent.toLowerCase().trim();
        if (applyTexts.some((text) => buttonText.includes(text))) {
          return button;
        }
      }

      return null;
    } catch (error) {
      this.appendStatusMessage(`Error finding apply button: ${error.message}`);
      return null;
    }
  }

  /**
   * Find alternative buttons that might lead to the application form
   */
  findAlternativeApplyButton() {
    try {
      // Expanded set of terms to look for
      const applyTexts = [
        "apply",
        "submit",
        "continue",
        "start",
        "begin",
        "application",
        "next",
        "interested",
      ];

      // Look for any clickable elements with these terms
      const allClickables = [
        ...document.querySelectorAll(
          'button, a, div[role="button"], span[role="button"], [class*="button"], [class*="btn"]'
        ),
      ];

      for (const element of allClickables) {
        if (!this.isElementVisible(element)) continue;

        const text = element.textContent.toLowerCase().trim();

        // Check if the element's text contains any of our target phrases
        if (applyTexts.some((term) => text.includes(term))) {
          return element;
        }
      }

      // If we still haven't found anything, look for job action containers
      const actionContainers = [
        ...document.querySelectorAll(
          ".job-actions, .actions, .cta, .apply-container, .job-apply"
        ),
      ];

      for (const container of actionContainers) {
        const buttons = container.querySelectorAll("button, a");
        if (buttons.length > 0) {
          return buttons[0]; // Return the first button in the container
        }
      }

      return null;
    } catch (error) {
      this.appendStatusMessage(
        `Error finding alternative apply button: ${error.message}`
      );
      return null;
    }
  }

  /**
   * Find application form with improved detection
   */
  findApplicationForm() {
    // Try specific Recruitee form selectors
    const formSelectors = CONFIG.SELECTORS.FORM.split(", ");

    // Add more potential Recruitee form selectors
    const expandedSelectors = [
      ...formSelectors,
      "form#application_form",
      "form.application",
      "form[action*='apply']",
      "form[action*='career']",
      "form[action*='job']",
      "form.recruitee-application",
      "form.recruitee-form",
      "form.application-form__fieldset",
    ];

    // Create form handler if needed
    if (!this.formHandler) {
      this.formHandler = new RecruiteeFormHandler({
        logger: (message) => this.appendStatusMessage(message),
      });
    }

    // Try each selector
    for (const selector of expandedSelectors) {
      const forms = document.querySelectorAll(selector);
      if (forms.length) {
        for (const form of forms) {
          if (this.isElementVisible(form)) {
            return form;
          }
        }
      }
    }

    // Try any form with input fields
    const allForms = document.querySelectorAll("form");
    for (const form of allForms) {
      if (
        this.isElementVisible(form) &&
        form.querySelectorAll("input, select, textarea").length > 0
      ) {
        return form;
      }
    }

    // If no forms found, look for form-like containers (some Recruitee sites use div-based forms)
    const formContainers = document.querySelectorAll(
      ".form-container, .application-form, .recruitee-form, .job-application, .application-fields"
    );

    for (const container of formContainers) {
      // Check if it has input elements and a button
      if (
        container.querySelectorAll("input, select, textarea").length > 0 &&
        container.querySelectorAll("button, input[type='submit']").length > 0
      ) {
        return container;
      }
    }

    return null;
  }

  /**
   * Utility to check if an element is visible
   */
  isElementVisible(element) {
    try {
      if (!element) return false;

      // Get element style
      const style = window.getComputedStyle(element);

      // Check if element is hidden
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0"
      ) {
        return false;
      }

      // Check if element has zero dimensions
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        return false;
      }

      // Check if any parent is hidden
      let parent = element.parentElement;
      while (parent) {
        const parentStyle = window.getComputedStyle(parent);
        if (
          parentStyle.display === "none" ||
          parentStyle.visibility === "hidden" ||
          parentStyle.opacity === "0"
        ) {
          return false;
        }
        parent = parent.parentElement;
      }

      return true;
    } catch (error) {
      return true; // Default to true on error
    }
  }
}

// Initialize the automation
debugLog("Creating RecruiteeJobAutomation instance");
const recruiteeAutomation = new RecruiteeJobAutomation();

// Add message listener for backward compatibility
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    const type = message.type || message.action;

    switch (type) {
      case "SEARCH_NEXT":
        recruiteeAutomation.handleSearchNext(message.data);
        sendResponse({ success: true });
        break;

      case "checkStatus":
        sendResponse({
          success: true,
          data: {
            initialized: recruiteeAutomation.state.initialized,
            isApplicationInProgress:
              recruiteeAutomation.state.isApplicationInProgress,
            processedCount: recruiteeAutomation.state.processedLinksCount,
          },
        });
        break;

      case "resetState":
        recruiteeAutomation.state.isApplicationInProgress = false;
        recruiteeAutomation.state.applicationStartTime = null;
        recruiteeAutomation.state.processedUrls = new Set();
        recruiteeAutomation.state.processedLinksCount = 0;
        recruiteeAutomation.updateStatusIndicator("ready");
        recruiteeAutomation.appendStatusMessage("State reset complete");
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
