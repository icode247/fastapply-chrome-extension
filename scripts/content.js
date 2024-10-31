class StateManager {
  constructor() {
    this.storageKey = "linkedInJobApplyState";
  }

  async saveState(state) {
    try {
      await chrome.storage.local.set({
        [this.storageKey]: state,
      });
      console.log("State saved successfully:", state);
    } catch (error) {
      console.error("Error saving state:", error);
    }
  }

  async getState() {
    try {
      const result = await chrome.storage.local.get([this.storageKey]);
      return result[this.storageKey] || null;
    } catch (error) {
      console.error("Error getting state:", error);
      return null;
    }
  }

  async updateState(partialState) {
    try {
      const currentState = (await this.getState()) || {};
      const newState = { ...currentState, ...partialState };
      await this.saveState(newState);
      return newState;
    } catch (error) {
      console.error("Error updating state:", error);
      return null;
    }
  }

  async clearState() {
    try {
      await chrome.storage.local.remove(this.storageKey);
      console.log("State cleared successfully");
    } catch (error) {
      console.error("Error clearing state:", error);
    }
  }
}
class LinkedInJobApply {
  constructor() {
    this.stateManager = new StateManager();
    this.HOST = "http://localhost:3000";
    // Remove instance variables that should be managed by state
    this.initializeState();
  }

  async restoreState() {
    const state = await this.stateManager.getState();
    if (state && state.userId) {
      // Refresh user details and preferences if we have a userId
      await this.fetchUserDetailsFromBackend(state.userId);
      await this.checkUserRole(state.userId);
    }
  }
  async initializeState() {
    const state = await this.stateManager.getState();
    if (!state) {
      // Set initial state
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
      await this.initializeState();
      this.setupMessageListener();
      await this.checkAndHandleLoginPage();
      await this.restoreState();
      console.log("LinkedIn Job Apply script initialized successfully");
    } catch (error) {
      console.error("Error initializing LinkedIn Job Apply script:", error);
      throw error;
    }
  }
  setupMessageListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      console.log("Message received:", request);
      switch (request.action) {
        case "startJobSearch":
          this.startJobSearch(request.userId)
            .then(sendResponse)
            .catch((error) =>
              sendResponse({ status: "error", message: error.message })
            );
          return true; // Keep the message channel open for async response

        case "processJobs":
          this.processJobs()
            .then(() => sendResponse({ status: "completed" }))
            .catch((error) =>
              sendResponse({ status: "error", message: error.message })
            );
          return true;

        default:
          sendResponse({ status: "error", message: "Unknown action" });
          return false;
      }
    });
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

    // Fallback to data attribute if exists
    return jobCard.dataset.jobId || null;
  }
  async processJobCard(jobCard, state) {
    try {
      const jobId = this.getJobIdFromCard(jobCard);
      if (!jobId) {
        console.log("Could not find job ID, skipping");
        return false;
      }

      // Check if already applied before clicking
      if (await this.checkIfAlreadyApplied(jobId, state.userId)) {
        console.log(`Already applied to job: ${jobId}. Skipping.`);
        return false;
      }

      await this.clickJobCard(jobCard);
      await this.waitForJobDetailsLoad();

      const jobDetails = await this.getJobProperties();
      console.log("Processing job:", jobDetails.title);

      const applyButton = await this.findEasyApplyButton();
      if (!applyButton) {
        console.log("No Easy Apply button found. Skipping this job.");
        return false;
      }

      const success = await this.applyToJob(applyButton, jobDetails);
      if (success) {
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
        await this.checkUserRole(state.userId);
        console.log(`Successfully applied to job: ${jobDetails.jobId}`);
        return true;
      }
      return false;
    } catch (error) {
      console.error(`Error processing job card: ${error.message}`);
      return false;
    }
  }
  async scrollAndWaitForNewJobs() {
    const jobsList = document.querySelector(".jobs-search-results-list");
    if (!jobsList) return false;

    const previousHeight = jobsList.scrollHeight;
    jobsList.scrollTo(0, jobsList.scrollHeight);

    // Wait for new content to load
    await this.sleep(2000);

    // Check if we got new content
    return jobsList.scrollHeight > previousHeight;
  }
  async processJobs() {
    console.log("Starting to process jobs from search results");
    let appliedJobs = 0;
    let processedJobs = new Set(); // Track processed jobs to avoid duplicates

    try {
      const state = await this.stateManager.getState();
      if (!state || !state.userId) {
        throw new Error("No user state found. Please restart the job search.");
      }

      await this.waitForSearchResultsLoad();
      while (true) {
        // Continue until we can't find more jobs or reach limits
        const jobCards = await this.getJobCards();
        let newJobsFound = false;

        for (const jobCard of jobCards) {
          const jobId = this.getJobIdFromCard(jobCard);
          if (!jobId || processedJobs.has(jobId)) {
            continue; // Skip if already processed or invalid
          }
          processedJobs.add(jobId);
          newJobsFound = true;

          try {
            const success = await this.processJobCard(jobCard, state);
            if (success) appliedJobs++;
          } catch (error) {
            console.error("Error processing job:", error);
            continue; // Continue with next job even if this one fails
          }

          await this.sleep(3000);
        }

        if (!newJobsFound || !(await this.scrollAndWaitForNewJobs())) {
          break; // Exit if no new jobs or can't scroll further
        }
      }
    } catch (error) {
      console.error("Error in processJobs:", error);
    }

    console.log(`Finished processing jobs. Applied to ${appliedJobs} jobs`);
    this.sendStatusUpdate("success", `Applied to ${appliedJobs} jobs`);
    return { status: "completed", message: `Applied to ${appliedJobs} jobs` };
  }

  async waitForSearchResultsLoad() {
    console.log("Waiting for search results to load...");
    await this.waitForElement(".jobs-search-results-list");
    console.log("Search results loaded");
  }

  async getJobCards() {
    const jobCards = document.querySelectorAll(
      ".jobs-search-results__list-item"
    );
    console.log(`Found ${jobCards.length} job cards`);
    return jobCards;
  }

  async clickJobCard(jobCard) {
    // Try multiple selectors to find clickable element
    const selectors = [
      "a[href*='jobs/view']",
      ".job-card-list__title",
      ".job-card-container__link",
      ".jobs-search-results__list-item a",
      "[data-control-name='job_card_click']",
    ];

    for (const selector of selectors) {
      const clickableElement = jobCard.querySelector(selector);
      if (clickableElement) {
        try {
          clickableElement.click();
          await this.waitForJobDetailsLoad();
          return;
        } catch (error) {
          console.log(`Click failed for selector ${selector}, trying next...`);
        }
      }
    }

    // If we get here, we couldn't find any clickable elements
    throw new Error("No clickable element found in job card");
  }

  async waitForJobDetailsLoad() {
    try {
      await this.waitForElement(
        ".job-details-jobs-unified-top-card__job-title",
        10000
      );
      // Add small delay to ensure content is fully loaded
      await this.sleep(1000);
    } catch (error) {
      throw new Error("Job details failed to load");
    }
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
    console.log({
      jobId,
      title: jobTitle,
      company,
      salary,
      location,
      postedDate: postedDate || "Unknown Date",
      applicants: applicants || "Unknown Applicants",
    });
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
      await this.waitForElement(".jobs-easy-apply-content");

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
        console.error("Maximum steps reached - something might be wrong");
        return false;
      }

      await this.saveAppliedJob(jobDetails);
      return true;
    } catch (error) {
      console.error("Error in applyToJob:", error);
      await this.handleErrorState();
      return false;
    }
  }
  // Add this method to your class if it doesn't exist already
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
      await this.checkUserRole(userId);

      const state = await this.stateManager.getState();
      console.log("preference", state.preferences);
      if (!this.canApplyMore(state)) {
        this.sendStatusUpdate(
          "error",
          "Application limit reached or insufficient credits."
        );
        return { status: "error", message: "Cannot apply more" };
      }

      const searchUrl = await this.generateComprehensiveSearchUrl(
        state.preferences
      );

      return {
        status: "ready",
        url: searchUrl,
        userId: userId,
      };
    } catch (error) {
      console.error("Error in startJobSearch:", error);
      this.sendStatusUpdate(
        "error",
        "Error starting job search: " + error.message
      );
      throw error;
    }
  }

  async generateComprehensiveSearchUrl(preferences) {
    const baseUrl = "https://www.linkedin.com/jobs/search/?";

    // Helper function to join array values with OR operator
    const joinWithOR = (arr) => (arr ? arr.join(" OR ") : "");

    // Map experience levels to LinkedIn parameters
    const experienceLevelMap = {
      "Entry Level": "1",
      "Mid-Senior Level": "2,3",
      Director: "4",
      Executive: "5",
    };

    // Map job types to LinkedIn parameters
    const jobTypeMap = {
      "Full-time": "F",
      "Part-time": "P",
      Contract: "C",
      Temporary: "T",
      Internship: "I",
      Volunteer: "V",
    };

    // Map work modes to LinkedIn parameters
    const workModeMap = {
      Remote: "1",
      Hybrid: "2",
      "On-Site": "3",
    };

    // Map date posted to LinkedIn parameters
    const datePostedMap = {
      "Past 24 hours": "1",
      "Past week": "7",
      "Past month": "30",
    };

    const params = new URLSearchParams({
      keywords: joinWithOR(preferences.positions),
      location: joinWithOR(preferences.location),
      f_AL: "true", // Easy apply
    });

    // Handle experience levels
    if (preferences.experience?.length) {
      const experienceCodes = preferences.experience
        .map((level) => experienceLevelMap[level])
        .filter(Boolean)
        .join(",");
      if (experienceCodes) params.append("f_E", experienceCodes);
    }

    // Handle job types
    if (preferences.jobType?.length) {
      const jobTypeCodes = preferences.jobType
        .map((type) => jobTypeMap[type])
        .filter(Boolean)
        .join(",");
      if (jobTypeCodes) params.append("f_JT", jobTypeCodes);
    }

    // Handle work modes
    if (preferences.workMode?.length) {
      const workModeCodes = preferences.workMode
        .map((mode) => workModeMap[mode])
        .filter(Boolean)
        .join(",");
      if (workModeCodes) params.append("f_WT", workModeCodes);
    }

    // Handle date posted
    if (preferences.datePosted) {
      const datePostedCode = datePostedMap[preferences.datePosted];
      if (datePostedCode) params.append("f_TPR", datePostedCode);
    }

    // Handle salary range
    if (preferences.salary?.length === 2) {
      const [min, max] = preferences.salary;
      params.append("f_SB2", `${min},${max}`);
    }

    // Handle companies
    if (preferences.company?.length) {
      params.append("f_C", preferences.company.join(","));
    }

    // Handle industries
    if (preferences.industry?.length) {
      // You might need to map these to LinkedIn's industry codes
      params.append("f_I", preferences.industry.join(","));
    }

    return baseUrl + params.toString();
  }
  getSortByParam(sortBy) {
    const sortMap = {
      "Most relevant": "R",
      "Most recent": "DD",
    };
    return sortMap[sortBy] || "R";
  }

  getExperienceLevelParam(levels) {
    const levelMap = {
      Internship: "1",
      "Entry level": "2",
      Associate: "3",
      "Mid-Senior level": "4",
      Director: "5",
      Executive: "6",
    };
    return levels
      .map((level) => levelMap[level] || "")
      .filter(Boolean)
      .join(",");
  }

  getJobTypeParam(jobTypes) {
    const jobTypeMap = {
      "Full-time": "F",
      "Part-time": "P",
      Contract: "C",
      Temporary: "T",
      Volunteer: "V",
      Internship: "I",
      Other: "O",
    };
    return jobTypes
      .map((type) => jobTypeMap[type] || "")
      .filter(Boolean)
      .join(",");
  }

  getWorkplaceTypeParam(workplaceTypes) {
    console.log(workplaceTypes);
    const workplaceTypeMap = {
      "On-site": "1",
      Remote: "2",
      Hybrid: "3",
    };
    return workplaceTypes
      ?.map((type) => workplaceTypeMap[type] || "")
      .filter(Boolean)
      .join(",");
  }

  getDatePostedParam(datePosted) {
    const dateMap = {
      "Past 24 hours": "r86400",
      "Past week": "r604800",
      "Past month": "r2592000",
      "Any time": "",
    };
    return dateMap[datePosted] || "";
  }

  getSalaryParam(salary) {
    const salaryRanges = {
      "$40,000+": "1",
      "$60,000+": "2",
      "$80,000+": "3",
      "$100,000+": "4",
      "$120,000+": "5",
      "$140,000+": "6",
      "$160,000+": "7",
      "$180,000+": "8",
      "$200,000+": "9",
      // Adding more granular options
      "Under $40,000": "0",
      "$40,000 - $60,000": "1,2",
      "$60,000 - $80,000": "2,3",
      "$80,000 - $100,000": "3,4",
      "$100,000 - $120,000": "4,5",
      "$120,000 - $140,000": "5,6",
      "$140,000 - $160,000": "6,7",
      "$160,000 - $180,000": "7,8",
      "$180,000 - $200,000": "8,9",
    };
    return salaryRanges[salary] || "";
  }

  getIndustryParam(industries) {
    const industryMap = {
      Accounting: "47",
      "Airlines/Aviation": "94",
      "Alternative Dispute Resolution": "120",
      Animation: "125",
      "Apparel & Fashion": "3",
      "Architecture & Planning": "5",
      "Arts and Crafts": "6",
      Automotive: "7",
      "Aviation & Aerospace": "8",
      Banking: "9",
      Biotechnology: "10",
      "Broadcast Media": "11",
      "Building Materials": "12",
      "Business Supplies and Equipment": "13",
      "Capital Markets": "14",
      Chemicals: "15",
      "Civic & Social Organization": "16",
      "Civil Engineering": "17",
      "Commercial Real Estate": "18",
      "Computer & Network Security": "19",
      "Computer Games": "145",
      "Computer Hardware": "20",
      "Computer Networking": "21",
      "Computer Software": "22",
      Construction: "23",
      "Consumer Electronics": "24",
      "Consumer Goods": "25",
      "Consumer Services": "26",
      Cosmetics: "27",
      Dairy: "28",
      "Defense & Space": "29",
      Design: "30",
      "E-Learning": "31",
      "Education Management": "32",
      "Electrical/Electronic Manufacturing": "33",
      Entertainment: "34",
      "Environmental Services": "35",
      "Events Services": "36",
      "Executive Office": "37",
      "Facilities Services": "38",
      Farming: "39",
      "Financial Services": "40",
      "Fine Art": "41",
      Fishery: "42",
      "Food & Beverages": "43",
      "Food Production": "44",
      "Fund-Raising": "45",
      Furniture: "46",
      "Gambling & Casinos": "48",
      "Glass, Ceramics & Concrete": "49",
      "Government Administration": "50",
      "Government Relations": "51",
      "Graphic Design": "52",
      "Health, Wellness and Fitness": "53",
      "Higher Education": "54",
      "Hospital & Health Care": "55",
      Hospitality: "56",
      "Human Resources": "57",
      "Import and Export": "58",
      "Individual & Family Services": "59",
      "Industrial Automation": "60",
      "Information Services": "61",
      "Information Technology and Services": "62",
      Insurance: "63",
      "International Affairs": "64",
      "International Trade and Development": "65",
      Internet: "66",
      "Investment Banking": "67",
      "Investment Management": "68",
      Judiciary: "69",
      "Law Enforcement": "70",
      "Law Practice": "71",
      "Legal Services": "72",
      "Legislative Office": "73",
      "Leisure, Travel & Tourism": "74",
      Libraries: "75",
      "Logistics and Supply Chain": "76",
      "Luxury Goods & Jewelry": "77",
      Machinery: "78",
      "Management Consulting": "79",
      Maritime: "80",
      "Market Research": "81",
      "Marketing and Advertising": "82",
      "Mechanical or Industrial Engineering": "83",
      "Media Production": "84",
      "Medical Devices": "85",
      "Medical Practice": "86",
      "Mental Health Care": "87",
      Military: "88",
      "Mining & Metals": "89",
      "Motion Pictures and Film": "90",
      "Museums and Institutions": "91",
      Music: "92",
      Nanotechnology: "93",
      Newspapers: "95",
      "Non-Profit Organization Management": "96",
      "Oil & Energy": "97",
      "Online Media": "98",
      "Outsourcing/Offshoring": "99",
      "Package/Freight Delivery": "100",
      "Packaging and Containers": "101",
      "Paper & Forest Products": "102",
      "Performing Arts": "103",
      Pharmaceuticals: "104",
      Philanthropy: "105",
      Photography: "106",
      Plastics: "107",
      "Political Organization": "108",
      "Primary/Secondary Education": "109",
      Printing: "110",
      "Professional Training & Coaching": "111",
      "Program Development": "112",
      "Public Policy": "113",
      "Public Relations and Communications": "114",
      "Public Safety": "115",
      Publishing: "116",
      "Railroad Manufacture": "117",
      Ranching: "118",
      "Real Estate": "119",
      "Recreational Facilities and Services": "121",
      "Religious Institutions": "122",
      "Renewables & Environment": "123",
      Research: "124",
      Restaurants: "126",
      Retail: "127",
      "Security and Investigations": "128",
      Semiconductors: "129",
      Shipbuilding: "130",
      "Sporting Goods": "131",
      Sports: "132",
      "Staffing and Recruiting": "133",
      Supermarkets: "134",
      Telecommunications: "135",
      Textiles: "136",
      "Think Tanks": "137",
      Tobacco: "138",
      "Translation and Localization": "139",
      "Transportation/Trucking/Railroad": "140",
      Utilities: "141",
      "Venture Capital & Private Equity": "142",
      Veterinary: "143",
      Warehousing: "144",
      Wholesale: "145",
      "Wine and Spirits": "146",
      Wireless: "147",
      "Writing and Editing": "148",
    };
    return industries
      .map((industry) => industryMap[industry] || "")
      .filter(Boolean)
      .join(",");
  }

  getJobFunctionParam(jobFunctions) {
    const jobFunctionMap = {
      "Accounting/Auditing": "1",
      Administrative: "2",
      "Arts and Design": "3",
      "Business Development": "4",
      "Community and Social Services": "5",
      Consulting: "6",
      Education: "7",
      Engineering: "8",
      Entrepreneurship: "9",
      Finance: "10",
      "Healthcare Services": "11",
      "Human Resources": "12",
      "Information Technology": "13",
      Legal: "14",
      Marketing: "15",
      "Media and Communication": "16",
      "Military and Protective Services": "17",
      Operations: "18",
      "Product Management": "19",
      "Program and Project Management": "20",
      Purchasing: "21",
      "Quality Assurance": "22",
      "Real Estate": "23",
      Research: "24",
      Sales: "25",
      Support: "26",
    };
    return jobFunctions
      .map((func) => jobFunctionMap[func] || "")
      .filter(Boolean)
      .join(",");
  }

  getBenefitsParam(benefits) {
    const benefitMap = {
      "Medical Insurance": "1",
      "Dental Insurance": "2",
      "Vision Insurance": "3",
      "Life Insurance": "4",
      "Retirement/401(k) Plan": "5",
      "Paid Time Off": "6",
      "Flexible Schedule": "7",
      "Work From Home": "8",
      "Professional Development": "9",
      "Tuition Reimbursement": "10",
      "Employee Discount": "11",
      "Gym Membership": "12",
      "Company Car": "13",
      "Child Care": "14",
      "Relocation Assistance": "15",
      "Stock Options/Equity": "16",
      "Performance Bonus": "17",
      "Commuter Assistance": "18",
      "Employee Assistance Program": "19",
      "Health Savings Account": "20",
      "Disability Insurance": "21",
      "Parental Leave": "22",
      "Adoption Assistance": "23",
      "Pet Insurance": "24",
      "Free Lunch or Snacks": "25",
    };
    return benefits
      .map((benefit) => benefitMap[benefit] || "")
      .filter(Boolean)
      .join(",");
  }

  async navigateToJobSearch(url) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: "navigateToJob", url },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve({ status: "Navigation complete" });
          }
        }
      );
    });
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

  async extractJobLinks() {
    const jobCards = document.querySelectorAll(".job-card-container");
    return Array.from(jobCards)
      .map((card) => {
        const anchor = card.querySelector(".job-card-list__title");
        return anchor ? anchor.href : null;
      })
      .filter(Boolean);
  }

  async navigateToJob(url) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: "navigateToJob", url },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        }
      );
    });
  }

  async waitForJobPageLoad() {
    return new Promise((resolve) => {
      const checkJobPage = () => {
        if (document.querySelector(".jobs-unified-top-card")) {
          console.log("Job page loaded");
          resolve();
        } else {
          setTimeout(checkJobPage, 500);
        }
      };
      checkJobPage();
    });
  }

  isJobDetailsPage() {
    return !!document.querySelector(".jobs-unified-top-card");
  }

  getJobProperties() {
    const title = document.title;
    const [job, company] = title.split(" | ");
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
      ".job-details-jobs-unified-top-card__job-insight"
    );
    const workplace = workplaceElem
      ? workplaceElem.textContent.trim()
      : "Not specified";

    console.log({
      title,
      jobId,
      job,
      company,
      location,
      postedDate,
      applications,
      workplace,
    });
    return {
      title,
      jobId,
      job,
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
        `${this.HOST}/api/applied-jobs?userId=${userId}&jobId=${jobId}`
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

  async fillCurrentStep() {
    // First handle file upload questions as they're more specific
    const fileUploadContainers = document.querySelectorAll(
      ".js-jobs-document-upload__container"
    );

    if (fileUploadContainers.length) {
      console.log("Found file upload fields:", fileUploadContainers.length);
      for (const container of fileUploadContainers) {
        await this.handleFileUpload(container);
      }
    }

    // Then handle regular form questions
    const questions = document.querySelectorAll(
      ".jobs-easy-apply-form-element"
    );
    for (const question of questions) {
      await this.handleQuestion(question);
    }
  }

  // async handleQuestion(question) {
  //   const questionHandlers = {
  //     select: this.handleSelectQuestion,
  //     radio: this.handleRadioQuestion,
  //     text: this.handleTextQuestion,
  //     textarea: this.handleTextAreaQuestion,
  //     checkbox: this.handleCheckboxQuestion,
  //   };

  //   for (const [type, handler] of Object.entries(questionHandlers)) {
  //     const element = question.querySelector(this.getQuestionSelector(type));
  //     if (element) {
  //       await handler.call(this, element);
  //       return;
  //     }
  //   }
  // }

  // getQuestionSelector(type) {
  //   const selectors = {
  //     select: "select",
  //     radio:
  //       'fieldset[data-test-form-builder-radio-button-form-component="true"]',
  //     text: "input[type='text']",
  //     textarea: "textarea",
  //     checkbox: "input[type='checkbox']",
  //     file: "input[type='file']"
  //   };
  //   return selectors[type];
  // }

  // async fillCurrentStep() {
  //   const questions = document.querySelectorAll(
  //     ".jobs-easy-apply-form-element"
  //   );

  //   // First handle regular questions
  //   for (const question of questions) {
  //     // Skip if it's a file upload question
  //     if (!question.querySelector('input[type="file"]')) {
  //       await this.handleQuestion(question);
  //     }
  //   }

  //   // Then handle file upload questions separately
  //   for (const question of questions) {
  //     if (question.querySelector('input[type="file"]')) {
  //       await this.handleFileQuestion(question);
  //     }
  //   }
  // }

  async handleFileUpload(container) {
    try {
      const fileInput = container.querySelector('input[type="file"]');
      if (!fileInput) return;

      // Get the label text to determine what kind of file is needed
      const labelText =
        container.querySelector("label span")?.textContent.toLowerCase() || "";
      const userDetails = await this.getUserDetails();

      if (!userDetails) {
        console.log("No user details available for file upload");
        return;
      }

      // Check what type of document is required
      if (labelText.includes("resume") || labelText.includes("cv")) {
        if (userDetails.resumeUrl) {
          console.log("Uploading resume from:", userDetails.resumeUrl);
          await this.uploadFileFromURL(fileInput, userDetails.resumeUrl);
        } else {
          console.log("No resume URL found in user details");
        }
      } else if (labelText.includes("cover letter")) {
        if (userDetails.coverLetterUrl) {
          console.log(
            "Uploading cover letter from:",
            userDetails.coverLetterUrl
          );
          await this.uploadFileFromURL(fileInput, userDetails.coverLetterUrl);
        } else {
          console.log("No cover letter URL found in user details");
        }
      }
    } catch (error) {
      console.error("Error handling file upload:", error);
    }
  }

  async handleQuestion(question) {
    // Skip if this is a file upload container
    if (question.classList.contains("js-jobs-document-upload__container")) {
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
        return;
      }
    }
  }

  async handleFileQuestion(question) {
    const fileInput = question.querySelector('input[type="file"]');
    if (!fileInput) return;

    const label = this.getQuestionLabel(question);
    const labelText = label.toLowerCase();
    const userDetails = await this.getUserDetails();

    if (!userDetails) {
      console.log("No user details available for file upload");
      return;
    }

    // Determine which file to upload based on the label
    if (labelText.includes("resume") || labelText.includes("cv")) {
      if (userDetails.resumeUrl) {
        console.log("Found resume upload field, attempting upload");
        await this.uploadFileFromURL(fileInput, userDetails.resumeUrl);
      }
    } else if (labelText.includes("cover letter")) {
      if (userDetails.coverLetterUrl) {
        console.log("Found cover letter upload field, attempting upload");
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

  async handleSelectQuestion(select) {
    const label = this.getQuestionLabel(select);
    const options = Array.from(select.options).map((option) => option.text);
    const answer = await this.getAnswer(label, options);
    select.value = answer;
    select.dispatchEvent(new Event("change", { bubbles: true }));
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
    textInput.value = answer;
    textInput.dispatchEvent(new Event("input", { bubbles: true }));
    if (
      label.toLowerCase().includes("city") ||
      label.toLowerCase().includes("location")
    ) {
      await this.sleep(2000);
      textInput.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
      );
      textInput.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
      );
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
    const labelElement = element
      .closest("div, fieldset")
      .querySelector("label, legend");
    return labelElement ? labelElement.textContent.trim() : "Unknown";
  }

  getUserDetails = async () => {
    const result = await chrome.storage.local.get(["userDetails"]);
    console.log(result.userDetails);
    return result.userDetails;
  };

  async getAnswer(label, options = []) {
    const lowerLabel = label.toLowerCase();
    console.log(`Getting answer for label: ${lowerLabel}`);

    // First get the user details once and store them
    const userDetails = await this.getUserDetails();
    console.log("User Details for answers:", userDetails);

    if (!userDetails) {
      console.error("No user details found");
      return options.length > 0 ? options[0] : "";
    }

    const answerMap = [
      {
        keywords: ["first", "name"],
        getValue: () => userDetails.firstName,
      },
      {
        keywords: ["last", "name"],
        getValue: () => userDetails.lastName,
      },
      {
        keywords: ["full", "name"],
        getValue: () => userDetails.fullName,
      },
      {
        keywords: ["email"],
        getValue: () => userDetails.email,
      },
      {
        keywords: ["phone", "number"],
        getValue: () => userDetails.phoneNumber,
      },
      {
        keywords: ["phone", "country", "code"],
        getValue: () => userDetails.phoneCountryCode || "Nigeria (+234)",
      },
      {
        keywords: ["experience", "years"],
        getValue: () => userDetails.yearsOfExperience,
      },
      {
        keywords: ["location"],
        getValue: () => userDetails.currentCity || userDetails.country,
      },
      {
        keywords: ["street", "address"],
        getValue: () => userDetails.street,
      },
      {
        keywords: ["city"],
        getValue: () => userDetails.currentCity,
      },
      {
        keywords: ["state", "province"],
        getValue: () => userDetails.state,
      },
      {
        keywords: ["zip", "postal", "code"],
        getValue: () => userDetails.zipcode,
      },
      {
        keywords: ["country"],
        getValue: () => userDetails.country,
      },
      {
        keywords: ["linkedin"],
        getValue: () => userDetails.linkedIn,
      },
      {
        keywords: ["website", "portfolio"],
        getValue: () => userDetails.website,
      },
      // Education defaults if not in userDetails
      {
        keywords: ["school"],
        getValue: () => userDetails.education?.school || "Uniport",
      },
      {
        keywords: ["degree"],
        getValue: () => userDetails.education?.degree || "Bachelor's",
      },
      {
        keywords: ["major", "field of study"],
        getValue: () => userDetails.education?.major || "Computer Science",
      },
      {
        keywords: ["dates attended", "from"],
        getValue: () => ({
          month: userDetails.educationStartMonth || "January",
          year: userDetails.educationStartYear || "2010",
        }),
      },
      {
        keywords: ["to"],
        getValue: () => ({
          month: userDetails.educationEndMonth || "December",
          year: userDetails.educationEndYear || "2014",
        }),
      },
      {
        keywords: ["headline"],
        getValue: () => userDetails.headline || "Web Developer",
      },
      {
        keywords: ["summary"],
        getValue: () =>
          userDetails.summary ||
          "Experienced web developer with a passion for creating efficient and scalable applications.",
      },
      {
        keywords: ["cover letter"],
        getValue: () =>
          userDetails.coverLetter ||
          "I am writing to express my strong interest in this position...",
      },
      {
        keywords: ["gender", "sex"],
        getValue: () => userDetails.gender || options[0] || "Prefer not to say",
      },
      {
        keywords: ["disability"],
        getValue: () => userDetails.disabilityStatus || "No",
      },
      {
        keywords: ["veteran", "military"],
        getValue: () => userDetails.veteranStatus || "No",
      },
      {
        keywords: ["citizenship", "work authorization"],
        getValue: () => userDetails.usCitizenship || "Yes",
      },
      {
        keywords: ["desired", "salary", "compensation"],
        getValue: () => userDetails.desiredSalary || "Competitive",
      },
      {
        keywords: ["notice", "period"],
        getValue: () => userDetails.noticePeriod || "2 weeks",
      },
      {
        keywords: ["current", "employer"],
        getValue: () => userDetails.recentEmployer || "Current Company",
      },
      {
        keywords: ["proficiency"],
        getValue: () => "Professional",
      },
      {
        keywords: ["scale", "1-10"],
        getValue: () => "8",
      },
      {
        keywords: ["hear", "about", "job"],
        getValue: () => "LinkedIn",
      },
      {
        keywords: ["address"],
        getValue: () => "Nigeria",
      },
    ];

    // Try to find a matching answer
    for (const { keywords, getValue } of answerMap) {
      if (keywords.every((keyword) => lowerLabel.includes(keyword))) {
        try {
          const answer = getValue();
          console.log(`Found match for "${lowerLabel}": `, answer);

          // Handle undefined or null answers
          if (answer === undefined || answer === null) {
            console.log(`Answer was ${answer}, using default`);
            return options.length > 0 ? options[0] : "";
          }

          return answer;
        } catch (error) {
          console.error(`Error getting answer for "${lowerLabel}":`, error);
          return options.length > 0 ? options[0] : "";
        }
      }
    }

    console.log(
      `No specific match found for "${lowerLabel}", using default answer`
    );
    return options.length > 0 ? options[0] : "";
  }
  // async handleDocumentUploads() {
  //   const resumeUpload = document.querySelector(
  //     'input[name="file"][type="file"][accept=".pdf,.doc,.docx"]'
  //   );
  //   if (resumeUpload && this.userDetails.resumeURL) {
  //     await this.uploadFileFromURL(resumeUpload, this.userDetails.resumeURL);
  //   }

  //   const coverLetterUpload = document.querySelector(
  //     'input[name="file"][type="file"][accept=".pdf,.doc,.docx"]'
  //   );
  //   if (coverLetterUpload && this.userDetails.coverLetterURL) {
  //     await this.uploadFileFromURL(
  //       coverLetterUpload,
  //       this.userDetails.coverLetterURL
  //     );
  //   }
  // }

  // async uploadFileFromURL(fileInput, fileURL) {
  //   try {
  //     const response = await fetch(fileURL);
  //     const blob = await response.blob();
  //     const file = new File([blob], "document.pdf", {
  //       type: "application/pdf",
  //     });
  //     const dataTransfer = new DataTransfer();
  //     dataTransfer.items.add(file);
  //     fileInput.files = dataTransfer.files;
  //     fileInput.dispatchEvent(new Event("change", { bubbles: true }));
  //   } catch (error) {
  //     console.error("Error uploading file:", error);
  //   }
  // }

  async handleDocumentUploads() {
    try {
      const state = await this.stateManager.getState();
      const userDetails = await this.getUserDetails();

      if (!userDetails) {
        console.log("No user details found for document upload");
        return;
      }

      // Find resume upload input - try multiple possible selectors
      const resumeSelectors = [
        'input[name="file"][type="file"][accept=".pdf,.doc,.docx"]',
        'input[type="file"][accept*="pdf"]',
        'input[type="file"][name*="resume"]',
        'input[type="file"][name*="cv"]',
        ".jobs-document-upload-input",
        ".jobs-resume-upload-input",
      ];

      let resumeUpload = null;
      for (const selector of resumeSelectors) {
        resumeUpload = document.querySelector(selector);
        if (resumeUpload) break;
      }

      // Look for resume upload by nearby text if selectors fail
      if (!resumeUpload) {
        const inputs = document.querySelectorAll('input[type="file"]');
        for (const input of inputs) {
          const nearbyText = this.getNearbyText(input).toLowerCase();
          if (nearbyText.includes("resume") || nearbyText.includes("cv")) {
            resumeUpload = input;
            break;
          }
        }
      }

      if (resumeUpload && userDetails.resumeUrl) {
        console.log("Found resume upload input, attempting upload");
        await this.uploadFileFromURL(resumeUpload, userDetails.resumeUrl);
      } else {
        console.log("Resume upload input not found or no resume URL available");
      }

      // Similar process for cover letter
      const coverLetterSelectors = [
        'input[type="file"][name*="cover"]',
        'input[type="file"][accept*="pdf"][name*="letter"]',
        ".jobs-cover-letter-upload-input",
      ];

      let coverLetterUpload = null;
      for (const selector of coverLetterSelectors) {
        coverLetterUpload = document.querySelector(selector);
        if (coverLetterUpload) break;
      }

      if (!coverLetterUpload) {
        const inputs = document.querySelectorAll('input[type="file"]');
        for (const input of inputs) {
          const nearbyText = this.getNearbyText(input).toLowerCase();
          if (nearbyText.includes("cover letter")) {
            coverLetterUpload = input;
            break;
          }
        }
      }

      if (coverLetterUpload && userDetails.coverLetterUrl) {
        console.log("Found cover letter upload input, attempting upload");
        await this.uploadFileFromURL(
          coverLetterUpload,
          userDetails.coverLetterUrl
        );
      }
    } catch (error) {
      console.error("Error in handleDocumentUploads:", error);
    }
  }

  getNearbyText(element, maxDepth = 3) {
    let text = "";
    let current = element;
    let depth = 0;

    // Look for text in siblings and parent siblings
    while (current && depth < maxDepth) {
      // Check previous siblings
      let sibling = current.previousElementSibling;
      while (sibling) {
        text += " " + sibling.textContent;
        sibling = sibling.previousElementSibling;
      }

      // Check next siblings
      sibling = current.nextElementSibling;
      while (sibling) {
        text += " " + sibling.textContent;
        sibling = sibling.nextElementSibling;
      }

      // Move up to parent
      current = current.parentElement;
      depth++;
    }

    return text.trim();
  }

  async uploadFileFromURL(fileInput, fileURL) {
    try {
      console.log(`Attempting to upload file from URL: ${fileURL}`);

      const response = await fetch(fileURL);
      if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.statusText}`);
      }

      const blob = await response.blob();
      let filename = "document.pdf";

      // Try to get filename from URL or Content-Disposition header
      const contentDisposition = response.headers.get("content-disposition");
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(
          /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/
        );
        if (filenameMatch && filenameMatch[1]) {
          filename = filenameMatch[1].replace(/['"]/g, "");
        }
      } else {
        const urlParts = fileURL.split("/");
        const urlFilename = urlParts[urlParts.length - 1];
        if (urlFilename && urlFilename.includes(".")) {
          filename = urlFilename;
        }
      }

      const file = new File([blob], filename, {
        type: blob.type || "application/pdf",
      });

      console.log(`Created file object: ${file.name} (${file.type})`);

      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInput.files = dataTransfer.files;

      // Dispatch multiple events to ensure proper handling
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
      fileInput.dispatchEvent(new Event("input", { bubbles: true }));

      // Some applications might need a focus event first
      fileInput.dispatchEvent(new Event("focus", { bubbles: true }));

      console.log("File upload events dispatched");

      // Wait a moment to ensure the upload is processed
      await this.sleep(1000);

      return true;
    } catch (error) {
      console.error("Error uploading file:", error);
      return false;
    }
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
        // Add any other possible button selectors here
      };

      // Wait for any button to appear
      await this.waitForAnyElement(Object.values(buttonSelectors));

      // Check for each button in priority order
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

      // These are modal-related buttons that appear after submission
      if (
        (await this.findAndClickButton(buttonSelectors.dismiss)) ||
        (await this.findAndClickButton(buttonSelectors.done)) ||
        (await this.findAndClickButton(buttonSelectors.close))
      ) {
        await this.sleep(2000);
        return "modal-closed";
      }

      console.log("No actionable buttons found");
      return "error";
    } catch (error) {
      console.error("Error in moveToNextStep:", error);
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
        console.error(`Error clicking button ${selector}:`, error);
        return false;
      }
    }
    return false;
  }

  async handlePostSubmissionModal() {
    try {
      // Wait for the post-submission modal to appear
      await this.sleep(2000); // Give time for the modal to appear

      // Try different selectors for closing the modal
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

      console.log("No modal close button found");
      return false;
    } catch (error) {
      console.error("Error handling post-submission modal:", error);
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

      const response = await fetch(`${this.HOST}/api/applied-jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
  // async saveAppliedJob(jobId) {
  //   try {
  //     const state = await this.stateManager.getState();
  //     if (!state || !state.userId) throw new Error("No user state found");

  //     const response = await fetch(`${this.HOST}/api/applied-jobs`, {
  //       method: "POST",
  //       headers: { "Content-Type": "application/json" },
  //       body: JSON.stringify({ jobId, userId: state.userId }),
  //     });
  //     if (!response.ok) throw new Error("Failed to save applied job");
  //   } catch (error) {
  //     console.error("Error saving applied job:", error);
  //   }
  // }

  async updateApplicationCount(userId) {
    try {
      const response = await fetch(`${this.HOST}/api/applications`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId,
          applicationsUsed: 1, // We increment by 1 for each application
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
  // async updateApplicationCount(userId) {
  //   try {
  //     const response = await fetch(`${this.HOST}/api/applications`, {
  //       method: "POST",
  //       headers: {
  //         "Content-Type": "application/json",
  //       },
  //       body: JSON.stringify({
  //         userId,
  //         applicationsUsed: 1, // We increment by 1 for each application
  //       }),
  //     });

  //     if (!response.ok) {
  //       throw new Error(
  //         `Failed to update application count: ${response.statusText}`
  //       );
  //     }

  //     return true;
  //   } catch (error) {
  //     console.error("Error updating application count:", error);
  //     return false;
  //   }
  // }

  sendStatusUpdate(status, message) {
    chrome.runtime.sendMessage({
      action: "statusUpdate",
      status: status,
      message: message,
    });
  }

  async fetchUserDetailsFromBackend(userId) {
    try {
      const response = await fetch(`${this.HOST}/api/user/${userId}`);
      if (!response.ok) throw new Error("Failed to fetch user details");
      const data = await response.json();
      console.log("userDetails data", data);

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

  async checkUserRole(userId) {
    try {
      const response = await fetch(`${this.HOST}/api/user/${userId}/role`);
      if (!response.ok) return;
      const data = await response.json();

      await this.stateManager.updateState({
        userRole: data.userRole,
        applicationLimit: data.applicationLimit,
        applicationsUsed: data.applicationsUsed,
      });
    } catch (error) {
      console.error("Error checking user role:", error);
      throw error;
    }
  }

  canApplyMore(state) {
    if (!state) return false;
    if (state.userRole === "unlimited") return true;
    if (state.userRole === "pro")
      return state.applicationsUsed < state.applicationLimit;
    return state.availableCredits > 0;
  }

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
}

Element.prototype.isVisible = function () {
  return (
    window.getComputedStyle(this).display !== "none" &&
    window.getComputedStyle(this).visibility !== "hidden" &&
    this.offsetParent !== null
  );
};
// Initialize and start the application
const linkedInJobApply = new LinkedInJobApply();
linkedInJobApply
  .init()
  .then(() => console.log("LinkedIn Job Apply script initialized"))
  .catch((error) =>
    console.error("Error initializing LinkedIn Job Apply script:", error)
  );
