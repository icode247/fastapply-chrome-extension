import { StateManager } from "@shared/stateManager";
import { canApplyMore } from "@shared/checkAuthorization";
import { HOST } from "@shared/constants";

class MonsterJobAutomation {
  constructor() {
    this.userData = null;
    this.isRunning = false;
    this.currentJobIndex = 0;
    this.startTime = new Date();
    this.stateManager = new StateManager();
    this.submittedLinks = [];
    this.jobsToApply = [];

    this.CONFIG = {
      SELECTORS: {
        JOB_CARDS: ".results-card",
        JOB_TITLE: ".job-cardstyle__JobCardTitle-sc-1mbmxes-2",
        COMPANY_NAME: ".name",
        LOCATION: ".location",
        APPLY_BUTTON:
          "a.card-header-actions-action, a[data-testid='applyButton']",
        FORM_FIELDS: "input, select, textarea",
        RESUME_INPUT: "input[type='file'][accept*='pdf'], input[type='file']",
        SUBMIT_BUTTON: "button[type='submit'], button.apply-button",
        NEXT_BUTTON: "button.next, button[data-testid='next']",
        SUCCESS_MESSAGE: ".success-message, .thank-you-message",
      },
      TIMEOUTS: {
        STANDARD: 2000,
        EXTENDED: 5000,
        MAX_TIMEOUT: 300000, // 5 minutes
      },
    };

    console.log("MonsterJobAutomation initialized");

    // Set up event listeners for window message passing
    window.addEventListener("message", this.handleWindowMessage.bind(this));
  }

  handleWindowMessage(event) {
    // Handle intercepted URLs from window.open override
    if (event.data && event.data.type === "INTERCEPTED_URL") {
      console.log("Content script received intercepted URL:", event.data.url);
      chrome.runtime.sendMessage({
        action: "interceptedURL",
        url: event.data.url,
      });
    }
  }

  async handleMessage(message, sender, sendResponse) {
    console.log("Monster content script received message:", message);

    try {
      switch (message.action) {
        case "initializeSearch":
          await this.initialize(message.userId, message.jobsToApply);
          sendResponse({ status: "initialized" });

          // If we're on the Monster search page, start processing job listings
          if (
            window.location.hostname.includes("monster.com") &&
            window.location.href.includes("/jobs/search")
          ) {
            await this.processJobListings();
          }
          break;

        case "processJobs":
          await this.processJobs(message.jobsToApply);
          sendResponse({ status: "processing" });
          break;

        case "fillApplicationForm":
          await this.fillApplicationForm(message.jobData);
          sendResponse({ status: "processing" });
          break;

        case "stop":
          this.stop();
          sendResponse({ status: "stopped" });
          break;

        case "navigationComplete":
          // If we're on an external application page, handle it
          await this.handleExternalApplicationPage(message.url);
          sendResponse({ status: "processed" });
          break;
      }
    } catch (error) {
      console.error("Error in Monster content script:", error);
      sendResponse({ status: "error", message: error.message });
    }

    return true;
  }

  async initialize(userId, jobsToApply) {
    try {
      this.isRunning = true;
      this.jobsToApply = jobsToApply || [];

      // Load user data
      const userDetails = await this.fetchUserDetailsFromBackend(userId);

      // Save initial state
      await this.stateManager.saveState({
        userId,
        userDetails,
        preferences: userDetails.jobPreferences || {},
        availableCredits: userDetails.credits || 0,
        applicationsUsed: userDetails.applicationsUsed || 0,
        userRole: userDetails.plan,
        isProcessing: true,
        currentJobIndex: 0,
        submittedLinks: [],
      });

      this.userData = userDetails;

      this.sendStatusUpdate(
        "initialized",
        "Monster automation initialized successfully"
      );
    } catch (error) {
      console.error("Initialization error:", error);
      this.sendStatusUpdate("error", "Failed to initialize: " + error.message);
      throw error;
    }
  }

  async fetchUserDetailsFromBackend(userId) {
    try {
      const response = await fetch(`${HOST}/api/user/${userId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch user details: ${response.statusText}`);
      }
      const data = await response.json();
      if (!data) throw new Error("No user data received from backend");
      return data;
    } catch (error) {
      console.error("Error fetching user details:", error);
      throw new Error("Error fetching user data: " + error.message);
    }
  }

  async processJobListings() {
    try {
      this.sendStatusUpdate("searching", "Processing job listings");

      // Wait for job cards to load
      await this.waitForElement(this.CONFIG.SELECTORS.JOB_CARDS);

      // Find all job cards
      const jobCards = document.querySelectorAll(
        this.CONFIG.SELECTORS.JOB_CARDS
      );
      console.log(`Found ${jobCards.length} job listings`);

      if (jobCards.length === 0) {
        this.sendStatusUpdate("complete", "No jobs found");
        return;
      }

      // Get current state to check limits
      const state = await this.stateManager.getState();
      if (!(await canApplyMore(state))) {
        this.sendStatusUpdate("error", "Application limit reached");
        return;
      }

      // Start applying to jobs
      this.sendStatusUpdate("applying", `Starting to apply to jobs`);

      // Process each job card
      for (let i = 0; i < jobCards.length; i++) {
        if (!this.isRunning) break;

        const card = jobCards[i];
        await this.processJobCard(card);

        // Delay between jobs
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      this.sendStatusUpdate("complete", "All jobs processed");
    } catch (error) {
      console.error("Error processing job listings:", error);
      this.sendStatusUpdate(
        "error",
        "Failed to process job listings: " + error.message
      );
    }
  }

  async processJobCard(card) {
    try {
      // Extract job details
      const title =
        card.querySelector(this.CONFIG.SELECTORS.JOB_TITLE)?.textContent ||
        "Unknown Position";
      const company =
        card.querySelector(this.CONFIG.SELECTORS.COMPANY_NAME)?.textContent ||
        "Unknown Company";
      const location =
        card.querySelector(this.CONFIG.SELECTORS.LOCATION)?.textContent ||
        "Unknown Location";

      const jobData = {
        title,
        company,
        location,
        url: window.location.href,
      };

      console.log(`Processing job: ${title} at ${company}`);

      // Check if already applied
      const state = await this.stateManager.getState();
      if (state.submittedLinks.includes(window.location.href)) {
        console.log("Already applied to this job, skipping");
        return;
      }

      // Update state with current job
      await this.stateManager.updateState({
        currentJob: jobData,
      });

      // Find and click the apply button
      const applyButton = card.querySelector(
        this.CONFIG.SELECTORS.APPLY_BUTTON
      );
      if (!applyButton) {
        console.log("No apply button found, skipping");
        return;
      }

      this.sendStatusUpdate("applying", `Applying to ${title} at ${company}`);

      // Click the apply button - this will trigger window.open which we've overridden
      applyButton.click();

      // At this point, the background script will handle the new window/tab
      // and will navigate to the job application page
    } catch (error) {
      console.error("Error processing job card:", error);
    }
  }

  async handleExternalApplicationPage(url) {
    try {
      // Get current job from state
      const state = await this.stateManager.getState();
      const jobData = state.currentJob || {
        title: "Unknown Position",
        company: "Unknown Company",
        location: "Unknown Location",
        url: url || window.location.href,
      };

      // Update the URL in job data
      jobData.url = url || window.location.href;

      this.sendStatusUpdate("filling", "Handling external application page");

      // Check what kind of page we're on and handle accordingly
      if (this.isGenericApplicationForm()) {
        await this.fillApplicationForm(jobData);
      } else {
        // If it's not a recognizable form, log as external
        this.sendStatusUpdate(
          "external",
          "Redirected to external application site"
        );
        await this.logApplication(
          jobData,
          "external",
          "External application site"
        );

        // Close this tab after a delay
        setTimeout(() => {
          window.close();
        }, 5000);
      }
    } catch (error) {
      console.error("Error handling external application page:", error);
      this.sendStatusUpdate(
        "error",
        "Failed to handle application page: " + error.message
      );
    }
  }

  isGenericApplicationForm() {
    // Check if this looks like a standard application form
    const formElements = document.querySelectorAll(
      this.CONFIG.SELECTORS.FORM_FIELDS
    );
    const resumeInput = document.querySelector(
      this.CONFIG.SELECTORS.RESUME_INPUT
    );
    const submitButton = document.querySelector(
      this.CONFIG.SELECTORS.SUBMIT_BUTTON
    );

    return formElements.length > 3 || (resumeInput && submitButton);
  }

  async fillApplicationForm(jobData) {
    try {
      const state = await this.stateManager.getState();
      const profile = state.userDetails;

      // Mark that we're filling an application
      await this.stateManager.updateState({
        pendingApplication: true,
      });

      this.sendStatusUpdate("filling", "Filling application form");

      // Process all form inputs
      const formFields = document.querySelectorAll(
        this.CONFIG.SELECTORS.FORM_FIELDS
      );

      for (const field of formFields) {
        if (!this.isElementVisible(field)) continue;

        const label = this.getFieldLabel(field);
        const value = this.getValueForField(label, profile);

        if (value) {
          await this.fillFormField(field, value);
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }

      // Handle resume upload if present
      const resumeInput = document.querySelector(
        this.CONFIG.SELECTORS.RESUME_INPUT
      );
      if (resumeInput && profile.resumeUrl) {
        await this.uploadFile(resumeInput, profile.resumeUrl, "resume.pdf");
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }

      // Submit the form
      const submitButton = document.querySelector(
        this.CONFIG.SELECTORS.SUBMIT_BUTTON
      );
      if (submitButton) {
        this.sendStatusUpdate("submitting", "Submitting application");
        submitButton.click();

        // Wait for confirmation
        try {
          await this.waitForElement(
            this.CONFIG.SELECTORS.SUCCESS_MESSAGE,
            10000
          );

          // Log successful application
          await this.logApplication(jobData);

          this.sendStatusUpdate(
            "success",
            "Application submitted successfully"
          );
        } catch (error) {
          // Check if there's a "next" button (multi-step form)
          const nextButton = document.querySelector(
            this.CONFIG.SELECTORS.NEXT_BUTTON
          );
          if (nextButton) {
            nextButton.click();
            await new Promise((resolve) => setTimeout(resolve, 3000));

            // Continue with next step
            await this.fillApplicationForm(jobData);
          } else {
            // Assume success if no error messages are visible
            await this.logApplication(jobData);
            this.sendStatusUpdate(
              "success",
              "Application likely submitted (no confirmation)"
            );
          }
        }
      } else {
        this.sendStatusUpdate("warning", "No submit button found");
      }

      // Mark that we're done with this application
      await this.stateManager.updateState({
        pendingApplication: false,
      });

      // Close the tab after a delay
      setTimeout(() => {
        window.close();
      }, 5000);
    } catch (error) {
      console.error("Error filling application form:", error);
      this.sendStatusUpdate(
        "error",
        "Failed to fill application form: " + error.message
      );

      // Mark that we're done with this application (even though it failed)
      await this.stateManager.updateState({
        pendingApplication: false,
      });

      // Close the tab after a delay
      setTimeout(() => {
        window.close();
      }, 5000);
    }
  }

  async fillFormField(field, value) {
    try {
      field.focus();

      // Handle different field types
      switch (field.type) {
        case "select-one":
          this.handleSelectField(field, value);
          break;

        case "checkbox":
          if (value === "Yes" || value === true || value === "true") {
            if (!field.checked) {
              field.click();
            }
          }
          break;

        case "radio":
          if (
            field.value.toLowerCase() === value.toLowerCase() ||
            field.parentElement.textContent
              .toLowerCase()
              .includes(value.toLowerCase())
          ) {
            field.click();
          }
          break;

        default:
          field.value = value;
          field.dispatchEvent(new Event("input", { bubbles: true }));
          field.dispatchEvent(new Event("change", { bubbles: true }));
          break;
      }
    } catch (error) {
      console.error(`Error filling form field:`, error);
    }
  }

  handleSelectField(selectElement, value) {
    try {
      // Get all options
      const options = Array.from(selectElement.options);

      // Find best match
      let selectedIndex = -1;

      // Try exact match first
      selectedIndex = options.findIndex(
        (option) =>
          option.text.toLowerCase().trim() === value.toLowerCase().trim() ||
          option.value.toLowerCase().trim() === value.toLowerCase().trim()
      );

      // If no exact match, try partial match
      if (selectedIndex === -1) {
        selectedIndex = options.findIndex(
          (option) =>
            option.text.toLowerCase().includes(value.toLowerCase()) ||
            option.value.toLowerCase().includes(value.toLowerCase())
        );
      }

      // If still no match, try partial word match
      if (selectedIndex === -1) {
        const words = value.toLowerCase().split(" ");
        selectedIndex = options.findIndex((option) =>
          words.some((word) => option.text.toLowerCase().includes(word))
        );
      }

      // If a match was found, select it
      if (selectedIndex !== -1) {
        selectElement.selectedIndex = selectedIndex;
        selectElement.dispatchEvent(new Event("change", { bubbles: true }));
      }
    } catch (error) {
      console.error("Error handling select field:", error);
    }
  }

  getFieldLabel(field) {
    // Try to get label from associated label element
    const id = field.id;
    if (id) {
      const labelElement = document.querySelector(`label[for="${id}"]`);
      if (labelElement) {
        return labelElement.textContent.trim();
      }
    }

    // Try to get label from parent label element
    const parentLabel = field.closest("label");
    if (parentLabel) {
      return parentLabel.textContent.trim();
    }

    // Try to get label from placeholder
    if (field.placeholder) {
      return field.placeholder;
    }

    // Try to get label from aria-label
    if (field.getAttribute("aria-label")) {
      return field.getAttribute("aria-label");
    }

    // Try to get label from nearby elements
    const parentDiv = field.parentElement;
    if (parentDiv) {
      const labelElement = parentDiv.querySelector(
        "label, .label, .field-label"
      );
      if (labelElement) {
        return labelElement.textContent.trim();
      }
    }

    // Return field name as fallback
    if (field.name) {
      return field.name.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
    }

    return "";
  }

  getValueForField(label, profile) {
    if (!label) return "";

    const normalizedLabel = label.toLowerCase().trim();

    // Map field labels to profile values
    const fieldMappings = {
      "first name": profile.firstName,
      "last name": profile.lastName,
      "full name": `${profile.firstName} ${profile.lastName}`,
      name: `${profile.firstName} ${profile.lastName}`,
      email: profile.email,
      phone: profile.phone,
      resume: null, // Handled separately
      linkedin: profile.linkedinUrl || "",
      "linkedin url": profile.linkedinUrl || "",
      website: profile.websiteUrl || "",
      "personal website": profile.websiteUrl || "",
      github: profile.githubUrl || "",
      "github url": profile.githubUrl || "",
      "cover letter": profile.coverLetter || "",
      message: profile.coverLetter || "",
      introduction: profile.coverLetter || "",
      "current company": profile.currentCompany || "",
      company: profile.currentCompany || "",
      location: profile.location || "",
      address: profile.address || "",
      city: profile.city || "",
      country: profile.country || "",
      "work authorization": "Yes",
      authorized: "Yes",
      "visa sponsorship": profile.visaSponsorship ? "Yes" : "No",
      sponsorship: profile.visaSponsorship ? "Yes" : "No",
      salary: "60000", // Default value
      "expected salary": "60000", // Default value
      "notice period": "2 weeks", // Default value
      "start date": "2 weeks", // Default value
      "work experience": profile.workExperience || "3 years",
      experience: profile.workExperience || "3 years",
    };

    // Check for exact matches
    for (const [key, value] of Object.entries(fieldMappings)) {
      if (normalizedLabel === key || normalizedLabel.includes(key)) {
        return value;
      }
    }

    // Generic fallback for common patterns
    if (normalizedLabel.includes("name") && normalizedLabel.includes("first")) {
      return profile.firstName;
    }

    if (normalizedLabel.includes("name") && normalizedLabel.includes("last")) {
      return profile.lastName;
    }

    // For fields we don't have a mapping for, return a default value based on field type
    if (
      normalizedLabel.includes("agree") ||
      normalizedLabel.includes("terms")
    ) {
      return "Yes"; // For agreement checkboxes
    }

    return "";
  }

  async uploadFile(inputElement, fileUrl, fileName) {
    try {
      if (!fileUrl) {
        console.log("No file URL provided");
        return false;
      }

      // Fetch the file
      const response = await fetch(fileUrl);
      const blob = await response.blob();

      // Create a File object
      const file = new File([blob], fileName, { type: "application/pdf" });

      // Create a DataTransfer to set the file
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);

      // Set the file on the input element
      inputElement.files = dataTransfer.files;

      // Dispatch change event
      inputElement.dispatchEvent(new Event("change", { bubbles: true }));

      return true;
    } catch (error) {
      console.error("Error uploading file:", error);
      return false;
    }
  }

  isElementVisible(element) {
    if (!element) return false;

    const style = window.getComputedStyle(element);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      element.offsetWidth > 0 &&
      element.offsetHeight > 0
    );
  }

  async waitForElement(selector, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      const checkInterval = setInterval(() => {
        const element = document.querySelector(selector);

        if (element) {
          clearInterval(checkInterval);
          resolve(element);
        }

        if (Date.now() - startTime > timeout) {
          clearInterval(checkInterval);
          reject(
            new Error(`Element '${selector}' not found within ${timeout}ms`)
          );
        }
      }, 100);
    });
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

  async logApplication(jobData, status = "completed", error = null) {
    try {
      const state = await this.stateManager.getState();
      const userId = state.userId;

      // Track submitted URL
      this.submittedLinks.push(jobData.url);

      // Update application count
      await this.updateApplicationCount(userId);

      // Save application details
      const applicationData = {
        userId: userId,
        jobId: jobData.id || Date.now().toString(),
        title: jobData.title || "Unknown Position",
        company: jobData.company || "Unknown Company",
        location: jobData.location || "Unknown Location",
        jobUrl: jobData.url || window.location.href,
        platform: "monster",
        status: status,
        appliedDate: new Date().toISOString(),
      };

      const response = await fetch(`${HOST}/api/applied-jobs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(applicationData),
      });

      if (!response.ok) {
        throw new Error(`Failed to save applied job: ${response.statusText}`);
      }

      // Update state
      await this.stateManager.updateState({
        submittedLinks: this.submittedLinks,
        applicationCount: (state.applicationCount || 0) + 1,
        lastActionTime: new Date().toISOString(),
      });

      // Send message about application completion
      chrome.runtime.sendMessage({
        action: "applicationComplete",
        status: status,
        jobData: applicationData,
      });

      return true;
    } catch (error) {
      console.error("Error logging application:", error);

      // Still try to notify about the error
      chrome.runtime.sendMessage({
        action: "applicationError",
        error: error.message,
        jobData: jobData,
      });

      return false;
    }
  }

  async processJobs(jobsToApply) {
    this.jobsToApply = jobsToApply || [];
    this.isRunning = true;

    if (window.location.hostname.includes("monster.com")) {
      if (window.location.href.includes("/jobs/search")) {
        await this.processJobListings();
      } else {
        await this.handleExternalApplicationPage();
      }
    }
  }

  async stop() {
    this.isRunning = false;
    await this.stateManager.updateState({
      isProcessing: false,
      lastActionTime: new Date().toISOString(),
    });
    this.sendStatusUpdate("stopped", "Automation stopped");
  }

  sendStatusUpdate(status, message) {
    console.log(`Status update: ${status} - ${message}`);
    chrome.runtime.sendMessage({
      action: "statusUpdate",
      status: status,
      message: message,
      platform: "monster",
      timestamp: new Date().toISOString(),
    });
  }
}

// Initialize the automation handler
const monsterAutomation = new MonsterJobAutomation();

// Set up message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  monsterAutomation.handleMessage(message, sender, sendResponse);
  return true;
});

// Listen for page load events
document.addEventListener("DOMContentLoaded", () => {
  console.log("Monster content script loaded on:", window.location.href);

  // Signal that the page is loaded
  chrome.runtime.sendMessage({
    action: "pageLoaded",
    url: window.location.href,
    platform: "monster",
  });
});
