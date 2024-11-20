const LinkedInJobApplyManager = {
    STATE: {
      IDLE: "idle",
      CHECKING_LOGIN: "checking_login",
      LOGGING_IN: "logging_in",
      NAVIGATING_TO_JOBS: "navigating_to_jobs",
      APPLYING: "applying",
    },
  
    currentState: "idle",
    userId: null,
    targetTabId: null,
    webAppUrl: "https://fastapply-adbs.vercel.app",
  
    async init() {
      chrome.runtime.onInstalled.addListener(this.onInstalled.bind(this));
      chrome.runtime.onMessage.addListener(this.handleMessage.bind(this));
      chrome.runtime.onMessageExternal.addListener(this.handleMessage.bind(this));
      chrome.action.onClicked.addListener(this.handleIconClick.bind(this));
    },
  
    onInstalled() {
      console.log("LinkedIn Job Application Assistant installed");
    },
  
    async startJobSearch() {
      try {
        const tab = await chrome.tabs.create({
          url: "https://www.linkedin.com/jobs/",
        });
  
        await this.waitForTabLoad(tab.id);
  
        const response = await chrome.tabs.sendMessage(tab.id, {
          action: "startJobSearch",
          userId: request.userId,
          jobsToApply: request.jobsToApply, // Pass jobsToApply here
        });
  
        if (response.status === "ready") {
          await this.navigateAndProcessJobs(
            response.url,
            response.userId,
            tab.id,
            request.jobsToApply // Pass jobsToApply here
          );
  
          sendResponse({
            status: "started",
            platform: "linkedin",
            message: "Job search process initiated",
            jobsToApply: request.jobsToApply,
          });
        } else {
          throw new Error("Failed to start job search");
        }
      } catch (error) {
        console.error("Error in startApplying:", error);
        sendResponse({
          status: "error",
          platform: "linkedin",
          message: "Failed to start job search: " + error.message,
        });
      }
    },
    async handleMessage(request, sender, sendResponse) {
      console.log("Received message:", request);
  
      try {
        switch (request.action) {
          case "startJobSearch":
            this.userId = request.userId;
            const searchResult = await this.startJobSearch(this.userId);
            if (searchResult.status === "ready") {
              await this.navigateAndProcessJobs(
                searchResult.url,
                searchResult.userId,
                this.targetTabId,
                request.jobsToApply // Pass jobsToApply here
              );
            }
            sendResponse(searchResult);
            break;
  
          case "navigateToJob":
            await chrome.tabs.update(sender.tab.id, { url: request.url });
            sendResponse({ status: "Navigation complete" });
            break;
  
          case "loginCompleted":
            await this.onLoginCompleted();
            break;
  
          case "storeUserDetails":
            chrome.storage.local.set({ userDetails: request.userDetails }, () => {
              sendResponse({ success: true });
            });
            break;
  
          case "getUserDetails":
            chrome.storage.local.get(["userDetails"], (result) => {
              sendResponse({ userDetails: result.userDetails || null });
            });
            break;
  
          case "startApplying":
            startJobSearch();
            break;
  
          default:
            sendResponse({ status: "error", message: "Unknown action" });
        }
      } catch (error) {
        console.error("Error in handleMessage:", error);
        sendResponse({ status: "error", message: error.message });
      }
  
      return true;
    },
  
    async navigateAndProcessJobs(url, userId, tabId, jobsToApply) {
      await chrome.tabs.update(tabId, { url: url });
      await this.waitForTabLoad(tabId);
  
      const result = await chrome.tabs.sendMessage(tabId, {
        action: "processJobs",
        userId: userId,
        jobsToApply: jobsToApply, // Ensure jobsToApply is passed here
      });
  
      return result;
    },
  
    async handleExternalMessage(request, sender, sendResponse) {
      console.log("Received external message:", request);
  
      if (request.action === "startApplying") {
        try {
          const tab = await chrome.tabs.create({
            url: "https://www.linkedin.com/jobs/",
          });
  
          await new Promise((resolve) => {
            chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
              if (tabId === tab.id && info.status === "complete") {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
              }
            });
          });
  
          const response = await chrome.tabs.sendMessage(tab.id, {
            action: "startJobSearch",
            userId: request.userId,
            jobsToApply: request.jobsToApply, // Pass jobsToApply here
          });
  
          if (response.status === "ready") {
            await chrome.tabs.update(tab.id, { url: response.url });
  
            await new Promise((resolve) => {
              chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
                if (tabId === tab.id && info.status === "complete") {
                  chrome.tabs.onUpdated.removeListener(listener);
                  resolve();
                }
              });
            });
  
            await chrome.tabs.sendMessage(tab.id, {
              action: "processJobs",
              jobsToApply: request.jobsToApply, // Pass jobsToApply here
            });
  
            sendResponse({
              status: "started",
              platform: "linkedin",
              message: "Job search process initiated",
              jobsToApply: request.jobsToApply,
            });
          } else {
            throw new Error("Failed to start job search");
          }
        } catch (error) {
          console.error("Error in handleExternalMessage:", error);
          sendResponse({
            status: "error",
            platform: "linkedin",
            message: "Failed to start job search: " + error.message,
          });
        }
      }
  
      return true;
    },
  
    async startJobSearchProcess() {
      this.currentState = this.STATE.CHECKING_LOGIN;
      const isLoggedIn = await this.checkLinkedInLogin();
  
      if (isLoggedIn) {
        await this.navigateToJobsPage();
      } else {
        await this.navigateToLoginPage();
      }
    },
  
    async checkLinkedInLogin() {
      return new Promise((resolve) => {
        chrome.cookies.get(
          { url: "https://www.linkedin.com", name: "li_at" },
          (cookie) => {
            resolve(!!cookie);
          }
        );
      });
    },
  
    async navigateToLoginPage() {
      this.currentState = this.STATE.LOGGING_IN;
      await this.updateOrCreateTab("https://www.linkedin.com/login");
    },
  
    async onLoginCompleted() {
      console.log("Login completed");
      await this.navigateToJobsPage();
    },
  
    async navigateToJobsPage() {
      this.currentState = this.STATE.NAVIGATING_TO_JOBS;
      await this.updateOrCreateTab("https://www.linkedin.com/jobs/");
      await this.waitForTabLoad();
      await this.startApplying();
    },
  
    async navigateToJob(url) {
      await this.updateOrCreateTab(url);
      await this.waitForTabLoad();
  
      // Send a message indicating navigation is complete
      chrome.tabs.sendMessage(
        this.targetTabId,
        { action: "navigationComplete" },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error(
              "Error sending navigation complete message:",
              chrome.runtime.lastError
            );
          }
        }
      );
    },
  
    async updateOrCreateTab(url) {
      return new Promise((resolve) => {
        if (this.targetTabId) {
          chrome.tabs.update(this.targetTabId, { url }, resolve);
        } else {
          chrome.tabs.create({ url }, (tab) => {
            this.targetTabId = tab.id;
            resolve(tab);
          });
        }
      });
    },
  
    async waitForTabLoad() {
      return new Promise((resolve) => {
        chrome.tabs.onUpdated.addListener(
          function listener(tabId, info) {
            if (tabId === this.targetTabId && info.status === "complete") {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          }.bind(this)
        );
      });
    },
  
    async waitForTabLoad(tabId) {
      return new Promise((resolve) => {
        chrome.tabs.onUpdated.addListener(function listener(updatedTabId, info) {
          if (updatedTabId === tabId && info.status === "complete") {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        });
      });
    },
  
    async startApplying() {
      this.currentState = this.STATE.APPLYING;
      chrome.tabs.sendMessage(this.targetTabId, {
        action: "startJobSearch",
        userId: this.userId,
      });
    },
  
    sendStatusToExternalApp(status, message) {
      // Implement the logic to send status updates to the Next.js app
      console.log(`Sending status to external app: ${status} - ${message}`);
      // You'll need to implement the actual communication with the Next.js app here
      // This could be done using chrome.runtime.sendMessage to a specific extension ID
      // or by making an HTTP request to your Next.js app's API endpoint
    },
  
    handleIconClick() {
      chrome.tabs.create({ url: this.webAppUrl });
    },
  };
  
  // LinkedInJobApplyManager.init();
  
  // BaseJobManager.js - Common functionality for all platforms
  const BaseJobManager = {
    STATE: {
      IDLE: "idle",
      CHECKING_LOGIN: "checking_login",
      LOGGING_IN: "logging_in",
      NAVIGATING_TO_JOBS: "navigating_to_jobs",
      APPLYING: "applying",
    },
  
    initialize(config) {
      this.config = {
        platform: "",
        loginUrl: "",
        jobsUrl: "",
        loginCookie: "",
        ...config,
      };
  
      this.state = {
        currentState: this.STATE.IDLE,
        userId: null,
        targetTabId: null,
        sessionData: {
          appliedJobs: 0,
          failedJobs: 0,
          startTime: null,
          lastActionTime: null,
        },
      };
    },
  
    // Common tab management methods
    async waitForTabLoad(tabId) {
      return new Promise((resolve) => {
        function listener(updatedTabId, info) {
          if (updatedTabId === tabId && info.status === "complete") {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        }
        chrome.tabs.onUpdated.addListener(listener);
      });
    },
  
    async updateOrCreateTab(url) {
      return new Promise((resolve) => {
        if (this.state.targetTabId) {
          chrome.tabs.update(this.state.targetTabId, { url }, resolve);
        } else {
          chrome.tabs.create({ url }, (tab) => {
            this.state.targetTabId = tab.id;
            resolve(tab);
          });
        }
      });
    },
  
    // Common job processing methods
    async navigateAndProcessJobs(url, userId, tabId, jobsToApply) {
      await chrome.tabs.update(tabId, { url });
      await this.waitForTabLoad(tabId);
  
      return await chrome.tabs.sendMessage(tabId, {
        action: "processJobs",
        userId,
        jobsToApply,
        platform: this.config.platform,
      });
    },
  
    // Common status handling
    async updateStatus(status, message) {
      this.state.currentState = status;
      console.log(`${this.config.platform} status update:`, message);
    },
  };
  
  // IndeedJobManager.js
  const IndeedJobManager = {
    ...BaseJobManager, // Inherit base functionality
  
    async init() {
      this.initialize({
        platform: "indeed",
        loginUrl: "https://secure.indeed.com/auth",
        jobsUrl: "https://www.indeed.com/jobs",
        loginCookie: "indeed_auth",
        selectors: {
          // Search related
          searchBox: "#text-input-what",
          locationBox: "#text-input-where",
          searchButton: ".yosegi-InlineWhatWhere-primaryButton",
          jobCards: ".job_seen_beacon",
          jobTitle: ".jobTitle",
          companyName: ".companyName",
          jobLocation: ".companyLocation",
  
          // Application related
          applyButton: ".indeed-apply-button, .jobsearch-ButtonApply",
          easyApplyButton: '[aria-label*="Apply now"]',
          continueButton: ".ia-continueButton",
          submitButton: ".ia-submitButton",
  
          // Form fields
          form: {
            firstName: ["#input-firstName", 'input[name*="first"]'],
            lastName: ["#input-lastName", 'input[name*="last"]'],
            email: ["#input-email", 'input[type="email"]'],
            phone: ["#input-phoneNumber", 'input[type="tel"]'],
            resume: 'input[type="file"]',
            experience: "#input-experience",
            education: "#input-education",
          },
        },
      });
  
      console.log("Indeed manager initialized");
    },
  
    async startJobSearch(userId, jobsToApply, preferences = {}) {
      try {
        this.state.userId = userId;
        const isLoggedIn = await this.checkLogin();
  
        if (!isLoggedIn) {
          await this.handleLogin();
        }
  
        const tab = await this.createSearchTab(preferences);
        await this.waitForTabLoad(tab.id);
  
        // Initialize content script
        const response = await chrome.tabs.sendMessage(tab.id, {
          action: "initializeSearch",
          preferences,
          selectors: this.config.selectors,
        });
  
        if (response?.status === "ready") {
          const result = await this.navigateAndProcessJobs(
            response.url || this.config.jobsUrl,
            userId,
            tab.id,
            jobsToApply
          );
  
          return {
            status: "started",
            platform: "indeed",
            message: "Job search process initiated",
            jobsToApply,
            ...result,
          };
        }
  
        throw new Error("Failed to initialize Indeed job search");
      } catch (error) {
        console.error("Indeed startJobSearch error:", error);
        return {
          status: "error",
          platform: "indeed",
          message: error.message,
        };
      }
    },
  
    async checkLogin() {
      return new Promise((resolve) => {
        chrome.cookies.get(
          { url: "https://www.indeed.com", name: this.config.loginCookie },
          (cookie) => {
            resolve(!!cookie);
          }
        );
      });
    },
  
    async handleLogin() {
      const tab = await this.updateOrCreateTab(this.config.loginUrl);
      this.state.currentState = this.STATE.LOGGING_IN;
  
      return new Promise((resolve) => {
        const checkLogin = async () => {
          const isLoggedIn = await this.checkLogin();
          if (isLoggedIn) {
            resolve(true);
          } else {
            setTimeout(checkLogin, 1000);
          }
        };
        checkLogin();
      });
    },
  
    async createSearchTab(preferences) {
      const searchUrl = this.buildSearchUrl(preferences);
      return await chrome.tabs.create({ url: searchUrl });
    },
  
    buildSearchUrl(preferences) {
      const params = new URLSearchParams({
        q: preferences.keywords?.join(" ") || "",
        l: preferences.location || "remote",
        sc: "0kf:attr(FSRCHC);",
        radius: preferences.radius || "25",
        sort: "date",
      });
  
      if (preferences.datePosted) {
        params.append("fromage", this.getDatePostedValue(preferences.datePosted));
      }
  
      if (preferences.jobType?.length) {
        params.append("jt", this.getJobTypeValue(preferences.jobType));
      }
  
      return `${this.config.jobsUrl}?${params.toString()}`;
    },
  
    getDatePostedValue(datePosted) {
      const dateMap = {
        "24 hours": "1",
        "3 days": "3",
        "7 days": "7",
        "14 days": "14",
        "30 days": "30",
      };
      return dateMap[datePosted] || "30";
    },
  
    getJobTypeValue(jobTypes) {
      const typeMap = {
        fulltime: "1",
        parttime: "2",
        contract: "3",
        temporary: "4",
        internship: "5",
      };
      return jobTypes
        .map((type) => typeMap[type.toLowerCase()])
        .filter(Boolean)
        .join(",");
    },
  
    async navigateToJob(url, tabId) {
      await chrome.tabs.update(tabId, { url });
      await this.waitForTabLoad(tabId);
  
      // Notify content script that navigation is complete
      await chrome.tabs.sendMessage(tabId, {
        action: "navigationComplete",
        platform: "indeed",
      });
    },
  
    // Handle application process updates
    async handleApplicationComplete(jobData) {
      this.state.sessionData.appliedJobs++;
      this.state.sessionData.lastActionTime = Date.now();
  
      // Send status update to main manager
      return {
        status: "success",
        platform: "indeed",
        jobData,
        sessionData: this.state.sessionData,
      };
    },
  
    async handleApplicationError(error, jobData) {
      this.state.sessionData.failedJobs++;
  
      return {
        status: "error",
        platform: "indeed",
        error: error.message,
        jobData,
        sessionData: this.state.sessionData,
      };
    },
  };
  
  const AutomationManager = {
    webAppUrl: "https://fastapply-adbs.vercel.app",
    platformManagers: {
      linkedin: LinkedInJobApplyManager,
      indeed: IndeedJobManager,
    },
  
    async init() {
      // Initialize event listeners
      chrome.runtime.onInstalled.addListener((details) => {
        console.log("Job Application Assistant installed");
        // this.handleInstalled(details);
      });
  
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        return this.handleMessage(message, sender, sendResponse);
      });
  
      chrome.runtime.onMessageExternal.addListener(
        (message, sender, sendResponse) => {
          return this.handleMessage(message, sender, sendResponse);
        }
      );
  
      chrome.action.onClicked.addListener((tab) => {
        this.handleIconClick(tab);
      });
  
      // Initialize platform managers
      for (const [platform, manager] of Object.entries(this.platformManagers)) {
        await manager.init();
        console.log(`${platform} manager initialized`);
      }
    },
  
    async handleMessage(message, sender, sendResponse) {
      console.log("Received message:", message);
  
      try {
        const platform = message.platform?.toLowerCase() || "linkedin";
        console.log(platform);
        const manager = this.platformManagers[platform];
        console.log(manager);
  
        if (!manager) {
          throw new Error(`Unsupported platform: ${platform}`);
        }
  
        let response;
        switch (message.action) {
          case "startJobSearch":
          case "startApplying":
            response = await manager.startJobSearch(
              message.userId,
              message.jobsToApply,
              message.preferences
            );
            break;
  
          case "applicationComplete":
            response = await manager.handleApplicationComplete(message.jobData);
            break;
  
          case "applicationError":
            response = await manager.handleApplicationError(
              message.error,
              message.jobData
            );
            break;
  
          case "getUserDetails":
            response = await this.getUserDetails();
            break;
  
          case "storeUserDetails":
            response = await this.storeUserDetails(message.userDetails);
            break;
  
          default:
            response = { status: "error", message: "Unknown action" };
        }
  
        sendResponse(response);
      } catch (error) {
        console.error("Error in handleMessage:", error);
        sendResponse({
          status: "error",
          message: error.message,
          stack: error.stack,
        });
      }
  
      return true; // Keep message channel open for async response
    },
  
    async getUserDetails() {
      return new Promise((resolve) => {
        chrome.storage.local.get(["userDetails"], (result) => {
          resolve({ userDetails: result.userDetails || null });
        });
      });
    },
  
    async storeUserDetails(userDetails) {
      return new Promise((resolve) => {
        chrome.storage.local.set({ userDetails }, () => {
          resolve({ success: true });
        });
      });
    },
  
    handleIconClick() {
      chrome.tabs.create({ url: this.webAppUrl });
    },
  };
  
  // Initialize the manager
  AutomationManager.init();
  