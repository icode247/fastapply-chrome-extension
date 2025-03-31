import { StateManager } from "@shared/stateManager";

class FastApplyAutomation {
  PLAN_LIMITS = {
    FREE: 5,
    PRO: 50,
    UNLIMITED: Infinity,
  };

  constructor() {
    this.userData = null;
    this.isRunning = false;
    this.currentJobIndex = 0;
    this.startTime = new Date();
    this.HOST = "http://localhost:3000";
    this.stateManager = new StateManager();
    this.currentPage = 1;
    this.totalPages = 1;

    this.CONFIG = {
      SELECTORS: {
        JOB_CARD: "[data-test='jobListing']",
        JOB_TITLE: ".JobCard_jobTitle__GLyJ1",
        COMPANY_NAME: ".EmployerProfile_compactEmployerName__9MGcV",
        LOCATION: ".JobCard_location__Ds1fM",
        APPLY_BUTTON: "[data-test='easyApply']",
        JOB_LINK: ".JobCard_jobTitle__GLyJ1",
        JOB_DESCRIPTION: ".JobDescriptionContent",
        POPUP_CLOSE: ".JobCard_closeButtonContainer__4R81v",
        CAPTCHA: ".h-captcha",
        PAGINATION: ".paginationFooter",
        NEXT_PAGE: "button[data-test='pagination-next']",
        APPLICATION_FORM: ".applyButton-EasyApplyButton",
      },
      TIMEOUTS: {
        STANDARD: 2000,
        EXTENDED: 5000,
        MAX_TIMEOUT: 300000, // 5 minutes for entire operation
      },
    };

    console.log("FastApplyAutomation initialized");
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
          await this.handleApplicationFilling(message.jobData);
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

  async initialize(userId) {
    return await this.safeExecute(async () => {
      const userDetails = await this.fetchUserDetailsFromBackend(userId);
      console.log("USER DETAILS", userDetails);

      await this.stateManager.saveState({
        userId,
        userDetails,
        preferences: userDetails.jobPreferences || {},
        availableCredits: userDetails.credits || 0,
        applicationsUsed: userDetails.applicationsUsed || 0,
        userPlan: userDetails.plan,
        isProcessing: false,
        currentJobIndex: 0,
        subscription: userDetails.subscription || null,
        pendingSearch: false,
        pendingApplication: false,
        viewedJobs: [],
        applications: [],
      });

      this.userData = userDetails;
      this.isRunning = true;
      this.setupTimeouts();
    }, "Initialization error");
  }

  async fetchUserDetailsFromBackend(userId) {
    return await this.safeExecute(async () => {
      const response = await fetch(`${this.HOST}/api/user/${userId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch user details: ${response.statusText}`);
      }

      const data = await response.json();
      if (!data) throw new Error("No user data received from backend");
      return data;
    }, "Error fetching user details");
  }

  async performJobSearch() {
    return await this.safeExecute(async () => {
      const state = await this.getCurrentState();
      const preferences = state.preferences || {};

      // Get search query
      const searchQuery = Array.isArray(preferences.positions)
        ? preferences.positions[0]
        : "";

      // Get location - handle array similar to positions
      const location = Array.isArray(preferences.location)
        ? preferences.location[0]
        : preferences.location || "Remote";

      // Location ID mappings
      const locationIds = {
        Lagos: "IC2543876",
        Remote: "REMOTE",
        "United States": "IN1",
        "United Kingdom": "IN2",
        Canada: "IN3",
        Australia: "IN16",
        Germany: "IN96",
        France: "IN86",
        Netherlands: "IN178",
        India: "IC1145013",
        Singapore: "IC3235921",
        Nigeria: "IN177",
        "South Africa": "IN211",
        Ireland: "IN70",
        "New Zealand": "IN186",
      };

      let urlPath = "";
      let queryParams = [];

      // Always add Easy Apply filter
      queryParams.push("applicationType=1");

      // Add remote work type if remote only is enabled
      if (preferences.remoteOnly) {
        queryParams.push("remoteWorkType=1");
      }

      // Add company rating filter if specified
      if (preferences.companyRating) {
        queryParams.push(`minRating=${preferences.companyRating}`);
      }

      // Add date posted filter
      if (preferences.datePosted) {
        const dateMapping = {
          "Last week": "7",
          "Last 2 weeks": "14",
          "Last month": "30",
        };
        const fromAge = dateMapping[preferences.datePosted];
        if (fromAge) {
          queryParams.push(`fromAge=${fromAge}`);
        }
      }

      // Combine query parameters
      const queryString =
        queryParams.length > 0 ? `?${queryParams.join("&")}` : "";

      if (location.toLowerCase() === "remote") {
        // Handle remote jobs
        urlPath = `jobs-SRCH_KO0,${searchQuery.length}_KE${searchQuery.replace(
          /\s+/g,
          "-"
        )}`;
      } else {
        // Handle location-based search
        const locationId = locationIds[location] || "";
        const locationSlug = location.toLowerCase().replace(/\s+/g, "-");
        const keywordStartIndex = locationSlug.length + 1;

        urlPath = `${locationSlug}-${searchQuery.replace(
          /\s+/g,
          "-"
        )}-jobs-SRCH_IL.0,${
          location.length
        }_${locationId}_KO${keywordStartIndex},${
          keywordStartIndex + searchQuery.length
        }`;
      }

      // Construct final URL with query parameters
      const searchUrl = `https://www.glassdoor.com/Job/${urlPath}.htm${queryString}`;

      // Update state and notify completion
      await this.stateManager.updateState({
        pendingSearch: true,
        lastActionTime: new Date().toISOString(),
      });

      console.log("Navigating to search URL:", searchUrl);
      window.location.href = searchUrl;
    }, "Error performing job search");
  }

  async startAutomation() {
    try {
      // First check if we can still apply
      const currentState = await this.stateManager.getState();
      if (!(await this.canApplyMore(currentState))) {
        this.sendStatusUpdate(
          "error",
          `Cannot apply: ${
            currentState.userPlan === "credit"
              ? `Insufficient credits (${currentState.availableCredits} remaining)`
              : `Daily limit reached)`
          }`
        );
        return "limit_reached";
      }

      this.isRunning = true;
      await this.stateManager.updateState({
        isProcessing: true,
        lastActionTime: new Date().toISOString(),
      });

      // Get all visible jobs on the current page
      this.jobsToApply = await this.getVisibleJobs();

      if (this.jobsToApply.length === 0) {
        throw new Error("No jobs found to process");
      }

      // Calculate maximum jobs to process based on plan
      let maxJobs = this.calculateMaxJobs(currentState);

      console.log(
        `Processing ${maxJobs} out of ${this.jobsToApply.length} jobs found`
      );

      // Process jobs one by one
      await this.processJobsSequentially(maxJobs);

      console.log("Job processing completed");
      this.sendStatusUpdate("completed", "All jobs processed");
    } catch (error) {
      console.error("Error in automation:", error);
      this.sendStatusUpdate("error", error.message);
    } finally {
      this.isRunning = false;
      await this.stateManager.updateState({
        isProcessing: false,
        lastActionTime: new Date().toISOString(),
      });
    }
  }

  calculateMaxJobs(currentState) {
    let maxJobs = this.jobsToApply.length; // Default to all jobs found

    switch (currentState.userPlan) {
      case "free":
        maxJobs = Math.min(
          this.PLAN_LIMITS.FREE - (currentState.applicationsUsed || 0),
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
      // unlimited plan will use maxJobs as is
    }

    return maxJobs;
  }

  async processJobsSequentially(maxJobs) {
    for (let i = 0; i < maxJobs && this.isRunning; i++) {
      const job = this.jobsToApply[i];
      this.currentJobIndex = i;

      try {
        // Step 1: Click on the job card and wait for details to load
        const jobCardSuccess = await this.clickJobCard(job);
        if (!jobCardSuccess) {
          console.log(`Skipping job ${job.title} - could not open details`);
          continue;
        }

        // Step 2: Look for the Apply button and click it if found
        const applyButtonSuccess = await this.clickApplyButton();
        if (!applyButtonSuccess) {
          console.log(
            `Skipping job ${job.title} - no apply button or external application`
          );

          // Log viewed job even if not applied
          await this.logViewedJob(job);

          // Go back to search results (if needed)
          await this.goBackToSearchResults();
          continue;
        }

        // Step 3: Handle the application form
        await this.handleApplicationFilling(job);

        // Step 4: Go back to search results for the next job
        await this.goBackToSearchResults();
      } catch (error) {
        console.error(`Error processing job ${job.title}:`, error);
        await this.stateManager.updateState({ pendingApplication: false });

        // Try to recover and continue with next job
        await this.goBackToSearchResults();
        continue;
      }
    }

    // Check if we've reached the end of current page and need to navigate to next page
    if (this.isRunning && this.currentPage < this.totalPages) {
      await this.navigateToNextPage();
      // Process jobs on the new page
      await this.startAutomation();
    }
  }

  async clickJobCard(job) {
    try {
      // Scroll job card into view before clicking
      job.element.scrollIntoView({ behavior: "smooth", block: "center" });
      await this.sleep(this.CONFIG.TIMEOUTS.STANDARD);

      // Find and click the job link
      const jobLink = job.element.querySelector(this.CONFIG.SELECTORS.JOB_LINK);
      if (!jobLink) {
        throw new Error("Job link not found");
      }

      console.log(`Clicking job: ${job.title} at ${job.company}`);
      jobLink.click();

      // Wait for job details to load
      await this.sleep(this.CONFIG.TIMEOUTS.STANDARD * 1.5);

      // Store job data in state
      await this.stateManager.updateState({
        currentJobIndex: this.currentJobIndex,
        lastActionTime: new Date().toISOString(),
        currentJob: {
          id: this.getJobId(job.element),
          title: job.title,
          company: job.company,
          location: job.location,
          url: job.url,
        },
      });

      // Handle any popups that may appear
      await this.handlePopups();

      return true;
    } catch (error) {
      console.error("Error clicking job card:", error);
      return false;
    }
  }

  async clickApplyButton() {
    try {
      console.log("Looking for Easy Apply button...");

      // Wait for the apply button to appear
      const applyButton = await this.waitForElement(
        this.CONFIG.SELECTORS.APPLY_BUTTON,
        5000
      );

      if (!applyButton) {
        console.log("No Easy Apply button found");
        return false;
      }

      // Check if it's an Easy Apply button by verifying text content
      const buttonText = applyButton.textContent.toLowerCase();
      if (!buttonText.includes("easy apply")) {
        console.log("Found button but not an Easy Apply button");
        return false;
      }

      // Check if button is disabled
      if (
        applyButton.getAttribute("aria-disabled") === "true" ||
        applyButton.disabled
      ) {
        console.log("Easy Apply button is disabled");
        return false;
      }

      // Check if it's an external application
      if (this.isExternalApplication()) {
        console.log("This is an external application - skipping");
        return false;
      }

      console.log("Found active Easy Apply button, clicking...");

      // Mark application as pending before clicking
      await this.stateManager.updateState({
        pendingApplication: true,
        lastActionTime: new Date().toISOString(),
      });

      // Click the apply button
      applyButton.click();

      // Wait for application form to appear
      await this.sleep(this.CONFIG.TIMEOUTS.STANDARD);

      return true;
    } catch (error) {
      console.error("Error clicking apply button:", error);
      return false;
    }
  }

  async handleApplicationFilling(job) {
    try {
      console.log("Starting application form filling for:", job.title);

      // Check for application form
      const applicationForm = await this.waitForElement(
        this.CONFIG.SELECTORS.APPLICATION_FORM,
        5000
      );

      if (!applicationForm) {
        console.log("Application form not found");
        return false;
      }

      // Fill out the application form
      await this.handleApplicationSteps();

      // Log the successful application
      await this.logApplication(job, "completed");

      console.log("Application completed successfully");

      // Update state to mark application as no longer pending
      await this.stateManager.updateState({
        pendingApplication: false,
        lastActionTime: new Date().toISOString(),
        applicationCount:
          (await this.getCurrentState()).applicationCount + 1 || 1,
      });

      return true;
    } catch (error) {
      console.error("Error filling application:", error);

      // Log the failed application
      await this.logApplication(job, "failed", error);

      // Update state
      await this.stateManager.updateState({
        pendingApplication: false,
        lastActionTime: new Date().toISOString(),
      });

      return false;
    }
  }

  async goBackToSearchResults() {
    try {
      // Use browser history to go back to search results
      window.history.back();

      // Wait for search results page to load
      await this.sleep(this.CONFIG.TIMEOUTS.STANDARD * 1.5);

      console.log("Returned to search results");
      return true;
    } catch (error) {
      console.error("Error returning to search results:", error);

      // Try to directly navigate to search results URL if available
      const state = await this.getCurrentState();
      if (state.searchUrl) {
        window.location.href = state.searchUrl;
        await this.sleep(this.CONFIG.TIMEOUTS.EXTENDED);
      }

      return false;
    }
  }

  async navigateToNextPage() {
    try {
      console.log("Attempting to navigate to next page...");

      // Find the next page button
      const nextPageButton = document.querySelector(
        this.CONFIG.SELECTORS.NEXT_PAGE
      );

      if (!nextPageButton || nextPageButton.disabled) {
        console.log("No next page button found or it is disabled");
        return false;
      }

      // Update current page count
      this.currentPage++;

      // Click the next page button
      nextPageButton.click();

      // Wait for the next page to load
      await this.sleep(this.CONFIG.TIMEOUTS.EXTENDED);

      console.log(`Navigated to page ${this.currentPage}`);

      // Update state
      await this.stateManager.updateState({
        currentPage: this.currentPage,
        lastActionTime: new Date().toISOString(),
      });

      return true;
    } catch (error) {
      console.error("Error navigating to next page:", error);
      return false;
    }
  }

  async getVisibleJobs() {
    try {
      // Get total pages info first (if available)
      const paginationElement = document.querySelector(
        this.CONFIG.SELECTORS.PAGINATION
      );
      if (paginationElement) {
        const paginationText = paginationElement.textContent;
        const pagesMatch = paginationText.match(/Page (\d+) of (\d+)/);
        if (pagesMatch && pagesMatch.length >= 3) {
          this.currentPage = parseInt(pagesMatch[1]);
          this.totalPages = parseInt(pagesMatch[2]);
          console.log(
            `Current page: ${this.currentPage} of ${this.totalPages}`
          );
        }
      }

      // Get all job cards
      const jobCards = document.querySelectorAll(
        this.CONFIG.SELECTORS.JOB_CARD
      );
      console.log(
        `Found ${jobCards.length} job cards on page ${this.currentPage}`
      );

      return Array.from(jobCards).map((card) => ({
        id: this.getJobId(card),
        element: card,
        title:
          card
            .querySelector(this.CONFIG.SELECTORS.JOB_TITLE)
            ?.textContent?.trim() || "Untitled Job",
        company:
          card
            .querySelector(this.CONFIG.SELECTORS.COMPANY_NAME)
            ?.textContent?.trim() || "Unknown Company",
        location:
          card
            .querySelector(this.CONFIG.SELECTORS.LOCATION)
            ?.textContent?.trim() || "Unknown Location",
        url:
          card.querySelector(this.CONFIG.SELECTORS.JOB_LINK)?.href ||
          window.location.href,
        description: this.getJobDescription(card),
      }));
    } catch (error) {
      console.error("Error getting visible jobs:", error);
      return [];
    }
  }

  getJobId(jobElement) {
    return (
      jobElement.dataset.jobid ||
      jobElement.getAttribute("data-jobid") ||
      jobElement.getAttribute("data-brandviews")?.split(":").pop() ||
      `job-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`
    );
  }

  getJobDescription(card) {
    // First try to get description from the card
    let description = card
      .querySelector(this.CONFIG.SELECTORS.JOB_DESCRIPTION)
      ?.textContent?.trim();

    // If not found in card, try getting from the main job description section
    if (!description) {
      const descriptionElement = document.querySelector(
        this.CONFIG.SELECTORS.JOB_DESCRIPTION
      );
      description = descriptionElement?.textContent?.trim();
    }

    return description || "";
  }

  isExternalApplication() {
    // Check for Easy Apply button presence
    const easyApplyButton = document.querySelector(
      this.CONFIG.SELECTORS.APPLY_BUTTON
    );

    // If there's no Easy Apply button, or it has specific indicators that it's external
    if (
      !easyApplyButton ||
      easyApplyButton.classList.contains("external-apply")
    ) {
      return true;
    }

    // Check button text for external indicators
    const buttonText = easyApplyButton?.textContent?.toLowerCase() || "";
    return (
      buttonText.includes("apply externally") ||
      buttonText.includes("apply on company site")
    );
  }

  async handlePopups() {
    try {
      // Check for various popup types and close them
      const selectors = [
        ".popover-x-button-close",
        this.CONFIG.SELECTORS.POPUP_CLOSE,
        "[aria-label='Close']",
        ".modal-close",
      ];

      for (const selector of selectors) {
        const popupCloseButton = await this.waitForElement(selector, 1000);
        if (popupCloseButton) {
          popupCloseButton.click();
          console.log(`Closed popup with selector: ${selector}`);
          await this.sleep(500);
        }
      }
    } catch (error) {
      // Ignore if no popup found or error closing
      console.log("No popups found or error closing popups:", error);
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

  async logViewedJob(jobData) {
    try {
      const state = await this.getCurrentState();
      const viewLog = {
        jobId: jobData.id,
        jobTitle: jobData.title,
        company: jobData.company,
        location: jobData.location,
        viewDate: new Date().toISOString(),
        url: jobData.url || window.location.href,
      };

      // Update state with viewed job log
      await this.stateManager.updateState({
        viewedJobs: [...(state.viewedJobs || []), viewLog],
        lastActionTime: new Date().toISOString(),
        viewCount: (state.viewCount || 0) + 1,
      });

      // Send message to background script about job view
      chrome.runtime.sendMessage({
        action: "jobViewed",
        jobData: viewLog,
      });

      console.log(`Job viewed:`, viewLog);
    } catch (error) {
      console.error("Error logging viewed job:", error);
    }
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

      console.log(`Application ${status}:`, applicationLog);
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

  async handleApplicationSteps() {
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
        console.log(`Processing application step ${currentAttempt}`);

        // Handle resume selection if present
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
              await this.sleep(1000);

              const uploadButton = document.querySelector(
                FORM_SELECTORS.UPLOAD_BUTTON
              );
              if (uploadButton) {
                uploadButton.click();
                await this.sleep(1000);

                const fileInput = document.querySelector(
                  FORM_SELECTORS.FILE_INPUT
                );
                if (fileInput && state?.userDetails?.resumeUrl) {
                  await this.uploadFileFromURL(fileInput, state?.userDetails);
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
            await this.handleFormElement(element, labelText);
          }
        }

        // Find the action button for this step
        const actionButton = this.findActionButton(FORM_SELECTORS);

        if (actionButton) {
          // If this looks like the final step, mark it
          if (
            actionButton.textContent.toLowerCase().includes("submit") ||
            actionButton.textContent.toLowerCase().includes("apply")
          ) {
            isLastStep = true;
            console.log("Final submission step detected");
          }

          console.log(`Clicking action button: ${actionButton.textContent}`);
          actionButton.click();
          await this.sleep(3000);
        } else {
          console.log("No action button found in this step");
          if (!hasVisibleFields) {
            console.log("No visible fields and no button - might be finished");
            isLastStep = true;
          }
        }

        // If we're stuck on a step, try to detect success/completion
        if (currentAttempt >= 3 && !isLastStep) {
          // Check for success message or completion indicators
          const successIndicators = [
            ".successMessage",
            ".success-message",
            ".application-success",
            "[data-test='application-success']",
          ];

          for (const indicator of successIndicators) {
            if (document.querySelector(indicator)) {
              console.log("Success indicator found, application complete");
              isLastStep = true;
              break;
            }
          }
        }
      }

      if (currentAttempt >= maxAttempts) {
        throw new Error("Maximum form steps exceeded");
      }

      console.log("Application submission completed or reached final step");
      return true;
    } catch (error) {
      console.error("Error in handleApplicationSteps:", error);
      throw error;
    }
  }

  findActionButton(FORM_SELECTORS) {
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

        // Log all found button texts for debugging
        console.log("Found button text:", text);

        // Check for various possible button text variations
        if (
          text.includes("submit") ||
          text.includes("apply") ||
          text === "submit your application"
        ) {
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

  getElementLabel(element) {
    // Try to get label from associated label element
    const labelElement = document.querySelector(`label[for="${element.id}"]`);
    if (labelElement) {
      const labelText = labelElement.textContent.trim();
      console.log(`Found label by id: ${labelText} for ${element.id}`);
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
      console.log(`Found parent label: ${labelText}`);
      return labelText;
    }

    // For radio buttons, try to find the fieldset legend
    if (element.type === "radio") {
      const fieldset = element.closest("fieldset");
      const legend = fieldset?.querySelector("legend");
      if (legend) {
        const legendText = legend.textContent.trim();
        console.log(`Found fieldset legend: ${legendText}`);
        return legendText;
      }
    }

    // Try to get label from aria-label
    if (element.getAttribute("aria-label")) {
      const ariaLabel = element.getAttribute("aria-label").trim();
      console.log(`Found aria-label: ${ariaLabel}`);
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
        console.log(`Found nearby text: ${nearbyText}`);
        return nearbyText;
      }
    }

    // If no label found, return the name attribute or empty string
    return element.name || "";
  }

  async handleFormElement(element, labelText) {
    try {
      if (element.value && !this.shouldOverwrite(labelText)) {
        console.log(`Skipping pre-filled field: ${labelText}`);
        return;
      }

      let options = [];
      if (element.type === "select-one" || element.type === "select-multiple") {
        options = Array.from(element.options).map((opt) => opt.text.trim());
      } else if (element.type === "radio") {
        options = Array.from(document.getElementsByName(element.name))
          .map((radio) => this.getElementLabel(radio))
          .filter(Boolean);
      } else if (element.type === "checkbox") {
        options = ["Yes", "No"];
      }

      const value = await this.getValueForField(labelText, options);
      if (!value) return;

      switch (element.type) {
        case "radio":
          await this.handleRadioInput(element, value, labelText);
          break;
        case "checkbox":
          await this.handleCheckboxInput(element, value, labelText);
          break;
        case "select-one":
        case "select-multiple":
          await this.handleSelect(element, value, labelText);
          break;
        case "tel":
          await this.handlePhoneInput(element, value);
          break;
        default:
          await this.simulateHumanInput(element, value);
      }
    } catch (error) {
      console.error(`Error handling form element ${labelText}:`, error);
    }
  }

  shouldOverwrite(labelText) {
    const ALWAYS_OVERWRITE = [
      "phone",
      "mobile",
      "address",
      "location",
      "website",
      "linkedin",
      "portfolio",
      "github",
    ];

    return ALWAYS_OVERWRITE.some((field) =>
      labelText.toLowerCase().includes(field)
    );
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
        console.log(`Selected radio: ${labelText} - ${radioValue}`);
        return;
      }
    }

    console.log(`No matching radio found for: ${labelText}`);
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
      console.log(`No options found for select: ${labelText}`);
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

  async handlePhoneInput(element, value) {
    // Format phone number to be just digits
    const digitsOnly = value.replace(/\D/g, "");
    await this.simulateHumanInput(element, digitsOnly);
  }

  async simulateHumanInput(element, value) {
    // Simplified direct value setting without typing simulation
    element.focus();
    element.click();
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.blur();
  }

  async uploadFileFromURL(fileInput, userDetails) {
    try {
      const proxyURL = `${this.HOST}/api/proxy-file?url=${encodeURIComponent(
        userDetails?.resumeUrl
      )}`;
      const response = await fetch(proxyURL);

      if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.statusText}`);
      }

      const blob = await response.blob();
      let filename = `${userDetails.firstName} ${userDetails.lastName} resume.pdf`;

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
      await this.sleep(100);
      fileInput.dispatchEvent(new Event("focus", { bubbles: true }));
      await this.sleep(100);
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
      await this.sleep(100);
      fileInput.dispatchEvent(new Event("input", { bubbles: true }));

      return true;
    } catch (error) {
      console.error("Error uploading file:", error);
      try {
        fileInput.value = "";
      } catch (e) {
        console.error("Could not clear file input:", e);
      }
      return false;
    }
  }

  async getValueForField(labelText, options = []) {
    try {
      const state = await this.getCurrentState();
      const normalizedLabel = labelText.toLowerCase().trim();
      const response = await fetch(`${this.HOST}/api/ai-answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: normalizedLabel,
          options: options,
          userData: state?.userDetails || {},
        }),
      });

      if (!response.ok) throw new Error("AI service error");
      const data = await response.json();
      return data.answer;
    } catch (error) {
      console.error("AI Answer Error:", error);
      return options.length > 0 ? options[0] : "";
    }
  }

  async canApplyMore(state) {
    return await this.safeExecute(async () => {
      if (!state || !state.userPlan || !state.availableCredits) return false;

      if (state.subscription) {
        const subscriptionEnd = new Date(state.subscription.currentPeriodEnd);
        if (subscriptionEnd < new Date()) {
          return false;
        }
      }

      switch (state.userPlan) {
        case "unlimited":
          return true;
        case "pro":
          return state.applicationsUsed < this.PLAN_LIMITS.PRO;
        case "credit":
          return state.availableCredits > 0;
        case "free":
          return state.applicationsUsed < this.PLAN_LIMITS.FREE;
        default:
          return false;
      }
    }, "Error checking if can apply more");
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

  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
        const lastActionTime = new Date(
          state?.lastActionTime || this.startTime
        );
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
        console.log("Detected stuck operation, attempting to recover");

        // If we're in an application form, try to exit
        if (state.pendingApplication) {
          await this.stateManager.updateState({
            pendingApplication: false,
            lastActionTime: new Date().toISOString(),
          });

          // Try to go back to search results
          await this.goBackToSearchResults();
        }

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

  async moveToNextJob() {
    return await this.safeExecute(async () => {
      const state = await this.getCurrentState();

      this.currentJobIndex++;

      await this.stateManager.updateState({
        currentJobIndex: this.currentJobIndex,
        lastActionTime: new Date().toISOString(),
      });

      if (this.currentJobIndex < this.jobsToApply?.length) {
        const nextJob = this.jobsToApply[this.currentJobIndex];
        console.log(`Moving to next job: ${nextJob.title}`);

        // Try to process the next job
        await this.clickJobCard(nextJob);
      } else {
        // Check if there are more pages
        if (this.currentPage < this.totalPages) {
          console.log(
            "Reached end of jobs on current page, navigating to next page"
          );
          await this.navigateToNextPage();
        } else {
          // All jobs processed
          console.log("All jobs on all pages processed");
          await this.stop();
          this.sendStatusUpdate("completed", "All jobs processed");
        }
      }
    }, "Error moving to next job");
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
}

const automationHandler = new FastApplyAutomation();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  automationHandler.handleMessage(message, sender, sendResponse);
  return true;
});

document.addEventListener("readystatechange", async (event) => {
  if (document.readyState === "complete") {
    await new Promise((resolve) => setTimeout(resolve, 1000));

    try {
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
        window.location.href.includes("/Job/") &&
        !document.querySelector(".jobsearch-NoResult-messageContainer")
      ) {
        console.log("Search results page detected, marking search complete");
        await automationHandler.stateManager.updateState({
          pendingSearch: false,
          searchUrl: window.location.href,
        });

        chrome.runtime.sendMessage({
          action: "searchCompleted",
          status: "ready",
          userId: state.userId,
        });
      }
    } catch (error) {
      console.log("Error in readystatechange handler:", error);
      // This might happen on initial page load before initialization
    }
  }
});
