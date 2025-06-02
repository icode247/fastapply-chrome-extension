import { HOST } from "@shared/constants";
import { GlassdoorFileHandler } from "@shared/linkedInUtils";
import { GlassdoorFormHandler } from "./glassdoorFormHandler";

// Debugging helpers
function debugLog(message, ...args) {
  console.log(`[GlassdoorApply] ${message}`, ...args);
}

function errorLog(message, error) {
  console.error(`[GlassdoorApply Error] ${message}`, error);
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
    // Glassdoor selectors
    JOB_CARDS:
      "[data-test='jobListing'], [data-brandviews], .react-job-listing, .JobCard",
    JOB_TITLE: ".JobCard_jobTitle__GLyJ1, .job-title, [data-test='job-title']",
    COMPANY_NAME:
      ".EmployerProfile_compactEmployerName__9MGcV, [data-test='employer-name']",
    LOCATION: ".JobCard_location__Ds1fM, [data-test='location']",
    JOB_LINK:
      ".JobCard_jobTitle__GLyJ1 a, [data-test='job-link'], .job-link, .jobLink",
    JOB_DETAILS_PANEL:
      ".JobDetails, [data-test='jobDetails'], .jobDetails, .details-panel",
    APPLY_BUTTON:
      "[data-test='easyApply'], .applyButton-EasyApplyButton, .easyApplyButtonEnabled, .easy-apply",
    JOB_DESCRIPTION: ".JobDescriptionContent, .description",
    NEXT_PAGE: "button[data-test='pagination-next'], .nextButton",
    POPUP_CLOSE: ".JobCard_closeButtonContainer__4R81v, .modal-close-btn",
    APPLICATION_FORM: ".applyForm, .easyApplyForm, .applicationForm",
    FORM_SUBMIT: "button[type='submit'], .easyApplySubmitButton, .submitButton",
    FORM_CONTINUE:
      ".continueButton, .nextButton, button[data-test='continue-btn']",
    REQUIRED_QUESTIONS: ".required, [aria-required='true']",
    RESUME_UPLOAD: "input[type='file'], .resumeUploadInput",
    FORM_CONTAINER: ".easyApplyFormContainer, .applyFormContainer",
    EXTERNAL_APPLY_INDICATOR: ".externalApply, .externalPostingLabel",
    LOGO: ".logo, .employerLogo",
    EASY_APPLY_TAG: ".easy-apply-tag, [data-test='easy-apply-tag']",

    // Indeed selectors (when redirected)
    INDEED_FORM_CONTAINER: ".ia-BasePage, #ia-container",
    INDEED_FORM_FIELD: ".ia-TextField, .ia-FormField",
    INDEED_SUBMIT_BUTTON:
      ".ia-continueButton, [data-testid='ia-continue-button']",
    INDEED_RESUME_UPLOAD: ".ia-ResumeUpload input[type='file']",
    INDEED_CHECKBOX: ".ia-Checkbox",
    INDEED_SUCCESS_INDICATOR: ".ia-SuccessPage, .ia-confirmation",
  },
  TIMEOUTS: {
    STANDARD: 2000,
    EXTENDED: 5000,
    MAX_TIMEOUT: 300000, // 5 minutes
  },
  DEBUG: true,
  BRAND_COLOR: "#0CAA41", // Glassdoor green color
};

/**
 * GlassdoorJobAutomation - Content script for automating Glassdoor job applications
 */
class GlassdoorJobAutomation {
  constructor() {
    debugLog("Initializing GlassdoorJobAutomation");

    // State tracking
    this.state = {
      initialized: false,
      ready: false,
      isApplicationInProgress: false,
      applicationStartTime: null,
      processedUrls: new Set(),
      processedJobIds: new Set(), // Added for better tracking
      processedLinksCount: 0,
      countDown: null,
      lastCheckedUrl: null,
      debounceTimers: {},
      currentPage: 1,
      totalPages: 1,
      isIndeedRedirect: false,
      detailsPanelLoaded: false,
      lastClickedJobCard: null,
      currentJobDetails: null, // Keep track of current job details
      pauseProcessing: false,
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
    this.fileHandler = new GlassdoorFileHandler({
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

    // Set up mutation observer to detect job panel updates
    this.setupMutationObserver();
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
      const url = window.location.href;
      const isApplyPage = url.match(
        /(glassdoor\.com\/job\/|glassdoor\.com\/Job\/|glassdoor\.com\/Apply\/)/i
      );
      const isIndeedApplyPage = url.includes("smartapply.indeed.com");

      const tabId = Date.now(); // Using timestamp as a unique identifier
      let portName;

      if (isIndeedApplyPage) {
        portName = `glassdoor-indeed-${tabId}`;
        this.state.isIndeedRedirect = true;
      } else if (isApplyPage) {
        portName = `glassdoor-apply-${tabId}`;
      } else {
        portName = `glassdoor-search-${tabId}`;
      }

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
   * Set up mutation observer to detect job details panel updates
   */
  setupMutationObserver() {
    try {
      const observerCallback = (mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === "childList" || mutation.type === "attributes") {
            // Check if the details panel has been updated
            const detailsPanel = document.querySelector(
              CONFIG.SELECTORS.JOB_DETAILS_PANEL
            );
            if (detailsPanel) {
              const hasNewContent =
                detailsPanel.querySelector(CONFIG.SELECTORS.JOB_DESCRIPTION) !==
                null;

              if (hasNewContent && !this.state.detailsPanelLoaded) {
                debugLog("Job details panel content loaded");
                this.state.detailsPanelLoaded = true;

                // Process the new job details
                this.debounce(
                  "processJobDetails",
                  () => this.processJobDetails(),
                  1000
                );
              }
            }
          }
        }
      };

      // Create and start the observer
      const observer = new MutationObserver(observerCallback);
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
      });

      this.detailsObserver = observer;
    } catch (error) {
      errorLog("Error setting up mutation observer:", error);
    }
  }

  /**
   * Process newly loaded job details panel
   */
  async processJobDetails() {
    if (this.state.isApplicationInProgress || this.state.pauseProcessing) {
      debugLog(
        "Application in progress or processing paused, skipping job details processing"
      );
      return;
    }

    try {
      const detailsPanel = document.querySelector(
        CONFIG.SELECTORS.JOB_DETAILS_PANEL
      );
      if (!detailsPanel) {
        debugLog("No job details panel found");
        return;
      }

      // Extract job details
      this.state.currentJobDetails =
        this.extractJobDetailsFromPanel(detailsPanel);
      debugLog("Extracted job details:", this.state.currentJobDetails);

      // Check if this job has already been processed
      const jobId = this.state.currentJobDetails.jobId;
      if (this.state.processedJobIds.has(jobId)) {
        debugLog(`Job ${jobId} already processed, skipping`);

        // Mark card as processed
        if (this.state.lastClickedJobCard) {
          this.markCardAsColor(
            this.state.lastClickedJobCard,
            "orange",
            "Already Processed"
          );
        }

        // Move to next job card
        this.debounce("searchNext", () => this.searchNext(), 1000);
        return;
      }

      // Check if it's an Easy Apply job
      const isEasyApply = await this.checkIfEasyApplyJob(detailsPanel);
      if (!isEasyApply) {
        debugLog("Not an Easy Apply job, skipping");
        this.state.processedJobIds.add(jobId);

        // Mark card as not Easy Apply
        if (this.state.lastClickedJobCard) {
          this.markCardAsColor(
            this.state.lastClickedJobCard,
            "gray",
            "Not Easy Apply"
          );
        }

        // Move to next job card
        this.debounce("searchNext", () => this.searchNext(), 1000);
        return;
      }

      // Found an Easy Apply job!
      debugLog("Found an Easy Apply job, preparing to apply");
      this.state.pauseProcessing = true;

      // Mark card as processing
      if (this.state.lastClickedJobCard) {
        this.markCardAsColor(
          this.state.lastClickedJobCard,
          "blue",
          "Processing"
        );
      }

      // Apply for the job
      this.state.isApplicationInProgress = true;
      this.state.processedJobIds.add(jobId);

      // Start application
      this.safeSendMessage({
        type: "START_APPLICATION",
        data: {
          url: window.location.href,
          title: this.state.currentJobDetails.title,
          jobId: jobId,
        },
      });

      // Click the apply button
      const applyButton = await this.findApplyButton(detailsPanel);
      if (applyButton) {
        this.appendStatusMessage("Clicking Easy Apply button");
        applyButton.click();

        // Wait for application form to load
        await this.wait(2000);

        // Start application process in the current tab (or modal)
        await this.startApplying();
      } else {
        this.appendStatusMessage("Failed to find Easy Apply button");
        this.state.isApplicationInProgress = false;
        this.state.pauseProcessing = false;

        // Continue with next job
        this.debounce("searchNext", () => this.searchNext(), 1000);
      }
    } catch (error) {
      errorLog("Error processing job details:", error);
      this.state.isApplicationInProgress = false;
      this.state.pauseProcessing = false;
      this.state.detailsPanelLoaded = false;

      // Continue with next job
      this.debounce("searchNext", () => this.searchNext(), 2000);
    }
  }

  /**
   * Extract job details from the details panel
   */
  extractJobDetailsFromPanel(panel) {
    try {
      // Get job ID from URL or data attributes
      const jobId = this.getJobIdFromCurrentPage();

      // Extract job title
      const titleElement =
        panel.querySelector(CONFIG.SELECTORS.JOB_TITLE) ||
        panel.querySelector("h1") ||
        document.querySelector('h1[data-test="job-title"]');
      const title = titleElement
        ? titleElement.textContent.trim()
        : "Job on Glassdoor";

      // Extract company name
      const companyElement =
        panel.querySelector(CONFIG.SELECTORS.COMPANY_NAME) ||
        panel.querySelector(".employer") ||
        document.querySelector('[data-test="employer-name"]');
      const company = companyElement
        ? companyElement.textContent.trim()
        : "Company on Glassdoor";

      // Extract location
      const locationElement =
        panel.querySelector(CONFIG.SELECTORS.LOCATION) ||
        panel.querySelector(".location") ||
        document.querySelector('[data-test="location"]');
      const location = locationElement
        ? locationElement.textContent.trim()
        : "Location not specified";

      // Try to extract other details
      const salaryElement = panel.querySelector(
        '[data-test="salary-estimate"], .salary'
      );
      const salary = salaryElement
        ? salaryElement.textContent.trim()
        : "Not specified";

      const workplaceElement = panel.querySelector(
        '[data-test="job-type"], .jobType'
      );
      const workplace = workplaceElement
        ? workplaceElement.textContent.trim()
        : "Not specified";

      const postedDateElement = panel.querySelector(
        '[data-test="posted-date"], .postedDate'
      );
      const postedDate = postedDateElement
        ? postedDateElement.textContent.trim()
        : "Not specified";

      return {
        jobId,
        title,
        company,
        location,
        jobUrl: window.location.href,
        salary,
        workplace,
        postedDate,
      };
    } catch (error) {
      errorLog("Error extracting job details from panel:", error);
      return {
        jobId: this.getJobIdFromCurrentPage(),
        title: "Job on Glassdoor",
        company: "Company on Glassdoor",
        location: "Location not specified",
        jobUrl: window.location.href,
        salary: "Not specified",
        workplace: "Not specified",
        postedDate: "Not specified",
      };
    }
  }

  /**
   * Get job ID from current page URL or DOM elements
   */
  getJobIdFromCurrentPage() {
    try {
      // First check URL params
      const url = window.location.href;
      const urlParams = new URLSearchParams(window.location.search);

      // Look for common job ID parameters
      const jobListingId = urlParams.get("jobListingId");
      if (jobListingId) return jobListingId;

      const jl = urlParams.get("jl");
      if (jl) return jl;

      // Try to extract from URL path
      const pathMatch = url.match(/\/job\/[^\/]+\/([A-Za-z0-9_-]+)/i);
      if (pathMatch && pathMatch[1]) return pathMatch[1];

      // Try to extract from data attributes in DOM
      const jobCard = this.state.lastClickedJobCard;
      if (jobCard) {
        const dataId =
          jobCard.getAttribute("data-id") ||
          jobCard.getAttribute("data-job-id") ||
          jobCard.getAttribute("data-job-listing-id") ||
          jobCard.getAttribute("data-brandviews");
        if (dataId) return dataId;
      }

      // Generate a random ID as fallback
      return "job-" + Math.floor(Math.random() * 1000000);
    } catch (error) {
      errorLog("Error getting job ID from page:", error);
      return "unknown-" + Math.floor(Math.random() * 1000000);
    }
  }

  /**
   * Check if the job in the details panel is an Easy Apply job
   */
  async checkIfEasyApplyJob(panel) {
    try {
      // Look for Easy Apply button
      const easyApplyButton = await this.waitForElement(
        CONFIG.SELECTORS.APPLY_BUTTON,
        2000,
        panel
      );

      if (easyApplyButton) {
        const buttonText = easyApplyButton.textContent.toLowerCase();

        // Check if it's actually an Easy Apply button and not external
        if (
          buttonText.includes("easy apply") &&
          !buttonText.includes("external") &&
          !buttonText.includes("company site")
        ) {
          return true;
        }
      }

      // Look for Easy Apply indicators
      const easyApplyIndicators = panel.querySelectorAll(
        '.easy-apply-tag, [data-test="easy-apply-tag"], ' +
          '.easyApply, [class*="easyApply"]'
      );

      if (easyApplyIndicators.length > 0) {
        return true;
      }

      // Check for external apply indicators
      const externalApplyIndicators = panel.querySelectorAll(
        CONFIG.SELECTORS.EXTERNAL_APPLY_INDICATOR +
          ', a[href*="apply"], a[href*="career"], .companyApply'
      );

      if (externalApplyIndicators.length > 0) {
        return false;
      }

      // Check text content for indicators
      const panelText = panel.textContent.toLowerCase();
      if (
        panelText.includes("easy apply") &&
        !panelText.includes("apply on company") &&
        !panelText.includes("apply externally")
      ) {
        return true;
      }

      return false;
    } catch (error) {
      errorLog("Error checking if Easy Apply job:", error);
      return false;
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

    if (url.includes("/Job/jobs") || url.includes("/job/search")) {
      debugLog("On Glassdoor search page");
      this.appendStatusMessage("Glassdoor search page detected");
      this.safeSendMessage({ type: "GET_SEARCH_TASK" });
    } else if (
      url.includes("/job/") ||
      url.includes("/Job/") ||
      url.includes("/Apply/")
    ) {
      debugLog("On Glassdoor job page");
      this.appendStatusMessage("Glassdoor job page detected");
      this.safeSendMessage({ type: "GET_APPLICATION_TASK" });
    } else if (url.includes("smartapply.indeed.com")) {
      debugLog("On Indeed easy apply page");
      this.appendStatusMessage("Indeed application form detected");
      this.state.isIndeedRedirect = true;
      this.safeSendMessage({ type: "GET_APPLICATION_TASK" });
    }
  }

  /**
   * Handle messages received through the port
   */
  handlePortMessage(message) {
    try {
      debugLog("Received port message:", message);

      const { type, data, requestId } = message || {};

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

      // Apply search filters
      this.applySearchFilters();

      // Start processing search results after a short delay
      this.debounce("searchNext", () => this.searchNext(), 1500);
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
      if (this.state.isIndeedRedirect) {
        this.debounce(
          "startApplyingIndeed",
          () => this.startApplyingIndeed(),
          1500
        );
      } else {
        this.debounce("startApplying", () => this.startApplying(), 1500);
      }
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
   * Handle duplicate job response
   */
  handleDuplicate(data) {
    try {
      debugLog("Duplicate job detected:", data);

      // Reset application state
      this.state.isApplicationInProgress = false;
      this.state.applicationStartTime = null;
      this.state.pauseProcessing = false;

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
      this.state.pauseProcessing = false;
      this.state.detailsPanelLoaded = false;

      // Increment processed count
      this.state.processedLinksCount++;

      if (!data || !data.url) {
        debugLog("No URL data in handleSearchNext");
        this.appendStatusMessage("Job processed, searching next...");
        this.debounce("searchNext", () => this.searchNext(), 1000);
        return;
      }

      const url = data.url;

      // Find and update link status in the page
      const jobCards = this.findAllJobCardElements();
      let cardFound = false;

      for (const card of jobCards) {
        const link = card.querySelector(CONFIG.SELECTORS.JOB_LINK);
        if (!link) continue;

        if (this.isUrlMatch(link.href, url)) {
          // Update visual status based on result
          if (data.status === "SUCCESS") {
            this.markCardAsColor(card, "green", "Applied");
            this.appendStatusMessage("Successfully applied to: " + url);
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
        debugLog("Job card not found in current page:", url);
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
      this.state.pauseProcessing = false;

      this.debounce("searchNext", () => this.searchNext(), 5000);
    }
  }

  /**
   * Apply search filters to improve job matching
   */
  async applySearchFilters() {
    try {
      this.appendStatusMessage("Applying search filters...");

      // Wait for page to fully load
      await this.wait(2000);

      // Apply Easy Apply filter if not already active
      const easyApplyFilter = document.querySelector(
        "input[name='filterType'][value='EASY_APPLY_ONLY'], #filterApplied_true, [data-test='easy-apply-filter'], .filter-item[data-test='EASY_APPLY_ONLY']"
      );

      if (easyApplyFilter && !easyApplyFilter.checked) {
        this.appendStatusMessage("Activating Easy Apply filter");
        easyApplyFilter.click();
        await this.wait(3000);
      }

      // Get pagination info
      const paginationText =
        document.querySelector(".paginationFooter, .pagingControls, .pageInfo")
          ?.textContent || "";
      const paginationMatch = paginationText.match(/Page (\d+) of (\d+)/);
      if (paginationMatch && paginationMatch.length >= 3) {
        this.state.currentPage = parseInt(paginationMatch[1]);
        this.state.totalPages = parseInt(paginationMatch[2]);
        debugLog(
          `Found pagination: Page ${this.state.currentPage} of ${this.state.totalPages}`
        );
      }

      this.appendStatusMessage("Search filters applied");
    } catch (error) {
      errorLog("Error applying search filters:", error);
      this.appendStatusErrorMessage(error);
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

    // Reset states
    this.state.isApplicationInProgress = false;
    this.state.pauseProcessing = false;

    // If we're on a search page, continue after a delay
    if (
      window.location.href.includes("/Job/jobs") ||
      window.location.href.includes("/job/search")
    ) {
      this.debounce("searchNext", () => this.searchNext(), 5000);
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

        // If application has been active for over 5 minutes, it's probably stuck
        if (applicationTime > 5 * 60 * 1000) {
          debugLog(
            "Application appears to be stuck for over 5 minutes, resetting state"
          );

          this.state.isApplicationInProgress = false;
          this.state.applicationStartTime = null;
          this.state.pauseProcessing = false;
          this.state.detailsPanelLoaded = false;

          this.appendStatusMessage(
            "Application timeout detected - resetting state"
          );
          this.updateStatusIndicator("error");

          if (
            window.location.href.includes("/Job/jobs") ||
            window.location.href.includes("/job/search")
          ) {
            // Continue search on search page
            this.debounce("searchNext", () => this.searchNext(), 2000);
          }
        }
      }

      // Check for stuck detail panel loading
      if (
        !this.state.isApplicationInProgress &&
        this.state.lastClickedJobCard &&
        !this.state.detailsPanelLoaded
      ) {
        const detailsPanel = document.querySelector(
          CONFIG.SELECTORS.JOB_DETAILS_PANEL
        );
        if (
          !detailsPanel ||
          !detailsPanel.querySelector(CONFIG.SELECTORS.JOB_DESCRIPTION)
        ) {
          debugLog("Details panel appears to be stuck, trying next job");
          this.state.detailsPanelLoaded = false;
          this.debounce("searchNext", () => this.searchNext(), 1000);
        }
      }
    } catch (error) {
      errorLog("Error in health check:", error);
    }
  }

  /**
   * Search for the next job to apply to
   * Improved version that handles Glassdoor's split panel UI
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

      if (this.state.isApplicationInProgress || this.state.pauseProcessing) {
        debugLog("Application in progress or processing paused, waiting...");
        return;
      }

      this.appendStatusMessage("Finding next Easy Apply job...");
      this.updateStatusIndicator("searching");

      // Reset detail panel loaded flag
      this.state.detailsPanelLoaded = false;

      // Find all job cards
      const jobCards = this.findAllJobCardElements();
      debugLog(`Found ${jobCards.length} job cards`);

      // If no job cards, try to load more
      if (jobCards.length === 0) {
        debugLog("No job cards found, trying to load more");
        this.appendStatusMessage("No job cards found, trying to load more...");

        // Try to click "Next" button for more results
        const nextPageButton = this.findNextPageButton();
        if (nextPageButton) {
          this.appendStatusMessage('Clicking "Next" button for more results');
          nextPageButton.click();
          await this.wait(3000);
          this.debounce("searchNext", () => this.searchNext(), 2000);
          return;
        } else {
          this.appendStatusMessage("No more results to load");
          this.safeSendMessage({ type: "SEARCH_COMPLETED" });
          return;
        }
      }

      // Find first unprocessed job card
      let nextJobCard = null;

      for (const card of jobCards) {
        // Skip if no link
        const link = card.querySelector(CONFIG.SELECTORS.JOB_LINK);
        if (!link) continue;

        // Extract job ID
        const jobId = this.getJobIdFromCard(card);

        // Check if already processed
        if (
          this.state.processedJobIds.has(jobId) ||
          this.isUrlProcessed(link.href)
        ) {
          continue;
        }

        // Found unprocessed card
        nextJobCard = card;
        break;
      }

      // If no unprocessed card found, go to next page
      if (!nextJobCard) {
        this.appendStatusMessage(
          "All jobs on current page processed, moving to next page"
        );
        const nextPageButton = this.findNextPageButton();

        if (nextPageButton) {
          this.appendStatusMessage('Clicking "Next" button');
          nextPageButton.click();
          await this.wait(3000);
          this.debounce("searchNext", () => this.searchNext(), 2000);
        } else {
          this.appendStatusMessage("All jobs processed, search completed!");
          this.safeSendMessage({ type: "SEARCH_COMPLETED" });
        }
        return;
      }

      // Process the next job card
      this.appendStatusMessage("Clicking on next job card");

      // Store reference to clicked card
      this.state.lastClickedJobCard = nextJobCard;

      // Click the job card to show details
      const link = nextJobCard.querySelector(CONFIG.SELECTORS.JOB_LINK);
      if (link) {
        // Mark card as loading
        this.markCardAsColor(nextJobCard, "blue", "Loading");

        // Click to show details
        link.click();

        // The mutation observer will detect when details are loaded and call processJobDetails()
        // We'll set a backup timeout in case the observer fails
        setTimeout(() => {
          if (
            !this.state.detailsPanelLoaded &&
            !this.state.isApplicationInProgress
          ) {
            debugLog("Details panel didn't load in time, forcing process");
            this.state.detailsPanelLoaded = true;
            this.processJobDetails();
          }
        }, 5000);
      } else {
        // No link found, move to next
        this.debounce("searchNext", () => this.searchNext(), 1000);
      }
    } catch (error) {
      errorLog("Error in searchNext:", error);
      this.appendStatusErrorMessage(error);

      // Reset states
      this.state.isApplicationInProgress = false;
      this.state.pauseProcessing = false;
      this.state.detailsPanelLoaded = false;

      // Try again after a delay
      setTimeout(() => this.searchNext(), 5000);
    }
  }

  /**
   * Get job ID from a job card element
   */
  getJobIdFromCard(card) {
    try {
      // Try to get job ID from data attributes
      const jobId =
        card.getAttribute("data-id") ||
        card.getAttribute("data-job-id") ||
        card.getAttribute("data-job-listing-id") ||
        card.getAttribute("data-brandviews");

      if (jobId) return jobId;

      // Try to get from URL in link
      const link = card.querySelector(CONFIG.SELECTORS.JOB_LINK);
      if (link && link.href) {
        const url = new URL(link.href);

        // Check URL params
        const urlParams = new URLSearchParams(url.search);
        const paramJobId = urlParams.get("jobListingId") || urlParams.get("jl");
        if (paramJobId) return paramJobId;

        // Try to extract from URL path
        const pathMatch = link.href.match(/\/job\/[^\/]+\/([A-Za-z0-9_-]+)/i);
        if (pathMatch && pathMatch[1]) return pathMatch[1];
      }

      // Generate random ID as fallback
      return "card-" + Math.floor(Math.random() * 1000000);
    } catch (error) {
      errorLog("Error getting job ID from card:", error);
      return "unknown-" + Math.floor(Math.random() * 1000000);
    }
  }

  /**
   * Start application process
   */
  async startApplying() {
    try {
      debugLog("Starting application process for Glassdoor");
      this.appendStatusMessage("Starting application process on Glassdoor");
      this.updateStatusIndicator("applying");

      // Check if page is valid
      if (
        document.body.innerText.includes("Page not found") ||
        document.body.innerText.includes("Job Not Found") ||
        document.body.innerText.includes("No longer accepting applications")
      ) {
        throw new SkipApplicationError(
          "Cannot start application: Page error or job no longer available"
        );
      }

      // Set application state
      this.state.isApplicationInProgress = true;
      this.state.applicationStartTime = Date.now();

      // Extract job details if not already available
      const jobDetails =
        this.state.currentJobDetails || this.extractJobDetails();
      debugLog("Using job details:", jobDetails);

      // Start countdown timer
      this.state.countDown = this.startCountDownTimer(60 * 5, () => {
        this.safeSendMessage({
          type: "APPLICATION_ERROR",
          data: "Application timed out after 5 minutes",
        });
      });

      // Wait a moment for page to fully load
      await this.wait(2000);

      // Check if this is an external application
      if (this.isExternalApplication()) {
        throw new SkipApplicationError("External application not supported");
      }

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
        this.state.pauseProcessing = false;

        debugLog("Application completed successfully");
        this.appendStatusMessage("Application completed successfully");
        this.updateStatusIndicator("success");

        // Mark job card as applied if available
        if (this.state.lastClickedJobCard) {
          this.markCardAsColor(
            this.state.lastClickedJobCard,
            "green",
            "Applied"
          );
        }

        // Go to next job after a delay
        this.debounce("searchNext", () => this.searchNext(), 3000);
      }
    } catch (error) {
      if (error instanceof SkipApplicationError) {
        errorLog("Application skipped:", error.message);
        this.appendStatusMessage("Application skipped: " + error.message);
        this.safeSendMessage({
          type: "APPLICATION_SKIPPED",
          data: error.message,
        });

        // Mark job card as skipped if available
        if (this.state.lastClickedJobCard) {
          this.markCardAsColor(
            this.state.lastClickedJobCard,
            "orange",
            "Skipped"
          );
        }
      } else {
        errorLog("Application error:", error);
        this.appendStatusErrorMessage(error);
        this.safeSendMessage({
          type: "APPLICATION_ERROR",
          data: this.errorToString(error),
        });

        // Mark job card as error if available
        if (this.state.lastClickedJobCard) {
          this.markCardAsColor(this.state.lastClickedJobCard, "red", "Error");
        }
      }

      // Reset application state
      this.state.isApplicationInProgress = false;
      this.state.applicationStartTime = null;
      this.state.pauseProcessing = false;

      // Go to next job after a delay
      this.debounce("searchNext", () => this.searchNext(), 3000);
    }
  }

  /**
   * Start application process for Indeed redirect pages
   */
  async startApplyingIndeed() {
    try {
      debugLog("Starting application process for Indeed integration");
      this.appendStatusMessage("Starting application process on Indeed form");
      this.updateStatusIndicator("applying");

      // Check if page is valid
      if (
        document.body.innerText.includes("Page not found") ||
        document.body.innerText.includes("not found") ||
        document.body.innerText.includes("Error")
      ) {
        throw new SkipApplicationError(
          "Cannot start application: Indeed form error or no longer available"
        );
      }

      // Set application state
      this.state.isApplicationInProgress = true;
      this.state.applicationStartTime = Date.now();

      // Wait for page to fully load
      await this.wait(2000);

      // Start countdown timer
      this.state.countDown = this.startCountDownTimer(60 * 5, () => {
        this.safeSendMessage({
          type: "APPLICATION_ERROR",
          data: "Indeed application timed out after 5 minutes",
        });
      });

      // Extract job details
      const jobDetails = this.extractIndeedJobDetails();
      debugLog("Extracted job details from Indeed form:", jobDetails);

      // Apply for the job using Indeed form
      const applied = await this.applyIndeed();

      if (applied) {
        // Send completion message
        this.safeSendMessage({
          type: "APPLICATION_COMPLETED",
          data: jobDetails,
        });

        // Reset application state
        this.state.isApplicationInProgress = false;
        this.state.applicationStartTime = null;

        debugLog("Indeed application completed successfully");
        this.appendStatusMessage("Indeed application completed successfully");
        this.updateStatusIndicator("success");
      }
    } catch (error) {
      if (error instanceof SkipApplicationError) {
        errorLog("Indeed application skipped:", error.message);
        this.appendStatusMessage(
          "Indeed application skipped: " + error.message
        );
        this.safeSendMessage({
          type: "APPLICATION_SKIPPED",
          data: error.message,
        });
      } else {
        errorLog("Indeed application error:", error);
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
   * Extract job details from Indeed form
   */
  extractIndeedJobDetails() {
    try {
      // Extract job ID from URL
      const url = window.location.href;
      const urlParams = new URLSearchParams(new URL(url).search);

      const jobId =
        urlParams.get("jk") ||
        urlParams.get("jobId") ||
        this.getJobIdFromURL(url);

      // Get title and company from page
      let title = document.title || "Job on Indeed";
      let company = "Company on Indeed";

      // Check for breadcrumb or other job info elements
      const jobTitleEl = document.querySelector(
        ".ia-JobHeader-title, .job-title"
      );
      const companyEl = document.querySelector(
        ".ia-JobHeader-subtitle, .company-name"
      );

      if (jobTitleEl) {
        title = jobTitleEl.textContent.trim();
      }

      if (companyEl) {
        company = companyEl.textContent.trim();
      }

      // Extract from Indeed page context
      const locationEl = document.querySelector(".location, .job-location");
      const location = locationEl
        ? locationEl.textContent.trim()
        : "Location not specified";

      return {
        jobId,
        title,
        company,
        location,
        jobUrl: url,
        salary: "Not specified",
        workplace: "Not specified",
        postedDate: "Not specified",
      };
    } catch (error) {
      errorLog("Error extracting Indeed job details:", error);
      return {
        jobId: this.getJobIdFromURL(window.location.href),
        title: "Job on Indeed",
        company: "Company on Indeed",
        location: "Location not specified",
        jobUrl: window.location.href,
        salary: "Not specified",
        workplace: "Not specified",
        postedDate: "Not specified",
      };
    }
  }

  /**
   * Handle Indeed application form filling
   */
  async applyIndeed() {
    try {
      this.appendStatusMessage("Processing Indeed application form");

      // Wait for element to be loaded
      const formContainer = await this.waitForElement(
        CONFIG.SELECTORS.INDEED_FORM_CONTAINER,
        10000
      );

      if (!formContainer) {
        throw new SkipApplicationError("Cannot find Indeed application form");
      }

      // Wait for profile data if not loaded
      if (!this.profile) {
        this.profile = await this.getProfileData();
      }

      // Create form handler
      const formHandler = new GlassdoorFormHandler({
        logger: (message) => this.appendStatusMessage(message),
        host: HOST,
        userData: this.profile,
      });

      // Process multi-step Indeed form
      await this.handleIndeedMultiStepApplication(formHandler);

      // Success if we get here
      this.appendStatusMessage("Indeed application successfully submitted!");
      return true;
    } catch (error) {
      if (error instanceof SkipApplicationError) {
        throw error;
      } else {
        errorLog("Error in Indeed apply:", error);
        throw new ApplicationError(
          "Error during Indeed application process: " +
            this.errorToString(error)
        );
      }
    }
  }

  /**
   * Handle multi-step Indeed application process
   */
  async handleIndeedMultiStepApplication(formHandler) {
    try {
      this.appendStatusMessage("Processing multi-step Indeed application");

      let isLastStep = false;
      let maxSteps = 10;
      let currentStep = 0;

      while (!isLastStep && currentStep < maxSteps) {
        currentStep++;
        this.appendStatusMessage(`Processing Indeed form step ${currentStep}`);

        // Handle resume upload if needed and this is the first step
        if (currentStep === 1) {
          await this.handleIndeedResumeUpload();
        }

        // Fill form fields on current step
        const form = document.body;
        await formHandler.fillFormWithProfile(form, this.profile);

        // Check required checkboxes
        await formHandler.handleRequiredCheckboxes(form);

        // Handle special Indeed form elements
        await this.handleIndeedSpecialFormElements();

        // Find action button
        const actionButton = document.querySelector(
          CONFIG.SELECTORS.INDEED_SUBMIT_BUTTON
        );

        if (!actionButton) {
          // Check if we've already reached success state
          if (this.isIndeedApplicationSuccess()) {
            this.appendStatusMessage("Indeed application success detected!");
            isLastStep = true;
            break;
          }

          throw new Error(
            `No action button found on Indeed step ${currentStep}`
          );
        }

        // Check if this is the final submission button
        const buttonText = actionButton.textContent.toLowerCase().trim();
        if (
          buttonText.includes("submit") ||
          buttonText.includes("apply now") ||
          buttonText === "apply"
        ) {
          this.appendStatusMessage(
            "Found final Indeed submit button, submitting application"
          );
          isLastStep = true;
        } else {
          this.appendStatusMessage(`Clicking continue button: "${buttonText}"`);
        }

        // Click the button
        actionButton.click();

        // Wait for next page/step to load
        await this.wait(3000);

        // Check if the application was successful
        if (this.isIndeedApplicationSuccess()) {
          this.appendStatusMessage("Indeed application success detected!");
          isLastStep = true;
          break;
        }
      }

      // Final check for success
      if (!this.isIndeedApplicationSuccess() && currentStep >= maxSteps) {
        throw new Error(
          "Maximum Indeed application steps reached without confirmation"
        );
      }

      // Success!
      return true;
    } catch (error) {
      errorLog("Error in handleIndeedMultiStepApplication:", error);
      throw error;
    }
  }

  /**
   * Handle Indeed special form elements
   */
  async handleIndeedSpecialFormElements() {
    try {
      // Handle checkboxes
      const checkboxes = document.querySelectorAll(
        CONFIG.SELECTORS.INDEED_CHECKBOX
      );
      for (const checkbox of checkboxes) {
        const label = checkbox.closest("label");
        if (label && label.textContent.toLowerCase().includes("agree")) {
          if (!checkbox.checked) {
            checkbox.click();
            await this.wait(200);
          }
        }
      }

      // Handle dropdown menus
      const dropdowns = document.querySelectorAll("select");
      for (const dropdown of dropdowns) {
        if (dropdown.options.length > 0 && !dropdown.value) {
          // Choose first non-empty option
          for (let i = 0; i < dropdown.options.length; i++) {
            if (dropdown.options[i].value) {
              dropdown.value = dropdown.options[i].value;
              dropdown.dispatchEvent(new Event("change", { bubbles: true }));
              break;
            }
          }
        }
      }

      // Handle radio buttons for yes/no questions (typically "yes" is preferred)
      const radioGroups = new Set();
      document.querySelectorAll('input[type="radio"]').forEach((radio) => {
        if (radio.name) radioGroups.add(radio.name);
      });

      for (const groupName of radioGroups) {
        const radios = document.querySelectorAll(
          `input[type="radio"][name="${groupName}"]`
        );
        if (radios.length > 0 && !Array.from(radios).some((r) => r.checked)) {
          // Find "yes" option or first option
          const yesOption =
            Array.from(radios).find((r) => {
              const label =
                r.closest("label") ||
                document.querySelector(`label[for="${r.id}"]`);
              return label && label.textContent.toLowerCase().includes("yes");
            }) || radios[0];

          if (yesOption) {
            yesOption.click();
            await this.wait(200);
          }
        }
      }
    } catch (error) {
      this.appendStatusMessage(
        "Error handling Indeed special elements: " + error.message
      );
    }
  }

  /**
   * Handle resume upload for Indeed forms
   */
  async handleIndeedResumeUpload() {
    try {
      this.appendStatusMessage("Checking for Indeed resume upload option");

      // Wait for resume upload element
      const resumeUpload = await this.waitForElement(
        CONFIG.SELECTORS.INDEED_RESUME_UPLOAD,
        5000
      );

      if (resumeUpload && this.profile?.resumeUrl) {
        this.appendStatusMessage(
          "Found Indeed resume upload field, uploading resume"
        );

        // Upload resume using file handler
        await this.fileHandler.handleResumeUpload(this.profile, {
          querySelector: () => resumeUpload,
        });

        await this.wait(3000);
        return true;
      }

      // No resume upload found, but that's OK - might be pre-filled
      return false;
    } catch (error) {
      this.appendStatusMessage(
        "Error uploading resume to Indeed: " + error.message
      );
      // Continue with application even if resume upload fails
      return false;
    }
  }

  /**
   * Check if Indeed application was successful
   */
  isIndeedApplicationSuccess() {
    // Look for success indicators
    if (document.querySelector(CONFIG.SELECTORS.INDEED_SUCCESS_INDICATOR)) {
      return true;
    }

    // Check for success text in body
    const bodyText = document.body.textContent.toLowerCase();
    return (
      bodyText.includes("application submitted") ||
      bodyText.includes("successfully applied") ||
      bodyText.includes("thank you for applying") ||
      bodyText.includes("your application has been submitted") ||
      bodyText.includes("application complete") ||
      bodyText.includes("application confirmation")
    );
  }

  /**
   * Extract job details from the page
   */
  extractJobDetails() {
    try {
      const jobId = this.getJobIdFromURL(window.location.href);

      const title =
        document
          .querySelector('h1[data-test="job-title"], .jobTitle')
          ?.textContent?.trim() ||
        document.querySelector('[data-test="jobTitle"]')?.textContent?.trim() ||
        "Job on Glassdoor";

      const company =
        document
          .querySelector('[data-test="employer-name"], .employerName')
          ?.textContent?.trim() ||
        document.querySelector(".e1tk4kwz5")?.textContent?.trim() ||
        "Company on Glassdoor";

      const location =
        document
          .querySelector('[data-test="location"], .location')
          ?.textContent?.trim() ||
        document.querySelector(".e1tk4kwz7")?.textContent?.trim() ||
        "Location not specified";

      // Try to extract salary
      let salary = "Not specified";
      const salaryElement = document.querySelector(
        '[data-test="salary-estimate"], .salary, .salaryEstimate'
      );
      if (salaryElement) {
        salary = salaryElement.textContent.trim();
      }

      // Try to extract job type/workplace
      let workplace = "Not specified";
      const jobTypeElement = document.querySelector(
        '[data-test="job-type"], .jobType, .workplace'
      );
      if (jobTypeElement) {
        workplace = jobTypeElement.textContent.trim();
      }

      // Try to extract posted date
      let postedDate = "Not specified";
      const dateElement = document.querySelector(
        '[data-test="posted-date"], .postedDate'
      );
      if (dateElement) {
        postedDate = dateElement.textContent.trim();
      }

      return {
        jobId,
        title,
        company,
        location,
        jobUrl: window.location.href,
        salary,
        workplace,
        postedDate,
      };
    } catch (error) {
      errorLog("Error extracting job details:", error);
      return {
        jobId: this.getJobIdFromURL(window.location.href),
        title: "Job on Glassdoor",
        company: "Company on Glassdoor",
        location: "Location not specified",
        jobUrl: window.location.href,
        salary: "Not specified",
        workplace: "Not specified",
        postedDate: "Not specified",
      };
    }
  }

  /**
   * Get job ID from URL
   */
  getJobIdFromURL(url) {
    try {
      // First check for jobListingId parameter
      const params = new URLSearchParams(new URL(url).search);
      const jobListingId = params.get("jobListingId");
      if (jobListingId) return jobListingId;

      // Then check for VID parameter
      const vid = params.get("VID");
      if (vid) return vid;

      // Try to extract from URL path for Glassdoor
      const idMatches = url.match(
        /(?:jobListingId=|VID=|\/job\/[^\/]+\/([A-Za-z0-9_-]+))/
      );
      if (idMatches && idMatches[1]) {
        return idMatches[1];
      }

      // Extract ID from path segments as fallback
      const pathParts = new URL(url).pathname.split("/");
      const lastSegment = pathParts[pathParts.length - 1];

      // Check if last segment is numeric or alphanumeric
      if (/^[A-Za-z0-9_-]+$/.test(lastSegment)) {
        return lastSegment;
      }

      // For Indeed pages
      if (url.includes("indeed.com")) {
        const jk = params.get("jk");
        if (jk) return jk;
      }

      return "unknown-" + Math.floor(Math.random() * 9999999);
    } catch (error) {
      errorLog("Error getting job ID from URL:", error);
      return "unknown-" + Math.floor(Math.random() * 9999999);
    }
  }

  /**
   * Apply for the job
   */
  async apply() {
    try {
      this.appendStatusMessage("Starting to apply for job");

      // Check if this is an external application
      if (this.isExternalApplication()) {
        throw new SkipApplicationError("External application not supported");
      }

      // Find the apply button if not already clicked during details processing
      const applyButton = await this.findApplyButton();
      if (!applyButton) {
        throw new SkipApplicationError("Cannot find Easy Apply button");
      }

      // Check if we need to click the button (if not already clicked)
      const applicationForm =
        document.querySelector(CONFIG.SELECTORS.APPLICATION_FORM) ||
        document.querySelector(CONFIG.SELECTORS.FORM_CONTAINER);

      if (!applicationForm) {
        this.appendStatusMessage("Clicking Easy Apply button");
        applyButton.click();

        // Wait for application form to load
        await this.wait(3000);

        // Check for application form again
        const formAfterClick = await this.waitForElement(
          CONFIG.SELECTORS.FORM_CONTAINER,
          5000
        );

        if (!formAfterClick) {
          // Check if it might redirect to Indeed
          const indeedRedirect = document.querySelector(
            'a[href*="indeed.com"]'
          );
          if (indeedRedirect) {
            this.appendStatusMessage("Detected Indeed redirect, clicking it");
            indeedRedirect.click();
            await this.wait(5000);

            // If redirected to Indeed, we'll handle it in the new tab
            return true;
          }

          throw new SkipApplicationError(
            "Cannot find application form after clicking apply button"
          );
        }
      }

      // Wait for profile data if not loaded
      if (!this.profile) {
        this.profile = await this.getProfileData();
      }

      // Create form handler
      const formHandler = new GlassdoorFormHandler({
        logger: (message) => this.appendStatusMessage(message),
        host: HOST,
        userData: this.profile,
        jobDescription: this.getJobDescription(),
      });

      // Process application form
      await this.handleMultiStepApplication(formHandler);

      // Success!
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
   * Handle multi-step application process
   */
  async handleMultiStepApplication(formHandler) {
    try {
      this.appendStatusMessage("Processing multi-step application");

      let isLastStep = false;
      let maxSteps = 10;
      let currentStep = 0;

      while (!isLastStep && currentStep < maxSteps) {
        currentStep++;
        this.appendStatusMessage(`Processing application step ${currentStep}`);

        // Handle resume upload if needed
        if (currentStep === 1) {
          await this.handleResumeUpload();
        }

        // Find and select container for current step
        const form =
          document.querySelector(CONFIG.SELECTORS.APPLICATION_FORM) ||
          document.querySelector(CONFIG.SELECTORS.FORM_CONTAINER) ||
          document;

        // Fill form fields on current step
        await formHandler.fillFormWithProfile(form, this.profile);

        // Check required checkboxes
        await formHandler.handleRequiredCheckboxes(form);

        // Find appropriate button (submit or continue)
        const submitButton = form.querySelector(CONFIG.SELECTORS.FORM_SUBMIT);
        const continueButton = form.querySelector(
          CONFIG.SELECTORS.FORM_CONTINUE
        );

        let actionButton = submitButton || continueButton;

        if (!actionButton) {
          // Try to find any button that looks like submit/continue
          const possibleButtons = Array.from(
            form.querySelectorAll("button")
          ).filter((btn) => {
            const text = btn.textContent.toLowerCase();
            return (
              (text.includes("submit") ||
                text.includes("apply") ||
                text.includes("continue") ||
                text.includes("next")) &&
              this.isElementVisible(btn)
            );
          });

          if (possibleButtons.length > 0) {
            actionButton = possibleButtons[0];
          }
        }

        if (!actionButton) {
          // Check if we've already reached success state
          if (this.isApplicationSuccess()) {
            this.appendStatusMessage("Application success detected!");
            isLastStep = true;
            break;
          }

          throw new Error(`No action button found on step ${currentStep}`);
        }

        // Check if this is the final submission button
        const buttonText = actionButton.textContent.toLowerCase().trim();
        if (
          buttonText.includes("submit") ||
          buttonText.includes("apply now") ||
          buttonText === "apply"
        ) {
          this.appendStatusMessage(
            "Found final submit button, submitting application"
          );
          isLastStep = true;
        } else {
          this.appendStatusMessage(`Clicking continue button: "${buttonText}"`);
        }

        // Click the button
        actionButton.click();

        // Wait for next page/step to load
        await this.wait(3000);

        // Check if the application was successful
        if (this.isApplicationSuccess()) {
          this.appendStatusMessage("Application success detected!");
          isLastStep = true;
          break;
        }
      }

      // Final check for success
      if (!this.isApplicationSuccess() && currentStep >= maxSteps) {
        throw new Error(
          "Maximum application steps reached without confirmation"
        );
      }

      // Success!
      return true;
    } catch (error) {
      errorLog("Error in handleMultiStepApplication:", error);
      throw error;
    }
  }

  /**
   * Check if application was successful
   */
  isApplicationSuccess() {
    // Look for success indicators
    const successPatterns = [
      ".successMessage",
      ".successContent",
      ".applicationSuccess",
      '[data-test="application-success"]',
      ".confirmationMessage",
      ".thankYouMessage",
    ];

    for (const pattern of successPatterns) {
      if (document.querySelector(pattern)) {
        return true;
      }
    }

    // Check for success text in body
    const bodyText = document.body.textContent.toLowerCase();
    return (
      bodyText.includes("application submitted") ||
      bodyText.includes("successfully applied") ||
      bodyText.includes("thank you for applying") ||
      bodyText.includes("your application has been submitted")
    );
  }

  /**
   * Check if this is an external application
   */
  isExternalApplication() {
    // Check for external apply indicators
    if (document.querySelector(CONFIG.SELECTORS.EXTERNAL_APPLY_INDICATOR)) {
      return true;
    }

    // Check for text indicators of external application
    const pageText = document.body.textContent.toLowerCase();
    return (
      pageText.includes("apply on company website") ||
      pageText.includes("apply externally") ||
      pageText.includes("apply on company site")
    );
  }

  /**
   * Get job description text
   */
  getJobDescription() {
    let description = "";

    // Try various selectors for job description
    const descriptionSelectors = [
      ".jobDescriptionContent",
      '[data-test="description"]',
      ".description",
      ".jobDescription",
      '[data-test="jobDescriptionText"]',
    ];

    for (const selector of descriptionSelectors) {
      const element = document.querySelector(selector);
      if (element) {
        description = element.textContent.trim();
        break;
      }
    }

    // If still no description, try title and company as fallback
    if (!description) {
      const jobTitle = document.querySelector("h1")?.textContent || "";
      const company =
        document.querySelector('[data-test="employer-name"]')?.textContent ||
        "";
      description = `Job: ${jobTitle} at ${company}`;
    }

    return description;
  }

  /**
   * Find the apply button
   */
  async findApplyButton(container = document) {
    try {
      // Try direct selector
      let applyButton = container.querySelector(CONFIG.SELECTORS.APPLY_BUTTON);

      if (applyButton && this.isElementVisible(applyButton)) {
        return applyButton;
      }

      // Try searching in details panel if available
      const detailsPanel = document.querySelector(
        CONFIG.SELECTORS.JOB_DETAILS_PANEL
      );
      if (detailsPanel && container === document) {
        const panelButton = detailsPanel.querySelector(
          CONFIG.SELECTORS.APPLY_BUTTON
        );
        if (panelButton && this.isElementVisible(panelButton)) {
          return panelButton;
        }
      }

      // Find any button or link with "Easy Apply" text
      const allButtons = Array.from(
        container.querySelectorAll('button, a.button, [role="button"], a')
      );

      for (const button of allButtons) {
        if (!this.isElementVisible(button)) continue;

        const buttonText = button.textContent.toLowerCase().trim();
        const buttonClass = button.className.toLowerCase();
        const buttonId = button.id.toLowerCase();

        if (
          (buttonText.includes("easy apply") ||
            buttonText === "apply" ||
            buttonClass.includes("easyapply") ||
            buttonId.includes("easyapply") ||
            buttonClass.includes("easy-apply")) &&
          !button.disabled &&
          !button.classList.contains("disabled")
        ) {
          return button;
        }
      }

      // Look for tags that might indicate an Easy Apply job and a nearby button
      const easyApplyTags = container.querySelectorAll(
        CONFIG.SELECTORS.EASY_APPLY_TAG
      );
      if (easyApplyTags.length > 0) {
        // If we found easy apply tags, look for a button near them
        for (const tag of easyApplyTags) {
          const nearbyButton = this.findNearbyButton(tag, "apply");
          if (nearbyButton) return nearbyButton;
        }
      }

      return null;
    } catch (error) {
      errorLog("Error finding apply button:", error);
      return null;
    }
  }

  /**
   * Find a button near an element
   */
  findNearbyButton(element, textHint) {
    // Look for siblings
    let sibling = element.nextElementSibling;
    while (sibling) {
      if (
        sibling.tagName === "BUTTON" ||
        sibling.tagName === "A" ||
        sibling.getAttribute("role") === "button"
      ) {
        return sibling;
      }
      sibling = sibling.nextElementSibling;
    }

    // Look for parent containers
    let parent = element.parentElement;
    for (let i = 0; i < 3 && parent; i++) {
      // Only check up to 3 levels up
      const buttons = parent.querySelectorAll(
        'button, a.button, [role="button"]'
      );
      for (const button of buttons) {
        if (
          this.isElementVisible(button) &&
          (button.textContent.toLowerCase().includes(textHint) || !textHint)
        ) {
          return button;
        }
      }
      parent = parent.parentElement;
    }

    return null;
  }

  /**
   * Handle resume upload
   */
  async handleResumeUpload() {
    try {
      this.appendStatusMessage("Checking for resume upload option");

      // Wait for resume upload element
      const resumeUpload = await this.waitForElement(
        CONFIG.SELECTORS.RESUME_UPLOAD,
        5000
      );

      if (resumeUpload && this.profile?.resumeUrl) {
        this.appendStatusMessage("Found resume upload field, uploading resume");

        // Upload resume using file handler
        await this.fileHandler.handleResumeUpload(this.profile, {
          querySelector: () => resumeUpload,
        });

        await this.wait(3000);
        return true;
      }

      // No resume upload found, but that's OK - might be pre-filled
      return false;
    } catch (error) {
      this.appendStatusMessage("Error uploading resume: " + error.message);
      // Continue with application even if resume upload fails
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
      const nextButton = document.querySelector(CONFIG.SELECTORS.NEXT_PAGE);
      if (
        nextButton &&
        this.isElementVisible(nextButton) &&
        !nextButton.disabled
      ) {
        return nextButton;
      }
      return null;
    } catch (error) {
      errorLog("Error finding next button:", error);
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
   * Wait for an element to appear in DOM
   */
  waitForElement(selector, timeout = 5000, container = document) {
    return new Promise((resolve) => {
      if (container.querySelector(selector)) {
        return resolve(container.querySelector(selector));
      }

      const observer = new MutationObserver(() => {
        if (container.querySelector(selector)) {
          resolve(container.querySelector(selector));
          observer.disconnect();
        }
      });

      observer.observe(container === document ? document.body : container, {
        childList: true,
        subtree: true,
      });

      setTimeout(() => {
        observer.disconnect();
        resolve(container.querySelector(selector));
      }, timeout);
    });
  }

  /**
   * Check if element is visible
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
   * Start a countdown timer
   */
  startCountDownTimer(duration, callback) {
    try {
      debugLog("Starting countdown timer", { duration });

      // Find or create timer container
      let timerContainer = document.getElementById(
        "glassdoor-automation-timer"
      );

      if (!timerContainer) {
        timerContainer = document.createElement("div");
        timerContainer.id = "glassdoor-automation-timer";
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
      highlight.className = "glassdoor-result-highlight";
      highlight.style.cssText = `
      position: absolute;
      right: 10px;
      top: 10px;
      background-color: ${
        color === "green"
          ? "rgba(12, 170, 65, 0.9)" // Glassdoor green
          : color === "orange"
          ? "rgba(255, 152, 0, 0.9)"
          : color === "red"
          ? "rgba(244, 67, 54, 0.9)"
          : color === "blue"
          ? "rgba(33, 150, 243, 0.9)"
          : color === "gray"
          ? "rgba(128, 128, 128, 0.9)"
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
          ? "Processed"
          : color === "red"
          ? "Error"
          : color === "blue"
          ? "Loading"
          : color === "gray"
          ? "Not Easy Apply"
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
          ? "#0CAA41" // Glassdoor green
          : color === "orange"
          ? "#FF9800"
          : color === "red"
          ? "#F44336"
          : color === "blue"
          ? "#2196F3"
          : color === "gray"
          ? "#9E9E9E"
          : "#000000"
      };
      border-radius: 4px;
      padding: 4px;
      margin: 4px 0;
      transition: all 0.3s ease;
    `;

      // Remove any existing highlights
      const existingHighlight = card.querySelector(
        ".glassdoor-result-highlight"
      );
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
    container.id = "glassdoor-status-overlay";
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
    background: rgba(12, 170, 65, 0.2);
    border-radius: 12px;
    color: ${CONFIG.BRAND_COLOR};
  `;
    header.appendChild(this.statusIndicator);

    container.appendChild(header);

    // Create log container
    this.logContainer = document.createElement("div");
    this.logContainer.id = "glassdoor-log-container";
    this.logContainer.style.cssText = `
    margin-top: 10px;
    max-height: 220px;
    overflow-y: auto;
    font-size: 12px;
    line-height: 1.4;
  `;

    // Create timer container
    const timerContainer = document.createElement("div");
    timerContainer.id = "glassdoor-automation-status-content";
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
        statusColor = "#0CAA41"; // Glassdoor green
        bgColor = "rgba(12, 170, 65, 0.2)";
        break;
      case "searching":
        statusText = "Searching";
        statusColor = "#ff9800";
        bgColor = "rgba(255, 152, 0, 0.2)";
        break;
      case "applying":
        statusText = "Applying";
        statusColor = CONFIG.BRAND_COLOR;
        bgColor = `rgba(12, 170, 65, 0.2)`;
        break;
      case "success":
        statusText = "Success";
        statusColor = "#0CAA41"; // Glassdoor green
        bgColor = "rgba(12, 170, 65, 0.2)";
        break;
      case "error":
        statusText = "Error";
        statusColor = "#f44336";
        bgColor = "rgba(244, 67, 54, 0.2)";
        break;
      default:
        statusText = status.charAt(0).toUpperCase() + status.slice(1);
        statusColor = CONFIG.BRAND_COLOR;
        bgColor = `rgba(12, 170, 65, 0.2)`;
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
}
// Initialize the automation
debugLog("Creating GlassdoorJobAutomation instance");
const glassdoorAutomation = new GlassdoorJobAutomation();

// Add message listener for backward compatibility
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    const type = message.type || message.action;

    switch (type) {
      case "SEARCH_NEXT":
        glassdoorAutomation.handleSearchNext(message.data);
        sendResponse({ success: true });
        break;

      case "checkStatus":
        sendResponse({
          success: true,
          data: {
            initialized: glassdoorAutomation.state.initialized,
            isApplicationInProgress:
              glassdoorAutomation.state.isApplicationInProgress,
            processedCount: glassdoorAutomation.state.processedLinksCount,
          },
        });
        break;

      case "resetState":
        glassdoorAutomation.state.isApplicationInProgress = false;
        glassdoorAutomation.state.applicationStartTime = null;
        glassdoorAutomation.state.processedUrls = new Set();
        glassdoorAutomation.state.processedLinksCount = 0;
        glassdoorAutomation.updateStatusIndicator("ready");
        glassdoorAutomation.appendStatusMessage("State reset complete");
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
