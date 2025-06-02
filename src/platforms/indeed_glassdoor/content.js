import { FileHandler } from "@shared/linkedInUtils";
import { HOST } from "@shared/constants";
import { StateManager } from "@shared/stateManager";
import { canApplyMore } from "@shared/checkAuthorization";
import FormHandler from "./formHandler";

// Debugging helpers
function debugLog(message, ...args) {
  console.log(`[JobApply] ${message}`, ...args);
}

function errorLog(message, error) {
  console.error(`[JobApply Error] ${message}`, error);
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

// Configuration with platform-specific selectors
const CONFIG = {
  PLATFORMS: {
    INDEED: "indeed",
    GLASSDOOR: "glassdoor",
  },
  SELECTORS: {
    // Common selectors for both platforms
    COMMON: {
      // Application form selectors
      RESUME_UPLOAD: "input[type=file]",
      FORM_INPUT: "input:not([type=hidden]), textarea, select",
      CONTINUE_BUTTON: "button[type=submit], button.ia-continueButton",
      SUBMIT_BUTTON: "button:contains('Submit'), button:contains('Apply')",
      RESUME_SELECT: ".ia-ResumeSelection-resume",
      RESUME_UPLOAD_BUTTON: "button.ia-ResumeSearch-uploadButton",

      // Popups
      POPUP_CLOSE: ".popover-x-button-close",
    },
    // Indeed-specific selectors
    INDEED: {
      // Job card selectors
      JOB_CARDS: ".job_seen_beacon",
      JOB_TITLE: ".jcs-JobTitle span[id^='jobTitle-']",
      COMPANY_NAME: "[data-testid='company-name']",
      LOCATION: "[data-testid='text-location']",
      SALARY: "[data-testid='salary-snippet']",

      // Apply button selectors
      APPLY_BUTTON: "#indeedApplyButton",
      APPLY_BUTTON_TEXT: ".jobsearch-IndeedApplyButton-newDesign",

      // Job description
      JOB_DESCRIPTION: "#jobDescriptionText",

      // Filters and pagination
      EASY_APPLY_FILTER: "#filter-epiccapplication",
      NEXT_PAGE: "[data-testid='pagination-page-next']",

      // External application indicators
      EXTERNAL_INDICATORS: [
        ".indeed-apply-status-not-applied",
        ".indeed-apply-status-applied",
        ".indeed-apply-status-rejected",
      ],
    },
    // Glassdoor-specific selectors
    GLASSDOOR: {
      // Job card selectors
      JOB_CARDS: ".JobsList_jobListItem__wjTHv, li[data-test='jobListing']",
      JOB_TITLE: ".JobCard_jobTitle__GLyJ1, a[data-test='job-title']",
      COMPANY_NAME:
        ".EmployerProfile_compactEmployerName__9MGcV, span.employer-name",
      LOCATION: ".JobCard_location__Ds1fM, div[data-test='emp-location']",
      SALARY: "[data-test='detailSalary'], .salaryEstimate",

      // Apply button selectors
      APPLY_BUTTON:
        "button[data-test='easyApply'], .EasyApplyButton_content__1cGPo, button.applyButton, a.applyButton",
      APPLY_BUTTON_TEXT:
        ".EasyApplyButton_content__1cGPo, .text-with-icon_LabelContainer__xbtB8",

      // Job description
      JOB_DESCRIPTION:
        ".jobDescriptionContent, [data-test='description'], [data-test='jobDescriptionText']",

      // Filters and pagination
      EASY_APPLY_FILTER:
        "[data-test='EASY_APPLY-filter'], input[value='EASY_APPLY']",
      NEXT_PAGE: "[data-test='pagination-next'], .nextButton",

      // External application indicators
      EXTERNAL_INDICATORS: [
        "[data-test='external-apply']",
        "a[target='_blank'][rel='nofollow']",
      ],

      // Form specific selectors for Glassdoor
      FORM_CONTAINER:
        ".jobsOverlayModal, .modal-content, .applyButtonContainer",
    },
  },
  TIMEOUTS: {
    STANDARD: 2000,
    EXTENDED: 5000,
    MAX_TIMEOUT: 300000, // 5 minutes
    APPLICATION_TIMEOUT: 3 * 60 * 1000, // 3 minutes,
    REDIRECT_TIMEOUT: 8000, // Longer timeout for redirects
  },
  PLAN_LIMITS: {
    FREE: 10,
    STARTER: 50,
    PRO: 500,
  },
  DEBUG: true,
  BRAND_COLOR: "#4a90e2", // FastApply brand blue
  // URL patterns for detecting platforms
  URL_PATTERNS: {
    INDEED: {
      SEARCH_PAGE: /(?:[\w-]+\.)?indeed\.com\/jobs/,
      JOB_PAGE: /indeed\.com\/(viewjob|job)/,
      APPLY_PAGE:
        /indeed\.com\/apply|smartapply\.indeed\.com\/beta\/indeedapply\/form/,
    },
    GLASSDOOR: {
      SEARCH_PAGE: /glassdoor\.com\/(Job|Search)/,
      JOB_PAGE: /glassdoor\.com\/job\/|glassdoor\.com\/Job\//,
      APPLY_PAGE: /glassdoor\.com\/apply\//,
    },
  },
};

/**
 * JobAutomation - Content script for automating job applications on Indeed and Glassdoor
 */
class JobAutomation {
  constructor() {
    debugLog("Initializing JobAutomation");

    // State tracking
    this.state = {
      initialized: false,
      ready: false,
      isRunning: false,
      isApplicationInProgress: false,
      applicationStartTime: null,
      processedCards: new Set(),
      processedCount: 0,
      countDown: null,
      lastActivity: Date.now(),
      debounceTimers: {},
      currentJobIndex: 0,
      pendingApplication: false,
      platform: null, // Will be set to 'indeed' or 'glassdoor'
      maxRedirectAttempts: 3,
      currentRedirectAttempts: 0,
      lastClickedJobCard: null,
      formDetectionAttempts: 0,
      maxFormDetectionAttempts: 5,
      currentJobDescription: "",
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

    // Detect platform
    this.detectPlatform();

    // Initialize on document ready
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => this.init());
    } else {
      this.init();
    }

    // Set up health check timer
    this.healthCheckTimer = setInterval(() => this.checkHealth(), 30000);

    // Set up mutation observer to detect form elements appearing
    this.setupFormDetectionObserver();
  }

  /**
   * Detect which platform we're on (Indeed or Glassdoor)
   */
  detectPlatform() {
    const url = window.location.href;

    // Check for Indeed
    if (
      CONFIG.URL_PATTERNS.INDEED.SEARCH_PAGE.test(url) ||
      CONFIG.URL_PATTERNS.INDEED.JOB_PAGE.test(url) ||
      CONFIG.URL_PATTERNS.INDEED.APPLY_PAGE.test(url)
    ) {
      this.state.platform = CONFIG.PLATFORMS.INDEED;
      debugLog("Detected platform: Indeed");
      return;
    }

    // Check for Glassdoor
    if (
      CONFIG.URL_PATTERNS.GLASSDOOR.SEARCH_PAGE.test(url) ||
      CONFIG.URL_PATTERNS.GLASSDOOR.JOB_PAGE.test(url) ||
      CONFIG.URL_PATTERNS.GLASSDOOR.APPLY_PAGE.test(url)
    ) {
      this.state.platform = CONFIG.PLATFORMS.GLASSDOOR;
      debugLog("Detected platform: Glassdoor");
      return;
    }

    // Special case for smartapply.indeed.com
    if (url.includes("smartapply.indeed.com")) {
      this.state.platform = CONFIG.PLATFORMS.INDEED;
      debugLog("Detected platform: Indeed (SmartApply)");
      return;
    }

    // If we can't determine the platform, default to Indeed
    this.state.platform = CONFIG.PLATFORMS.INDEED;
    console.log(CONFIG.PLATFORMS.INDEED);
    debugLog("Could not determine platform, defaulting to Indeed");
  }

  /**
   * Get selector based on current platform
   */
  getSelector(selectorName) {
    // Check if it's a common selector
    if (CONFIG.SELECTORS.COMMON[selectorName]) {
      return CONFIG.SELECTORS.COMMON[selectorName];
    }

    // Get platform-specific selector
    const platformSelectors =
      CONFIG.SELECTORS[this.state.platform.toUpperCase()];
    if (platformSelectors && platformSelectors[selectorName]) {
      return platformSelectors[selectorName];
    }

    // Fallback to Indeed selectors if not found
    return CONFIG.SELECTORS.INDEED[selectorName] || "";
  }

  /**
   * Create a status overlay on the page
   */
  createStatusOverlay() {
    // Create container
    const container = document.createElement("div");
    container.id = "job-status-overlay";
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
    background: rgba(228, 233, 239, 0.9);
    border-radius: 12px;
    color: ${CONFIG.BRAND_COLOR};
  `;
    header.appendChild(this.statusIndicator);

    container.appendChild(header);

    // Create log container
    this.logContainer = document.createElement("div");
    this.logContainer.id = "job-log-container";
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

  /**
   * Repeatedly check for Glassdoor form in modal or Indeed redirect
   */
  checkForGlassdoorForm(attempt) {
    // Check if we've been redirected to Indeed SmartApply
    const isIndeedSmartApply = window.location.href.includes(
      "smartapply.indeed.com/beta/indeedapply/form"
    );

    if (isIndeedSmartApply) {
      // We've been redirected from Glassdoor to Indeed SmartApply form
      this.appendStatusMessage(
        "Detected redirect from Glassdoor to Indeed SmartApply form"
      );

      // Update platform to Indeed for correct form handling
      this.state.platform = CONFIG.PLATFORMS.INDEED;
      this.state.formDetected = true;

      // Handle the detected form
      setTimeout(async () => {
        await this.handleDetectedForm();
      }, 1000);

      return;
    }

    // Check for Glassdoor form in modal
    const hasGlassdoorForm =
      document.querySelector(".jobsOverlayModal") ||
      document.querySelector(".modal-content form");

    // Also check for standard form elements
    const hasStandardForm =
      document.querySelector("form") ||
      document.querySelector(".ia-ApplyFormScreen");

    // Check if URL changed to an apply page
    const isOnApplyPage = CONFIG.URL_PATTERNS.GLASSDOOR.APPLY_PAGE.test(
      window.location.href
    );

    if (hasGlassdoorForm || hasStandardForm || isOnApplyPage) {
      this.appendStatusMessage(
        `Glassdoor form detected on attempt ${attempt + 1}`
      );
      this.state.formDetected = true;

      // Handle the detected form
      setTimeout(async () => {
        await this.handleDetectedForm();
      }, 1000);
    } else {
      // Check again after a delay
      setTimeout(() => {
        this.checkForGlassdoorForm(attempt + 1);
      }, 1000);
    }
  }

  /**
   * Mark the last clicked job card if available
   */
  markLastJobCardIfAvailable(status) {
    if (this.state.lastClickedJobCard) {
      this.markJobCard(this.state.lastClickedJobCard, status);
    }
  }

  /**
   * Get job cards that haven't been processed yet
   */
  getUnprocessedJobCards() {
    let allCards;

    // Special handling for Glassdoor
    if (this.state.platform === CONFIG.PLATFORMS.GLASSDOOR) {
      // Try to find the job list container first
      const jobListContainer = document.querySelector(
        "ul.JobsList_jobsList__lqjTr, ul[aria-label='Jobs List']"
      );
      if (jobListContainer) {
        allCards = jobListContainer.querySelectorAll(
          this.getSelector("JOB_CARDS")
        );
      } else {
        allCards = document.querySelectorAll(this.getSelector("JOB_CARDS"));
      }
    } else {
      // Regular processing for Indeed or other platforms
      allCards = document.querySelectorAll(this.getSelector("JOB_CARDS"));
    }

    return Array.from(allCards).filter((card) => {
      const cardId = this.getJobCardId(card);
      return !this.state.processedCards.has(cardId);
    });
  }

  /**
   * Get a unique ID for a job card
   */
  getJobCardId(jobCard) {
    // For Glassdoor - try to get the data-jobid attribute
    if (this.state.platform === CONFIG.PLATFORMS.GLASSDOOR) {
      const jobId =
        jobCard.getAttribute("data-jobid") || jobCard.getAttribute("data-id");
      if (jobId) {
        return jobId;
      }

      // Also check for jobListingId in the card's link
      const jobLink = jobCard.querySelector(
        '.JobCard_trackingLink__HMyun, a[data-test="job-link"]'
      );
      if (jobLink && jobLink.href) {
        const match = jobLink.href.match(/jobListingId=(\d+)/);
        if (match && match[1]) {
          return match[1];
        }
      }
    }

    // Try to get job ID from a title link
    const link =
      jobCard.querySelector(this.getSelector("JOB_TITLE")) ||
      jobCard.querySelector("a");
    if (link && link.href) {
      // For Indeed
      if (this.state.platform === CONFIG.PLATFORMS.INDEED) {
        const match = link.href.match(/jk=([^&]+)/);
        if (match && match[1]) {
          return match[1];
        }
      }
      // For Glassdoor - additional patterns
      else if (this.state.platform === CONFIG.PLATFORMS.GLASSDOOR) {
        // Try different URL patterns for Glassdoor
        const jobListingMatch = link.href.match(/jobListingId=(\d+)/);
        if (jobListingMatch && jobListingMatch[1]) {
          return jobListingMatch[1];
        }

        // Try to match the JV_KO pattern in the URL
        const jvMatch = link.href.match(/JV_KO[^_]+_KE[^_]+_(\d+)\.htm/);
        if (jvMatch && jvMatch[1]) {
          return jvMatch[1];
        }
      }
    }

    // Fallback to job title + company
    const title =
      jobCard.querySelector(this.getSelector("JOB_TITLE"))?.textContent || "";
    const company =
      jobCard.querySelector(this.getSelector("COMPANY_NAME"))?.textContent ||
      "";
    return `${title}-${company}`.replace(/\s+/g, "").toLowerCase();
  }

  /**
   * Mark a job card visually
   */
  markJobCard(jobCard, status) {
    try {
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
      const title =
        jobCard
          .querySelector(this.getSelector("JOB_TITLE"))
          ?.textContent?.trim() || "Unknown Position";
      const company =
        jobCard
          .querySelector(this.getSelector("COMPANY_NAME"))
          ?.textContent?.trim() || "Unknown Company";
      const location =
        jobCard
          .querySelector(this.getSelector("LOCATION"))
          ?.textContent?.trim() || "Unknown Location";
      const salary =
        jobCard
          .querySelector(this.getSelector("SALARY"))
          ?.textContent?.trim() || "Not specified";

      // Get job ID from link
      let jobId = "";
      const link =
        jobCard.querySelector(this.getSelector("JOB_TITLE")) ||
        jobCard.querySelector("a");
      if (link && link.href) {
        if (this.state.platform === CONFIG.PLATFORMS.INDEED) {
          const match = link.href.match(/jk=([^&]+)/);
          if (match && match[1]) {
            jobId = match[1];
          }
        } else if (this.state.platform === CONFIG.PLATFORMS.GLASSDOOR) {
          const match = link.href.match(/jobListingId=(\d+)/);
          if (match && match[1]) {
            jobId = match[1];
          }
        }
      }

      return {
        jobId,
        title,
        company,
        location,
        salary,
        jobUrl: link?.href || window.location.href,
        workplace: "Not specified",
        postedDate: "Not specified",
        applicants: "Not specified",
        platform: this.state.platform,
      };
    } catch (error) {
      errorLog("Error extracting job details:", error);
      return {
        jobId: "",
        title: "Unknown Position",
        company: "Unknown Company",
        location: "Unknown Location",
        jobUrl: window.location.href,
        platform: this.state.platform,
      };
    }
  }

  /**
   * Track a successful application on the server
   */
  async trackApplication(jobDetails) {
    try {
      // Skip if no user data
      if (!this.userData || !this.userData.userId) {
        return;
      }

      // Update application count
      const updateResponse = await fetch(`${this.HOST}/api/applications`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: this.userData.userId,
        }),
      });

      // Add job to applied jobs
      await fetch(`${this.HOST}/api/applied-jobs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...jobDetails,
          userId: this.userData.userId,
          applicationPlatform: this.state.platform,
        }),
      });
    } catch (error) {
      errorLog("Error tracking application:", error);
    }
  }

  /**
   * Handle popups that might appear
   */
  handlePopups() {
    try {
      const closeButton = document.querySelector(
        this.getSelector("POPUP_CLOSE")
      );
      if (closeButton && this.isElementVisible(closeButton)) {
        closeButton.click();
      }
    } catch (error) {
      // Ignore errors with popups
    }
  }

  /**
   * Check if this is an external application
   */
  isExternalApplication() {
    // Check if any external indicators are visible
    const externalIndicators =
      CONFIG.SELECTORS[this.state.platform.toUpperCase()].EXTERNAL_INDICATORS;
    for (const selector of externalIndicators) {
      const element = document.querySelector(selector);
      if (element && this.isElementVisible(element)) {
        return true;
      }
    }

    // Check for text indicating external application
    const jobContainer = document.querySelector(
      '.jobsearch-JobComponent, [data-test="description"]'
    );
    if (jobContainer) {
      const containerText = jobContainer.textContent.toLowerCase();
      if (
        containerText.includes("apply on company site") ||
        containerText.includes("apply externally") ||
        containerText.includes("apply on the company website")
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Wait for an element to appear on the page
   */
  async waitForElement(selector, timeout = 3000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const element = document.querySelector(selector);
      if (element && this.isElementVisible(element)) {
        return element;
      }

      // Wait a bit before trying again
      await this.sleep(100);
    }

    return null;
  }

  /**
   * Check if application was submitted successfully
   */
  checkSubmissionSuccess() {
    // Check for success indicators
    const successSelectors = [
      ".ia-ApplicationMessage-successMessage",
      ".ia-JobActionConfirmation-container",
      ".ia-SuccessPage",
      ".ia-JobApplySuccess",
      'div:contains("Application submitted")',
      'div:contains("Your application has been submitted")',
      ".submitted-container",
      ".success-container",
    ];

    for (const selector of successSelectors) {
      try {
        const element = document.querySelector(selector);
        if (element && this.isElementVisible(element)) {
          return true;
        }
      } catch (e) {
        // Continue checking other selectors
      }
    }

    // Check page text
    const pageText = document.body.innerText.toLowerCase();
    return (
      pageText.includes("application submitted") ||
      pageText.includes("successfully applied") ||
      pageText.includes("thank you for applying") ||
      pageText.includes("successfully submitted") ||
      pageText.includes("application complete")
    );
  }

  /**
   * Handle resume upload
   */
  async handleResumeUpload() {
    try {
      this.appendStatusMessage("Checking for resume upload option");

      // Check if there's a resume selection screen
      const resumeSelections = document.querySelectorAll(
        this.getSelector("RESUME_SELECT")
      );
      if (resumeSelections.length > 0) {
        // If there are resume options already available, select the first one
        this.appendStatusMessage("Resume already uploaded, selecting it");
        resumeSelections[0].click();
        await this.sleep(1000);

        // Find and click continue after selection
        const continueButton = document.querySelector(
          this.getSelector("CONTINUE_BUTTON")
        );
        if (continueButton) {
          continueButton.click();
          await this.sleep(2000);
        }
        return true;
      }

      // Check for upload button
      const uploadButton = document.querySelector(
        this.getSelector("RESUME_UPLOAD_BUTTON")
      );
      if (uploadButton) {
        this.appendStatusMessage("Clicking resume upload button");
        uploadButton.click();
        await this.sleep(1000);
      }

      // Look for file input
      const fileInput = document.querySelector(
        this.getSelector("RESUME_UPLOAD")
      );
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
                console.log(
                  "Got profile data from background script",
                  response.data
                );
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
          debugLog("Application appears to be stuck, resetting state");

          // Mark the last job card as error if available
          this.markLastJobCardIfAvailable("error");

          this.state.isApplicationInProgress = false;
          this.state.applicationStartTime = null;
          this.state.pendingApplication = false;
          this.state.formDetected = false;

          this.appendStatusMessage(
            "Application timeout detected - resetting state"
          );
          this.updateStatusIndicator("error");

          // Continue with next job if automation is running
          if (this.state.isRunning) {
            setTimeout(() => this.processNextJob(), 2000);
          }
        }
      }

      // Check for automation inactivity
      if (this.state.isRunning) {
        const now = Date.now();
        const inactiveTime = now - this.state.lastActivity;

        if (inactiveTime > 120000) {
          // 2 minutes inactivity
          debugLog("Automation appears inactive, attempting recovery");

          // Reset any stuck application state
          if (this.state.isApplicationInProgress) {
            this.state.isApplicationInProgress = false;
            this.state.applicationStartTime = null;
            this.state.pendingApplication = false;
            this.state.formDetected = false;
          }

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
   * Start a countdown timer
   */
  startCountDownTimer(seconds, callback) {
    try {
      // Find or create timer container
      let timerContainer = document.getElementById("job-automation-timer");

      if (!timerContainer) {
        timerContainer = document.createElement("div");
        timerContainer.id = "job-automation-timer";
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
      let timeLeft = seconds;
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
          timerContainer.style.display = "none";
        }
      };

      // Return control object
      return { stop };
    } catch (error) {
      debugLog("Error starting countdown timer", error);
      return { stop: () => {} };
    }
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
   * Sleep for the specified milliseconds
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

  /// NEW METHODS

  /**
   * Handle individual job page
   */
  async handleJobPage() {
    try {
      this.appendStatusMessage("Processing job page");

      // Check if we're already on the application form page
      const isApplyPage = this.isOnApplyFormPage();
      debugLog("Is on apply form page:", isApplyPage);

      if (isApplyPage) {
        // We're already on the form page, so let's fill it out
        this.appendStatusMessage(
          "On application form page, starting application process"
        );

        // Wait for profile data
        if (!this.profile) {
          this.profile = await this.getProfileData();
        }

        if (this.profile) {
          // Start applying directly since we're already on the form page
          this.appendStatusMessage("Starting form completion process");
          this.state.isApplicationInProgress = true;
          this.state.applicationStartTime = Date.now();
          this.state.formDetected = true;

          // Handle application form
          const success = await this.handleApplyForm();

          // Reset application state
          this.state.isApplicationInProgress = false;
          this.state.applicationStartTime = null;
          this.state.formDetected = false;

          if (success) {
            this.appendStatusMessage("Application completed successfully");

            // Track application if we have job details
            if (this.currentJobDetails) {
              this.trackApplication(this.currentJobDetails);
            }

            // After successful form submission, inform that we're ready to process next job
            if (this.state.pendingApplication) {
              this.state.pendingApplication = false;
              this.appendStatusMessage("Ready to process next job");
            }
          } else {
            this.appendStatusErrorMessage("Failed to complete application");

            // Still mark as ready for next job
            if (this.state.pendingApplication) {
              this.state.pendingApplication = false;
            }
          }
        } else {
          this.appendStatusErrorMessage("No profile data available");
        }
      } else {
        // We're on a job details page, look for the apply button
        this.appendStatusMessage("Looking for Easy Apply button");

        let applyButton = await this.findApplyButton();

        if (applyButton) {
          this.appendStatusMessage("Found apply button, clicking it");
          // Set application in progress
          this.state.isApplicationInProgress = true;
          this.state.applicationStartTime = Date.now();
          this.state.pendingApplication = true;
          this.state.formDetected = false;
          this.state.currentRedirectAttempts = 0;

          // For Glassdoor, we need to handle both modal forms and redirects
          if (this.state.platform === CONFIG.PLATFORMS.GLASSDOOR) {
            // Click the button - for Glassdoor this might open a modal or redirect
            applyButton.click();

            // Set up a check for Glassdoor modal forms
            this.checkForGlassdoorForm(0);
          } else {
            // For Indeed, click and expect a redirect
            applyButton.click();

            // Check for redirection after a delay
            this.checkForRedirectOrForm();
          }
        } else {
          this.appendStatusMessage(
            "No apply button found or not an Easy Apply job"
          );
        }
      }
    } catch (error) {
      errorLog("Error handling job page:", error);
      this.appendStatusErrorMessage(error);

      // Reset application state
      this.state.isApplicationInProgress = false;
      this.state.applicationStartTime = null;
      this.state.pendingApplication = false;
      this.state.formDetected = false;
    }
  }

  /**
   * Check if we're on an application form page
   */
  isOnApplyFormPage() {
    // Check URL patterns - more comprehensive patterns
    const url = window.location.href;

    // For Indeed
    if (
      url.includes("smartapply.indeed.com/beta/indeedapply/form") ||
      url.includes("indeed.com/apply") ||
      url.includes("indeed.com/viewjob")
    ) {
      debugLog("Detected Indeed application form page via URL");
      return true;
    }

    // For Glassdoor
    if (
      this.state.platform === CONFIG.PLATFORMS.GLASSDOOR &&
      (url.includes("glassdoor.com/apply") ||
        url.includes("glassdoor.com/job/apply"))
    ) {
      debugLog("Detected Glassdoor application form page via URL");
      return true;
    }

    // Check for form elements - more comprehensive selectors
    debugLog("Checking for form elements on page");

    const hasIndeedFormElements =
      document.querySelector("form") ||
      document.querySelector(".ia-ApplyFormScreen") ||
      document.querySelector("#ia-container") ||
      document.querySelector(".indeed-apply-bd") ||
      document.querySelector(".indeed-apply-form");

    const hasGlassdoorFormElements =
      this.state.platform === CONFIG.PLATFORMS.GLASSDOOR &&
      (document.querySelector(".jobsOverlayModal") ||
        document.querySelector(".modal-content form") ||
        document.querySelector(".applyButtonContainer") ||
        document.querySelector("[data-test='applyButton']"));

    const hasFormElements = hasIndeedFormElements || hasGlassdoorFormElements;

    if (hasFormElements) {
      debugLog("Detected form elements on page");
    }

    return hasFormElements;
  }

  /**
   * Set up a mutation observer to detect form elements appearing on the page
   */
  setupFormDetectionObserver() {
    try {
      // Create a new observer
      this.formObserver = new MutationObserver((mutations) => {
        // Check more frequently - not just when we're explicitly waiting for a form
        if (this.state.isApplicationInProgress || this.isOnApplyPage()) {
          // Check if form elements have appeared - improved selectors
          const hasForm =
            document.querySelector("form") ||
            document.querySelector(".ia-ApplyFormScreen") ||
            document.querySelector("#ia-container") ||
            document.querySelector(".indeed-apply-bd") ||
            document.querySelector(".indeed-apply-form") ||
            document.querySelector(".modal-content form") ||
            document.querySelector(".jobsOverlayModal");

          if (hasForm && !this.state.formDetected) {
            debugLog("Form detected by mutation observer");
            this.state.formDetected = true;

            // Handle the form after a short delay to let it fully load
            setTimeout(() => {
              this.handleDetectedForm();
            }, 1000);
          }
        }
      });

      // Start observing the document with the configured parameters
      this.formObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });

      debugLog("Form detection observer set up");
    } catch (error) {
      errorLog("Error setting up form observer:", error);
    }
  }

  /**
   * Helper method to check if we're on an application page by URL
   */
  isOnApplyPage() {
    const url = window.location.href;
    return (
      url.includes("smartapply.indeed.com") ||
      url.includes("indeed.com/apply") ||
      url.includes("glassdoor.com/apply")
    );
  }

  /**
   * Handle application form - improved form detection
   */
  async handleApplyForm() {
    try {
      // Wait for the form to load completely
      await this.sleep(1500);

      // Initialize the enhanced FormHandler with all required configuration
      const formHandler = new FormHandler({
        logger: (message) => this.appendStatusMessage(message),
        host: this.HOST,
        userData: this.profile,
        jobDescription: this.state.currentJobDescription,
        platform: this.state.platform,
      });

      this.appendStatusMessage(
        "Form handler initialized, starting form filling process"
      );

      // Use the new comprehensive form filling method that handles everything
      const success = await formHandler.fillCompleteForm();

      // Update UI based on result
      if (success) {
        this.appendStatusMessage("Application submitted successfully!");
        // Mark the last job card as applied if available
        this.markLastJobCardIfAvailable("applied");
      } else {
        this.appendStatusMessage(
          "Application process completed but success not confirmed"
        );
        // Don't mark as error since it might have actually succeeded
      }

      return success;
    } catch (error) {
      errorLog("Error handling application form:", error);
      this.appendStatusErrorMessage("Form submission error: " + error.message);
      // Mark the last job card as error if available
      this.markLastJobCardIfAvailable("error");
      return false;
    }
  }

  /**
   * Enhanced resume upload handler for Indeed and Glassdoor
   * This handles multiple upload patterns including the SmartApply interface
   */
  async handleResumeUpload() {
    try {
      this.appendStatusMessage("Checking for resume upload option");

      // Wait for elements to be fully loaded
      await this.sleep(2000);

      // ----- INDEED SPECIFIC PATTERNS -----
      if (this.state.platform === CONFIG.PLATFORMS.INDEED) {
        // 1. Check if there's already a resume preview showing (like in the HTML shared)
        const resumePreview =
          document.querySelector("[data-testid='ResumeThumbnail']") ||
          document.querySelector(".css-1qsu1np") ||
          document.querySelector("[aria-roledescription='document']");

        if (resumePreview) {
          this.appendStatusMessage(
            "Resume already uploaded and showing in preview"
          );

          // Look for "Continue" or "Next" button and click it
          const continueButton =
            document.querySelector("[data-testid='IndeedApplyButton']") ||
            document.querySelector("button[type='submit']") ||
            this.findButtonByText("Continue") ||
            this.findButtonByText("Next");

          if (continueButton && this.isElementVisible(continueButton)) {
            this.appendStatusMessage(
              "Clicking continue button after resume preview"
            );
            continueButton.click();
            await this.sleep(2000);
            return true;
          }

          return true; // Resume is already showing, so upload succeeded
        }

        // 2. Check for "Upload Resume" button in Indeed interface
        const uploadResumeButton =
          this.findButtonByText("Upload resume") ||
          this.findButtonByText("Upload Resume") ||
          document.querySelector("[data-testid='resume-upload-button']") ||
          document.querySelector(".css-1qg3oo5"); // Indeed upload button class

        if (uploadResumeButton && this.isElementVisible(uploadResumeButton)) {
          this.appendStatusMessage("Found upload resume button, clicking it");
          uploadResumeButton.click();
          await this.sleep(1500);
        }

        // 3. Check for "Select Resume" section in SmartApply (shows already uploaded resumes)
        const resumeSelectionItems =
          document.querySelectorAll("[data-testid='resume-select-card']") ||
          document.querySelectorAll(".css-zmmde0") || // Indeed resume card class
          document.querySelectorAll(".ia-ResumeSelection-resume");

        if (resumeSelectionItems && resumeSelectionItems.length > 0) {
          this.appendStatusMessage(
            `Found ${resumeSelectionItems.length} existing resumes, selecting first one`
          );

          // Click the first resume option
          resumeSelectionItems[0].click();
          await this.sleep(1000);

          // Look for continue button
          const continueAfterSelect =
            document.querySelector("button[data-testid='continue-button']") ||
            this.findButtonByText("Continue") ||
            document.querySelector("button[type='submit']");

          if (
            continueAfterSelect &&
            this.isElementVisible(continueAfterSelect)
          ) {
            this.appendStatusMessage(
              "Clicking continue after selecting resume"
            );
            continueAfterSelect.click();
            await this.sleep(2000);
          }

          return true;
        }
      }

      // ----- GLASSDOOR SPECIFIC PATTERNS -----
      if (this.state.platform === CONFIG.PLATFORMS.GLASSDOOR) {
        // Check for Glassdoor resume upload button
        const glassdoorUploadBtn =
          this.findButtonByText("Upload Resume") ||
          document.querySelector("[data-test='resume-upload-button']");

        if (glassdoorUploadBtn && this.isElementVisible(glassdoorUploadBtn)) {
          this.appendStatusMessage(
            "Found Glassdoor upload button, clicking it"
          );
          glassdoorUploadBtn.click();
          await this.sleep(1500);
        }
      }

      // ----- GENERIC FILE INPUT DETECTION -----
      // Try to find file input elements - be very thorough with selectors
      const fileInputs = [
        // Indeed selectors
        document.querySelector("input[type='file'][accept='.pdf,.doc,.docx']"),
        document.querySelector("input[type='file'][name='resume']"),
        document.querySelector(
          "input[type='file'][data-testid='resume-upload-input']"
        ),
        document.querySelector(".ia-ResumeUpload-fileInput"),

        // Glassdoor selectors
        document.querySelector(
          "input[type='file'][accept='.doc,.docx,.pdf,.rtf']"
        ),
        document.querySelector("input[type='file'][name='resumeFile']"),

        // Generic selectors
        document.querySelector("input[type='file']"),
        document.querySelector("input[accept*='pdf']"),
        document.querySelector("input[accept*='doc']"),
      ].filter((input) => input !== null && this.isInputEnabled(input));

      if (fileInputs.length === 0) {
        this.appendStatusMessage("No resume upload field found");

        // Look for "Skip" option since some applications allow skipping resume upload
        const skipButton =
          this.findButtonByText("Skip") ||
          this.findLinkByText("Skip this step");

        if (skipButton && this.isElementVisible(skipButton)) {
          this.appendStatusMessage(
            "No upload field found, but found skip button - clicking it"
          );
          skipButton.click();
          await this.sleep(1500);
          return true;
        }

        return false;
      }

      const fileInput = fileInputs[0]; // Use the first valid file input found
      this.appendStatusMessage(
        `Found file input: ${fileInput.name || "unnamed input"}`
      );

      // Make sure we have resume URL
      if (!this.profile?.resumeUrl) {
        this.appendStatusMessage("No resume URL in profile");
        return false;
      }

      // Upload resume using file handler
      this.appendStatusMessage(
        "Uploading resume to: " + (fileInput.name || "file input")
      );
      const uploaded = await this.fileHandler.handleResumeUpload(this.profile, {
        querySelector: () => fileInput,
      });

      if (uploaded) {
        this.appendStatusMessage("Resume uploaded successfully");

        // Wait for upload to process and any UI changes
        await this.sleep(3000);

        // Look for and click continue button after upload
        const continueAfterUpload =
          document.querySelector("button[type='submit']") ||
          this.findButtonByText("Continue") ||
          this.findButtonByText("Next") ||
          document.querySelector("button[data-testid='continue-button']");

        if (continueAfterUpload && this.isElementVisible(continueAfterUpload)) {
          this.appendStatusMessage("Clicking continue after resume upload");
          continueAfterUpload.click();
          await this.sleep(2000);
        }

        return true;
      } else {
        this.appendStatusMessage("Resume upload failed");
        return false;
      }
    } catch (error) {
      this.appendStatusErrorMessage(
        "Error during resume upload: " + error.message
      );
      return false;
    }
  }

  /**
   * Helper method to find a button by its text content
   */
  findButtonByText(text) {
    const allButtons = Array.from(document.querySelectorAll("button"));
    return allButtons.find(
      (button) =>
        button.textContent &&
        button.textContent.trim().toLowerCase().includes(text.toLowerCase())
    );
  }

  /**
   * Helper method to find a link by its text content
   */
  findLinkByText(text) {
    const allLinks = Array.from(document.querySelectorAll("a"));
    return allLinks.find(
      (link) =>
        link.textContent &&
        link.textContent.trim().toLowerCase().includes(text.toLowerCase())
    );
  }

  /**
   * Helper method to check if an input element is enabled and can be interacted with
   */
  isInputEnabled(input) {
    if (!input) return false;

    try {
      return (
        !input.disabled &&
        !input.readOnly &&
        this.isElementVisible(input) &&
        getComputedStyle(input).display !== "none" &&
        getComputedStyle(input).visibility !== "hidden"
      );
    } catch (error) {
      return false;
    }
  }

  /**
   * Enhanced file handler for Indeed SmartApply specifically
   * This should be added to your FileHandler class
   */
  async handleIndeedSmartApplyResume() {
    try {
      // First check if we have a resume preview showing
      const previewVisible =
        document.querySelector("[data-testid='ResumeThumbnail']") ||
        document.querySelector("[aria-roledescription='document']");

      if (previewVisible) {
        this.logger("Resume preview already showing, no need to upload");
        return true;
      }

      // Try to find the upload button first (Sometimes we need to click this before the input appears)
      const uploadButton =
        this.findButtonByText("Upload resume") ||
        document.querySelector("[data-testid='resume-upload-button']");

      if (uploadButton && this.isElementVisible(uploadButton)) {
        this.logger("Clicking upload button to reveal file input");
        uploadButton.click();
        await this.sleep(1500);
      }

      // Now look for file input with various selectors
      const fileInput =
        document.querySelector(
          "input[type='file'][accept='.pdf,.doc,.docx']"
        ) ||
        document.querySelector(
          "input[type='file'][data-testid='resume-upload-input']"
        ) ||
        document.querySelector(".ia-ResumeUpload-fileInput") ||
        document.querySelector("input[type='file']");

      if (!fileInput) {
        this.logger("No file input found for Indeed SmartApply");

        // Check if there are previously uploaded resumes to select
        const resumeOptions =
          document.querySelectorAll("[data-testid='resume-select-card']") ||
          document.querySelectorAll(".ia-ResumeSelection-resume");

        if (resumeOptions && resumeOptions.length > 0) {
          this.logger(
            `Found ${resumeOptions.length} existing resumes, selecting first one`
          );
          resumeOptions[0].click();
          await this.sleep(1000);
          return true;
        }

        return false;
      }

      // Use the existing fetch and upload logic
      this.logger("Found file input, proceeding with fetch and upload");
      const result = await this.fetchAndUploadResume(fileInput);

      // After upload, check for continue button
      if (result) {
        await this.sleep(2000);
        const continueBtn =
          this.findButtonByText("Continue") ||
          document.querySelector("button[type='submit']");

        if (continueBtn && this.isElementVisible(continueBtn)) {
          this.logger("Clicking continue after upload");
          continueBtn.click();
        }
      }

      return result;
    } catch (error) {
      this.logger("Error in handleIndeedSmartApplyResume: " + error.message);
      return false;
    }
  }

  /**
   * This is a separate method to specifically detect and handle
   * resume upload in the Indeed SmartApply interface
   */
  async detectAndHandleIndeedResume() {
    try {
      // Wait for the SmartApply interface to load
      await this.sleep(2000);

      // Check if we're on the resume step
      const resumeHeadings = Array.from(document.querySelectorAll("h1")).filter(
        (h) => h.textContent && h.textContent.includes("Add your resume")
      );
      const isResumeStep =
        resumeHeadings.length > 0 ||
        document.querySelector("[data-testid='resume-step']") ||
        document.querySelector(".ia-ResumeSection");

      if (!isResumeStep) {
        this.appendStatusMessage("Not on resume upload step");
        return true; // Not a failure, just not on this step
      }

      this.appendStatusMessage("Detected Indeed resume upload step");

      // First check for resume preview (already uploaded resume)
      const resumePreview =
        document.querySelector("[data-testid='ResumeThumbnail']") ||
        document.querySelector("[aria-roledescription='document']");

      if (resumePreview) {
        this.appendStatusMessage(
          "Resume already uploaded and showing in preview"
        );

        // Click continue button if available
        const continueButton =
          this.findButtonByText("Continue") ||
          document.querySelector("button[data-testid='continue-button']") ||
          document.querySelector("button[type='submit']");

        if (continueButton && this.isElementVisible(continueButton)) {
          this.appendStatusMessage("Clicking continue with existing resume");
          continueButton.click();
          await this.sleep(2000);
        }

        return true;
      }

      // Check for existing resume options to select
      const resumeOptions =
        document.querySelectorAll("[data-testid='resume-select-card']") ||
        document.querySelectorAll(".ia-ResumeSelection-resume");

      if (resumeOptions && resumeOptions.length > 0) {
        this.appendStatusMessage(
          `Found ${resumeOptions.length} existing resumes, selecting first one`
        );
        resumeOptions[0].click();
        await this.sleep(1500);

        // Click continue
        const continueAfterSelect =
          this.findButtonByText("Continue") ||
          document.querySelector("button[type='submit']");

        if (continueAfterSelect && this.isElementVisible(continueAfterSelect)) {
          this.appendStatusMessage("Clicking continue after selecting resume");
          continueAfterSelect.click();
          await this.sleep(2000);
        }

        return true;
      }

      // If no resume showing and no options to select, we need to upload

      // First look for upload button
      const uploadButton =
        this.findButtonByText("Upload resume") ||
        document.querySelector("[data-testid='resume-upload-button']");

      if (uploadButton && this.isElementVisible(uploadButton)) {
        this.appendStatusMessage("Clicking upload resume button");
        uploadButton.click();
        await this.sleep(1500);
      }

      // Now look for file input
      const fileInput =
        document.querySelector(
          "input[type='file'][accept='.pdf,.doc,.docx']"
        ) ||
        document.querySelector(
          "input[type='file'][data-testid='resume-upload-input']"
        ) ||
        document.querySelector(".ia-ResumeUpload-fileInput") ||
        document.querySelector("input[type='file']");

      if (!fileInput) {
        this.appendStatusMessage(
          "No file input found even after clicking upload button"
        );
        return false;
      }

      // Upload resume using file handler
      this.appendStatusMessage("Uploading resume to SmartApply");

      // Make sure we have resume URL
      if (!this.profile?.resumeUrl) {
        this.appendStatusMessage("No resume URL in profile");
        return false;
      }

      const uploaded = await this.fileHandler.handleResumeUpload(this.profile, {
        querySelector: () => fileInput,
      });

      if (uploaded) {
        this.appendStatusMessage("Resume uploaded successfully to SmartApply");

        // Wait for upload to process
        await this.sleep(3000);

        // Click continue button
        const continueAfterUpload =
          this.findButtonByText("Continue") ||
          document.querySelector("button[type='submit']");

        if (continueAfterUpload && this.isElementVisible(continueAfterUpload)) {
          this.appendStatusMessage("Clicking continue after uploading resume");
          continueAfterUpload.click();
          await this.sleep(2000);
        }

        return true;
      } else {
        this.appendStatusMessage("Resume upload to SmartApply failed");
        return false;
      }
    } catch (error) {
      this.appendStatusErrorMessage(
        "Error handling Indeed resume: " + error.message
      );
      return false;
    }
  }

  /**
   * Improved findApplyButton method with exact button text matching
   */
  async findApplyButton() {
    // For Indeed, check for buttons with EXACTLY "apply now" text (case insensitive)
    if (this.state.platform === CONFIG.PLATFORMS.INDEED) {
      const easyApplyBtn = document.querySelector("button#indeedApplyButton");
      const externalApplyBtn = document.querySelector(
        "#viewJobButtonLinkContainer button[href], #applyButtonLinkContainer button[href]"
      );

      if (easyApplyBtn && this.isElementVisible(easyApplyBtn)) {
        this.appendStatusMessage("✅ Found Easy Apply button on Indeed");
        return easyApplyBtn;
      }

      if (externalApplyBtn && this.isElementVisible(externalApplyBtn)) {
        this.appendStatusMessage(
          "⚠️ Found External Apply button (redirects to company site)"
        );
        // sendMessage({
        //   type: "handleExternalApplication",
        // });
        // return externalApplyBtn;
        return null;
      }

      this.appendStatusMessage("❌ No apply button found on Indeed");
      return null;
    }

    // For Glassdoor, check for buttons with EXACTLY "Easy Apply" text
    if (this.state.platform === CONFIG.PLATFORMS.GLASSDOOR) {
      // Check all buttons for exact match "Easy Apply" text
      const allButtons = Array.from(
        document.querySelectorAll("button, a.applyButton")
      );

      for (const btn of allButtons) {
        if (this.isElementVisible(btn)) {
          const buttonText = btn.textContent.trim();

          // Check for EXACT "Easy Apply" match for Glassdoor
          if (buttonText === "Easy Apply") {
            this.appendStatusMessage(
              "Found Glassdoor 'Easy Apply' button (exact match)"
            );
            return btn;
          }
        }
      }

      // If we didn't find an exact "Easy Apply" button, skip this job
      this.appendStatusMessage(
        "No exact 'Easy Apply' button found for Glassdoor, skipping job"
      );
      return null;
    }

    // If we reach here, we didn't find the correct button
    this.appendStatusMessage(
      `No matching button found for platform: ${this.state.platform}, skipping job`
    );
    return null;
  }

  /**
   * Check if we've already applied to this job on SmartApply
   * Add this to the checkForRedirectOrForm or handleDetectedForm method
   */

  async checkIfAlreadyApplied() {
    try {
      // Check if we're on the Indeed SmartApply form page
      const isSmartApplyPage = window.location.href.includes(
        "smartapply.indeed.com/beta/indeedapply/form"
      );

      if (!isSmartApplyPage) {
        return false; // Not on SmartApply page
      }

      // Look for "You've applied to this job" text
      const pageText = document.body.innerText;
      const alreadyAppliedText = "You've applied to this job";

      if (pageText.includes(alreadyAppliedText)) {
        this.appendStatusMessage(
          "Found 'You've applied to this job' message - already applied"
        );

        // Add to submitted links with SKIPPED status
        const url = window.location.href;
        this.state.submittedLinks.push({
          url,
          status: "SKIPPED",
          reason: "Already applied to this job",
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

        // Reset application state
        this.resetApplicationState();

        // Notify search tab to continue to next job
        this.notifySearchNext({
          url,
          status: "SKIPPED",
          message: "Already applied to this job",
        });

        return true;
      }

      return false; // Not already applied
    } catch (error) {
      console.error("Error checking if already applied:", error);
      return false;
    }
  }

  /**
   * Enhanced handleDetectedForm method with already-applied check
   */

  async handleDetectedForm() {
    try {
      // First check if we've already applied to this job
      const alreadyApplied = await this.checkIfAlreadyApplied();
      if (alreadyApplied) {
        // If already applied, we've handled everything in the checkIfAlreadyApplied method
        return;
      }

      this.appendStatusMessage("Form detected, starting application process");

      // Wait for profile data if needed
      if (!this.profile) {
        this.profile = await this.getProfileData();
      }

      if (this.profile) {
        // Handle application form
        const success = await this.handleApplyForm();

        // After form submission (success or failure), update status
        if (success) {
          this.appendStatusMessage("Application submitted successfully");
          if (this.currentJobDetails) {
            this.trackApplication(this.currentJobDetails);
          }
          this.markLastJobCardIfAvailable("applied");
        } else {
          this.appendStatusMessage("Failed to complete application");
          this.markLastJobCardIfAvailable("error");
        }

        // Reset application state
        this.state.isApplicationInProgress = false;
        this.state.applicationStartTime = null;
        this.state.pendingApplication = false;
        this.state.formDetected = false;
        this.state.currentRedirectAttempts = 0;

        // Now we can move to the next job
        if (this.state.isRunning) {
          this.appendStatusMessage("Moving to next job...");
          setTimeout(() => this.processNextJob(), 2000);
        }
      } else {
        this.appendStatusErrorMessage(
          "No profile data available for form filling"
        );
        // Reset application state
        this.state.isApplicationInProgress = false;
        this.state.applicationStartTime = null;
        this.state.pendingApplication = false;
        this.state.formDetected = false;

        // Still move to next job if automation is running
        if (this.state.isRunning) {
          setTimeout(() => this.processNextJob(), 2000);
        }
      }
    } catch (error) {
      errorLog("Error handling detected form:", error);
      this.appendStatusErrorMessage("Error handling form: " + error.message);

      // Reset application state
      this.state.isApplicationInProgress = false;
      this.state.applicationStartTime = null;
      this.state.pendingApplication = false;
      this.state.formDetected = false;

      // Still try to move on if automation is running
      if (this.state.isRunning) {
        setTimeout(() => this.processNextJob(), 2000);
      }
    }
  }

  /**
   * Enhanced checkForRedirectOrForm with already-applied check
   */

  checkForRedirectOrForm() {
    // Check if we've reached max redirect attempts
    if (this.state.currentRedirectAttempts >= this.state.maxRedirectAttempts) {
      this.appendStatusErrorMessage("Max redirect attempts reached, giving up");

      // Reset application state
      this.state.isApplicationInProgress = false;
      this.state.applicationStartTime = null;
      this.state.pendingApplication = false;
      this.state.formDetected = false;

      // Continue with next job if running automation
      if (this.state.isRunning) {
        setTimeout(() => this.processNextJob(), 2000);
      }

      return;
    }

    this.state.currentRedirectAttempts++;
    this.appendStatusMessage(
      `Checking for redirect or form (attempt ${this.state.currentRedirectAttempts})`
    );

    const currentUrl = window.location.href;

    // Check for Glassdoor POST_APPLY page
    if (
      currentUrl.includes("glassdoor.com") &&
      currentUrl.includes("smart-apply-action=POST_APPLY")
    ) {
      this.appendStatusMessage(
        "Detected Glassdoor POST_APPLY page - skipping and moving to next job"
      );

      // Add to submitted links with SKIPPED status
      this.state.submittedLinks.push({
        url: currentUrl,
        status: "SKIPPED",
        reason: "Glassdoor POST_APPLY page detected",
        timestamp: Date.now(),
        platform: this.state.platform,
      });

      // Close the application tab and move to next job
      try {
        if (this.state.applyTabId) {
          chrome.tabs.remove(this.state.applyTabId);
        }
      } catch (tabError) {
        console.error("Error closing tab:", tabError);
      }

      // Reset application state
      this.resetApplicationState();

      // Notify search tab to continue to next job
      this.notifySearchNext({
        url: currentUrl,
        status: "SKIPPED",
        message: "Glassdoor POST_APPLY page detected, skipping",
      });

      return;
    }

    // Check if we're on an Indeed form page by URL
    const isIndeedFormPage = currentUrl.includes(
      "smartapply.indeed.com/beta/indeedapply/form"
    );

    // If we're on Indeed SmartApply, check if we've already applied
    if (isIndeedFormPage) {
      // Look for "You've applied to this job" text
      const pageText = document.body.innerText;
      if (pageText.includes("You've applied to this job")) {
        this.appendStatusMessage(
          "Found 'You've applied to this job' message - already applied"
        );

        // Add to submitted links with SKIPPED status
        this.state.submittedLinks.push({
          url: currentUrl,
          status: "SKIPPED",
          reason: "Already applied to this job",
          timestamp: Date.now(),
          platform: this.state.platform,
        });

        // Close the application tab and move to next job
        try {
          if (this.state.applyTabId) {
            chrome.tabs.remove(this.state.applyTabId);
          }
        } catch (tabError) {
          console.error("Error closing tab:", tabError);
        }

        // Reset application state
        this.resetApplicationState();

        // Notify search tab to continue to next job
        this.notifySearchNext({
          url: currentUrl,
          status: "SKIPPED",
          message: "Already applied to this job",
        });

        return;
      }
    }

    // Check if we're on a Glassdoor form page by URL
    const isGlassdoorFormPage = currentUrl.includes("glassdoor.com/apply");

    // If we started on one platform but redirected to another, update the platform
    if (
      this.state.platform === CONFIG.PLATFORMS.GLASSDOOR &&
      isIndeedFormPage
    ) {
      this.appendStatusMessage(
        "Detected redirect from Glassdoor to Indeed SmartApply form"
      );
      this.state.platform = CONFIG.PLATFORMS.INDEED;
    } else if (
      this.state.platform === CONFIG.PLATFORMS.INDEED &&
      isGlassdoorFormPage
    ) {
      this.appendStatusMessage(
        "Detected redirect from Indeed to Glassdoor form"
      );
      this.state.platform = CONFIG.PLATFORMS.GLASSDOOR;
    }

    // Check for form elements
    const hasFormElements =
      document.querySelector("form") ||
      document.querySelector(".ia-ApplyFormScreen") ||
      (this.state.platform === CONFIG.PLATFORMS.GLASSDOOR &&
        (document.querySelector(".jobsOverlayModal") ||
          document.querySelector(".modal-content form")));

    if (isIndeedFormPage || isGlassdoorFormPage || hasFormElements) {
      this.appendStatusMessage(
        "Successfully redirected to form page or form detected"
      );
      this.state.formDetected = true;

      // Handle the detected form
      setTimeout(async () => {
        await this.handleDetectedForm();
      }, 1000);
    } else {
      // Schedule another check after a delay
      this.appendStatusMessage("No form detected yet, waiting...");

      setTimeout(() => {
        this.checkForRedirectOrForm();
      }, CONFIG.TIMEOUTS.STANDARD);
    }
  }

  /**
   * Check if jobs are found in search results
   * This is a new method to check the search results header for job count
   */
  checkIfJobsFound() {
    try {
      // Look for the search results header element
      const searchHeaderSelectors = [
        "h1.SearchResultsHeader_jobCount__eHngv",
        "[data-test='search-title']",
        ".jobsearch-JobCountAndSortPane-jobCount",
        ".count",
      ];

      // Try each selector until we find a match
      let searchHeader = null;
      for (const selector of searchHeaderSelectors) {
        searchHeader = document.querySelector(selector);
        if (searchHeader) break;
      }

      if (!searchHeader) {
        this.appendStatusMessage("Could not find search results header");
        return { jobsFound: true }; // Default to true if we can't determine
      }

      // Parse the header text to extract the job count
      const headerText = searchHeader.textContent.trim();
      this.appendStatusMessage(`Found search header: "${headerText}"`);

      const jobCountMatch = headerText.match(/^(\d+)\s+/);

      if (jobCountMatch) {
        const jobCount = parseInt(jobCountMatch[1], 10);
        this.appendStatusMessage(`Found ${jobCount} jobs in search results`);
        return {
          jobsFound: jobCount > 0,
          jobCount: jobCount,
          searchQuery: headerText.replace(jobCountMatch[0], "").trim(),
        };
      } else if (
        headerText.toLowerCase().includes("no jobs found") ||
        headerText.toLowerCase().includes("0 jobs") ||
        headerText.toLowerCase().includes("found 0")
      ) {
        this.appendStatusMessage("No jobs found in search results");
        return { jobsFound: false, jobCount: 0 };
      }

      // If we couldn't parse the count but the header exists, check if there are any job cards
      const jobCards = document.querySelectorAll(this.getSelector("JOB_CARDS"));
      if (jobCards.length === 0) {
        this.appendStatusMessage("No job cards found in search results");
        return { jobsFound: false, jobCount: 0 };
      }

      return { jobsFound: true }; // Default to true if we can't determine for sure
    } catch (error) {
      errorLog("Error checking if jobs found:", error);
      return { jobsFound: true }; // Default to true on error to avoid blocking
    }
  }

  /**
   * Apply search filters to narrow down results
   * Updated to check for job results after applying filters
   */

  applySearchFilters() {
    try {
      this.appendStatusMessage("Applying search filters...");

      // Check for Easy Apply filter based on platform
      const easyApplyFilter = document.querySelector(
        this.getSelector("EASY_APPLY_FILTER")
      );
      if (easyApplyFilter && !easyApplyFilter.checked) {
        this.appendStatusMessage("Selecting Easy Apply filter");
        easyApplyFilter.click();
      }

      // Wait for filters to apply
      setTimeout(() => {
        this.appendStatusMessage("Filters applied, checking for job results");

        // Check if any jobs were found
        const { jobsFound, jobCount } = this.checkIfJobsFound();

        if (!jobsFound) {
          this.appendStatusMessage("No jobs found matching search criteria");
          this.updateStatusIndicator("completed", "No jobs found");
          this.state.ready = true;
          this.state.isRunning = false;
          return;
        }

        this.appendStatusMessage(
          `Found ${jobCount || "multiple"} jobs, starting automation`
        );
        this.state.ready = true;

        // Automatically start automation once filters are applied and jobs are found
        if (!this.state.isRunning) {
          this.startAutomation();
        }
      }, 2000);
    } catch (error) {
      errorLog("Error applying search filters:", error);
      this.appendStatusErrorMessage(error);

      // Set ready anyway and try to start
      this.state.ready = true;
      setTimeout(() => {
        if (!this.state.isRunning) {
          this.startAutomation();
        }
      }, 2000);
    }
  }

  /**
   * Start the automation process
   * Updated to check for jobs before starting
   */
  async startAutomation() {
    try {
      if (this.state.isRunning) {
        this.appendStatusMessage("Automation already running");
        return;
      }

      this.appendStatusMessage("Starting automation");

      // Check if jobs were found before proceeding
      const { jobsFound, jobCount, searchQuery } = this.checkIfJobsFound();

      if (!jobsFound) {
        this.appendStatusMessage(
          `No jobs found for search: ${searchQuery || "your search criteria"}`
        );
        this.updateStatusIndicator("completed", "No jobs found");
        return; // Don't start automation if no jobs found
      }

      this.updateStatusIndicator("running");

      // Initialize state
      this.state.isRunning = true;
      this.state.currentJobIndex = 0;
      this.state.processedCount = 0;
      this.state.lastActivity = Date.now();
      this.state.formDetected = false;
      this.state.isApplicationInProgress = false;
      this.state.pendingApplication = false;
      this.state.applicationStartTime = null;
      this.state.currentRedirectAttempts = 0;
      this.state.lastClickedJobCard = null;

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
   * Process the next job
   * Updated to double-check for jobs
   */

  async processNextJob() {
    try {
      if (!this.state.isRunning) {
        this.appendStatusMessage("Automation stopped");
        return;
      }

      // If there's a pending application, don't process the next job yet
      if (this.state.isApplicationInProgress || this.state.pendingApplication) {
        this.appendStatusMessage(
          "Application in progress, waiting before processing next job"
        );
        // Check again after a delay
        setTimeout(() => this.processNextJob(), 5000);
        return;
      }

      // Double check if we're on a results page with 0 jobs
      if (this.state.currentJobIndex === 0) {
        const { jobsFound } = this.checkIfJobsFound();
        if (!jobsFound) {
          this.appendStatusMessage(
            "No jobs found in search results, stopping automation"
          );
          this.updateStatusIndicator("completed", "No jobs found");
          this.state.isRunning = false;
          return;
        }
      }

      // Get all job cards that haven't been processed yet
      const jobCards = this.getUnprocessedJobCards();

      if (jobCards.length === 0) {
        // Try to load more jobs
        if (await this.goToNextPage()) {
          // Wait for page to load and try again
          setTimeout(() => this.processNextJob(), 3000);
        } else {
          this.appendStatusMessage("No more jobs to process");
          this.updateStatusIndicator("completed");
          this.state.isRunning = false;
        }
        return;
      }

      // Process the first unprocessed job card
      const jobCard = jobCards[0];
      this.state.lastClickedJobCard = jobCard;

      // Mark as processing
      this.markJobCard(jobCard, "processing");

      // Click the job card to show details
      this.appendStatusMessage("Clicking job card to show details");
      if (this.state.platform === CONFIG.PLATFORMS.GLASSDOOR) {
        console.log("Clicking job card on glassdoor");

        jobCard.querySelector("a.JobCard_trackingLink__HMyun")?.click();
      } else {
        jobCard.querySelector("a.jcs-JobTitle")?.click();
      }

      // Wait for details to load
      await this.sleep(CONFIG.TIMEOUTS.STANDARD);

      // Handle any popups
      this.handlePopups();

      // Extract job details before clicking apply
      const jobDetails = this.extractJobDetailsFromCard(jobCard);

      // Store job details for later tracking
      this.currentJobDetails = jobDetails;

      // Find the apply button in the details panel
      const applyButton = await this.findApplyButton();

      if (!applyButton) {
        this.appendStatusMessage("No Easy Apply button found, skipping job");
        this.markJobCard(jobCard, "skipped");
        this.state.processedCards.add(this.getJobCardId(jobCard));
        this.state.processedCount++;

        // Move to next job
        setTimeout(() => this.processNextJob(), 1000);
        return;
      }

      // Found an Easy Apply button, start the application
      this.appendStatusMessage("Found Easy Apply button, starting application");

      // Set application in progress
      this.state.isApplicationInProgress = true;
      this.state.applicationStartTime = Date.now();
      this.state.pendingApplication = true;
      this.state.formDetected = false;
      this.state.currentRedirectAttempts = 0;

      // Mark card as being processed
      this.state.processedCards.add(this.getJobCardId(jobCard));

      // For Glassdoor, we need to handle both modal forms and redirects
      if (this.state.platform === CONFIG.PLATFORMS.GLASSDOOR) {
        // Click the button - for Glassdoor this might open a modal or redirect
        applyButton.click();

        // Set up a check for Glassdoor modal forms
        this.checkForGlassdoorForm(0);
      } else {
        // For Indeed, click and expect a redirect
        applyButton.click();

        // Check for redirection after a delay
        this.checkForRedirectOrForm();
      }
    } catch (error) {
      errorLog("Error processing job:", error);
      this.appendStatusErrorMessage("Error processing job: " + error.message);

      // Reset application state
      this.state.isApplicationInProgress = false;
      this.state.applicationStartTime = null;
      this.state.pendingApplication = false;
      this.state.formDetected = false;

      // Try to continue with next job
      setTimeout(() => this.processNextJob(), 3000);
    }
  }

  /**
   * Go to next page of jobs
   * Updated to check if new page has jobs
   */

  async goToNextPage() {
    try {
      const nextButton = document.querySelector(this.getSelector("NEXT_PAGE"));
      if (nextButton && this.isElementVisible(nextButton)) {
        this.appendStatusMessage("Moving to next page of results");
        nextButton.click();

        // Wait for the page to load
        await this.sleep(3000);

        // Check if the new page has jobs
        const { jobsFound } = this.checkIfJobsFound();
        if (!jobsFound) {
          this.appendStatusMessage("No jobs found on next page");
          return false;
        }

        return true;
      }
      return false;
    } catch (error) {
      errorLog("Error going to next page:", error);
      return false;
    }
  }

  /**
   * Initialize automation - check for jobs at init
   */

  init() {
    try {
      const url = window.location.href;
      debugLog("Initializing on URL:", url);

      // Enhanced detection for Indeed application form
      if (
        url.includes("smartapply.indeed.com") ||
        url.includes("indeed.com/apply")
      ) {
        this.appendStatusMessage(
          "Indeed application form page detected directly"
        );
        // This is the application form page - start applying immediately
        this.state.platform = CONFIG.PLATFORMS.INDEED; // Set platform to Indeed for the form
        this.state.initialized = true;
        this.state.ready = true;
        this.state.formDetected = true;

        // Allow the form to fully load - longer delay
        setTimeout(async () => {
          this.appendStatusMessage("Starting application on Indeed form");

          // Get profile data
          try {
            this.profile = await this.getProfileData();

            if (this.profile) {
              // Set application in progress
              this.state.isApplicationInProgress = true;
              this.state.applicationStartTime = Date.now();

              // Handle the form
              const success = await this.handleApplyForm();

              // Reset application state
              this.state.isApplicationInProgress = false;
              this.state.applicationStartTime = null;

              if (success) {
                this.appendStatusMessage("Application completed successfully");
                this.updateStatusIndicator("success");
              } else {
                this.appendStatusErrorMessage("Failed to complete application");
                this.updateStatusIndicator("error");
              }
            } else {
              this.appendStatusErrorMessage(
                "Could not get profile data for application"
              );
            }
          } catch (profileError) {
            this.appendStatusErrorMessage(
              "Error getting profile: " + profileError.message
            );
          }
        }, 3000); // Increased delay to 3 seconds

        return;
      }

      // Handle Glassdoor application form in modal
      if (
        this.state.platform === CONFIG.PLATFORMS.GLASSDOOR &&
        (document.querySelector(".jobsOverlayModal") ||
          document.querySelector(".modal-content form"))
      ) {
        this.appendStatusMessage(
          "Glassdoor application form detected in modal"
        );
        this.state.initialized = true;
        this.state.ready = true;
        this.state.formDetected = true;

        // Allow the form to fully load
        setTimeout(async () => {
          this.appendStatusMessage("Starting application on Glassdoor form");

          // Get profile data
          try {
            this.profile = await this.getProfileData();

            if (this.profile) {
              // Set application in progress
              this.state.isApplicationInProgress = true;
              this.state.applicationStartTime = Date.now();

              // Handle the form
              const success = await this.handleApplyForm();

              // Reset application state
              this.state.isApplicationInProgress = false;
              this.state.applicationStartTime = null;

              if (success) {
                this.appendStatusMessage("Application completed successfully");
                this.updateStatusIndicator("success");
              } else {
                this.appendStatusErrorMessage("Failed to complete application");
                this.updateStatusIndicator("error");
              }
            } else {
              this.appendStatusErrorMessage(
                "Could not get profile data for application"
              );
            }
          } catch (profileError) {
            this.appendStatusErrorMessage(
              "Error getting profile: " + profileError.message
            );
          }
        }, 2000);

        return;
      }

      // Normal initialization for other pages
      const platform = this.state.platform;

      const isSearchPage =
        CONFIG.URL_PATTERNS[platform.toUpperCase()].SEARCH_PAGE.test(url);
      const isJobPage =
        CONFIG.URL_PATTERNS[platform.toUpperCase()].JOB_PAGE.test(url);
      const isApplyPage =
        CONFIG.URL_PATTERNS[platform.toUpperCase()].APPLY_PAGE.test(url);

      if (isSearchPage) {
        this.appendStatusMessage(
          `${
            platform.charAt(0).toUpperCase() + platform.slice(1)
          } search page detected`
        );

        // Check if jobs are found before applying filters
        const { jobsFound } = this.checkIfJobsFound();
        if (!jobsFound) {
          this.appendStatusMessage("No jobs found in search results");
          this.updateStatusIndicator("completed", "No jobs found");
          this.state.ready = true;
          this.state.initialized = true;
          return;
        }

        // Apply filters after a short delay
        setTimeout(() => this.applySearchFilters(), 1000);
      } else if (isJobPage || isApplyPage) {
        this.appendStatusMessage(
          `${
            platform.charAt(0).toUpperCase() + platform.slice(1)
          } job page detected`
        );

        // Handle individual job page
        this.handleJobPage();
      }

      this.state.initialized = true;

      // Automatically start automation after initialization
      setTimeout(() => {
        if (isSearchPage && this.state.ready && !this.state.isRunning) {
          this.startAutomation();
        }
      }, 3000);
    } catch (error) {
      errorLog("Error in init:", error);
      this.appendStatusErrorMessage("Initialization error: " + error.message);
    }
  }
}

// Initialize the automation
debugLog("Creating JobAutomation instance");
const jobAutomation = new JobAutomation();

// Add message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    const { action, type } = message;
    const messageType = action || type;

    switch (messageType) {
      case "startJobSearch":
      case "startAutomation":
        jobAutomation.startAutomation();
        sendResponse({ status: "processing" });
        break;

      case "stopAutomation":
        jobAutomation.state.isRunning = false;
        jobAutomation.appendStatusMessage("Automation stopped by user");
        jobAutomation.updateStatusIndicator("stopped");
        sendResponse({ status: "stopped" });
        break;

      case "checkStatus":
        sendResponse({
          success: true,
          data: {
            initialized: jobAutomation.state.initialized,
            isApplicationInProgress:
              jobAutomation.state.isApplicationInProgress,
            processedCount: jobAutomation.state.processedCount,
            isRunning: jobAutomation.state.isRunning,
            platform: jobAutomation.state.platform,
          },
        });
        break;

      case "resetState":
        jobAutomation.state.isApplicationInProgress = false;
        jobAutomation.state.applicationStartTime = null;
        jobAutomation.state.processedCards = new Set();
        jobAutomation.state.processedCount = 0;
        jobAutomation.state.isRunning = false;
        jobAutomation.state.formDetected = false;
        jobAutomation.state.pendingApplication = false;
        jobAutomation.state.currentRedirectAttempts = 0;
        jobAutomation.updateStatusIndicator("ready");
        jobAutomation.appendStatusMessage("State reset complete");
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

  return true;
});
