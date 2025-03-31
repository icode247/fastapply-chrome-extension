import { StateManager } from "@shared/stateManager";
import { canApplyMore } from "@shared/checkAuthorization";
import { getJobURL, generateBusinessDates } from "@shared/utils";
import { HOST } from "@shared/constants";

class IndeedJobParser {
  constructor() {
    this.targetClass = "ia-JobDescription";
  }

  getElementText(element) {
    if (element.tagName === "UL" || element.tagName === "OL") {
      return Array.from(element.querySelectorAll("li"))
        .map((li) => `• ${li.textContent.trim()}`)
        .filter((text) => text !== "• ")
        .join("\n");
    }
    return element.textContent.trim();
  }

  processTextBlock(text) {
    return (
      text
        ?.replace(/\s+/g, " ")
        .replace(/\n\s*\n/g, "\n")
        .trim() || ""
    );
  }

  getSectionName(text) {
    const normalized = text.toLowerCase().trim();
    const sections = {
      "job summary": "summary",
      "key responsibilities": "responsibilities",
      "required skills": "requirements",
      "preferred skills": "preferredSkills",
      "why join": "benefits",
      "job types": "jobDetails",
      pay: "compensation",
    };

    for (const [key, value] of Object.entries(sections)) {
      if (normalized.includes(key)) return value;
    }
    return "other";
  }

  scrapeDescription(format = "string") {
    try {
      const container = document.querySelector(`.${this.targetClass}`);
      if (!container) throw new Error("Job description container not found");

      const sections = {
        summary: [],
        responsibilities: [],
        requirements: [],
        preferredSkills: [],
        benefits: [],
        jobDetails: [],
        compensation: [],
        other: [],
      };

      let currentSection = "other";
      let description = "";

      const elements = container.children;
      Array.from(elements).forEach((element) => {
        const text = this.getElementText(element);
        if (!text) return;

        // Check if element is a section header
        if (element.tagName === "P" && !element.querySelector("ul, ol")) {
          const potentialSection = this.getSectionName(text);
          if (potentialSection !== "other") {
            currentSection = potentialSection;
            if (format === "string") description += `\n${text}\n\n`;
            return;
          }
        }

        // Handle lists and paragraphs
        if (format === "string") {
          description += `${text}\n\n`;
        } else {
          if (element.tagName === "UL") {
            const points = text
              .split("\n")
              .map((point) => point.replace("• ", "").trim())
              .filter(Boolean);
            sections[currentSection].push(...points);
          } else {
            sections[currentSection].push(text);
          }
        }
      });

      if (format === "string") {
        return this.processTextBlock(description);
      }

      // Clean empty sections
      return Object.fromEntries(
        Object.entries(sections).filter(([_, value]) => value.length > 0)
      );
    } catch (error) {
      console.error("Error extracting job description:", error);
      return format === "string"
        ? `Error extracting job description: ${error.message}`
        : { error: error.message };
    }
  }

  static extract(format = "string") {
    const parser = new IndeedJobParser();
    return parser.scrapeDescription(format);
  }
}

class FastApplyAutomation {
  constructor() {
    this.userData = null;
    this.isRunning = false;
    this.currentJobIndex = 0;
    this.startTime = new Date();
    this.stateManager = new StateManager();
    this.CONFIG = {
      SELECTORS: {
        JOB_CARD: ".job_seen_beacon",
        JOB_TITLE: '.jcs-JobTitle span[id^="jobTitle-"]',
        COMPANY_NAME: '[data-testid="company-name"]',
        LOCATION: '[data-testid="text-location"]',
        APPLY_BUTTON: "#indeedApplyButton",
        APPLY_BUTTON_TEXT: ".jobsearch-IndeedApplyButton-newDesign",
        JOB_LINK: ".jcs-JobTitle",
        JOB_DESCRIPTION: ".css-o11dc0",
        JOB_SALARY: "#salaryInfoAndJobType",
        POPUP_CLOSE: ".popover-x-button-close",
        CAPTCHA: ".h-captcha",
        EXTERNAL_INDICATORS: [
          ".indeed-apply-status-not-applied",
          ".indeed-apply-status-applied",
          ".indeed-apply-status-rejected",
        ],
      },
      TIMEOUTS: {
        STANDARD: 2000,
        EXTENDED: 5000,
        MAX_TIMEOUT: 30000,
      },
    };
    this.answerCache = new Map();
    this.pendingRequests = new Map();
    this.requestTimeout = 10000; // 10 second timeout
    console.log("FastApplyAutomation constructor");
  }

  async handleMessage(message, sender, sendResponse) {
    console.log("Content script received message:", message);

    try {
      switch (message.action) {
        case "startJobSearch":
          if (!message.userId) {
            sendResponse({
              status: "error",
              message: "Missing required user data",
            });
            return;
          }

          // Initialize and start job search
          await this.initialize(message.userId);
          await this.performJobSearch();

          // Send immediate response
          sendResponse({ status: "processing" });
          break;

        case "searchCompleted":
          await this.stateManager.updateState({
            pendingSearch: false,
          });

          chrome.runtime.sendMessage({
            action: "searchCompleted",
            status: "ready",
            userId: this.userData?.userId,
          });
          break;

        case "processJobs":
          await this.startAutomation();
          sendResponse({ status: "processing" });
          break;

        case "fillApplicationForm":
          await this.handleIndeedApplication(message.jobData);
          sendResponse({ status: "processing" });
          break;

        case "stop":
          this.stop();
          sendResponse({ status: "stopped" });
          break;
      }
    } catch (error) {
      console.error("Error in content script:", error);
      sendResponse({ status: "error", message: error.message });
    }
  }

  async startAutomation() {
    try {
      // First check if we can still apply
      const currentState = await this.stateManager.getState();
      if (!(await canApplyMore(currentState))) {
        this.sendStatusUpdate(
          "error",
          `Cannot apply: ${
            currentState.userPlan === "credit"
              ? `Insufficient credits (${currentState.availableCredits} remaining)`
              : `Daily limit reached`
          }`
        );
        return "limit_reached";
      }
      console.log("started automation");
      this.isRunning = true;
      this.jobsToApply = await this.getVisibleJobs();

      if (this.jobsToApply.length === 0) {
        throw new Error("No jobs found to process");
      }

      // Calculate maximum jobs to process based on plan
      let maxJobs = this.jobsToApply.length;
      switch (currentState.userPlan) {
        case "free":
          maxJobs = Math.min(
            this.PLAN_LIMITS.FREE - (currentState.applicationsUsed || 0),
            maxJobs
          );
          break;
        case "starter":
          maxJobs = Math.min(
            this.PLAN_LIMITS.STARTER - (currentState.applicationsUsed || 0),
            maxJobs
          );
          break;
        case "credit":
          maxJobs = Math.min(currentState.availableCredits || 0, maxJobs);
          break;
        case "pro":
          maxJobs = Math.min(
            this.PLAN_LIMITS.PRO - (currentState.applicationsUsed || 0),
            maxJobs
          );
          break;
      }

      console.log(
        `Processing ${maxJobs} out of ${this.jobsToApply.length} jobs found`
      );

      for (let i = 0; i < maxJobs && this.isRunning; i++) {
        const job = this.jobsToApply[i];
        this.currentJobIndex = i;

        try {
          await this.processJob(job);

          // Enhanced application completion check with timeout
          let completed = false;
          const startTime = Date.now();

          while (!completed && Date.now() - startTime < 300000) {
            // 5 min timeout
            const state = await this.getCurrentState();
            if (!state.pendingApplication) {
              completed = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }

          if (!completed) {
            throw new Error("Application timeout");
          }

          // Add mandatory delay between successful applications
          if (i < maxJobs - 1) {
            const minDelay = 6000;
            const maxDelay = 8000;
            await new Promise((resolve) =>
              setTimeout(
                resolve,
                Math.floor(Math.random() * (maxDelay - minDelay) + minDelay)
              )
            );
          }
        } catch (error) {
          console.error(`Error processing job ${job.title}:`, error);
          await this.stateManager.updateState({ pendingApplication: false });

          // Check if we should stop the entire process
          if (
            error.message.includes("limit reached") ||
            error.message.includes("session expired")
          ) {
            throw error;
          }
          continue;
        }
      }
    } catch (error) {
      console.error("Error in automation:", error);
      this.sendStatusUpdate("error", error.message);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

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

  async simulateHumanInput(element, value) {
    // Simplified direct value setting without typing simulation
    element.focus();
    element.click();
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.blur();
  }

  async initialize(userId) {
    return await this.safeExecute(async () => {
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
      this.isRunning = true;
      this.setupTimeouts();
    }, "Initialization error");
  }

  async fetchUserDetailsFromBackend(userId) {
    return await this.safeExecute(async () => {
      const response = await fetch(`${HOST}/api/user/${userId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch user details: ${response.statusText}`);
      }
      const data = await response.json();
      if (!data) throw new Error("No user data received from backend");
      return data;
    }, "Error fetching user details");
  }

  async getVisibleJobs() {
    const jobCards = document.querySelectorAll(this.CONFIG.SELECTORS.JOB_CARD);
    return Array.from(jobCards).map((card) => ({
      id: card.querySelector(this.CONFIG.SELECTORS.JOB_LINK)?.dataset?.jk || "",
      element: card,
      title: card
        .querySelector(this.CONFIG.SELECTORS.JOB_TITLE)
        ?.textContent?.trim(),
      company: card
        .querySelector(this.CONFIG.SELECTORS.COMPANY_NAME)
        ?.textContent?.trim(),
      location: card
        .querySelector(this.CONFIG.SELECTORS.LOCATION)
        ?.textContent?.trim(),
      url:
        card.querySelector(this.CONFIG.SELECTORS.JOB_LINK)?.href ||
        window.location.href,
      description: card
        .querySelector(this.CONFIG.SELECTORS.JOB_DESCRIPTION)
        ?.textContent?.trim(),
      salary: card
        .querySelector(this.CONFIG.SELECTORS.JOB_SALARY)
        ?.textContent?.trim(),
    }));
  }

  async processJob(job) {
    let retryCount = 0;
    const maxRetries = 2;

    while (retryCount <= maxRetries) {
      try {
        const state = await this.getCurrentState();
        if (!canApplyMore(state)) {
          throw new Error("Application limit reached");
        }

        // Add random delay between 6-8 seconds for jobs after the first one
        if (this.currentJobIndex > 0) {
          const delay = Math.floor(Math.random() * (8000 - 6000) + 6000);
          await this.sleep(delay);
        }

        // Click the job card to show details
        const jobLink = job.element.querySelector(
          this.CONFIG.SELECTORS.JOB_LINK
        );
        if (!jobLink) {
          throw new Error("Job link not found");
        }

        jobLink.click();
        await this.sleep(this.CONFIG.TIMEOUTS.STANDARD);

        // Handle any popups before proceeding
        await this.handlePopups();

        // Find and verify apply button
        const applyButton = await this.findApplyButton();
        if (!applyButton) {
          throw new Error("Apply button not found");
        }

        // Check if it's an external application before clicking
        if (this.isExternalApplication()) {
          console.log("Skipping external application");
          return;
        }

        // Store job data in state before clicking apply
        await this.stateManager.updateState({
          currentJobIndex: this.currentJobIndex + 1,
          lastActionTime: new Date().toISOString(),
          currentJob: {
            id: job.id,
            title: job.title,
            company: job.company,
            location: job.location,
            url: job.url,
            description: job.description,
          },
          pendingApplication: true, // New flag to indicate we're waiting to fill forms
        });

        // Click apply button and wait for standard timeout
        applyButton.click();
        await this.sleep(this.CONFIG.TIMEOUTS.STANDARD);

        // If we get here, the job was processed successfully
        return;
      } catch (error) {
        console.error(`Attempt ${retryCount + 1} failed:`, error);
        retryCount++;

        // If it's a fatal error, throw immediately
        if (
          error.message.includes("limit reached") ||
          error.message.includes("session expired")
        ) {
          throw error;
        }

        // If we've exhausted retries, throw the error
        if (retryCount > maxRetries) {
          throw error;
        }

        // Wait before retrying
        await this.sleep(3000 * retryCount);
      }
    }
  }

  async findApplyButton() {
    console.log("Finding apply button...");

    const button = await this.waitForElement("#indeedApplyButton");
    if (!button) {
      console.log("No Indeed Smart Apply button found");
      return null;
    }

    // Verify it's a Smart Apply button by checking for the wrapper
    const hasWrapper = button.querySelector(
      ".jobsearch-IndeedApplyButton-contentWrapper"
    );
    if (!hasWrapper) {
      return null;
    }

    console.log("Found Indeed Smart Apply button");
    return button;
  }

  isExternalApplication() {
    // Check if the apply button has an href attribute or external link indicators
    const button = document.querySelector(
      'button[aria-label*="Apply now"][href]'
    );
    return !!button;
  }

  async handleIndeedApplication(job) {
    const frame = document.querySelector("#indeedApplyIframe");
    if (frame) {
      await this.switchToApplicationFrame(frame);
    }

    await this.handleApplicationSteps();
    await this.logApplication(job);
  }

  async safeExecute(operation, errorMessage) {
    try {
      return await operation();
    } catch (error) {
      console.error(errorMessage, error);
      chrome.runtime.sendMessage({
        type: "LOG_ERROR",
        error: error.message,
        retry: true,
        retryCount: 0,
      });
      return null;
    }
  }

  setupTimeouts() {
    // Main operation timeout
    setTimeout(async () => {
      if (this.isRunning) {
        const currentTime = new Date();
        if (currentTime - this.startTime > this.CONFIG.TIMEOUTS.MAX_TIMEOUT) {
          await this.stop();
          this.sendStatusUpdate("timeout", "Operation timed out");
        }
      }
    }, this.CONFIG.TIMEOUTS.MAX_TIMEOUT);

    // Auto-retry handler for stuck operations
    setInterval(async () => {
      if (this.isRunning) {
        const state = await this.getCurrentState();
        const lastActionTime = state?.lastActionTime || this.startTime;
        const currentTime = new Date();

        if (currentTime - lastActionTime > this.CONFIG.TIMEOUTS.EXTENDED) {
          await this.handleStuckOperation();
        }
      }
    }, this.CONFIG.TIMEOUTS.STANDARD);
  }

  async handleStuckOperation() {
    return await this.safeExecute(async () => {
      const state = await this.getCurrentState();

      // Try to recover from stuck state
      if (state.isProcessing) {
        // Attempt to move to next job
        await this.moveToNextJob();

        // Update last action time
        await this.stateManager.updateState({
          lastActionTime: new Date().toISOString(),
        });

        this.sendStatusUpdate("recovered", "Recovered from stuck operation");
      }
    }, "Error handling stuck operation");
  }

  async stop() {
    this.isRunning = false;
    await this.stateManager.updateState({
      isProcessing: false,
      lastActionTime: new Date().toISOString(),
    });
  }

  sendStatusUpdate(status, data) {
    chrome.runtime.sendMessage({
      action: "statusUpdate",
      status,
      data,
      timestamp: new Date().toISOString(),
    });
  }

  async moveToNextJob() {
    return await this.safeExecute(async () => {
      const state = await this.getCurrentState();

      this.currentJobIndex++;

      await this.stateManager.updateState({
        currentJobIndex: this.currentJobIndex,
        lastActionTime: new Date().toISOString(),
      });

      if (this.currentJobIndex < this.jobsToApply?.length) {
        // Navigate to next job
        chrome.runtime.sendMessage({
          action: "navigateToJob",
          url: this.jobsToApply[this.currentJobIndex].url,
        });
      } else {
        // All jobs processed
        await this.stop();
        this.sendStatusUpdate("completed", "All jobs processed");
      }
    }, "Error moving to next job");
  }

  async waitForJobSearchPage() {
    while (!document.querySelector("#jobsearch-HomePage")) {
      console.log("waiting!");
      await this.sleep(100);
    }
    return true;
  }
  async performJobSearch() {
    return await this.safeExecute(async () => {
      const state = await this.getCurrentState();
      const preferences = state.preferences || {};

      // Build search URL with all parameters
      const searchParams = new URLSearchParams();

      // 1. Search query (q)
      const searchQuery = Array.isArray(preferences.positions)
        ? preferences.positions[0]
        : "";
      searchParams.append("q", searchQuery);

      // 2. Location (l)
      searchParams.append("l", preferences.location || "Lagos");

      // 3. Build filter string (sc parameter)
      let filterString = "0kf:";

      // Job type attribute codes for Indeed UK
      const jobTypeMap = {
        "Full-time": "4HKF7",
        "Part-time": "CPAHG",
        Contract: "5QWDV",
        Temporary: "CF3CP",
        Internship: "VDTG7",
      };

      // 3a. Job type filters - collect all selected job types
      if (
        Array.isArray(preferences.jobType) &&
        preferences.jobType.length > 0
      ) {
        const jobTypeFilters = preferences.jobType
          .filter((type) => jobTypeMap[type])
          .map((type) => jobTypeMap[type]);

        if (jobTypeFilters.length > 0) {
          // Join all job types with OR operator
          filterString += `attr(${jobTypeFilters.join("|")},OR)`;
        }
      }

      // 3b. Always add Remote filter (not conditional)
      filterString += "attr(DSQF7);";

      // Add the filter string to search parameters
      searchParams.append("sc", filterString);

      // 4. Date posted (fromage)
      if (preferences.datePosted && preferences.datePosted.value) {
        searchParams.append("fromage", preferences.datePosted.value);
      }

      // 5. Add from=searchOnDesktopSerp
      searchParams.append("from", "searchOnDesktopSerp");

      // Construct final URL
      const searchUrl = `${getJobURL(
        state.userDetails.country
      )}/jobs?${searchParams.toString()}`;

      console.log(searchUrl);

      // Update state and notify completion
      await this.stateManager.updateState({
        pendingSearch: true,
        lastActionTime: new Date().toISOString(),
      });

      // Navigate to search results
      window.location.href = searchUrl;
    }, "Error performing job search");
  }

  async getCurrentState() {
    return await this.safeExecute(async () => {
      const state = await this.stateManager.getState();
      if (!state?.userId) {
        throw new Error("No valid state found - please reinitialize");
      }
      return state;
    }, "Error getting current state");
  }

  async handlePopups() {
    try {
      const popupCloseButton = await this.waitForElement(
        ".popover-x-button-close",
        1000
      );
      if (popupCloseButton) {
        await popupCloseButton.click();
      }
    } catch (error) {
      // Ignore if no popup found
    }
  }

  extractSiteKey(iframeSrc) {
    const siteKeyMatch = iframeSrc.match(/[?&]k=([^&]+)/);
    return siteKeyMatch ? siteKeyMatch[1] : null;
  }

  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async uploadFileFromURL(fileInput, userDetails) {
    try {
      const description = IndeedJobParser.extract("string");
      const matchedUrl = `https://resumify-6b8b3d9b7428.herokuapp.com/api/match`;
      const res = await fetch(matchedUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          resume_urls: userDetails.resumeUrl,
          job_description: description,
        }),
      });

      const data = await res.json();
      const proxyURL = `${HOST}/api/proxy-file?url=${encodeURIComponent(
        data.highest_ranking_resume
      )}`;
      const response = await fetch(proxyURL);

      if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.statusText}`);
      }

      const blob = await response.blob();
      let filename = `${userDetails.firstName} ${userDetails.lastName} resume.pdf`;

      // Get filename from Content-Disposition header
      const contentDisposition = response.headers.get("content-disposition");
      if (contentDisposition) {
        const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(
          contentDisposition
        );
        if (matches?.[1]) {
          // Remove any quotes and path information
          filename = matches[1].replace(/['"]/g, "");
        }
      }

      // Create file object with sanitized filename
      const file = new File([blob], filename, {
        type: blob.type || "application/pdf",
        lastModified: Date.now(),
      });
      if (file.size === 0) {
        throw new Error("Created file is empty");
      }

      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInput.files = dataTransfer.files;

      // Dispatch events in sequence with small delays
      await this.sleep(200);
      fileInput.dispatchEvent(new Event("focus", { bubbles: true }));
      await this.sleep(200);
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
      await this.sleep(200);
      fileInput.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    } catch (error) {
      console.log(error);
      try {
        fileInput.value = "";
      } catch (e) {
        console.error("Could not clear file input:", e);
      }
      return false;
    }
  }

  async waitForUpload(fileInput) {
    const maxWaitTime = 30000; // 30 seconds
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      // Check if file input has a file
      if (fileInput.files.length > 0) {
        // Look for upload success indicators
        const successIndicator =
          document.querySelector(".upload-success") ||
          document.querySelector('[data-testid="resume-upload-success"]');
        if (successIndicator) {
          return true;
        }
      }
      await this.sleep(100);
    }
    throw new Error("Upload timeout");
  }

  async handleApplicationSteps() {
    const state = await this.getCurrentState();

    try {
      const FORM_SELECTORS = {
        RESUME_OPTIONS: '[data-testid="ResumeOptionsMenu-btn"]',
        UPLOAD_BUTTON: '[data-testid="ResumeOptionsMenu-upload"]',
        FILE_INPUT: 'input[type="file"]',
        INPUTS:
          'input[type="text"], input[type="email"], input[type="tel"], input[type="number"], input[type="radio"], input[type="checkbox"], input[type="password"]',
        SELECTS: "select",
        TEXTAREAS: "textarea",
        BUTTONS: {
          CONTAINER: "[class*='button'], [class*='Button'], button",
          TEXT: "span, div",
        },
      };

      let isLastStep = false;
      let maxAttempts = 10;
      let currentAttempt = 0;

      while (!isLastStep && currentAttempt < maxAttempts) {
        currentAttempt++;
        await this.sleep(1000);

        const indeedResumeRadio = document.querySelector(
          'input[value="INDEED_RESUME"]'
        );
        const fileResumeRadio = document.querySelector(
          'input[value="SAVED_FILE_RESUME"]'
        );

        if (indeedResumeRadio && fileResumeRadio) {
          const state = await this.getCurrentState();
          const useIndeedResume = state?.preferences?.useIndeedResume || true;
          if (useIndeedResume) {
            fileResumeRadio.click();
            await this.sleep(1000);

            const resumeOptionsBtn = document.querySelector(
              FORM_SELECTORS.RESUME_OPTIONS
            );
            if (resumeOptionsBtn) {
              resumeOptionsBtn.click();
              await this.sleep(1000); // Increased wait time

              const uploadButton = document.querySelector(
                FORM_SELECTORS.UPLOAD_BUTTON
              );
              if (uploadButton) {
                uploadButton.click();
                await this.sleep(1000); // Increased wait time

                const fileInput = document.querySelector(
                  FORM_SELECTORS.FILE_INPUT
                );
                if (fileInput && state?.userDetails?.resumeUrl) {
                  const uploadSuccess = await this.uploadFileFromURL(
                    fileInput,
                    state?.userDetails
                  );
                  if (!uploadSuccess) {
                    await this.waitForUpload(fileInput);
                  }
                }
              }
            }
          } else {
            indeedResumeRadio.click();
          }
          await this.sleep(2000);
        }

        // Get all visible form elements in current step
        const formElements = {
          inputs: Array.from(document.querySelectorAll(FORM_SELECTORS.INPUTS)),
          selects: Array.from(
            document.querySelectorAll(FORM_SELECTORS.SELECTS)
          ),
          textareas: Array.from(
            document.querySelectorAll(FORM_SELECTORS.TEXTAREAS)
          ),
        };

        let hasVisibleFields = false;

        // Process form elements
        for (const [type, elements] of Object.entries(formElements)) {
          for (const element of elements) {
            if (
              element.type === "hidden" ||
              !this.isElementVisible(element) ||
              element.name === "age"
            ) {
              continue;
            }

            hasVisibleFields = true;
            const labelText = this.getElementLabel(element);
            this.handleFormElement(element, labelText);
          }
        }

        // Enhanced button finding logic
        const findActionButton = () => {
          // Get all potential button containers
          const buttonContainers = Array.from(
            document.querySelectorAll(FORM_SELECTORS.BUTTONS.CONTAINER)
          );

          for (const container of buttonContainers) {
            // Skip if container or its children aren't visible
            if (!this.isElementVisible(container)) continue;

            // Look for text content in the button or its children
            const textElements = Array.from(
              container.querySelectorAll(FORM_SELECTORS.BUTTONS.TEXT)
            );
            textElements.unshift(container); // Also check the container itself

            for (const element of textElements) {
              const text = element.textContent.trim().toLowerCase();
              // Check for various possible button text variations
              if (
                text.includes("submit") ||
                text.includes("apply") ||
                text === "submit your application"
              ) {
                isLastStep = true;
                return container;
              }

              if (
                text === "continue" ||
                text === "review" ||
                text === "next" ||
                text.includes("next step") ||
                text.includes("continue to next") ||
                text.includes("apply anyway")
              ) {
                return container;
              }
            }
          }
          return null;
        };

        const actionButton = findActionButton();

        if (actionButton) {
          actionButton.click();
          await this.sleep(3000);
        } else {
          if (!hasVisibleFields) {
            isLastStep = true;
          }
        }
      }

      if (currentAttempt >= maxAttempts) {
        throw new Error("Maximum form steps exceeded");
      }
    } catch (error) {
      await this.logApplication(jobData, "failed", error);

      console.error("Error in handleApplicationSteps:", error);
      throw error;
    }
  }

  isElementVisible(element) {
    if (!element) return false;

    // Check if element or its label is visible
    const elementVisible = () => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();

      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0" &&
        rect.height > 0
      );
    };

    // For radio buttons, also check if the label or nearby container is visible
    const containerVisible = () => {
      const container =
        element.closest("label") ||
        element.closest("fieldset") ||
        element.parentElement;

      if (container) {
        const style = window.getComputedStyle(container);
        const rect = container.getBoundingClientRect();

        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          style.opacity !== "0" &&
          rect.height > 0
        );
      }
      return false;
    };

    return elementVisible() || containerVisible();
  }

  async updateApplicationCount(userId) {
    try {
      const response = await fetch(`${HOST}/api/applications`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId,
        }),
      });

      if (!response.ok) {
        throw new Error(
          `Failed to update application count: ${response.statusText}`
        );
      }

      return true;
    } catch (error) {
      console.error("Error updating application count:", error);
      return false;
    }
  }
  async saveApplication(jobData, status = "completed", error = null) {
    try {
      const state = await this.getCurrentState();
      const applicationData = {
        userId: state.userId,
        jobId: jobData.id,
        title: jobData.title,
        company: jobData.company,
        location: jobData.location,
        jobUrl: window.location.href,
        salary: jobData.salary || "Not specified",
        workplace: jobData.location,
        postedDate: jobData.postedDate || "Not specified",
        applicants: jobData.applications || "Not specified",
      };

      const response = await fetch(`${HOST}/api/applied-jobs`, {
        method: "POST",
        body: JSON.stringify(applicationData),
      });

      if (!response.ok) {
        throw new Error(`Failed to save applied job: ${response.statusText}`);
      }

      // Send message to background script about application status
      chrome.runtime.sendMessage({
        action: "applicationComplete",
        status: status,
      });
    } catch (error) {
      console.error("Error logging application:", error);
      // Still try to notify about the error
      chrome.runtime.sendMessage({
        action: "applicationError",
        error: error.message,
        // jobData: jobData,
      });
    }
  }

  async handleIndeedApplication(jobData) {
    try {
      const state = await this.getCurrentState();
      await this.handleApplicationSteps();
      await this.updateApplicationCount(state.userId);
      await this.saveApplication(jobData);
    } catch (error) {
      console.error("Error in application process:", error);
      await this.logApplication(jobData, "failed", error);
      throw error;
    }
  }

  getElementLabel(element) {
    // Try to get label from associated label element
    const labelElement = document.querySelector(`label[for="${element.id}"]`);
    if (labelElement) {
      const labelText = labelElement.textContent.trim();
      return labelText;
    }

    // Try to get label from parent label element
    const parentLabel = element.closest("label");
    if (parentLabel) {
      // Get text content excluding nested input texts
      const labelText = Array.from(parentLabel.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent.trim())
        .join(" ")
        .trim();
      return labelText;
    }

    // For radio buttons, try to find the fieldset legend
    if (element.type === "radio") {
      const fieldset = element.closest("fieldset");
      const legend = fieldset?.querySelector("legend");
      if (legend) {
        const legendText = legend.textContent.trim();
        return legendText;
      }
    }

    // Try to get label from aria-label
    if (element.getAttribute("aria-label")) {
      const ariaLabel = element.getAttribute("aria-label").trim();
      return ariaLabel;
    }

    // Try to get label from placeholder
    if (element.placeholder) {
      return element.placeholder.trim();
    }

    // Try to find a label-like element near the radio button
    if (element.type === "radio") {
      const nearbyText =
        element.nextElementSibling?.textContent?.trim() ||
        element.previousElementSibling?.textContent?.trim();
      if (nearbyText) {
        return nearbyText;
      }
    }

    // If no label found, return the name attribute or empty string
    return element.name || "";
  }

  async handlePhoneInput(element, value) {
    try {
      // Find the country select element
      const countrySelect = element
        .closest(".PhoneInput")
        ?.querySelector("select");
      if (!countrySelect) return;

      // Parse phone number to extract country code and number
      const normalizedValue = value.replace(/[^\d+]/g, "");
      let countryCode = normalizedValue.match(/^\+?(\d{1,3})/)?.[1];
      let phoneNumber = normalizedValue.replace(/^\+?\d{1,3}/, "").trim();

      // Find matching country option
      const options = Array.from(countrySelect.options);
      const countryOption = options.find((opt) =>
        opt.text.includes(`(+${countryCode})`)
      );

      if (countryOption) {
        // Select country
        countrySelect.focus();
        countrySelect.value = countryOption.value;
        countrySelect.dispatchEvent(new Event("change", { bubbles: true }));
      }

      // Input phone number
      await this.simulateHumanInput(element, phoneNumber);
    } catch (error) {
      console.error("Error handling phone input:", error);
    }
  }
  async handleRadioInput(element, value, labelText) {
    // Convert value to string and lowercase for comparison
    const normalizedValue = String(value).toLowerCase().trim();

    // Check if the radio button's value matches or its label contains the value
    const matches = (radioValue) => {
      const normalizedRadioValue = String(radioValue).toLowerCase().trim();
      return (
        normalizedValue === normalizedRadioValue ||
        normalizedRadioValue.includes(normalizedValue)
      );
    };

    // Find radio buttons in the same group
    const radioGroup = document.getElementsByName(element.name);

    for (const radio of radioGroup) {
      // Compare value with the radio button's value, label, or associated text
      const radioLabel = this.getElementLabel(radio);
      const radioValue = radio.value;

      if (matches(radioValue) || matches(radioLabel)) {
        // Simulate human-like interaction
        radio.focus();
        radio.click();
        return;
      }
    }
  }

  async handleCheckboxInput(element, value, labelText) {
    // Normalize the value - we want to check if it implies "true" or selection
    const normalizedValue = String(value).toLowerCase().trim();
    const shouldBeChecked =
      normalizedValue === "true" ||
      normalizedValue === "1" ||
      normalizedValue === "yes";

    // Check current state and act accordingly
    if (shouldBeChecked && !element.checked) {
      element.focus();
      element.click();
      console.log(`Checked checkbox: ${labelText}`);
    } else if (!shouldBeChecked && element.checked) {
      element.focus();
      element.click();
      console.log(`Unchecked checkbox: ${labelText}`);
    }
  }

  async handleSelect(element, value, labelText) {
    if (!element.options || element.options.length === 0) {
      return;
    }

    const normalizedValue = String(value).toLowerCase().trim();

    // Array of matching strategies from exact to fuzzy
    const strategies = [
      // Exact matches
      (opt) => opt.value.toLowerCase().trim() === normalizedValue,
      (opt) => opt.text.toLowerCase().trim() === normalizedValue,
      // Partial matches
      (opt) => opt.value.toLowerCase().includes(normalizedValue),
      (opt) => opt.text.toLowerCase().includes(normalizedValue),
      // Word matches
      (opt) =>
        normalizedValue
          .split(" ")
          .some((word) => opt.text.toLowerCase().includes(word)),
      // First non-empty option as fallback
      (opt) => opt.value && opt.value.trim() !== "",
    ];

    for (const strategy of strategies) {
      const matchedOption = Array.from(element.options).find(strategy);
      if (matchedOption) {
        element.focus();
        element.value = matchedOption.value;
        element.dispatchEvent(new Event("change", { bubbles: true }));
        element.dispatchEvent(new Event("input", { bubbles: true }));
        console.log(`Selected "${matchedOption.text}" for ${labelText}`);
        return;
      }
    }

    // Log failure for debugging
    console.log(
      `No valid option found for ${labelText}. Available options:`,
      Array.from(element.options).map((o) => ({ value: o.value, text: o.text }))
    );
  }

  async logApplication(jobData, status = "completed", error = null) {
    try {
      const state = await this.getCurrentState();
      const applicationLog = {
        jobId: jobData.id,
        jobTitle: jobData.title,
        company: jobData.company,
        location: jobData.location,
        applicationDate: new Date().toISOString(),
        status: status,
        error: error?.message || null,
        url: jobData.url || window.location.href,
      };

      // Update state with new application log
      await this.stateManager.updateState({
        applications: [...(state.applications || []), applicationLog],
        lastActionTime: new Date().toISOString(),
        applicationCount: (state.applicationCount || 0) + 1,
      });

      // Send message to background script about application status
      chrome.runtime.sendMessage({
        action: "applicationComplete",
        status: status,
        jobData: applicationLog,
      });
    } catch (error) {
      console.error("Error logging application:", error);
      // Still try to notify about the error
      chrome.runtime.sendMessage({
        action: "applicationError",
        error: error.message,
        jobData: jobData,
      });
    }
  }

  async getValueForField(labelText, options = []) {
    try {
      const normalizedLabel = labelText.toLowerCase().trim();

      // Check cache first
      const cachedAnswer = this.answerCache.get(normalizedLabel);
      if (cachedAnswer) {
        return cachedAnswer;
      }

      // Check if there's a pending request for this label
      if (this.pendingRequests.has(normalizedLabel)) {
        return await this.pendingRequests.get(normalizedLabel);
      }

      // Create new request promise
      const requestPromise = this.makeRequest(normalizedLabel, options);
      this.pendingRequests.set(normalizedLabel, requestPromise);

      try {
        const answer = await Promise.race([
          requestPromise,
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("Request timeout")),
              this.requestTimeout
            )
          ),
        ]);

        // Cache the successful response
        this.answerCache.set(normalizedLabel, answer);
        return answer;
      } finally {
        // Clean up pending request
        this.pendingRequests.delete(normalizedLabel);
      }
    } catch (error) {
      console.error("AI Answer Error:", error);
      return options.length > 0 ? options[0] : "";
    }
  }

  async makeRequest(normalizedLabel, options) {
    const now = new Date();
    if (
      normalizedLabel.toLowerCase().includes("interview") ||
      normalizedLabel.toLowerCase().includes("availability")
    ) {
      return generateBusinessDates(now, 3);
    }
    const state = await this.getCurrentState();
    const response = await fetch(`${HOST}/api/ai-answer`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Add any auth headers if needed
      },
      body: JSON.stringify({
        question: normalizedLabel,
        options: options,
        userData: state?.userDetails || {},
      }),
    });

    if (!response.ok) throw new Error("AI service error");
    const data = await response.json();
    return data.answer;
  }

  async handleFormElement(element, labelText) {
    try {
      const options = this.getElementOptions(element);

      // Get value with caching
      const value = await this.getValueForField(labelText, options);
      if (!value) return;

      // Proceed with value application only if element is still in the DOM
      if (!document.contains(element)) {
        console.log("Element no longer in DOM, skipping:", labelText);
        return;
      }

      await this.applyValueToElement(element, value, labelText);
    } catch (error) {
      console.error(`Error handling form element ${labelText}:`, error);
    }
  }

  getElementOptions(element) {
    switch (element.type) {
      case "select-one":
      case "select-multiple":
        return Array.from(element.options).map((opt) => opt.text.trim());

      case "radio":
        return Array.from(document.getElementsByName(element.name))
          .map((radio) => this.getElementLabel(radio))
          .filter(Boolean);

      case "checkbox":
        return ["Yes", "No"];

      default:
        return [];
    }
  }

  async applyValueToElement(element, value, labelText) {
    const elementHandlers = {
      radio: () => this.handleRadioInput(element, value, labelText),
      checkbox: () => this.handleCheckboxInput(element, value, labelText),
      "select-one": () => this.handleSelect(element, value, labelText),
      "select-multiple": () => this.handleSelect(element, value, labelText),
      default: () => this.simulateHumanInput(element, value),
    };

    const handler = elementHandlers[element.type] || elementHandlers.default;
    await handler();
  }
}

const automationHandler = new FastApplyAutomation();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("HWass s")
  automationHandler.handleMessage(message, sender, sendResponse);
  return true;
});

document.addEventListener("readystatechange", async (event) => {
  if (document.readyState === "complete") {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const state = await automationHandler.getCurrentState();

    console.log("Page loaded, current state:", state);

    // Send pageLoaded message
    chrome.runtime.sendMessage({
      action: "pageLoaded",
      url: window.location.href,
    });

    // Handle search completion
    if (
      state?.pendingSearch &&
      !document.querySelector(".jobsearch-NoResult-messageContainer")
    ) {
      await automationHandler.stateManager.updateState({
        pendingSearch: false,
      });

      chrome.runtime.sendMessage({
        action: "searchCompleted",
        status: "ready",
      });
    }

    // Handle application form
    if (
      state?.pendingApplication //&&
      // document.querySelector("#indeedApplyButtonContainer")
    ) {
      console.log("Application form detected, starting form fill");

      await automationHandler.stateManager.updateState({
        pendingApplication: false,
      });

      chrome.runtime.sendMessage({
        action: "startFormFill",
        jobData: state.currentJob,
      });
    }
  }
});

