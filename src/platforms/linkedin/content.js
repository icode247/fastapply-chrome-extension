import { StateManager } from "@shared/stateManager";
import ExternalJobAutomation from "../external/automationHandler";
import {
  canApplyMore,
  checkUserRole,
  getRemainingApplications,
} from "@shared//checkAuthorization";
import { HOST, PLAN_LIMITS } from "@shared/constants";
import { FileHandler, LinkedInJobParser } from "../../shared/linkedInUtils";
import { StatusNotificationManager } from "../../shared/utils";

//
//applications
class LinkedInJobApply {
  constructor() {
    this.stateManager = new StateManager();
    this.externalAutomation = null;
    this.answerCache = new Map();
    this.fileHandler = new FileHandler();
    this.statusManager = new StatusNotificationManager(); // Move to constructor
    this.init().catch((error) => console.error("Initialization error:", error));
  }

  async restoreState() {
    const state = await this.stateManager.getState();
    if (state && state.userId) {
      await this.fetchUserDetailsFromBackend(state.userId);
      await checkUserRole(state.userId);
    }
  }

  async initializeState() {
    const state = await this.stateManager.getState();
    if (!state) {
      await this.stateManager.saveState({
        userId: null,
        userRole: null,
        applicationLimit: 0,
        applicationsUsed: 0,
        availableCredits: 0,
        preferences: {},
        jobQueue: [],
        isProcessing: false,
      });
    }
  }

  async init() {
    try {
      console.log("Initializing LinkedInJobApply...");
      await this.initializeState();
      this.setupMessageListener();
      await this.checkAndHandleLoginPage();
      await this.restoreState();
    } catch (error) {
      console.error("Initialization failed:", error);
      this.statusManager.show(
        "Initialization failed: " + error.message,
        "error"
      );
      throw error;
    }
  }

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      console.log("Received message:", request);

      // Create a promise-based handler for each action
      const handleMessage = async () => {
        try {
          switch (request.action) {
            case "START_EXTERNAL_APPLICATION":
              this.statusManager.show(
                "Starting external application...",
                "info"
              );
              this.externalAutomation = new ExternalJobAutomation({
                userId: request.userId,
                host: HOST,
                platform: "linkedin",
                page: request.page,
              });
              await this.externalAutomation.init();
              return { status: "success" };

            case "startJobSearch":
              this.statusManager.show("Starting job search...", "info");
              return await this.startJobSearch(request.userId);

            case "processJobs":
              this.statusManager.show("Starting job applications...", "info");
              const result = await this.processJobs({
                jobsToApply: request.jobsToApply || 10,
              });
              return { status: "completed", ...result };

            default:
              throw new Error("Unknown action");
          }
        } catch (error) {
          console.error("Error handling message:", error);
          this.statusManager.show("Error: " + error.message, "error");
          return { status: "error", message: error.message };
        }
      };

      // Handle the async response properly
      handleMessage().then((response) => {
        try {
          sendResponse(response);
        } catch (error) {
          console.error("Error sending response:", error);
        }
      });
      return true;
    });
  }

  async waitForPageLoad() {
    try {
      // Wait for job list to be present
      await this.waitForElement(".jobs-search-results-list");

      // Wait for jobs to load
      await this.sleep(2000);

      // Wait for any loading spinners to disappear
      const spinner = document.querySelector(".artdeco-loader");
      if (spinner) {
        await new Promise((resolve) => {
          const observer = new MutationObserver(() => {
            if (!document.contains(spinner)) {
              observer.disconnect();
              resolve();
            }
          });
          observer.observe(document.body, { childList: true, subtree: true });
        });
      }
    } catch (error) {
      console.error("Error waiting for page load:", error);
    }
  }

  async checkAndHandleLoginPage() {
    if (window.location.href.includes("linkedin.com/login")) {
      this.observeLoginCompletion();
    }
  }

  observeLoginCompletion() {
    const observer = new MutationObserver((mutations) => {
      if (document.querySelector(".feed-identity-module")) {
        observer.disconnect();
        chrome.runtime.sendMessage({ action: "loginCompleted" });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  getJobIdFromCard(jobCard) {
    // Try multiple ways to get job ID
    const jobLink = jobCard.querySelector("a[href*='jobs/view']");
    if (jobLink) {
      const href = jobLink.href;
      const match = href.match(/view\/(\d+)/);
      return match ? match[1] : null;
    }
    return jobCard.dataset.jobId || null;
  }

  async waitForSearchResultsLoad() {
    await this.waitForElement(".jobs-search-results-list");
  }

  async getJobCards() {
    const jobCards = document.querySelectorAll(
      ".scaffold-layout__list-item[data-occludable-job-id]"
    );
    return jobCards;
  }

  async findEasyApplyButton() {
    try {
      // Wait for button with timeout
      const button = await this.waitForElement(".jobs-apply-button", 5000);
      return button;
    } catch (error) {
      console.log("Easy Apply button not found");
      return null;
    }
  }

  async getJobDetailsFromPanel() {
    // Extract job ID from URL
    const jobId =
      new URL(window.location.href).searchParams.get("currentJobId") ||
      "Unknown ID";

    // Wait for the job details panel to load
    await this.waitForElement(".job-details-jobs-unified-top-card__job-title");

    const jobTitle = this.getElementText(
      ".job-details-jobs-unified-top-card__job-title"
    );
    const company = this.getElementText(
      ".job-details-jobs-unified-top-card__company-name"
    );
    const location = this.getElementText(
      ".job-details-jobs-unified-top-card__bullet"
    );

    // Find salary information
    const salary = this.findSalaryInfo();

    // Additional details
    const jobInsightText = this.getElementText(
      ".job-details-jobs-unified-top-card__primary-description-container"
    );
    const [, postedDate, applicants] = jobInsightText
      .split("·")
      .map((item) => item?.trim());

    return {
      jobId,
      title: jobTitle,
      company,
      salary,
      location,
      postedDate: postedDate || "Unknown Date",
      applicants: applicants || "Unknown Applicants",
    };
  }

  // Helper method to get text content of an element
  getElementText(selector) {
    const element = document.querySelector(selector);
    return element ? element.textContent.trim() : "N/A";
  }

  // Helper method to find salary information
  findSalaryInfo() {
    const jobInsightElements = document.querySelectorAll(
      ".job-details-jobs-unified-top-card__job-insight"
    );
    for (const element of jobInsightElements) {
      const text = element.textContent;
      if (text.includes("$") || text.toLowerCase().includes("salary")) {
        return text.trim();
      }
    }
    return "Not specified";
  }

  async applyToJob(applyButton, jobDetails) {
    try {
      // Start application
      applyButton.click();
      // await this.waitForElement(".jobs-easy-apply-content");

      let currentStep = "initial";
      let attempts = 0;
      const maxAttempts = 20; // Maximum number of steps to prevent infinite loops
      while (currentStep !== "submitted" && attempts < maxAttempts) {
        await this.fillCurrentStep();
        currentStep = await this.moveToNextStep();
        attempts++;

        // Handle post-submission modal
        if (currentStep === "submitted") {
          await this.handlePostSubmissionModal();
        }
      }

      if (attempts >= maxAttempts) {
        // Close the application modal before moving on
        await this.closeApplication();
        // Add a small delay to ensure modal is fully closed
        await this.sleep(1000);
        return false;
      }

      await this.saveAppliedJob(jobDetails);
      return true;
    } catch (error) {
      // Ensure we close the modal even if there's an error
      await this.handleErrorState();
      // Add a small delay to ensure modal is fully closed
      await this.sleep(1000);
      return false;
    }
  }

  async closeApplication() {
    try {
      // First try to click the main close button (jobs modal)
      const closeButton = document.querySelector(
        "button[data-test-modal-close-btn]"
      );
      if (closeButton && this.isElementVisible(closeButton)) {
        closeButton.click();
        await this.sleep(1000); // Wait for potential save dialog

        // Check for the "Save Application" dialog
        const discardButton = document.querySelector(
          'button[data-control-name="discard_application_confirm_btn"]'
        );
        if (discardButton && this.isElementVisible(discardButton)) {
          console.log("Found save dialog, clicking discard");
          discardButton.click();
          await this.sleep(1000); // Wait for dialog to close
        }
        return true;
      }

      // Fallback selectors in case the main selectors change
      const fallbackSelectors = [
        ".artdeco-modal__dismiss",
        'button[aria-label="Dismiss"]',
        'button[aria-label="Close"]',
      ];

      for (const selector of fallbackSelectors) {
        const button = document.querySelector(selector);
        if (button && this.isElementVisible(button)) {
          button.click();
          await this.sleep(1000);

          // Check for save dialog with fallback selector
          const discardDialog = document.querySelector(
            ".artdeco-modal__actionbar--confirm-dialog"
          );
          if (discardDialog) {
            const discardBtn = document.querySelector(
              'button[data-control-name="discard_application_confirm_btn"]'
            );
            if (discardBtn && this.isElementVisible(discardBtn)) {
              discardBtn.click();
              await this.sleep(1000);
            }
          }
          return true;
        }
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async checkAndHandleLoginPage() {
    if (window.location.href.includes("linkedin.com/login")) {
      this.observeLoginCompletion();
    }
  }

  observeLoginCompletion() {
    const observer = new MutationObserver((mutations) => {
      if (document.querySelector(".feed-identity-module")) {
        observer.disconnect();
        chrome.runtime.sendMessage({ action: "loginCompleted" });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  async startJobSearch(userId) {
    try {
      // Save userId to state
      await this.stateManager.updateState({ userId });
      await this.fetchUserDetailsFromBackend(userId);
      await checkUserRole(userId);

      const state = await this.stateManager.getState();
      if (!canApplyMore(state)) {
        const remaining = getRemainingApplications(state);
        this.statusManager.show(
          `Cannot apply: ${
            state.userRole === "credit"
              ? `Insufficient credits (${state.credits} remaining)`
              : `Daily limit reached (${remaining} applications remaining)`
          }`,
          "warning"
        );
        this.sendStatusUpdate(
          "error",
          `Cannot apply: ${
            state.userRole === "credit"
              ? `Insufficient credits (${state.credits} remaining)`
              : `Daily limit reached (${remaining} applications remaining)`
          }`
        );
        return { status: "error", message: "Cannot apply more" };
      }
      this.statusManager.show("Applying job filters...", "info");

      const searchUrl = await this.generateComprehensiveSearchUrl(
        state.preferences
      );

      return {
        status: "ready",
        url: searchUrl,
        userId: userId,
      };
    } catch (error) {
      this.statusManager.show(
        `Error starting job search: ${error.message}`,
        "error"
      );
      this.sendStatusUpdate(
        "error",
        "Error starting job search: " + error.message
      );
      throw error;
    }
  }

  async generateComprehensiveSearchUrl(preferences) {
    const baseUrl = "https://www.linkedin.com/jobs/search/?";

    const joinWithOR = (arr) => (arr ? arr.join(" OR ") : "");

    const params = new URLSearchParams();
    params.append("f_AL", "true"); // Keep the Easy Apply filter

    // Handle positions
    if (preferences.positions?.length) {
      params.append("keywords", joinWithOR(preferences.positions));
      // const titleCodes = preferences.positions
      //   .map((position) => titleMap[position])
      //   .filter(Boolean);
      // if (titleCodes.length) {
      //   params.append("f_T", titleCodes.join(","));
      // }
    }

    if (preferences.location) {
      // GeoId mapping for countries
      const geoIdMap = {
        Nigeria: "105365761",
        Netherlands: "102890719",
        "United States": "103644278",
        "United Kingdom": "101165590",
        Canada: "101174742",
        Australia: "101452733",
        Germany: "101282230",
        France: "105015875",
        India: "102713980",
        Singapore: "102454443",
        "South Africa": "104035573",
        Ireland: "104738515",
        "New Zealand": "105490917",
      };

      if (preferences.location === "Remote") {
        params.append("f_WT", "2");
      } else if (geoIdMap[preferences.location]) {
        params.append("geoId", geoIdMap[preferences.location]);
      } else {
        params.append("location", preferences.location);
      }
    }

    const workModeMap = {
      Remote: "2",
      Hybrid: "3",
      "On-site": "1",
    };

    if (preferences.workMode?.length) {
      const workModeCodes = preferences.workMode
        .map((mode) => workModeMap[mode])
        .filter(Boolean);
      if (workModeCodes.length) {
        params.append("f_WT", workModeCodes.join(","));
      }
    }

    const datePostedMap = {
      "Any time": "",
      "Past month": "r2592000",
      "Past week": "r604800",
      "Past 24 hours": "r86400",
    };

    if (preferences.datePosted) {
      const dateCode = datePostedMap[preferences.datePosted];
      if (dateCode) {
        params.append("f_TPR", dateCode);
      }
    }

    const experienceLevelMap = {
      Internship: "1",
      "Entry level": "2",
      Associate: "3",
      "Mid-Senior level": "4",
      Director: "5",
      Executive: "6",
    };

    if (preferences.experience?.length) {
      const experienceCodes = preferences.experience
        .map((level) => experienceLevelMap[level])
        .filter(Boolean);
      if (experienceCodes.length) {
        params.append("f_E", experienceCodes.join(","));
      }
    }

    // Job Type Mapping
    const jobTypeMap = {
      "Full-time": "F",
      "Part-time": "P",
      Contract: "C",
      Temporary: "T",
      Internship: "I",
      Volunteer: "V",
    };
    if (preferences.jobType?.length) {
      const jobTypeCodes = preferences.jobType
        .map((type) => jobTypeMap[type])
        .filter(Boolean);
      if (jobTypeCodes.length) {
        params.append("f_JT", jobTypeCodes.join(","));
      }
    }

    // Salary Range Mapping
    if (preferences.salary?.length === 2) {
      const [min] = preferences.salary;
      const salaryBuckets = {
        40000: "1",
        60000: "2",
        80000: "3",
        100000: "4",
        120000: "5",
        140000: "6",
        160000: "7",
        180000: "8",
        200000: "9",
      };

      const bucketValue = Object.entries(salaryBuckets)
        .reverse()
        .find(([threshold]) => min >= parseInt(threshold))?.[1];

      if (bucketValue) {
        params.append("f_SB", bucketValue);
      }
    }

    // Sorting
    params.append("sortBy", "R");

    return baseUrl + params.toString();
  }

  async waitForSearchResultsLoad() {
    return new Promise((resolve) => {
      const checkSearchResults = () => {
        if (document.querySelector(".jobs-search-results-list")) {
          console.log("Search results loaded");
          resolve();
        } else {
          setTimeout(checkSearchResults, 500);
        }
      };
      checkSearchResults();
    });
  }

  isJobDetailsPage() {
    return !!document.querySelector(".jobs-unified-top-card");
  }

  //TODO: use this function to handle tailored resume and cover letter generation.
  scrapeDescription() {
    const descriptionElement = document.querySelector(
      ".jobs-description-content__text"
    );
    if (!descriptionElement) return "No job description found";

    const cleanDescription = Array.from(descriptionElement.children)
      .map((element) => {
        if (element.tagName === "UL" || element.tagName === "OL") {
          return Array.from(element.children)
            .map((li) => `• ${li.textContent.trim()}`)
            .join("\n");
        }
        return element.textContent.trim();
      })
      .filter((text) => text)
      .join("\n\n");

    return cleanDescription;
  }

  getJobProperties() {
    const company = document.querySelector(
      ".job-details-jobs-unified-top-card__company-name"
    ).textContent;
    const title = document.querySelector(
      ".job-details-jobs-unified-top-card__job-title"
    ).textContent;
    const urlParams = new URLSearchParams(window.location.search);
    const jobId = urlParams.get("currentJobId");
    const detailsContainer = document.querySelector(
      ".job-details-jobs-unified-top-card__primary-description-container .t-black--light.mt2"
    );
    const detailsText = detailsContainer ? detailsContainer.textContent : "";
    const location = detailsText.match(/^(.*?)\s·/)?.[1] || "Not specified";
    const postedDate = detailsText.match(/·\s(.*?)\s·/)?.[1] || "Not specified";
    const applications =
      detailsText.match(/·\s([^·]+)$/)?.[1] || "Not specified";
    const workplaceElem = document.querySelector(
      ".job-details-preferences-and-skills__pill"
    );

    const workplace = workplaceElem
      ? workplaceElem.textContent.trim()
      : "Not specified";

    return {
      title,
      jobId,
      company,
      location,
      postedDate,
      applications,
      workplace,
    };
  }

  async checkIfAlreadyApplied(jobId, userId) {
    try {
      const response = await fetch(
        `${HOST}/api/applied-jobs?userId=${userId}&jobId=${jobId}`
      );
      if (!response.ok) {
        throw new Error(
          `Failed to check application status: ${response.statusText}`
        );
      }
      const data = await response.json();
      return data.applied;
    } catch (error) {
      console.error("Error checking if job is already applied:", error);
      return false;
    }
  }

  async waitForNavigation() {
    return new Promise((resolve) => {
      const observer = new MutationObserver((mutations) => {
        if (document.querySelector(".jobs-easy-apply-content")) {
          observer.disconnect();
          resolve();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  async getAnswer(label, options = []) {
    const normalizedLabel = label.toLowerCase().trim();
    if (this.answerCache[normalizedLabel]) {
      return this.answerCache[normalizedLabel];
    }

    try {
      const response = await fetch(`${HOST}/api/ai-answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: normalizedLabel,
          options,
          userData: await this.getUserDetails(),
          description: LinkedInJobParser.extract("string"),
        }),
      });

      if (!response.ok) throw new Error("AI service error");
      const data = await response.json();
      this.answerCache[normalizedLabel] = data.answer;
      return data.answer;
    } catch (error) {
      console.error("AI Answer Error:", error);
      return options.length > 0 ? options[0] : "";
    }
  }

  async waitForUploadProcessing(container) {
    return new Promise((resolve) => {
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === "childList") {
            const successMessage = container.querySelector(
              ".artdeco-inline-feedback--success"
            );
            const errorMessage = container.querySelector(
              ".artdeco-inline-feedback--error"
            );
            if (successMessage) {
              observer.disconnect();
              resolve("success");
            } else if (errorMessage) {
              observer.disconnect();
              resolve("error");
            }
          }
        }
      });

      observer.observe(container, { childList: true, subtree: true });

      // Set a timeout in case the upload takes too long
      setTimeout(() => {
        observer.disconnect();
        resolve("timeout");
      }, 30000); // 30 seconds timeout
    });
  }

  async fillCurrentStep() {
    // First handle file upload questions as they're more specific
    const fileUploadContainers = document.querySelectorAll(
      ".js-jobs-document-upload__container"
    );

    if (fileUploadContainers.length) {
      for (const container of fileUploadContainers) {
        this.statusManager.show(
          "Analyzing resumes for the perfect match",
          "info"
        );
        await this.fileHandler.handleFileUpload(
          container,
          await this.getUserDetails(),
          LinkedInJobParser.extract("string")
        );
      }
    }

    // Then handle regular form questions
    const questions = document.querySelectorAll(".fb-dash-form-element");
    for (const question of questions) {
      await this.handleQuestion(question);
    }
  }

  async handleQuestion(question) {
    if (
      question.classList.contains("js-jobs-document-upload__container") ||
      question.hasAttribute("data-processed")
    ) {
      return;
    }

    const questionHandlers = {
      select: this.handleSelectQuestion,
      radio: this.handleRadioQuestion,
      text: this.handleTextQuestion,
      textarea: this.handleTextAreaQuestion,
      checkbox: this.handleCheckboxQuestion,
    };

    for (const [type, handler] of Object.entries(questionHandlers)) {
      const element = question.querySelector(this.getQuestionSelector(type));
      if (element) {
        await handler.call(this, element);
        question.setAttribute("data-processed", "true");
        return;
      }
    }
  }
  async handleSelectQuestion(select) {
    // Find parent container
    const container = select.closest(".fb-dash-form-element");
    // Get label accounting for nested spans
    const labelElement = container.querySelector(
      ".fb-dash-form-element__label"
    );
    const label = labelElement?.textContent?.trim();

    const options = Array.from(select.options)
      .filter((opt) => opt.value !== "Select an option")
      .map((opt) => opt.text.trim());

    const answer = await this.getAnswer(label, options);
    select.value = answer;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async handleFileQuestion(question) {
    const fileInput = question.querySelector('input[type="file"]');
    if (!fileInput) return;

    const label = this.getQuestionLabel(question);
    const labelText = label.toLowerCase();
    const userDetails = await this.getUserDetails();

    if (!userDetails) {
      return;
    }

    // Determine which file to upload based on the label
    if (labelText.includes("resume") || labelText.includes("cv")) {
      if (userDetails.resumeUrl) {
        await this.uploadFileFromURL(fileInput, userDetails.resumeUrl);
      }
    } else if (labelText.includes("cover letter")) {
      if (userDetails.coverLetterUrl) {
        await this.uploadFileFromURL(fileInput, userDetails.coverLetterUrl);
      }
    }
  }

  getQuestionSelector(type) {
    const selectors = {
      select: "select",
      radio:
        'fieldset[data-test-form-builder-radio-button-form-component="true"]',
      text: "input[type='text']",
      textarea: "textarea",
      checkbox: "input[type='checkbox']",
    };
    return selectors[type];
  }

  async handleRadioQuestion(radio) {
    const label = this.getQuestionLabel(radio);
    const options = Array.from(
      radio.querySelectorAll('input[type="radio"]')
    ).map((input) => {
      const labelElement = document.querySelector(`label[for="${input.id}"]`);
      return labelElement ? labelElement.textContent : "Unknown";
    });
    const answer = await this.getAnswer(label, options);

    const answerElement = Array.from(radio.querySelectorAll("label")).find(
      (el) => el.textContent.includes(answer)
    );
    if (answerElement) answerElement.click();
  }

  async handleTextQuestion(textInput) {
    const label = this.getQuestionLabel(textInput);
    const answer = await this.getAnswer(label);

    // Handle date fields
    const isDateField =
      textInput.getAttribute("placeholder") === "mm/dd/yyyy" ||
      textInput.getAttribute("name") === "artdeco-date" ||
      label.toLowerCase().includes("date");

    if (isDateField) {
      const formattedDate = this.formatDateForInput(answer);
      textInput.value = formattedDate;
      textInput.dispatchEvent(new Event("input", { bubbles: true }));
      textInput.dispatchEvent(new Event("blur", { bubbles: true }));
      return;
    }

    // Handle typeahead
    const isTypeahead = textInput.getAttribute("role") === "combobox";
    textInput.value = answer;
    textInput.dispatchEvent(new Event("input", { bubbles: true }));

    if (isTypeahead) {
      await this.sleep(1000);
      textInput.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown" })
      );
      await this.sleep(500);
      textInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    }
  }

  formatDateForInput(dateStr) {
    try {
      const date = new Date(dateStr);
      const mm = String(date.getMonth() + 1).padStart(2, "0");
      const dd = String(date.getDate()).padStart(2, "0");
      const yyyy = date.getFullYear();
      return `${mm}/${dd}/${yyyy}`;
    } catch (error) {
      return dateStr;
    }
  }

  async handleTextAreaQuestion(textArea) {
    const label = this.getQuestionLabel(textArea);
    const answer = await this.getAnswer(label);
    textArea.value = answer;
    textArea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  async handleCheckboxQuestion(checkbox) {
    const label = this.getQuestionLabel(checkbox);
    const answer = (await this.getAnswer(label, ["Yes", "No"])) === "Yes";
    checkbox.checked = answer;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
  }

  getQuestionLabel(element) {
    const container = element.closest(".fb-dash-form-element");
    if (!container) return "Unknown";

    const label = container.querySelector(
      "label, legend, .fb-dash-form-element__label"
    );
    if (!label) return "Unknown";

    // Handle both nested spans and direct text
    return label.textContent.trim().replace(/\s+/g, " ");
  }

  getUserDetails = async () => {
    const result = await chrome.storage.local.get(["userDetails"]);
    return result.userDetails;
  };

  async waitForUploadProcess(fileInput, timeout = 10000) {
    const container = fileInput.closest("form") || fileInput.parentElement;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      // Check for error messages
      const errorElement = container.querySelector(
        ".artdeco-inline-feedback--error"
      );
      if (errorElement && errorElement.textContent.trim()) {
        throw new Error(`Upload failed: ${errorElement.textContent.trim()}`);
      }

      // Check for success indicators
      const successElement = container.querySelector(
        ".artdeco-inline-feedback--success"
      );
      if (successElement) {
        return true;
      }

      await this.sleep(500);
    }

    // If we still have a file in the input after timeout, consider it successful
    const hasFile = fileInput.files && fileInput.files.length > 0;
    return hasFile;
  }

  async moveToNextStep() {
    try {
      // Define all possible buttons
      const buttonSelectors = {
        next: 'button[aria-label="Continue to next step"]',
        preview: 'button[aria-label="Review your application"]',
        submit: 'button[aria-label="Submit application"]',
        dismiss: 'button[aria-label="Dismiss"]',
        done: 'button[aria-label="Done"]',
        close: 'button[aria-label="Close"]',
        continueApplying:
          'button[aria-label*="Easy Apply"][aria-label*="Continue applying"]',
        continueTips:
          'button[aria-label="I understand the tips and want to continue the apply process"]',
        saveJob: 'button[data-control-name="save_application_btn"]',
      };

      // Wait for any button to appear
      await this.waitForAnyElement(Object.values(buttonSelectors));

      // Check for each button in priority order
      if (await this.findAndClickButton(buttonSelectors.continueTips)) {
        await this.sleep(2000);
        return "continue";
      }

      if (await this.findAndClickButton(buttonSelectors.continueApplying)) {
        await this.sleep(2000);
        return "continue";
      }

      if (await this.findAndClickButton(buttonSelectors.saveJob)) {
        await this.sleep(2000);
        return "saved";
      }

      if (await this.findAndClickButton(buttonSelectors.submit)) {
        await this.sleep(2000);
        return "submitted";
      }

      if (await this.findAndClickButton(buttonSelectors.preview)) {
        await this.sleep(2000);
        return "preview";
      }

      if (await this.findAndClickButton(buttonSelectors.next)) {
        await this.sleep(2000);
        return "next";
      }

      if (
        (await this.findAndClickButton(buttonSelectors.dismiss)) ||
        (await this.findAndClickButton(buttonSelectors.done)) ||
        (await this.findAndClickButton(buttonSelectors.close))
      ) {
        await this.sleep(2000);
        return "modal-closed";
      }
      return "error";
    } catch (error) {
      return "error";
    }
  }

  async findAndClickButton(selector) {
    const button = document.querySelector(selector);
    if (button && button.isVisible()) {
      try {
        button.click();
        return true;
      } catch (error) {
        return false;
      }
    }
    return false;
  }

  async handlePostSubmissionModal() {
    try {
      await this.sleep(2000);

      const modalSelectors = [
        'button[aria-label="Dismiss"]',
        'button[aria-label="Done"]',
        'button[aria-label="Close"]',
        ".artdeco-modal__dismiss",
        ".jobs-applied-modal__dismiss-btn",
      ];

      for (const selector of modalSelectors) {
        const button = document.querySelector(selector);
        if (button && this.isElementVisible(button)) {
          button.click();
          await this.sleep(1000); // Wait for modal to close
          return true;
        }
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  async handleErrorState() {
    try {
      // Try to close any open modals or dialogs
      const closeButtons = [
        'button[aria-label="Dismiss"]',
        'button[aria-label="Close"]',
        ".artdeco-modal__dismiss",
        ".jobs-applied-modal__dismiss-btn",
      ];

      for (const selector of closeButtons) {
        const button = document.querySelector(selector);
        if (button && this.isElementVisible(button)) {
          button.click();
          await this.sleep(1000);
        }
      }
    } catch (error) {
      console.error("Error handling error state:", error);
    }
  }

  async waitForAnyElement(selectors, timeout = 5000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element && this.isElementVisible(element)) {
          return element;
        }
      }
      await this.sleep(100);
    }
    throw new Error(`None of the elements found: ${selectors.join(", ")}`);
  }

  isElementVisible(element) {
    if (!element) return false;

    const style = window.getComputedStyle(element);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0"
    ) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return false;
    }

    return element.offsetParent !== null;
  }
  async saveAppliedJob(jobDetails) {
    try {
      const state = await this.stateManager.getState();
      if (!state || !state.userId) throw new Error("No user state found");

      const applicationData = {
        userId: state.userId,
        jobId: jobDetails.jobId,
        title: jobDetails.title,
        company: jobDetails.company,
        location: jobDetails.location,
        jobUrl: window.location.href,
        salary: jobDetails.salary || "Not specified",
        workplace: jobDetails.workplace,
        postedDate: jobDetails.postedDate,
        applicants: jobDetails.applications,
      };

      const response = await fetch(`${HOST}/api/applied-jobs`, {
        method: "POST",
        body: JSON.stringify(applicationData),
      });

      if (!response.ok) {
        throw new Error(`Failed to save applied job: ${response.statusText}`);
      }

      return true;
    } catch (error) {
      console.error("Error saving applied job:", error);
      return false;
    }
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

  sendStatusUpdate(status, message) {
    chrome.runtime.sendMessage({
      action: "statusUpdate",
      status: status,
      message: message,
    });
  }

  async fetchUserDetailsFromBackend(userId) {
    try {
      const response = await fetch(`${HOST}/api/user/${userId}`);
      if (!response.ok) throw new Error("Failed to fetch user details");
      const data = await response.json();

      // Save to chrome.storage.local for getAnswer method
      await chrome.storage.local.set({ userDetails: data });

      // Update state with new data
      await this.stateManager.updateState({
        preferences: data.jobPreferences,
        availableCredits: data.credits,
      });
    } catch (error) {
      console.error("Error fetching user details:", error);
      throw error;
    }
  }

  //TODO: check if the logic here is properly checking number of applications by free or pro users

  async waitForElement(selector, timeout = 10000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const element = document.querySelector(selector);
      if (element) return element;
      await this.sleep(100);
    }
    throw new Error(`Element not found: ${selector}`);
  }

  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async goToNextPage(currentPage) {
    try {
      const paginationContainer = await this.waitForElement(
        ".artdeco-pagination__pages.artdeco-pagination__pages--number"
      );
      if (!paginationContainer) return false;

      const pageButtons = paginationContainer.querySelectorAll(
        "li.artdeco-pagination__indicator--number"
      );
      const pages = Array.from(pageButtons);

      // Find the next page button
      const nextPageButton = pages.find((page) => {
        const pageNum = page.getAttribute("data-test-pagination-page-btn");
        return pageNum && parseInt(pageNum) === currentPage + 1;
      });

      if (!nextPageButton) {
        // Check if there's an ellipsis and a last page
        const ellipsis = paginationContainer.querySelector(
          'button[aria-label^="Page"] span'
        );
        if (ellipsis && ellipsis.textContent === "…") {
          const lastPageButton = pages[pages.length - 1];
          const lastPageNum = parseInt(
            lastPageButton.getAttribute("data-test-pagination-page-btn")
          );

          if (currentPage < lastPageNum) {
            const url = new URL(window.location.href);
            url.searchParams.set("start", currentPage * 25);
            await this.navigateToPage(url.toString());
            return true;
          }
        }
        return false;
      }

      const button = nextPageButton.querySelector("button");
      if (button) {
        button.click();
        await this.waitForPageLoad();
        return true;
      }

      return false;
    } catch (error) {
      console.error("Error navigating to next page:", error);
      return false;
    }
  }

  // //TODO:

  async clickJobCard(jobCard) {
    try {
      const clickableElement = jobCard.querySelector(
        "a[href*='jobs/view'], .job-card-list__title, .job-card-container__link"
      );

      if (!clickableElement) {
        throw new Error("No clickable element found in job card");
      }

      console.log("Found clickable element:", clickableElement.tagName);

      const clickEvent = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
      });

      clickEvent.preventDefault();
      clickableElement.dispatchEvent(clickEvent);
      console.log("Click event dispatched");

      await this.waitForJobDetailsLoad();
      console.log("Job details loaded successfully");

      return true;
    } catch (error) {
      console.error("Error clicking job card:", error);
      throw error;
    }
  }

  async waitForJobDetailsLoad() {
    try {
      console.log("Waiting for job details to load");
      const element = await this.waitForElement(
        ".job-details-jobs-unified-top-card__job-title",
        10000
      );

      console.log("Job details title element found");
      await this.sleep(1000);

      return element;
    } catch (error) {
      console.error("Error waiting for job details:", error);
      throw new Error("Job details failed to load");
    }
  }

  // async processJobs({ jobsToApply }) {
  //   let processedCount = 0;
  //   let appliedCount = 0;
  //   let processedJobs = new Set();
  //   let currentPage = 1;
  //   let noNewJobsCount = 0;
  //   const MAX_NO_NEW_JOBS = 3;

  //   try {
  //     const state = await this.stateManager.getState();
  //     if (!state || !state.userId) {
  //       throw new Error("No user state found. Please restart the job search.");
  //     }

  //     this.statusManager.show(
  //       `Starting to process jobs. Target: ${jobsToApply} jobs`,
  //       "info"
  //     );

  //     // Initial scroll to trigger job loading
  //     await this.initialScroll();

  //     while (appliedCount < jobsToApply) {
  //       const jobCards = await this.getJobCards();
  //       console.log(
  //         `Found ${jobCards.length} job cards on page ${currentPage}`
  //       );

  //       if (jobCards.length === 0) {
  //         console.log("No job cards found, checking pagination");
  //         const hasNextPage = await this.goToNextPage(currentPage);
  //         if (hasNextPage) {
  //           currentPage++;
  //           noNewJobsCount = 0;
  //           await this.waitForPageLoad();
  //           continue;
  //         } else {
  //           console.log("No more pages available");
  //           break;
  //         }
  //       }

  //       let newJobsFound = false;

  //       for (const jobCard of jobCards) {
  //         if (appliedCount >= jobsToApply) {
  //           this.statusManager.show(
  //             `Reached target of ${jobsToApply} jobs`,
  //             "warning"
  //           );
  //           break;
  //         }

  //         const jobId = this.getJobIdFromCard(jobCard);

  //         if (!jobId || processedJobs.has(jobId)) {
  //           continue;
  //         }

  //         processedJobs.add(jobId);
  //         newJobsFound = true;
  //         processedCount++;

  //         try {
  //           // First check if we can still apply
  //           const currentState = await this.stateManager.getState();
  //           if (!canApplyMore(currentState)) {
  //             const remaining = getRemainingApplications(currentState);
  //             this.statusManager.show(
  //               `Cannot apply: ${
  //                 currentState.userRole === "credit"
  //                   ? `Insufficient credits (${currentState.credits} remaining)`
  //                   : `Daily limit reached (${remaining} applications remaining)`
  //               }`,
  //               "warning"
  //             );
  //             return {
  //               status: "limit_reached",
  //               appliedCount,
  //               processedCount,
  //               totalPages: currentPage,
  //             };
  //           }

  //           // Check if already applied
  //           if (await this.checkIfAlreadyApplied(jobId, state.userId)) {
  //             this.statusManager.show(
  //               `Already applied to job ${jobId}, skipping.`,
  //               "warning"
  //             );
  //             continue;
  //           }

  //           // Check if the job card is in view, if not, scroll to it
  //           if (!this.isElementInViewport(jobCard)) {
  //             jobCard.scrollIntoView({ behavior: "smooth", block: "center" });
  //             await this.sleep(1000);
  //           }

  //           // Click and wait for job details
  //           await this.clickJobCard(jobCard);
  //           await this.waitForJobDetailsLoad();

  //           const jobDetails = await this.getJobProperties();
  //           this.statusManager.show(
  //             `Processing: ${jobDetails.title} (Page ${currentPage})`,
  //             "info"
  //           );

  //           // Find and click the Easy Apply button
  //           const applyButton = await this.findEasyApplyButton();
  //           if (!applyButton) {
  //             console.log("No Easy Apply button found");
  //             continue;
  //           }

  //           // Attempt to apply
  //           const success = await this.applyToJob(applyButton, jobDetails);

  //           if (success) {
  //             appliedCount++;
  //             this.statusManager.show(
  //               `Successfully applied to job ${appliedCount}/${jobsToApply}`,
  //               "success"
  //             );

  //             // Update application count and state
  //             const currentState = await this.stateManager.getState();
  //             await this.stateManager.updateState({
  //               applicationsUsed: currentState.applicationsUsed + 1,
  //               availableCredits:
  //                 currentState.userRole === "free" ||
  //                 currentState.userRole === "credit"
  //                   ? currentState.availableCredits - 1
  //                   : currentState.availableCredits,
  //             });

  //             await this.updateApplicationCount(state.userId);
  //             await checkUserRole(state.userId);
  //           }

  //           await this.sleep(2000);
  //         } catch (error) {
  //           this.statusManager.show(
  //             `Error processing job ${jobId} on page ${currentPage}`,
  //             "error"
  //           );
  //           console.error(`Error processing job ${jobId}:`, error);
  //           continue;
  //         }
  //       }

  //       // If we haven't found new jobs on current page
  //       if (!newJobsFound) {
  //         // Try scrolling first
  //         if (await this.scrollAndWaitForNewJobs()) {
  //           noNewJobsCount = 0;
  //           continue;
  //         }

  //         // If scrolling doesn't help, try next page
  //         this.statusManager.show(
  //           `Moving to next page (current: ${currentPage})`,
  //           "info"
  //         );
  //         const hasNextPage = await this.goToNextPage(currentPage);
  //         if (hasNextPage) {
  //           currentPage++;
  //           noNewJobsCount = 0;
  //           await this.waitForPageLoad();
  //         } else {
  //           noNewJobsCount++;
  //           if (noNewJobsCount >= MAX_NO_NEW_JOBS) {
  //             this.statusManager.show(
  //               "No more jobs available after multiple attempts",
  //               "warning"
  //             );
  //             break;
  //           }
  //         }
  //       }
  //     }

  //     const message = `Finished processing jobs. Applied to ${appliedCount}/${jobsToApply} jobs (Processed ${processedCount} total across ${currentPage} pages)`;
  //     this.statusManager.show(message, "success");

  //     return {
  //       status: "completed",
  //       message,
  //       appliedCount,
  //       processedCount,
  //       totalPages: currentPage,
  //     };
  //   } catch (error) {
  //     console.error("Error in processJobs:", error);
  //     this.statusManager.show("Error processing jobs", "error");
  //     throw error;
  //   }
  // }

  async processJobs({ jobsToApply }) {
    let processedCount = 0;
    let appliedCount = 0;
    let skippedCount = 0;
    let processedJobs = new Set();
    let currentPage = 1;
    let noNewJobsCount = 0;
    const MAX_NO_NEW_JOBS = 3;

    try {
      const state = await this.stateManager.getState();
      if (!state || !state.userId) {
        throw new Error("No user state found. Please restart the job search.");
      }

      this.statusManager.show(
        `Starting to process jobs. Target: ${jobsToApply} jobs`,
        "info"
      );

      // Initial scroll to trigger job loading
      await this.initialScroll();

      while (appliedCount < jobsToApply) {
        const jobCards = await this.getJobCards();
        console.log(
          `Found ${jobCards.length} job cards on page ${currentPage}`
        );

        if (jobCards.length === 0) {
          console.log("No job cards found, checking pagination");
          const hasNextPage = await this.goToNextPage(currentPage);
          if (hasNextPage) {
            currentPage++;
            noNewJobsCount = 0;
            await this.waitForPageLoad();
            continue;
          } else {
            console.log("No more pages available");
            break;
          }
        }

        let newJobsFound = false;
        let newApplicableJobsFound = false; // Track if we found jobs we can apply to

        for (const jobCard of jobCards) {
          if (appliedCount >= jobsToApply) {
            this.statusManager.show(
              `Reached target of ${jobsToApply} jobs`,
              "success"
            );
            break;
          }

          const jobId = this.getJobIdFromCard(jobCard);

          if (!jobId || processedJobs.has(jobId)) {
            continue;
          }

          processedJobs.add(jobId);
          newJobsFound = true;
          processedCount++;

          try {
            // First check if we can still apply
            const currentState = await this.stateManager.getState();
            if (!canApplyMore(currentState)) {
              const remaining = getRemainingApplications(currentState);
              this.statusManager.show(
                `Cannot apply: ${
                  currentState.userRole === "credit"
                    ? `Insufficient credits (${currentState.credits} remaining)`
                    : `Daily limit reached (${remaining} applications remaining)`
                }`,
                "warning"
              );
              return {
                status: "limit_reached",
                appliedCount,
                processedCount,
                skippedCount,
                totalPages: currentPage,
              };
            }

            // Check if the job card is in view, if not, scroll to it
            if (!this.isElementInViewport(jobCard)) {
              jobCard.scrollIntoView({ behavior: "smooth", block: "center" });
              await this.sleep(1000);
            }

            // Click and wait for job details
            await this.clickJobCard(jobCard);
            await this.waitForJobDetailsLoad();

            // Find the Easy Apply button - if not found, this job is considered already applied
            const applyButton = await this.findEasyApplyButton();
            if (!applyButton) {
              console.log("No Easy Apply button found - job already applied");
              this.statusManager.show(
                `Already applied to job ${jobId}, skipping.`,
                "warning"
              );
              skippedCount++;
              continue;
            }

            // We found a job we can actually apply to
            newApplicableJobsFound = true;

            const jobDetails = await this.getJobProperties();
            this.statusManager.show(
              `Processing: ${jobDetails.title} (Page ${currentPage})`,
              "info"
            );

            // We already found the Easy Apply button earlier

            // Attempt to apply
            const success = await this.applyToJob(applyButton, jobDetails);

            if (success) {
              appliedCount++;
              this.statusManager.show(
                `Successfully applied to job ${appliedCount}/${jobsToApply} (${skippedCount} jobs skipped)`,
                "success"
              );

              // Update application count and state
              const currentState = await this.stateManager.getState();
              await this.stateManager.updateState({
                applicationsUsed: currentState.applicationsUsed + 1,
                availableCredits:
                  currentState.userRole === "free" ||
                  currentState.userRole === "credit"
                    ? currentState.availableCredits - 1
                    : currentState.availableCredits,
              });

              await this.updateApplicationCount(state.userId);
              await checkUserRole(state.userId);
            }

            await this.sleep(2000);
          } catch (error) {
            this.statusManager.show(
              `Error processing job ${jobId} on page ${currentPage}`,
              "error"
            );
            console.error(`Error processing job ${jobId}:`, error);
            continue;
          }
        }

        // If we haven't found any new jobs that we can apply to
        if (!newApplicableJobsFound) {
          // Try scrolling first to load more jobs
          if (await this.scrollAndWaitForNewJobs()) {
            noNewJobsCount = 0;
            continue;
          }

          // If scrolling doesn't help, try next page
          this.statusManager.show(
            `Moving to next page (current: ${currentPage})`,
            "info"
          );
          const hasNextPage = await this.goToNextPage(currentPage);
          if (hasNextPage) {
            currentPage++;
            noNewJobsCount = 0;
            await this.waitForPageLoad();
          } else {
            noNewJobsCount++;
            if (noNewJobsCount >= MAX_NO_NEW_JOBS) {
              this.statusManager.show(
                `No more applicable jobs to apply. Applied to ${appliedCount}/${jobsToApply} (${skippedCount} jobs)`,
                "warning"
              );
              break;
            }
          }
        } else {
          // Reset the counter if we found applicable jobs
          noNewJobsCount = 0;
        }
      }

      // Determine the status based on whether we reached the target
      const completionStatus =
        appliedCount >= jobsToApply ? "target_reached" : "no_more_jobs";
      const message =
        appliedCount >= jobsToApply
          ? `Successfully applied to target of ${appliedCount}/${jobsToApply} jobs (Processed ${processedCount} total across ${currentPage} pages)`
          : `Applied to ${appliedCount}/${jobsToApply} jobs - no more jobs available (Skipped ${skippedCount} already applied jobs)`;

      this.statusManager.show(
        message,
        appliedCount >= jobsToApply ? "success" : "warning"
      );

      return {
        status: completionStatus,
        message,
        appliedCount,
        processedCount,
        skippedCount,
        totalPages: currentPage,
      };
    } catch (error) {
      console.error("Error in processJobs:", error);
      this.statusManager.show("Error processing jobs", "error");
      throw error;
    }
  }
  async goToNextPage(currentPage) {
    try {
      console.log(`Attempting to go to next page after page ${currentPage}`);

      // First try to find the next button
      const nextButton = document.querySelector(
        "button.jobs-search-pagination__button--next"
      );
      if (nextButton) {
        console.log("Found next button, clicking it");
        nextButton.click();
        await this.waitForPageLoad();
        return true;
      }

      // If no next button, try finding the pagination container
      const paginationContainer = document.querySelector(
        ".jobs-search-pagination__pages"
      );
      if (!paginationContainer) {
        console.log("No pagination found");
        return false;
      }

      // Get all page indicators
      const pageIndicators = paginationContainer.querySelectorAll(
        ".jobs-search-pagination__indicator"
      );

      // Find the current active page button
      const activeButton = paginationContainer.querySelector(
        ".jobs-search-pagination__indicator-button--active"
      );
      if (!activeButton) {
        console.log("No active page button found");
        return false;
      }

      // Get the current page number
      const currentPageNum = parseInt(
        activeButton.querySelector("span").textContent
      );
      console.log(`Current page number: ${currentPageNum}`);

      // Find the next page button
      let nextPageButton = null;
      pageIndicators.forEach((indicator, index) => {
        const button = indicator.querySelector("button");
        const span = button.querySelector("span");
        const pageNum = span.textContent;

        if (pageNum !== "…" && parseInt(pageNum) === currentPageNum + 1) {
          nextPageButton = button;
        }
      });

      if (nextPageButton) {
        console.log(`Found next page button for page ${currentPageNum + 1}`);
        nextPageButton.click();
        await this.waitForPageLoad();
        return true;
      }

      // If we have an ellipsis and we're not at the last page
      const pageState = document.querySelector(
        ".jobs-search-pagination__page-state"
      );
      if (pageState) {
        const match = pageState.textContent.match(/Page \d+ of (\d+)/);
        if (match) {
          const totalPages = parseInt(match[1]);
          if (currentPageNum < totalPages) {
            console.log(
              `Current page ${currentPageNum} is less than total pages ${totalPages}, updating URL`
            );
            const url = new URL(window.location.href);
            const start = currentPageNum * 25; // LinkedIn uses 25 jobs per page
            url.searchParams.set("start", start);
            window.history.pushState({}, "", url.toString());
            // Trigger page reload or content refresh
            await this.waitForPageLoad();
            return true;
          }
        }
      }

      console.log("No next page available");
      return false;
    } catch (error) {
      console.error("Error navigating to next page:", error);
      return false;
    }
  }

  async initialScroll() {
    const jobsList = document.querySelector(".jobs-search-results-list");

    if (!jobsList) {
      return;
    }

    // Scroll down in smaller increments
    const totalHeight = jobsList.scrollHeight;
    const increment = Math.floor(totalHeight / 4);

    for (let i = 0; i <= totalHeight; i += increment) {
      jobsList.scrollTo(0, i);
      await this.sleep(500);
    }

    // Scroll back to top
    jobsList.scrollTo(0, 0);
    await this.sleep(1000);
  }

  async scrollAndWaitForNewJobs() {
    const jobsList = document.querySelector(".jobs-search-results-list");

    if (!jobsList) {
      return false;
    }

    const previousHeight = jobsList.scrollHeight;
    const previousJobCount = document.querySelectorAll(
      ".jobs-search-results-list [data-occludable-job-id]"
    ).length;

    // Scroll in smaller increments
    const currentScroll = jobsList.scrollTop;
    const targetScroll = currentScroll + window.innerHeight * 0.75;

    jobsList.scrollTo({
      top: targetScroll,
      behavior: "smooth",
    });

    // Wait for potential loading
    await this.sleep(2000);

    // Check for new content
    const newHeight = jobsList.scrollHeight;
    const newJobCount = document.querySelectorAll(
      ".jobs-search-results-list [data-occludable-job-id]"
    ).length;

    console.log(
      `Scroll check - Previous jobs: ${previousJobCount}, New jobs: ${newJobCount}`
    );

    return newHeight > previousHeight || newJobCount > previousJobCount;
  }

  isElementInViewport(element) {
    const rect = element.getBoundingClientRect();
    return (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <=
        (window.innerHeight || document.documentElement.clientHeight) &&
      rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );
  }
}

//handleFileQuestion

Element.prototype.isVisible = function () {
  return (
    window.getComputedStyle(this).display !== "none" &&
    window.getComputedStyle(this).visibility !== "hidden" &&
    this.offsetParent !== null
  );
};
// Initialize and start the application
const linkedInJobApply = new LinkedInJobApply();
// linkedInJobApply
//   .init()
//   .then(() => console.log("LinkedIn Job Apply script initialized"))
//   .catch((error) =>
//     console.error("Error initializing LinkedIn Job Apply script:", error)
//   );
