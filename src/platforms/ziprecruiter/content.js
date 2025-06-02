// ZipRecruiter Job Application Automation
// This script automates applying for jobs on ZipRecruiter with improved state management
import { FileHandler } from "@shared/linkedInUtils";
import { HOST } from "@shared/constants";
import { StateManager } from "@shared/stateManager";
import { canApplyMore } from "@shared/checkAuthorization";
import ZipRecruiterFormHandler from "./zipRecruiterFormHandler";
//waiting for application response
//getProfileData
// Debugging helpers
function debugLog(message, ...args) {
  console.log(`[ZipRecruiter] ${message}`, ...args);
}

function errorLog(message, error) {
  console.error(`[ZipRecruiter Error] ${message}`, error);
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

/**
 * ZipRecruiterAutomation - Content script for automating job applications on ZipRecruiter
 * With improved state management to ensure form completion before moving to next job
 */
class ZipRecruiterAutomation {
  constructor() {
    debugLog("Initializing ZipRecruiterAutomation");

    // Configuration with ZipRecruiter-specific selectors
    this.config = {
      SELECTORS: {
        // Job cards and details
        JOB_CARDS: ".job_result_two_pane",
        JOB_TITLE: "h2.font-bold.text-primary",
        COMPANY_NAME: "[data-testid='job-card-company']",
        LOCATION: "[data-testid='job-card-location']",
        SALARY: "p.text-primary:contains('$')",

        // Apply button and indicators
        APPLY_BUTTON: "button[aria-label*='1-Click Apply']",
        APPLIED_INDICATOR: "button[aria-label*='Applied']",

        // Application modal
        MODAL_CONTAINER: ".ApplyingToHeader",
        MODAL_HEADER: ".ApplyingToHeader",
        MODAL_QUESTIONS: ".question_form fieldset",
        MODAL_SELECT: "[role='combobox']",
        MODAL_SELECT_OPTIONS: "[role='listbox'] li",
        MODAL_CONTINUE_BUTTON: "button[type='submit']",
        MODAL_SUCCESS: ".apply-success, .application-success",

        // No jobs found
        NO_JOBS_FOUND: ".jobs_not_found",
        SUGGESTED_SEARCH: ".suggested_search_subsection",

        // Pagination
        NEXT_PAGE_BUTTON: "a[title='Next Page']",
        PAGINATION_CONTAINER: ".pagination_container_two_pane",
        LAST_PAGE_INDICATOR: "button[title='Next Page'][disabled]",
      },
      TIMEOUTS: {
        STANDARD: 3000,
        EXTENDED: 8000,
        // Increased timeout for applications to allow more time for form completion
        APPLICATION_TIMEOUT: 8 * 60 * 1000, // 8 minutes
      },
      PLAN_LIMITS: {
        FREE: 10,
        STARTER: 50,
        PRO: 500,
      },
      DEBUG: true,
      BRAND_COLOR: "#4a90e2", // FastApply brand blue
    };

    // State tracking - simplified and consolidated
    this.state = {
      initialized: false,
      ready: false,
      isRunning: false,

      // Application state - critical for coordination
      isApplicationInProgress: false,
      applicationStartTime: null,
      formDetected: false,

      // Job tracking
      processedCards: new Set(),
      processedCount: 0,
      currentJobIndex: 0,
      lastProcessedCard: null,
      currentJobDetails: null,

      // Activity tracking
      lastActivity: Date.now(),

      // Lock for preventing parallel job processing
      jobProcessingLock: false,

      // Pagination tracking
      currentPage: 1,
      totalPages: 0,
      noMorePages: false,
    };

    // User data and job management
    this.userData = null;
    this.profile = null;
    this.stateManager = new StateManager();

    // Create status overlay
    this.createStatusOverlay();

    // Create file handler for resume uploads
    this.fileHandler = new FileHandler({
      show: (message, type) => {
        debugLog(`[${type || "info"}] ${message}`);
        this.appendStatusMessage(message);
      },
    });

    // Set the API host
    this.HOST = HOST || "https://fastapply.co";

    // Initialize on document ready
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => this.init());
    } else {
      this.init();
    }

    // Set up health check timer - less frequent but more thorough
    this.healthCheckTimer = setInterval(() => this.checkHealth(), 60000);

    // Set up mutation observer to detect form elements appearing
    // this.setupFormDetectionObserver();
  }

  /**
   * Create a status overlay on the page
   */
  createStatusOverlay() {
    // Create container
    const container = document.createElement("div");
    container.id = "ziprecruiter-status-overlay";
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
      border-left: 4px solid ${this.config.BRAND_COLOR};
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
      color: ${this.config.BRAND_COLOR};
    `;

    const logoText = document.createElement("span");
    logoText.textContent = "FastApply";
    logoText.style.color = this.config.BRAND_COLOR;

    logoDiv.appendChild(logoIcon);
    logoDiv.appendChild(logoText);
    header.appendChild(logoDiv);

    // Status indicator
    this.statusIndicator = document.createElement("span");
    this.statusIndicator.textContent = "Initializing...";
    this.statusIndicator.style.cssText = `
      font-size: 12px;
      padding: 3px 8px;
      background: rgba(228, 233, 239, 0.9);
      border-radius: 12px;
      color: ${this.config.BRAND_COLOR};
    `;
    header.appendChild(this.statusIndicator);

    container.appendChild(header);

    // Create log container
    this.logContainer = document.createElement("div");
    this.logContainer.id = "ziprecruiter-log-container";
    this.logContainer.style.cssText = `
      margin-top: 10px;
      max-height: 220px;
      overflow-y: auto;
      font-size: 12px;
      line-height: 1.4;
    `;

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
      
      .job-highlight {
        animation: fastApplyFadeIn 0.3s ease-in;
      }
    `;
    document.head.appendChild(style);
  }

  async init() {
    try {
      const url = window.location.href;
      debugLog("Initializing on URL:", url);

      // Check for pending applications in localStorage
      this.checkPendingApplications();

      // Check if we're on a search results page
      if (
        url.includes("ziprecruiter.com/jobs") ||
        url.includes("ziprecruiter.com/search")
      ) {
        this.appendStatusMessage("ZipRecruiter search page detected");

        // Check if no jobs were found
        if (this.checkNoJobsFound()) {
          this.appendStatusMessage("No jobs found for this search");
          this.updateStatusIndicator("completed");
          return;
        }

        // Check and record pagination info
        this.detectPaginationInfo();
      }

      // Check if we're on a job details page
      else if (
        url.includes("ziprecruiter.com/jobs/") ||
        url.includes("ziprecruiter.com/job/")
      ) {
        this.appendStatusMessage("ZipRecruiter job details page detected");

        // Look for apply button
        setTimeout(() => this.checkForApplyButton(), 1000);
      }

      this.state.initialized = true;
      this.state.ready = true;
      this.updateStatusIndicator("ready");

      // Automatically start automation after initialization if on search page
      setTimeout(() => {
        if (
          (url.includes("ziprecruiter.com/jobs") ||
            url.includes("ziprecruiter.com/search")) &&
          !this.state.isRunning
        ) {
          this.startAutomation();
        }
      }, 3000);
    } catch (error) {
      errorLog("Error in init:", error);
      this.appendStatusErrorMessage("Initialization error: " + error.message);
    }
  }

  /**
   * Check for pending applications in localStorage
   */
  async checkPendingApplications() {
    try {
      const pendingData = localStorage.getItem(
        "ziprecruiter_completed_applications"
      );
      if (!pendingData) return;

      const pendingApplications = JSON.parse(pendingData);
      if (
        !Array.isArray(pendingApplications) ||
        pendingApplications.length === 0
      )
        return;

      this.appendStatusMessage(
        `Found ${pendingApplications.length} pending applications to process`
      );

      // Process each pending application
      const updatedApplications = [];

      for (const app of pendingApplications) {
        if (app.processed) {
          updatedApplications.push(app);
          continue;
        }

        try {
          // Send to background script
          chrome.runtime.sendMessage({
            action: "applicationCompleted",
            data: app.details,
            url: app.url,
          });

          // Mark as processed
          app.processed = true;
          this.appendStatusMessage(
            `Processed pending application for ${
              app.details?.title || "unknown job"
            }`
          );
        } catch (e) {
          this.appendStatusErrorMessage(
            `Failed to process pending application: ${e.message}`
          );
        }

        updatedApplications.push(app);
      }

      // Save updated list back to localStorage
      localStorage.setItem(
        "ziprecruiter_completed_applications",
        JSON.stringify(updatedApplications)
      );

      // Consider cleaning up old processed applications (over 1 day old)
      this.cleanupOldApplications(updatedApplications);
    } catch (error) {
      errorLog("Error checking pending applications:", error);
    }
  }

  /**
   * Clean up old applications
   */
  cleanupOldApplications(applications) {
    try {
      if (!Array.isArray(applications)) return;

      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      const filteredApps = applications.filter((app) => {
        // Keep unprocessed applications regardless of age
        if (!app.processed) return true;

        // Filter out processed applications older than one day
        return app.timestamp > oneDayAgo;
      });

      if (filteredApps.length !== applications.length) {
        localStorage.setItem(
          "ziprecruiter_completed_applications",
          JSON.stringify(filteredApps)
        );
        this.appendStatusMessage(
          `Cleaned up ${
            applications.length - filteredApps.length
          } old processed applications`
        );
      }
    } catch (error) {
      errorLog("Error cleaning up old applications:", error);
    }
  }

  /**
   * Store application in localStorage
   */
  storeApplicationInLocalStorage(jobDetails) {
    try {
      // Create a timestamped record
      const applicationRecord = {
        details: jobDetails,
        url: window.location.href,
        timestamp: Date.now(),
        status: "SUCCESS",
        userId: this.userData?.userId,
        processed: false,
      };

      // Get existing stored applications
      let storedApplications = [];
      const existingData = localStorage.getItem(
        "ziprecruiter_completed_applications"
      );

      if (existingData) {
        try {
          storedApplications = JSON.parse(existingData);
        } catch (e) {
          // If parsing fails, start with empty array
          storedApplications = [];
        }
      }

      // Add new record and save back to localStorage
      storedApplications.push(applicationRecord);
      localStorage.setItem(
        "ziprecruiter_completed_applications",
        JSON.stringify(storedApplications)
      );

      this.appendStatusMessage("Application data saved to localStorage");
    } catch (error) {
      errorLog("Error storing application in localStorage:", error);
    }
  }

  /**
   * Send application completed event to background script
   */
  sendApplicationCompletedToBackground(jobDetails) {
    try {
      this.appendStatusMessage(
        "Sending applicationCompleted event to background script"
      );

      // Store application in localStorage as backup
      this.storeApplicationInLocalStorage(jobDetails);

      // Send message to background script
      chrome.runtime.sendMessage({
        action: "applicationCompleted",
        data: jobDetails,
        url: window.location.href,
      });

      // Log success
      this.appendStatusMessage("Application completion message sent");
    } catch (error) {
      errorLog("Error sending completion to background:", error);
    }
  }

  /**
   * Detect and record pagination information
   */
  detectPaginationInfo() {
    try {
      const paginationContainer = document.querySelector(
        this.config.SELECTORS.PAGINATION_CONTAINER
      );

      if (!paginationContainer) {
        this.appendStatusMessage(
          "No pagination detected, assuming single page"
        );
        this.state.totalPages = 1;
        return;
      }

      // Try to find current page and total pages from pagination links
      const pageLinks =
        paginationContainer.querySelectorAll("a[title^='Page:']");

      if (pageLinks && pageLinks.length > 0) {
        // Extract page numbers from titles
        const pageNumbers = Array.from(pageLinks)
          .map((link) => {
            const titleMatch = link.getAttribute("title").match(/Page: (\d+)/);
            return titleMatch ? parseInt(titleMatch[1], 10) : 0;
          })
          .filter((num) => num > 0);

        // Get highest page number as total pages
        if (pageNumbers.length > 0) {
          this.state.totalPages = Math.max(...pageNumbers);
        }

        // Find current page - either from URL or from active link
        const urlParams = new URLSearchParams(window.location.search);
        const pageParam = urlParams.get("page");

        if (pageParam) {
          this.state.currentPage = parseInt(pageParam, 10);
        } else {
          // Look for the active page link (has different styling)
          const activeLinks = Array.from(
            paginationContainer.querySelectorAll("a")
          ).filter((link) => {
            return (
              link.classList.contains("bg-button-primary-default") ||
              window.getComputedStyle(link).backgroundColor !== "transparent"
            );
          });

          if (activeLinks.length > 0) {
            const titleMatch = activeLinks[0]
              .getAttribute("title")
              ?.match(/Page: (\d+)/);
            if (titleMatch) {
              this.state.currentPage = parseInt(titleMatch[1], 10);
            }
          }
        }

        this.appendStatusMessage(
          `Detected pagination: Page ${this.state.currentPage} of ${this.state.totalPages}`
        );
      } else {
        // If we can't detect pages properly, assume we're on page 1
        this.state.currentPage = 1;
        this.state.totalPages = 1;
      }

      // Check if we're on the last page
      const nextPageDisabled = paginationContainer.querySelector(
        this.config.SELECTORS.LAST_PAGE_INDICATOR
      );
      if (nextPageDisabled) {
        this.appendStatusMessage("Detected last page of results");
        this.state.noMorePages = true;
      }
    } catch (error) {
      errorLog("Error detecting pagination:", error);
      // Default to safe values
      this.state.currentPage = 1;
      this.state.totalPages = 1;
    }
  }

  /**
   * Check if no jobs were found for the search
   */
  checkNoJobsFound() {
    const noJobsElement = document.querySelector(
      this.config.SELECTORS.NO_JOBS_FOUND
    );
    return noJobsElement !== null;
  }

  /**
   * Begin application process - centralized state management
   * Returns a promise to ensure proper flow control
   */
  async beginApplication() {
    return new Promise((resolve) => {
      // Set critical state flags
      this.state.isApplicationInProgress = true;
      this.state.applicationStartTime = Date.now();

      // Update UI
      this.updateStatusIndicator("applying");
      this.appendStatusMessage("Application process started");

      // Small delay to ensure UI updates
      setTimeout(resolve, 100);
    });
  }

  /**
   * End application process - centralized state management
   * Returns a promise to ensure proper flow control
   */
  async endApplication(success) {
    return new Promise((resolve) => {
      // Clear critical state flags
      this.state.isApplicationInProgress = false;
      this.state.applicationStartTime = null;
      this.state.formDetected = false;

      // Update UI based on result
      if (success) {
        this.updateStatusIndicator("success");
        this.state.processedCount++;
      } else {
        this.updateStatusIndicator("error");
      }

      this.appendStatusMessage(
        `Application process ended (${success ? "success" : "failure"})`
      );

      // Small delay to ensure UI updates
      setTimeout(resolve, 100);
    });
  }

  /**
   * Start the automation process - Main entry point for processing
   */
  async startAutomation() {
    try {
      if (this.state.isRunning) {
        this.appendStatusMessage("Automation already running");
        return;
      }

      // Check if no jobs were found
      if (this.checkNoJobsFound()) {
        this.appendStatusMessage("No jobs found for this search");
        this.updateStatusIndicator("completed");
        return;
      }

      this.appendStatusMessage("Starting automation");
      this.updateStatusIndicator("running");

      // Initialize state
      this.state.isRunning = true;
      this.state.currentJobIndex = 0;
      this.state.processedCount = 0;
      this.state.lastActivity = Date.now();
      this.state.formDetected = false;
      this.state.isApplicationInProgress = false;
      this.state.applicationStartTime = null;
      this.state.lastProcessedCard = null;
      this.state.jobProcessingLock = false;
      this.state.noMorePages = false;

      // Detect pagination if not done already
      if (this.state.totalPages === 0) {
        this.detectPaginationInfo();
      }

      // Fetch profile data if not already available
      if (!this.profile) {
        this.profile = await this.getProfileData();
      }

      // Process first job
      await this.processNextJob();
    } catch (error) {
      errorLog("Error starting automation:", error);
      this.appendStatusErrorMessage(
        "Failed to start automation: " + error.message
      );
      this.state.isRunning = false;
    }
  }

  /**
   * Process next job with proper locking mechanism to prevent parallel processing
   */
  async processNextJob() {
    try {
      // Don't proceed if automation is stopped
      if (!this.state.isRunning) {
        this.appendStatusMessage("Automation stopped");
        return;
      }

      // Critical check: Don't proceed if an application is in progress or if we have the lock
      if (this.state.isApplicationInProgress || this.state.jobProcessingLock) {
        this.appendStatusMessage(
          "Application in progress or job processing locked, waiting..."
        );

        // Check if application is stuck
        if (this.state.applicationStartTime) {
          const elapsed = Date.now() - this.state.applicationStartTime;
          // Allow a much longer timeout (8 minutes) to ensure form completion
          if (elapsed > this.config.TIMEOUTS.APPLICATION_TIMEOUT) {
            this.appendStatusMessage(
              "Application appears stuck, performing recovery"
            );

            // Try to close any open modals
            await this.closeFailedApplicationModals();

            // Force reset the application state
            await this.endApplication(false);
            this.state.jobProcessingLock = false;

            // Wait a moment before trying the next job
            setTimeout(() => this.processNextJob(), 5000);
          } else {
            // Check again after a delay
            setTimeout(() => this.processNextJob(), 5000);
          }
        } else {
          // Check again after a delay
          setTimeout(() => this.processNextJob(), 5000);
        }
        return;
      }

      // Acquire the lock
      this.state.jobProcessingLock = true;
      this.appendStatusMessage("Looking for next job to process");

      // Get all job cards that haven't been processed yet
      const jobCards = this.getUnprocessedJobCards();

      if (jobCards.length === 0) {
        // Try to load more jobs by going to the next page
        if (this.state.noMorePages) {
          // We've reached the end of all available pages
          this.appendStatusMessage(
            "No more jobs or pages to process. Completed all available jobs."
          );
          this.updateStatusIndicator("completed");
          this.state.isRunning = false;
          this.state.jobProcessingLock = false;
          return;
        }

        // Try to move to the next page
        if (await this.goToNextPage()) {
          // Wait for page to load and try again
          this.appendStatusMessage(
            `Navigated to page ${this.state.currentPage}. Waiting for page to load...`
          );
          this.state.jobProcessingLock = false;
          setTimeout(() => this.processNextJob(), 3000);
        } else {
          // Could not go to next page or no more pages
          this.appendStatusMessage(
            "No more pages available. Completed automation."
          );
          this.updateStatusIndicator("completed");
          this.state.isRunning = false;
          this.state.jobProcessingLock = false;
        }
        return;
      }

      // Process the first unprocessed job card
      const jobCard = jobCards[0];
      this.state.lastProcessedCard = jobCard;

      // Mark as processing
      this.markJobCard(jobCard, "processing");

      // Extract job details before clicking the card
      const jobDetails = this.extractJobDetailsFromCard(jobCard);
      this.currentJobDetails = jobDetails;

      // First, click on the job card to view details
      this.appendStatusMessage("Clicking job card to view details");

      // Find the clickable element within the job card (usually the title or the card itself)
      const clickableElement = jobCard.querySelector("h2 a") || jobCard;

      // Begin application process with proper state management
      await this.beginApplication();

      // Click the job card
      clickableElement.click();

      // Wait for job details to load
      this.appendStatusMessage("Waiting for job details to load");

      // Use a promise to ensure we wait for the completion
      await new Promise((resolve) => {
        setTimeout(() => resolve(), 2000);
      });

      // Process the apply button in the job detail view
      await this.processJobDetailView(jobCard);
    } catch (error) {
      errorLog("Error processing job:", error);
      this.appendStatusErrorMessage("Error processing job: " + error.message);

      // Always release the lock and reset application state in case of error
      this.state.jobProcessingLock = false;
      await this.endApplication(false);

      // Mark current card as error if available
      if (this.state.lastProcessedCard) {
        this.markJobCard(this.state.lastProcessedCard, "error");
      }

      // Try the next job after a delay
      setTimeout(() => this.processNextJob(), 5000);
    }
  }

  /**
   * Process the job detail view (after clicking a job card)
   * Returns a promise that resolves when the process is complete
   */
  async processJobDetailView(jobCard) {
    try {
      // Find the apply button in the detail view using multiple methods
      let applyButton = document.querySelector(
        this.config.SELECTORS.APPLY_BUTTON
      );

      // Fallback if the selector doesn't work
      if (!applyButton) {
        const buttons = Array.from(document.querySelectorAll("button"));
        applyButton = buttons.find((btn) => {
          const buttonText = btn.innerText || btn.textContent || "";
          return (
            buttonText.includes("1-Click Apply") ||
            buttonText.includes("Quick Apply") ||
            buttonText.includes("Continue Application")
          );
        });
      }

      if (!applyButton || !this.isElementVisible(applyButton)) {
        this.appendStatusMessage(
          "No apply button found in details, skipping job"
        );
        this.markJobCard(jobCard, "skipped");
        this.state.processedCards.add(this.getJobCardId(jobCard));

        // End the application process (failure)
        await this.endApplication(false);

        // Release the lock
        this.state.jobProcessingLock = false;

        // Move to next job after a delay
        setTimeout(() => this.processNextJob(), 2000);
        return;
      }

      // Check if already applied
      if (applyButton.textContent.includes("Applied")) {
        this.appendStatusMessage("Job already applied to");
        // Changed from "skipped" to "already_applied"
        this.markJobCard(jobCard, "already_applied");
        this.state.processedCards.add(this.getJobCardId(jobCard));

        // End the application process
        await this.endApplication(false);

        // Release the lock
        this.state.jobProcessingLock = false;

        // Move to next job after a delay
        setTimeout(() => this.processNextJob(), 2000);
        return;
      }

      // Found an Apply button, start the application
      this.appendStatusMessage(
        `Found ${applyButton.textContent.trim()} button, starting application`
      );

      // Mark card as processed
      this.state.processedCards.add(this.getJobCardId(jobCard));

      // Click the apply button
      this.appendStatusMessage(
        `Clicking ${applyButton.textContent.trim()} button`
      );
      applyButton.click();

      // Wait for application process to complete
      await this.handleApplicationAfterClick(jobCard);
    } catch (error) {
      errorLog("Error processing job detail view:", error);
      this.appendStatusErrorMessage("Error processing job: " + error.message);

      // Mark as error and release lock
      this.markJobCard(jobCard, "error");
      this.state.processedCards.add(this.getJobCardId(jobCard));

      // End application process
      await this.endApplication(false);
      this.state.jobProcessingLock = false;

      // Move to next job after a delay
      setTimeout(() => this.processNextJob(), 3000);
    }
  }

  /**
   * Handle the application form filling process
   * Returns a promise that resolves to true on success, false on failure
   */
  async handleApplyForm() {
    try {
      this.appendStatusMessage("Processing application form");

      // Check if we need to handle resume upload first
      const resumeUploadHandled = await this.handleResumeUploadIfNeeded();

      // Initialize the form handler with necessary data
      const formHandler = new ZipRecruiterFormHandler({
        logger: (message) => this.appendStatusMessage(message),
        userData: this.profile || this.getFallbackProfile(),
        jobDescription: this.currentJobDetails
          ? `${this.currentJobDetails.title} at ${this.currentJobDetails.company} in ${this.currentJobDetails.location}`
          : "",
        fileHandler: this.fileHandler,
      });

      // Fill the form
      const success = await formHandler.fillCompleteForm();

      if (success) {
        this.appendStatusMessage("Form filled and submitted successfully");
        return true;
      } else {
        this.appendStatusErrorMessage(
          "Form handler could not complete application"
        );

        // Try to close any error modals
        await this.closeFailedApplicationModals();

        // If we at least uploaded the resume, that might be considered partial success
        return resumeUploadHandled;
      }
    } catch (error) {
      errorLog("Form handler error:", error);
      this.appendStatusErrorMessage("Error filling form: " + error.message);

      // Try to close any error modals
      await this.closeFailedApplicationModals();

      return false;
    }
  }

  /**
   * Handle resume upload if needed
   */
  async handleResumeUploadIfNeeded() {
    try {
      this.appendStatusMessage("Checking for resume upload fields...");

      // Find resume upload fields
      const resumeFields = this.findResumeUploadFields();

      if (resumeFields.length === 0) {
        this.appendStatusMessage(
          "No resume upload fields found, continuing with normal form flow"
        );
        return false;
      }

      this.appendStatusMessage(
        `Found ${resumeFields.length} resume upload fields, handling them directly`
      );

      // Get user profile
      const profile = this.profile || this.getFallbackProfile();

      // Check if we have a resume URL
      if (!profile.resumeUrl) {
        // Try to find resume URL in different possible locations
        profile.resumeUrl = profile.cv?.url || profile.resume?.url;
      }

      if (!profile.resumeUrl) {
        this.appendStatusErrorMessage("No resume URL found in profile");
        return false;
      }

      // Process each resume field
      let success = false;
      for (const field of resumeFields) {
        this.appendStatusMessage(
          `Uploading resume to field: ${this.getFieldDescription(field)}`
        );

        // Use the file handler to upload the resume
        success = await this.uploadResumeToField(field, profile);

        if (success) {
          this.appendStatusMessage("Resume uploaded successfully");
          break; // One successful upload is enough
        }
      }

      // Check if we should proceed with form submission
      if (success && this.isResumeOnlyForm()) {
        this.appendStatusMessage(
          "This appears to be a resume-only form, continuing..."
        );

        // Find and click continue button
        const continueButton = this.findContinueButton();
        if (continueButton) {
          this.appendStatusMessage(
            "Clicking continue button after resume upload"
          );
          continueButton.click();

          // Wait for next step to load
          await new Promise((resolve) => setTimeout(resolve, 2000));

          return true;
        }
      }

      return success;
    } catch (error) {
      this.appendStatusErrorMessage(
        `Error handling resume upload: ${error.message}`
      );
      return false;
    }
  }

  /**
   * Find resume upload fields in the document
   */
  findResumeUploadFields() {
    try {
      // Look for all file inputs
      const allFileInputs = document.querySelectorAll('input[type="file"]');

      // Filter to find resume upload fields
      return Array.from(allFileInputs).filter((input) => {
        // Check the input's attributes
        const inputId = input.id || "";
        const inputName = input.name || "";
        const inputAccept = input.accept || "";

        // Check if this looks like a resume upload
        if (
          inputId.toLowerCase().includes("resume") ||
          inputName.toLowerCase().includes("resume") ||
          inputId.toLowerCase().includes("cv") ||
          inputName.toLowerCase().includes("cv")
        ) {
          return true;
        }

        // Check accept attribute for document types
        if (
          inputAccept.includes("pdf") ||
          inputAccept.includes("doc") ||
          inputAccept.includes("application/msword")
        ) {
          // Now check surrounding elements for resume keywords
          const container = input.closest("fieldset") || input.parentElement;
          const containerText = container
            ? container.textContent.toLowerCase()
            : "";

          return (
            containerText.includes("resume") ||
            containerText.includes("cv") ||
            containerText.includes("upload") ||
            containerText.includes("attach")
          );
        }

        return false;
      });
    } catch (error) {
      this.appendStatusErrorMessage(
        `Error finding resume fields: ${error.message}`
      );
      return [];
    }
  }

  /**
   * Get a user-friendly description of a field
   */
  getFieldDescription(field) {
    try {
      // Try to get a label
      const container = field.closest("fieldset") || field.parentElement;

      if (container) {
        const label = container.querySelector(
          "label, span.text-primary, p.text-primary"
        );
        if (label && label.textContent) {
          return label.textContent.trim();
        }
      }

      // If no label found, use the field's attributes
      return `${field.id || field.name || "File input"}`;
    } catch (error) {
      return "File input field";
    }
  }

  /**
   * Upload resume to a specific field
   */
  async uploadResumeToField(field, profile) {
    try {
      // Use the fileHandler if available
      if (this.fileHandler) {
        this.appendStatusMessage("Using fileHandler to upload resume");

        // Create dummy container for the fileHandler
        const form = field.closest("form") || document.createElement("form");

        // Adapt profile format if needed for the fileHandler
        const adaptedProfile = {
          ...profile,
          cv: { url: profile.resumeUrl },
        };

        return await this.fileHandler.handleLeverResumeUpload(
          adaptedProfile,
          form
        );
      }

      // Fallback to direct upload if fileHandler fails or isn't available
      return await this.uploadFileFromUrl(field, profile.resumeUrl, profile);
    } catch (error) {
      this.appendStatusErrorMessage(`Error uploading resume: ${error.message}`);
      return false;
    }
  }

  /**
   * Upload a file from URL to a file input element
   */
  async uploadFileFromUrl(fileInput, url, userData) {
    try {
      this.appendStatusMessage(`Uploading file from ${url}`);

      // Use proxy to avoid CORS issues
      const proxyURL = `${this.HOST}/api/proxy-file?url=${encodeURIComponent(
        url
      )}`;

      const response = await fetch(proxyURL);
      if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.statusText}`);
      }

      const blob = await response.blob();
      if (!blob || blob.size === 0) {
        throw new Error("Downloaded file is empty");
      }

      // Create a filename
      let filename = "resume.pdf";

      // Try to get from content-disposition
      const contentDisposition = response.headers.get("content-disposition");
      if (contentDisposition) {
        const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(
          contentDisposition
        );
        if (matches && matches[1]) {
          filename = matches[1].replace(/['"]/g, "");
        }
      }

      // Use user data for better filename
      if (userData.firstName && userData.lastName) {
        const ext = filename.split(".").pop() || "pdf";
        filename = `${userData.firstName}_${userData.lastName}_resume.${ext}`;
      }

      // Create File object
      const file = new File([blob], filename, {
        type: blob.type || "application/pdf",
        lastModified: Date.now(),
      });

      // Set the file to the input
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInput.files = dataTransfer.files;

      // Dispatch necessary events
      await this.triggerFileEvents(fileInput);

      // Check if file was set successfully
      return fileInput.files.length > 0;
    } catch (error) {
      this.appendStatusErrorMessage(`Error uploading file: ${error.message}`);
      return false;
    }
  }

  /**
   * Trigger events to simulate human interaction with file input
   */
  async triggerFileEvents(fileInput) {
    const events = ["focus", "click", "change", "input"];

    for (const eventName of events) {
      await this.sleep(100);
      fileInput.dispatchEvent(new Event(eventName, { bubbles: true }));
    }

    // Additional wait for processing
    await this.sleep(1000);
  }

  /**
   * Check if this is a form that only requires a resume upload
   */
  isResumeOnlyForm() {
    // Check if there's just one or two form fields (resume and maybe zipcode)
    const formFields = document.querySelectorAll(
      "fieldset, .question_form fieldset"
    );

    if (formFields.length <= 1) {
      return true;
    }

    if (formFields.length === 2) {
      // Check if one field is zipcode (common pattern)
      const fieldTexts = Array.from(formFields).map((field) =>
        field.textContent.toLowerCase()
      );

      // If one field contains "zipcode" and one contains "resume", it's a resume+zipcode form
      const hasZipcode = fieldTexts.some(
        (text) => text.includes("zipcode") || text.includes("zip code")
      );
      const hasResume = fieldTexts.some(
        (text) => text.includes("resume") || text.includes("cv")
      );

      if (hasZipcode && hasResume) {
        return true;
      }
    }

    return false;
  }

  /**
   * Find the continue/submit button for the form
   */
  findContinueButton() {
    // Try various selectors for continue/submit buttons
    return (
      document.querySelector('button[type="submit"]') ||
      Array.from(document.querySelectorAll("button")).find(
        (btn) =>
          btn.textContent.toLowerCase().includes("continue") ||
          btn.textContent.toLowerCase().includes("submit") ||
          btn.textContent.toLowerCase().includes("next")
      )
    );
  }

  /**
   * Close modal dialogs after a failed application
   * Returns a promise to ensure sequence
   */
  async closeFailedApplicationModals() {
    try {
      this.appendStatusMessage("Attempting to close any open modals");

      // First, try to find and click the main "Close" button
      const closeButtons = Array.from(
        document.querySelectorAll(
          'button[title="Close"], button[aria-label="Close"]'
        )
      );

      // Also look for buttons with an X icon (SVG)
      const svgCloseButtons = Array.from(
        document.querySelectorAll("button")
      ).filter((btn) => {
        return (
          btn.querySelector('svg path[d*="m8 8.992 16 16M24 8.987l-16 16"]') ||
          (btn.innerHTML.includes("<svg") &&
            btn.innerHTML.includes("path") &&
            (btn.getAttribute("aria-label") === "Close" ||
              btn.getAttribute("title") === "Close"))
        );
      });

      // Combine both types of close buttons
      const allCloseButtons = [...closeButtons, ...svgCloseButtons];

      let closedFirst = false;
      if (allCloseButtons.length > 0) {
        // Find the visible one
        const visibleCloseButton = allCloseButtons.find((btn) =>
          this.isElementVisible(btn)
        );

        if (visibleCloseButton) {
          this.appendStatusMessage("Clicking Close button to dismiss modal");
          visibleCloseButton.click();
          closedFirst = true;

          // Wait for the first modal to close and potentially the second to appear
          await this.sleep(1500);
        }
      }

      // Now look for the "Save & Exit" button that might appear after closing the first modal
      const saveExitButtons = Array.from(
        document.querySelectorAll("button")
      ).filter((btn) => {
        const text = btn.textContent || btn.innerText || "";
        return (
          text.includes("Save & Exit") ||
          text.includes("Save and Exit") ||
          (btn.querySelector("p") &&
            btn.querySelector("p").textContent.includes("Save & Exit"))
        );
      });

      if (saveExitButtons.length > 0) {
        const visibleSaveExitButton = saveExitButtons.find((btn) =>
          this.isElementVisible(btn)
        );

        if (visibleSaveExitButton) {
          this.appendStatusMessage(
            "Clicking Save & Exit to complete dismissal"
          );
          visibleSaveExitButton.click();

          // Wait for the secondary modal to close
          await this.sleep(1500);
          return true;
        }
      }

      return closedFirst; // Return true if at least the first modal was closed
    } catch (error) {
      errorLog("Error closing modals:", error);
      return false;
    }
  }

  /**
   * Set up a mutation observer to detect form elements appearing
   * Improved to avoid interference with ongoing application
   */
  // setupFormDetectionObserver() {
  //   try {
  //     // Create a new observer
  //     this.formObserver = new MutationObserver((mutations) => {
  //       // Only check for new forms if we're in an application process but don't have a form yet
  //       if (this.state.isApplicationInProgress && !this.state.formDetected) {
  //         const modalContainer = document.querySelector(
  //           this.config.SELECTORS.MODAL_CONTAINER
  //         );

  //         if (modalContainer && this.isElementVisible(modalContainer)) {
  //           debugLog("Form detected by mutation observer");
  //           this.state.formDetected = true;

  //           // Only log - don't start a new application process
  //           this.appendStatusMessage("Application form detected");
  //         }
  //       }
  //     });

  //     // Start observing the document
  //     this.formObserver.observe(document.documentElement, {
  //       childList: true,
  //       subtree: true,
  //     });

  //     debugLog("Form detection observer set up");
  //   } catch (error) {
  //     errorLog("Error setting up form observer:", error);
  //   }
  // }

  /**
   * Check for apply button on job details page
   */
  async checkForApplyButton() {
    try {
      // Find the apply button using more reliable selectors
      let applyButton = document.querySelector(
        this.config.SELECTORS.APPLY_BUTTON
      );

      // Fallback: Try to find by inner text if the selector didn't work
      if (!applyButton) {
        const buttons = Array.from(document.querySelectorAll("button"));
        applyButton = buttons.find((btn) => {
          // Check if the button or its children contain any of the apply button variations
          const buttonText = btn.innerText || btn.textContent || "";
          return (
            buttonText.includes("1-Click Apply") ||
            buttonText.includes("Quick Apply") ||
            buttonText.includes("Continue Application")
          );
        });
      }

      if (applyButton && this.isElementVisible(applyButton)) {
        this.appendStatusMessage("Found apply button");

        // Check if already applied
        if (applyButton.textContent.includes("Applied")) {
          this.appendStatusMessage("Job has already been applied to");
          return;
        }

        // Get profile data
        this.profile = await this.getProfileData();

        if (this.profile) {
          // Begin application process
          await this.beginApplication();

          // Extract job details before clicking apply
          const jobDetails = this.extractJobDetailsFromPage();
          this.currentJobDetails = jobDetails;

          // Click the apply button
          this.appendStatusMessage(
            `Clicking ${applyButton.textContent.trim()} button`
          );
          applyButton.click();

          // Use the same handler as in the job card flow
          await this.handleApplicationAfterClick(null);
        } else {
          this.appendStatusErrorMessage(
            "Could not get profile data for application"
          );
        }
      } else {
        this.appendStatusMessage("No apply button found on this page");
      }
    } catch (error) {
      errorLog("Error checking for apply button:", error);
      this.appendStatusErrorMessage(
        "Error checking for apply button: " + error.message
      );

      // Reset application state
      await this.endApplication(false);
    }
  }

  /**
   * Go to next page of jobs
   * Enhanced to update pagination state and detect last page
   */
  async goToNextPage() {
    try {
      // If we already know there are no more pages, don't try
      if (this.state.noMorePages) {
        this.appendStatusMessage("Already at the last page of results");
        return false;
      }

      // First try to find the next page button using the specific selector
      let nextButton = document.querySelector(
        this.config.SELECTORS.NEXT_PAGE_BUTTON
      );

      // Fallback to more generic selectors if needed
      if (!nextButton) {
        nextButton = document.querySelector(".next, .next-page, a[rel='next']");
      }

      // Final fallback - look for any link with "Next" text
      if (!nextButton) {
        const links = Array.from(document.querySelectorAll("a"));
        nextButton = links.find(
          (link) =>
            (link.textContent || "").trim().toLowerCase() === "next" ||
            link.title?.toLowerCase().includes("next page")
        );
      }

      if (nextButton && this.isElementVisible(nextButton)) {
        // Check if the button is disabled
        const isDisabled =
          nextButton.hasAttribute("disabled") ||
          nextButton.classList.contains("disabled") ||
          nextButton.getAttribute("aria-disabled") === "true";

        if (isDisabled) {
          this.appendStatusMessage(
            "Next page button is disabled - reached the last page"
          );
          this.state.noMorePages = true;
          return false;
        }

        // Get the current URL to check for page parameter later
        const currentUrl = window.location.href;

        // Update state before navigation
        this.state.currentPage++;
        this.appendStatusMessage(
          `Moving to page ${this.state.currentPage} of results`
        );

        // Click the next button
        nextButton.click();

        // Wait for navigation to complete
        return new Promise((resolve) => {
          const checkNavigation = () => {
            if (window.location.href !== currentUrl) {
              // Page has changed, navigation successful

              // Check for no results on new page
              if (this.checkNoJobsFound()) {
                this.appendStatusMessage("No jobs found on new page");
                this.state.noMorePages = true;
                resolve(false);
                return;
              }

              // Update pagination info on the new page
              this.detectPaginationInfo();
              resolve(true);
            } else {
              // Still on same page, check again shortly
              setTimeout(checkNavigation, 500);
            }
          };

          // Start checking after a short delay
          setTimeout(checkNavigation, 1000);

          // Set a max timeout to prevent hanging
          setTimeout(() => {
            this.appendStatusMessage(
              "Navigation timeout - assuming navigation failed"
            );
            resolve(false);
          }, 10000);
        });
      }

      this.appendStatusMessage(
        "No next page button found - reached the last page"
      );
      this.state.noMorePages = true;
      return false;
    } catch (error) {
      errorLog("Error going to next page:", error);
      return false;
    }
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
   * Get profile data
   */
  async getProfileData() {
    try {
      // Return cached profile if available
      if (this.profile) {
        return this.profile;
      }

      this.appendStatusMessage("Fetching profile data");

      // Try to get data from background script
      try {
        return new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(
            { action: "getProfileData" },
            (response) => {
              if (chrome.runtime.lastError) {
                this.appendStatusMessage(
                  "Error from background: " + chrome.runtime.lastError.message
                );
                // Use fallback profile instead of rejecting
                resolve(this.getFallbackProfile());
              } else if (response && response.success && response.data) {
                this.appendStatusMessage(
                  "Got profile data from background script"
                );
                resolve(response.data);
              } else {
                this.appendStatusMessage(
                  "No valid profile data in response, using fallback"
                );
                resolve(this.getFallbackProfile());
              }
            }
          );
        });
      } catch (err) {
        this.appendStatusMessage(
          "Error requesting profile data: " + err.message
        );
        return this.getFallbackProfile();
      }
    } catch (error) {
      errorLog("Error getting profile data:", error);
      return this.getFallbackProfile();
    }
  }

  /**
   * Get a fallback profile for testing or when API fails
   */
  getFallbackProfile() {
    this.appendStatusMessage("Using fallback profile data");
    return this.profile;
  }

  /**
   * Get unprocessed job cards
   */
  getUnprocessedJobCards() {
    try {
      const allCards = document.querySelectorAll(
        this.config.SELECTORS.JOB_CARDS
      );

      return Array.from(allCards).filter((card) => {
        const cardId = this.getJobCardId(card);

        // Skip cards that have already been processed
        if (this.state.processedCards.has(cardId)) {
          return false;
        }

        return true;
      });
    } catch (error) {
      errorLog("Error getting unprocessed job cards:", error);
      return [];
    }
  }

  /**
   * Get a unique ID for a job card
   */
  getJobCardId(jobCard) {
    try {
      // Try to get ID from data attribute
      const dataId =
        jobCard.getAttribute("data-job-id") ||
        jobCard.getAttribute("data-id") ||
        jobCard.id;

      if (dataId) {
        return dataId;
      }

      // Try to get from job URL
      const jobLink = jobCard.querySelector(
        "a[href*='ziprecruiter.com/jobs/']"
      );
      if (jobLink && jobLink.href) {
        return jobLink.href;
      }

      // Fallback to job title + company
      const title =
        jobCard
          .querySelector(this.config.SELECTORS.JOB_TITLE)
          ?.textContent.trim() || "";
      const company =
        jobCard
          .querySelector(this.config.SELECTORS.COMPANY_NAME)
          ?.textContent.trim() || "";

      return `${title}-${company}`.replace(/\s+/g, "").toLowerCase();
    } catch (error) {
      errorLog("Error getting job card ID:", error);
      return Math.random().toString(36).substring(2, 15);
    }
  }

  /**
   * Mark a job card visually
   * Updated with new "already_applied" status
   */
  markJobCard(jobCard, status) {
    try {
      if (!jobCard) return;

      // Remove any existing highlights
      const existingHighlight = jobCard.querySelector(".job-highlight");
      if (existingHighlight) {
        existingHighlight.remove();
      }

      // Create highlight element
      const highlight = document.createElement("div");
      highlight.className = "job-highlight";

      // Status-specific styling
      let color, text;
      switch (status) {
        case "processing":
          color = "#2196F3"; // Blue
          text = "Processing";
          break;
        case "applied":
          color = "#4CAF50"; // Green
          text = "Applied";
          break;
        case "already_applied":
          color = "#8BC34A"; // Light Green
          text = "Already Applied";
          break;
        case "skipped":
          color = "#FF9800"; // Orange
          text = "Skipped";
          break;
        case "error":
          color = "#F44336"; // Red
          text = "Error";
          break;
        default:
          color = "#9E9E9E"; // Gray
          text = "Unknown";
      }

      // Style the highlight
      highlight.style.cssText = `
        position: absolute;
        top: 0;
        right: 0;
        background-color: ${color};
        color: white;
        padding: 3px 8px;
        font-size: 12px;
        font-weight: bold;
        border-radius: 0 0 0 5px;
        z-index: 999;
      `;
      highlight.textContent = text;

      // Add border to the job card
      jobCard.style.border = `2px solid ${color}`;
      jobCard.style.position = "relative";

      // Add the highlight
      jobCard.appendChild(highlight);
    } catch (error) {
      errorLog("Error marking job card:", error);
    }
  }

  /**
   * Extract job details from a job card
   */
  extractJobDetailsFromCard(jobCard) {
    try {
      // More robust title selection with fallbacks
      let title = "";
      // Try the configured selector first
      const titleElement = jobCard.querySelector(
        this.config.SELECTORS.JOB_TITLE
      );
      if (titleElement && titleElement.textContent) {
        title = titleElement.textContent.trim();
      } else {
        // Fallback to common title selectors
        const titleFallbacks = [
          "h1.font-bold.text-primary",
          "h1.text-header-md",
          "h2.font-bold",
          "h3.font-bold",
          "a.jobTitle",
          "[data-testid='job-title']",
          ".job-title",
        ];

        for (const selector of titleFallbacks) {
          const element = jobCard.querySelector(selector);
          if (element && element.textContent) {
            title = element.textContent.trim();
            break;
          }
        }
      }
      if (!title) title = "Unknown Position";

      // More robust company name selection with fallbacks
      let company = "";
      // Try the configured selector first
      const companyElement = jobCard.querySelector(
        this.config.SELECTORS.COMPANY_NAME
      );
      if (companyElement && companyElement.textContent) {
        company = companyElement.textContent.trim();
      } else {
        // Fallback to common company selectors
        const companyFallbacks = [
          "a[aria-label*='LLC'], a[aria-label*='Inc'], a[aria-label*='Corp']",
          "a.text-link",
          ".company-name",
          "[data-testid='company-name']",
          "a[href*='/co/']",
        ];

        for (const selector of companyFallbacks) {
          const elements = jobCard.querySelectorAll(selector);
          for (const element of elements) {
            if (
              element &&
              element.textContent &&
              !element.textContent.includes("Apply")
            ) {
              company = element.textContent.trim();
              break;
            }
          }
          if (company) break;
        }
      }
      if (!company) company = "Unknown Company";

      // More robust location selection with fallbacks
      let location = "";
      // Try the configured selector first
      const locationElement = jobCard.querySelector(
        this.config.SELECTORS.LOCATION
      );
      if (locationElement && locationElement.textContent) {
        location = locationElement.textContent.trim();
      } else {
        // Fallback to common location selectors
        const locationFallbacks = [
          "p.text-primary",
          ".location",
          "[data-testid='text-location']",
          "p.text-body-md",
        ];

        for (const selector of locationFallbacks) {
          try {
            const elements = jobCard.querySelectorAll(selector);
            for (const element of elements) {
              const text = element.textContent.trim();
              // Location typically includes a city name and/or state code
              if (
                text &&
                !text.includes("Posted") &&
                !text.includes("$") &&
                (text.includes(",") || /[A-Z]{2}/.test(text))
              ) {
                location = text;
                break;
              }
            }
            if (location) break;
          } catch (e) {
            // Some complex selectors might fail, continue to the next one
            continue;
          }
        }
      }
      if (!location) location = "Unknown Location";

      // Attempt to get salary info
      let salary = "Not specified";

      // Instead of using jQuery-style :contains, find all p.text-primary elements and check content
      try {
        const salaryElements = jobCard.querySelectorAll("p.text-primary");
        for (const element of salaryElements) {
          const text = element.textContent.trim();
          if (text && text.includes("$")) {
            salary = text;
            break;
          }
        }
      } catch (e) {
        // If error, use default salary value
      }

      // Get job ID and URL from link - more robust approach
      let jobId = "";
      let jobUrl = "";

      // Try multiple link patterns
      const linkSelectors = [
        "a[href*='ziprecruiter.com/jobs/']",
        "a[href*='ziprecruiter.com/ek/']",
        "a[aria-label*='Apply']",
        "a.jobTitle-link",
        "a[href*='ziprecruiter.com']",
      ];

      for (const selector of linkSelectors) {
        const jobLink = jobCard.querySelector(selector);
        if (
          jobLink &&
          jobLink.href &&
          jobLink.href.includes("ziprecruiter.com")
        ) {
          jobUrl = jobLink.href;

          // Extract ID from URL
          try {
            // Different URL patterns
            if (jobUrl.includes("/jobs/")) {
              const urlParts = jobUrl.split("/");
              jobId = urlParts[urlParts.length - 1].split("?")[0];
            } else if (jobUrl.includes("/ek/l/")) {
              // Extract job ID from application URL format
              const match = jobUrl.match(/\/ek\/l\/([A-Za-z0-9_-]+)/);
              jobId = match ? match[1] : "";
            }

            if (jobId) break;
          } catch (e) {
            // If parsing fails, continue to next link
            continue;
          }
        }
      }

      // If we still don't have a job URL, use the current page URL
      if (!jobUrl) {
        jobUrl = window.location.href;

        // Try to extract ID from current URL
        if (jobUrl.includes("/jobs/") || jobUrl.includes("/job/")) {
          const urlParts = jobUrl.split("/");
          jobId = urlParts[urlParts.length - 1].split("?")[0];
        }
      }

      // Extract posted date with fallbacks
      const postedDate = this.extractPostedDate(jobCard);

      return {
        jobId: company.replace(/[\/.#\[\]\*\s%]/g, "_"),
        title,
        company,
        location,
        salary,
        jobUrl,
        workplace: "remote",
        platform: "ziprecruiter",
        postedDate,
      };
    } catch (error) {
      errorLog("Error extracting job details from card:", error);
      return {
        jobId: "",
        title: "Unknown Position",
        company: "Unknown Company",
        location: "Unknown Location",
        jobUrl: window.location.href,
        platform: "ziprecruiter",
      };
    }
  }

  /**
   * Extract posted date from a job card
   */
  extractPostedDate(jobCard) {
    try {
      // Target the specific element structure based on the HTML you shared
      const exactSelector = "p.text-primary.normal-case.text-body-md";
      const elements = jobCard.querySelectorAll(exactSelector);

      for (const element of elements) {
        const text = element.textContent.trim();
        if (text && text.toLowerCase().includes("posted")) {
          return text;
        }
      }

      // Fallback selectors if the exact one doesn't match
      const fallbackSelectors = [
        ".date",
        ".posted-date",
        ".job-age",
        // Look in divs with specific class combinations
        "div.flex p.text-primary",
        "div.flex p.text-body-md",
        // Just look for any element containing posted text
        "p",
        "span",
        "div",
      ];

      // Try each fallback selector
      for (const selector of fallbackSelectors) {
        try {
          const elements = jobCard.querySelectorAll(selector);
          for (const element of elements) {
            const text = element.textContent.trim();
            if (text && text.toLowerCase().includes("posted")) {
              return text;
            }
          }
        } catch (e) {
          // If selector fails, try the next one
          continue;
        }
      }

      // If we still can't find it, try searching the entire job card for text containing "posted"
      const allText = jobCard.textContent;
      const postedPattern = /posted\s+(\d+\s+\w+|\w+)/i;
      const match = allText.match(postedPattern);
      if (match) {
        return match[0];
      }

      return "Not specified";
    } catch (error) {
      return "Not specified";
    }
  }

  /**
   * Extract job details from the current job page
   */
  extractJobDetailsFromPage() {
    try {
      // Get job title
      const title =
        document
          .querySelector("h1, .job-title, .jobTitle")
          ?.textContent.trim() || "Unknown Position";

      // Get company name
      const company =
        document
          .querySelector(
            ".hiring-company, .company-name, [data-testid='company-name']"
          )
          ?.textContent.trim() || "Unknown Company";

      // Get location
      const location =
        document
          .querySelector(".location, [data-testid='text-location']")
          ?.textContent.trim() || "Unknown Location";

      // Get URL and job ID
      const jobUrl = window.location.href;
      const urlParts = jobUrl.split("/");
      const jobId = urlParts[urlParts.length - 1].split("?")[0];

      return {
        jobId,
        title,
        company,
        location,
        jobUrl,
        platform: "ziprecruiter",
      };
    } catch (error) {
      errorLog("Error extracting job details from page:", error);
      return {
        jobId: "",
        title: "Unknown Position",
        company: "Unknown Company",
        location: "Unknown Location",
        jobUrl: window.location.href,
        platform: "ziprecruiter",
      };
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
        if (applicationTime > this.config.TIMEOUTS.APPLICATION_TIMEOUT) {
          debugLog("Application appears to be stuck, recovering state");

          // Mark the last job card as error if available
          if (this.state.lastProcessedCard) {
            this.markJobCard(this.state.lastProcessedCard, "error");
          }

          // Reset application state
          this.state.isApplicationInProgress = false;
          this.state.applicationStartTime = null;
          this.state.formDetected = false;
          this.state.jobProcessingLock = false;

          this.appendStatusMessage(
            "Application timeout detected - resetting state"
          );
          this.updateStatusIndicator("error");

          // Continue with next job if automation is running
          if (this.state.isRunning) {
            setTimeout(() => this.processNextJob(), 5000);
          }
        }
      }

      // Check for automation inactivity
      if (this.state.isRunning) {
        const now = Date.now();
        const inactiveTime = now - this.state.lastActivity;

        if (inactiveTime > 180000) {
          // 3 minutes inactivity
          debugLog("Automation appears inactive, attempting recovery");

          // Reset any stuck application state
          if (this.state.isApplicationInProgress) {
            this.state.isApplicationInProgress = false;
            this.state.applicationStartTime = null;
            this.state.formDetected = false;
          }

          // Reset lock
          this.state.jobProcessingLock = false;

          // Try to continue automation
          this.state.lastActivity = now;
          this.processNextJob();
        }
      }
    } catch (error) {
      errorLog("Error in health check:", error);
    }
  }

  /**
   * Sleep for the specified milliseconds
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
      case "running":
        statusText = "Running";
        statusColor = "#ff9800";
        bgColor = "rgba(255, 152, 0, 0.2)";
        break;
      case "applying":
        statusText = "Applying";
        statusColor = this.config.BRAND_COLOR;
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
      case "stopped":
        statusText = "Stopped";
        statusColor = "#9e9e9e";
        bgColor = "rgba(158, 158, 158, 0.2)";
        break;
      case "completed":
        statusText = "Completed";
        statusColor = "#4caf50";
        bgColor = "rgba(76, 175, 80, 0.2)";
        break;
      default:
        statusText = status.charAt(0).toUpperCase() + status.slice(1);
        statusColor = this.config.BRAND_COLOR;
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

    // Update last activity timestamp
    this.state.lastActivity = Date.now();
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

    // Update last activity timestamp
    this.state.lastActivity = Date.now();
  }

  /**
   * Handle the application process after clicking the apply button
   * Using sequential processing to properly handle form or instant success
   */
  async handleApplicationAfterClick(jobCard) {
    try {
      this.appendStatusMessage("Processing application");

      // STEP 1: First check for application modal (wait a short time for it to appear)
      await this.sleep(1000); // Brief wait for modal to appear if it's going to

      const modalContainer = document.querySelector(
        this.config.SELECTORS.MODAL_CONTAINER
      );
      console.log(modalContainer && this.isElementVisible(modalContainer));
      if (modalContainer && this.isElementVisible(modalContainer)) {
        // MODAL DETECTED - Need to fill out form
        this.appendStatusMessage("Application modal detected - handling form");
        this.state.formDetected = true;

        // Process the form and get the result - WAIT FOR THIS TO COMPLETE
        const formResult = await this.handleApplyForm();

        if (formResult) {
          // Form handled successfully
          this.appendStatusMessage("Form submitted successfully");

          // Mark job as applied
          this.markJobCard(jobCard, "applied");

          // Send completed status
          if (this.currentJobDetails) {
            this.sendApplicationCompletedToBackground(this.currentJobDetails);
          }

          // End application process (success)
          await this.endApplication(true);
        } else {
          // Form handling failed
          this.appendStatusMessage("Form submission failed");
          this.markJobCard(jobCard, "error");
          await this.endApplication(false);
        }

        // Release the lock when done with form handling
        this.state.jobProcessingLock = false;

        // Move to next job after a short delay
        setTimeout(() => {
          if (this.state.isRunning) {
            this.processNextJob();
          }
        }, 2000);

        return;
      }

      // STEP 2: If no modal, check for instant success
      this.appendStatusMessage(
        "No modal detected, checking for instant success"
      );

      // Check for "Applied" button
      let appliedButton = document.querySelector(
        this.config.SELECTORS.APPLIED_INDICATOR
      );

      // Fallback to text content search
      if (!appliedButton) {
        const buttons = Array.from(document.querySelectorAll("button"));
        appliedButton = buttons.find((btn) =>
          (btn.innerText || btn.textContent || "").includes("Applied")
        );
      }

      if (appliedButton) {
        this.appendStatusMessage("Application submitted instantly (1-Click)");

        // Mark as applied
        this.markJobCard(jobCard, "applied");

        // Send completed status
        if (this.currentJobDetails) {
          this.sendApplicationCompletedToBackground(this.currentJobDetails);
        }

        // End application process (success)
        await this.endApplication(true);
        this.state.jobProcessingLock = false;

        // Move to next job after a short delay
        setTimeout(() => {
          if (this.state.isRunning) {
            this.processNextJob();
          }
        }, 2000);

        return;
      }

      // STEP 3: Check for success message in page content
      const pageContent = document.body.innerText.toLowerCase();
      const successPhrases = [
        "application submitted",
        "successfully applied",
        "thank you for applying",
        "application complete",
        "application received",
        "your application has been submitted",
      ];

      const hasSuccessPhrase = successPhrases.some((phrase) =>
        pageContent.includes(phrase)
      );

      if (hasSuccessPhrase) {
        this.appendStatusMessage(
          "Application submitted successfully (content detection)"
        );

        // Mark as applied
        this.markJobCard(jobCard, "applied");

        // Send completed status
        if (this.currentJobDetails) {
          this.sendApplicationCompletedToBackground(this.currentJobDetails);
        }

        // End application process (success)
        await this.endApplication(true);
        this.state.jobProcessingLock = false;

        // Move to next job after a short delay
        setTimeout(() => {
          if (this.state.isRunning) {
            this.processNextJob();
          }
        }, 2000);

        return;
      }

      // STEP 4: If we get here, application was not successful
      this.appendStatusMessage(
        "Application process failed - no success indicators found"
      );
      this.markJobCard(jobCard, "error");

      // End application process (failure)
      await this.endApplication(false);
      this.state.jobProcessingLock = false;

      // Move to next job after a short delay
      setTimeout(() => {
        if (this.state.isRunning) {
          this.processNextJob();
        }
      }, 2000);
    } catch (error) {
      errorLog("Error handling application:", error);
      this.appendStatusErrorMessage(
        "Error in application process: " + error.message
      );

      // Mark as error
      if (jobCard) {
        this.markJobCard(jobCard, "error");
      }

      // End application process (failure)
      await this.endApplication(false);
      this.state.jobProcessingLock = false;

      // Try next job after a delay
      setTimeout(() => {
        if (this.state.isRunning) {
          this.processNextJob();
        }
      }, 2000);
    }
  }

  /**
   * Process next job with proper locking mechanism to prevent parallel processing
   */
  async processNextJob() {
    try {
      // Don't proceed if automation is stopped
      if (!this.state.isRunning) {
        this.appendStatusMessage("Automation stopped");
        return;
      }

      // Critical check: Don't proceed if an application is in progress or if we have the lock
      if (this.state.isApplicationInProgress || this.state.jobProcessingLock) {
        this.appendStatusMessage(
          "Application in progress or job processing locked, waiting..."
        );

        // Check if application is stuck
        if (this.state.applicationStartTime) {
          const elapsed = Date.now() - this.state.applicationStartTime;
          // Allow a much longer timeout (8 minutes) to ensure form completion
          if (elapsed > this.config.TIMEOUTS.APPLICATION_TIMEOUT) {
            this.appendStatusMessage(
              "Application appears stuck, performing recovery"
            );

            // Try to close any open modals
            await this.closeFailedApplicationModals();

            // Force reset the application state
            await this.endApplication(false);
            this.state.jobProcessingLock = false;

            // Wait a moment before trying the next job
            setTimeout(() => this.processNextJob(), 5000);
          } else {
            // Check again after a delay
            setTimeout(() => this.processNextJob(), 5000);
          }
        } else {
          // Check again after a delay
          setTimeout(() => this.processNextJob(), 5000);
        }
        return;
      }

      // Acquire the lock
      this.state.jobProcessingLock = true;
      this.appendStatusMessage("Looking for next job to process");

      // Get all job cards that haven't been processed yet
      const jobCards = this.getUnprocessedJobCards();

      if (jobCards.length === 0) {
        // Try to load more jobs by going to the next page
        if (this.state.noMorePages) {
          // We've reached the end of all available pages
          this.appendStatusMessage(
            "No more jobs or pages to process. Completed all available jobs."
          );
          this.updateStatusIndicator("completed");
          this.state.isRunning = false;
          this.state.jobProcessingLock = false;
          return;
        }

        // Try to move to the next page
        if (await this.goToNextPage()) {
          // Wait for page to load and try again
          this.appendStatusMessage(
            `Navigated to page ${this.state.currentPage}. Waiting for page to load...`
          );
          this.state.jobProcessingLock = false;
          setTimeout(() => this.processNextJob(), 3000);
        } else {
          // Could not go to next page or no more pages
          this.appendStatusMessage(
            "No more pages available. Completed automation."
          );
          this.updateStatusIndicator("completed");
          this.state.isRunning = false;
          this.state.jobProcessingLock = false;
        }
        return;
      }

      // Process the first unprocessed job card
      const jobCard = jobCards[0];
      this.state.lastProcessedCard = jobCard;

      // Mark as processing
      this.markJobCard(jobCard, "processing");

      // Extract job details before clicking the card
      const jobDetails = this.extractJobDetailsFromCard(jobCard);
      this.currentJobDetails = jobDetails;

      // First, click on the job card to view details
      this.appendStatusMessage("Clicking job card to view details");

      // Find the clickable element within the job card (usually the title or the card itself)
      const clickableElement = jobCard.querySelector("h2 a") || jobCard;

      // Begin application process with proper state management
      await this.beginApplication();

      // Click the job card
      clickableElement.click();

      // Wait for job details to load
      this.appendStatusMessage("Waiting for job details to load");

      // Use a promise to ensure we wait for the completion
      await new Promise((resolve) => {
        setTimeout(() => resolve(), 2000);
      });

      // Process the apply button in the job detail view
      await this.processJobDetailView(jobCard);
    } catch (error) {
      errorLog("Error processing job:", error);
      this.appendStatusErrorMessage("Error processing job: " + error.message);

      // Always release the lock and reset application state in case of error
      this.state.jobProcessingLock = false;
      await this.endApplication(false);

      // Mark current card as error if available
      if (this.state.lastProcessedCard) {
        this.markJobCard(this.state.lastProcessedCard, "error");
      }

      // Try the next job after a delay
      setTimeout(() => this.processNextJob(), 5000);
    }
  }

  /**
   * Handle the application process after clicking the apply button
   */
  async handleApplicationAfterClick(jobCard) {
    try {
      this.appendStatusMessage("Waiting for application process to complete");

      // First wait a moment for modal or success indicators to appear
      await this.sleep(1500);

      // Check for application modal first
      const modalContainer = document.querySelector(
        this.config.SELECTORS.MODAL_CONTAINER
      );

      if (modalContainer && this.isElementVisible(modalContainer)) {
        // MODAL FOUND - Handle form filling
        this.appendStatusMessage("Application modal detected - handling form");
        this.state.formDetected = true;

        // Process the form and get the result - WAIT FOR THIS TO COMPLETE
        const formResult = await this.handleApplyForm();

        // Handle the result based on form processing
        if (formResult) {
          // Form handled successfully
          this.markJobCard(jobCard, "applied");

          // Send application completed
          if (this.currentJobDetails) {
            this.sendApplicationCompletedToBackground(this.currentJobDetails);
          }

          // End application process (success)
          await this.endApplication(true);
        } else {
          // Form handling failed
          this.appendStatusMessage("Form submission failed");
          this.markJobCard(jobCard, "error");
          await this.endApplication(false);
        }
      } else {
        // NO MODAL - Check if it was instant success

        // Check for "Applied" button
        let appliedButton = document.querySelector(
          this.config.SELECTORS.APPLIED_INDICATOR
        );

        // Fallback to text content search
        if (!appliedButton) {
          const buttons = Array.from(document.querySelectorAll("button"));
          appliedButton = buttons.find((btn) =>
            (btn.innerText || btn.textContent || "").includes("Applied")
          );
        }

        if (appliedButton) {
          this.appendStatusMessage("Application submitted instantly (1-Click)");

          // Mark as applied and send completion
          this.markJobCard(jobCard, "applied");
          if (this.currentJobDetails) {
            this.sendApplicationCompletedToBackground(this.currentJobDetails);
          }

          // End application process (success)
          await this.endApplication(true);
        } else {
          // Check for success message in page content
          const pageContent = document.body.innerText.toLowerCase();
          const successPhrases = [
            "application submitted",
            "successfully applied",
            "thank you for applying",
            "application complete",
            "application received",
            "your application has been submitted",
          ];

          const hasSuccessPhrase = successPhrases.some((phrase) =>
            pageContent.includes(phrase)
          );

          if (hasSuccessPhrase) {
            this.appendStatusMessage(
              "Application submitted successfully (content detection)"
            );

            // Mark as applied and send completion
            this.markJobCard(jobCard, "applied");
            if (this.currentJobDetails) {
              this.sendApplicationCompletedToBackground(this.currentJobDetails);
            }

            // End application process (success)
            await this.endApplication(true);
          } else {
            // No success indicators found
            this.appendStatusMessage(
              "No success indicators found - marking as error"
            );
            this.markJobCard(jobCard, "error");
            await this.endApplication(false);
          }
        }
      }

      // Always release the lock when done
      this.state.jobProcessingLock = false;

      // Move to next job after completion
      setTimeout(() => {
        if (this.state.isRunning) {
          this.processNextJob();
        }
      }, 2000);
    } catch (error) {
      errorLog("Error handling application:", error);
      this.appendStatusErrorMessage(
        "Error in application process: " + error.message
      );

      // Mark as error
      if (jobCard) {
        this.markJobCard(jobCard, "error");
      }

      // End application process (failure)
      await this.endApplication(false);
      this.state.jobProcessingLock = false;

      // Try next job
      setTimeout(() => {
        if (this.state.isRunning) {
          this.processNextJob();
        }
      }, 2000);
    }
  }

  /**
   * Handle the application form filling process
   * Returns a promise that resolves to true on success, false on failure
   */
  async handleApplyForm() {
    try {
      this.appendStatusMessage("Processing application form");

      // Check if we need to handle resume upload first
      const resumeUploadHandled = await this.handleResumeUploadIfNeeded();

      // Initialize the form handler with necessary data
      const formHandler = new ZipRecruiterFormHandler({
        logger: (message) => this.appendStatusMessage(message),
        userData: this.profile || this.getFallbackProfile(),
        jobDescription: this.currentJobDetails
          ? `${this.currentJobDetails.title} at ${this.currentJobDetails.company} in ${this.currentJobDetails.location}`
          : "",
        fileHandler: this.fileHandler,
      });

      // Fill the form
      const success = await formHandler.fillCompleteForm();

      if (success) {
        this.appendStatusMessage("Form filled and submitted successfully");
        return true;
      } else {
        this.appendStatusErrorMessage(
          "Form handler could not complete application"
        );

        // Try to close any error modals
        await this.closeFailedApplicationModals();

        // If we at least uploaded the resume, that might be considered partial success
        return resumeUploadHandled;
      }
    } catch (error) {
      errorLog("Form handler error:", error);
      this.appendStatusErrorMessage("Error filling form: " + error.message);

      // Try to close any error modals
      await this.closeFailedApplicationModals();

      return false;
    }
  }
}

// Initialize the automation
debugLog("Creating ZipRecruiterAutomation instance");
const zipRecruiterAutomation = new ZipRecruiterAutomation();

// Add message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    const { action, type } = message;
    const messageType = action || type;

    switch (messageType) {
      case "startAutomation":
        zipRecruiterAutomation.startAutomation();
        sendResponse({ status: "processing" });
        break;

      case "stopAutomation":
        zipRecruiterAutomation.state.isRunning = false;
        zipRecruiterAutomation.appendStatusMessage(
          "Automation stopped by user"
        );
        zipRecruiterAutomation.updateStatusIndicator("stopped");
        sendResponse({ status: "stopped" });
        break;

      case "checkStatus":
        sendResponse({
          success: true,
          data: {
            initialized: zipRecruiterAutomation.state.initialized,
            isApplicationInProgress:
              zipRecruiterAutomation.state.isApplicationInProgress,
            processedCount: zipRecruiterAutomation.state.processedCount,
            isRunning: zipRecruiterAutomation.state.isRunning,
            currentPage: zipRecruiterAutomation.state.currentPage,
            totalPages: zipRecruiterAutomation.state.totalPages,
          },
        });
        break;

      case "resetState":
        zipRecruiterAutomation.state.isApplicationInProgress = false;
        zipRecruiterAutomation.state.applicationStartTime = null;
        zipRecruiterAutomation.state.processedCards = new Set();
        zipRecruiterAutomation.state.processedCount = 0;
        zipRecruiterAutomation.state.isRunning = false;
        zipRecruiterAutomation.state.formDetected = false;
        zipRecruiterAutomation.state.jobProcessingLock = false;
        zipRecruiterAutomation.state.noMorePages = false;
        zipRecruiterAutomation.updateStatusIndicator("ready");
        zipRecruiterAutomation.appendStatusMessage("State reset complete");
        sendResponse({ success: true, message: "State reset" });
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

export default ZipRecruiterAutomation;
