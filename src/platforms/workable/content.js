// Content script for Workable job application automation

// Debug logging helper
function debugLog(message, ...args) {
  console.log(`[Workable Debug] ${message}`, ...args);
}

// Error logging helper
function errorLog(message, error) {
  console.error(`[Workable Error] ${message}`, error);
  if (error?.stack) {
    console.error(error.stack);
  }
}

// Custom error types
class SendCvError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "SendCvError";
    this.details = details;
  }
}

class SendCvSkipError extends SendCvError {
  constructor(message) {
    super(message);
    this.name = "SendCvSkipError";
  }
}

// Immediately log that the script is loaded
debugLog("Content script loading...");

// Configuration
const CONFIG = {
  SELECTORS: {
    JOB_LINKS:
      "a[href*='workable.com'], a[href*='apply.workable.com'], a[href*='jobs.workable.com'], a[href*='apply.jobs.workable.com']",
    GOOGLE_RESULTS:
      "#search .g, #rso .g, div[data-sokoban-container], #rso div[data-hveid], div[data-hveid], .g, .MjjYud, .Gx5Zad",
    FORM_FIELDS:
      "input[type='text'], input[type='email'], input[type='tel'], input[type='number'], select, textarea, input[type='checkbox'], input[type='radio'], input[type='date']",
    DROPZONE:
      "div.dropzone, div[class*='dropzone'], div[class*='upload'], input[type='file'][accept*='pdf']",
    FILE_INPUT: "input[type='file']",
    SUBMIT_BUTTON: "button[type='submit']",
    NEXT_BUTTON:
      "button.btn-primary, button.btn-submit, button[type='submit'], button.button--primary, button.next-step",
    SUCCESS_MESSAGE:
      "div.application-confirmation, div.success-message, h1.success-message, div[class*='success'], div.thank-you",
    CHECKBOX_CONTAINER:
      ".field-type-Boolean, div[class*='checkbox'], label[class*='checkbox']",
    ERROR_MESSAGE: ".error-message, .alert-error, div[class*='error']",
  },
  TIMEOUTS: {
    STANDARD: 2000,
    EXTENDED: 5000,
    MAX_TIMEOUT: 300000, // 5 minutes
    KEEPALIVE_INTERVAL: 10000, // 10 seconds
  },
  DEBUG: true,
};

// Main class for Workable job automation
class WorkableJobAutomation {
  constructor() {
    this.userData = null;
    this.isRunning = false;
    this.currentJobIndex = 0;
    this.startTime = new Date();
    this.submittedLinks = [];
    this.jobsToApply = [];
    this.visitedLinks = new Set();
    this.processedLinks = [];
    this.applicationData = {};
    this.keepAliveInterval = null;
    this.debugLogs = [];
    this.serverBaseUrl = "";
    this.session = null;

    // CRITICAL STATE TRACKING FLAGS (from Lever implementation)
    this.isApplicationInProgress = false;
    this.applicationStartTime = null;
    this.processedUrls = new Set();
    this.ready = false;
    this.initialized = false;
    this.port = null;

    // Initialize a health check timer
    this.stuckStateTimer = setInterval(() => {
      if (this.isApplicationInProgress && this.applicationStartTime) {
        const now = Date.now();
        const elapsedTime = now - this.applicationStartTime;

        // If application has been in progress for over 5 minutes, it's probably stuck
        if (elapsedTime > 5 * 60 * 1000) {
          debugLog(
            "Application appears to be stuck for over 5 minutes, forcing reset"
          );
          this.isApplicationInProgress = false;
          this.applicationStartTime = null;
          this.appendStatusMessage(
            "Application timeout detected - resetting state"
          );
          setTimeout(() => this.searchNext(), 1000);
        }
      }
    }, 60000);

    // Create a port connection to the background script
    this.initializeConnection();

    // Initialize debug container if debugging is enabled
    this.createStatusOverlay();

    this.logInfo("WorkableJobAutomation initialized");

    // Detect the current page type and initialize accordingly
    this.detectPageTypeAndInitialize();
  }

  /**
   * Create a long-lived connection to the background script
   */
  initializeConnection() {
    try {
      const tabId = window.name || Math.floor(Math.random() * 1000000);

      // Create a connection name based on the page type
      let connectionName = window.location.href.includes("google.com/search")
        ? `workable-search-${tabId}`
        : `workable-apply-${tabId}`;

      debugLog(`Creating connection: ${connectionName}`);

      // Create the connection
      this.port = chrome.runtime.connect({ name: connectionName });

      // Set up message handler
      this.port.onMessage.addListener(this.handlePortMessage.bind(this));

      // Handle disconnection
      this.port.onDisconnect.addListener(() => {
        debugLog("Port disconnected. Attempting to reconnect in 1 second...");

        // Attempt to reconnect after a brief delay
        setTimeout(() => this.initializeConnection(), 1000);
      });

      debugLog("Connection established");
    } catch (err) {
      errorLog("Error initializing connection:", err);

      // Try to reconnect after a delay
      setTimeout(() => this.initializeConnection(), 2000);
    }
  }

  /**
   * Handle messages received through the port
   */
  handlePortMessage(message) {
    try {
      debugLog("Port message received:", message);

      const type = message.type || message.action;

      switch (type) {
        case "SUCCESS":
          // If this is a response to GET_SEARCH_TASK or GET_SEND_CV_TASK
          if (message.data) {
            if (message.data.submittedLinks !== undefined) {
              debugLog("Processing search task data");
              this.processSearchTaskData(message.data);
            } else if (message.data.profile !== undefined) {
              debugLog("Processing send CV task data");
              this.processSendCvTaskData(message.data);
            }
          }
          break;

        case "SEARCH_NEXT":
          debugLog("Handling search next:", message.data);
          this.handleSearchNext(message.data);
          break;

        case "ERROR":
          errorLog("Error from background script:", message.message);
          this.appendStatusErrorMessage("Background error: " + message.message);
          break;

        default:
          debugLog(`Unhandled message type: ${type}`);
      }
    } catch (err) {
      errorLog("Error handling port message:", err);
    }
  }

  // Create a floating debug container
  createDebugContainer() {
    const container = document.createElement("div");
    container.id = "workable-debug-container";
    container.style.cssText =
      "position: fixed; bottom: 10px; right: 10px; width: 300px; max-height: 300px; overflow-y: auto; background: rgba(0,0,0,0.8); color: lime; padding: 10px; font-family: monospace; font-size: 12px; z-index: 9999; border-radius: 5px;";

    const header = document.createElement("div");
    header.textContent = "Workable Automation Debug";
    header.style.cssText =
      "font-weight: bold; margin-bottom: 5px; border-bottom: 1px solid lime;";
    container.appendChild(header);

    const logContainer = document.createElement("div");
    logContainer.id = "workable-debug-logs";
    container.appendChild(logContainer);

    document.body.appendChild(container);
  }

  // Log debug information
  logInfo(message, data = {}) {
    const timestamp = new Date().toISOString().split("T")[1].split(".")[0];
    const logEntry = `[${timestamp}] ${message}`;

    console.log(logEntry, data);

    this.debugLogs.push({
      timestamp: new Date().toISOString(),
      message,
      data,
    });

    // Keep only last 100 logs
    if (this.debugLogs.length > 100) {
      this.debugLogs.shift();
    }

    // Update debug UI if enabled
    if (CONFIG.DEBUG && document.getElementById("workable-debug-logs")) {
      const logElement = document.createElement("div");
      logElement.textContent = logEntry;
      const logContainer = document.getElementById("workable-debug-logs");
      logContainer.appendChild(logElement);

      // Auto-scroll to bottom
      logContainer.scrollTop = logContainer.scrollHeight;

      // Limit to last 30 entries in UI
      while (logContainer.children.length > 30) {
        logContainer.removeChild(logContainer.firstChild);
      }
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
      this.fetchSearchTaskData();
    } else if (url.includes("workable.com")) {
      debugLog("On Workable job page");
      this.appendStatusMessage("Workable job page detected");
      this.fetchSendCvTaskData();
    }
  }

  /**
   * Fetch search task data from background script
   */
  fetchSearchTaskData() {
    try {
      debugLog("Fetching search task data");
      this.appendStatusMessage("Fetching search task data...");

      // Send message through the port
      this.port.postMessage({
        type: "GET_SEARCH_TASK",
      });
    } catch (err) {
      errorLog("Error fetching search task data:", err);
      this.appendStatusErrorMessage(err);

      // Try again after a delay
      setTimeout(() => this.fetchSearchTaskData(), 3000);
    }
  }

  /**
   * Fetch send CV task data from background script
   */
  fetchSendCvTaskData() {
    try {
      debugLog("Fetching send CV task data");
      this.appendStatusMessage("Fetching CV task data...");

      // Send message through the port
      this.port.postMessage({
        type: "GET_SEND_CV_TASK",
      });
    } catch (err) {
      errorLog("Error fetching send CV task data:", err);
      this.appendStatusErrorMessage(err);

      // Try again after a delay
      setTimeout(() => this.fetchSendCvTaskData(), 3000);
    }
  }

  /**
   * Process search task data received from background script
   */
  processSearchTaskData(data) {
    try {
      debugLog("Processing search task data:", data);

      if (!data) {
        debugLog("No search task data provided");
        return;
      }

      const {
        tabId,
        limit,
        current,
        domain,
        submittedLinks,
        searchLinkPattern,
      } = data;

      this.SEARCH_DATA = {
        tabId: tabId,
        limit: limit,
        current: current,
        domain: domain || ["workable.com", "apply.workable.com"],
        submittedLinks: submittedLinks
          ? submittedLinks.map((link) => ({ ...link, tries: 0 }))
          : [],
        searchLinkPattern: searchLinkPattern,
      };

      if (searchLinkPattern) {
        try {
          // Convert string regex back to RegExp
          if (typeof searchLinkPattern === "string") {
            const patternParts =
              searchLinkPattern.match(/^\/(.*?)\/([gimy]*)$/);
            if (patternParts) {
              this.SEARCH_DATA.searchLinkPattern = new RegExp(
                patternParts[1],
                patternParts[2]
              );
            } else {
              this.SEARCH_DATA.searchLinkPattern = new RegExp(
                searchLinkPattern
              );
            }
          } else {
            this.SEARCH_DATA.searchLinkPattern = searchLinkPattern;
          }
        } catch (regexErr) {
          errorLog("Error parsing search link pattern:", regexErr);
          this.SEARCH_DATA.searchLinkPattern = null;
        }
      } else {
        this.SEARCH_DATA.searchLinkPattern = null;
      }

      debugLog("Search data initialized:", this.SEARCH_DATA);
      this.ready = true;
      this.initialized = true;

      this.appendStatusMessage("Search initialization complete");

      // Start processing search results
      setTimeout(() => this.searchNext(), 1000);
    } catch (err) {
      errorLog("Error processing search task data:", err);
      this.appendStatusErrorMessage(err);
    }
  }

  /**
   * Process send CV task data received from background script
   */
  processSendCvTaskData(data) {
    try {
      debugLog("Processing send CV task data:", data);

      if (!data) {
        debugLog("No send CV task data provided");
        return;
      }

      this.ready = true;
      this.initialized = true;
      this.appendStatusMessage("Apply initialization complete");

      // Start the application process
      setTimeout(() => this.startApplying(data), 1000);
    } catch (err) {
      errorLog("Error processing send CV task data:", err);
      this.appendStatusErrorMessage(err);
    }
  }

  // Legacy method to handle one-off messages from background script
  async handleMessage(message, sender, sendResponse) {
    this.logInfo("Received one-off message", message);

    try {
      // For compatibility, convert one-off messages to port format if possible
      if (this.port) {
        switch (message.action) {
          case "initializeSearch":
            // Convert to port format
            this.initialize(
              message.userId,
              message.jobsToApply,
              message.serverBaseUrl,
              message.session
            );
            sendResponse({ status: "initialized" });

            // If we're on a Google search page, start processing job listings
            if (window.location.hostname.includes("google.com")) {
              await this.processGoogleSearchResults();
            }
            break;

          case "initializeJobTab":
            // Start the keepalive ping
            this.startKeepAlive();

            // Store data needed for this application
            this.applicationData = {
              userId: message.userId,
              country: message.country,
              city: message.city,
              workplace: message.workplace,
              serverBaseUrl: message.serverBaseUrl,
              session: message.session,
            };

            // Process application form
            await this.handleApplicationPage();
            sendResponse({ status: "processing" });
            break;

          case "searchNext":
            await this.handleSearchNext(message.data);
            sendResponse({ status: "searching" });
            break;

          default:
            // Handle other messages directly
            switch (message.action) {
              case "processJobs":
                await this.processJobs(message.jobsToApply);
                sendResponse({ status: "processing" });
                break;

              case "stop":
                this.stop();
                sendResponse({ status: "stopped" });
                break;

              case "navigationComplete":
                this.logInfo("Navigation complete", {
                  url: window.location.href,
                });

                if (window.location.href.includes("workable.com")) {
                  if (window.location.href.includes("/apply/")) {
                    await this.handleApplicationPage();
                  } else {
                    await this.handleJobPage();
                  }
                }

                sendResponse({ status: "processed" });
                break;

              default:
                this.logInfo("Unknown message action", message);
                sendResponse({ status: "error", message: "Unknown action" });
            }
        }
      } else {
        // If port not available, fall back to direct handling
        switch (message.action) {
          case "initializeSearch":
            await this.initialize(
              message.userId,
              message.jobsToApply,
              message.serverBaseUrl,
              message.session
            );
            sendResponse({ status: "initialized" });

            // If we're on a Google search page, start processing job listings
            if (window.location.hostname.includes("google.com")) {
              await this.processGoogleSearchResults();
            }
            break;

          case "initializeJobTab":
            // Start the keepalive ping
            this.startKeepAlive();

            // Store data needed for this application
            this.applicationData = {
              userId: message.userId,
              country: message.country,
              city: message.city,
              workplace: message.workplace,
              serverBaseUrl: message.serverBaseUrl,
              session: message.session,
            };

            // Process application form
            await this.handleApplicationPage();
            sendResponse({ status: "processing" });
            break;

          case "processJobs":
            await this.processJobs(message.jobsToApply);
            sendResponse({ status: "processing" });
            break;

          case "searchNext":
            await this.searchNextJob(message.data);
            sendResponse({ status: "searching" });
            break;

          case "stop":
            this.stop();
            sendResponse({ status: "stopped" });
            break;

          case "navigationComplete":
            this.logInfo("Navigation complete", { url: window.location.href });

            if (window.location.href.includes("workable.com")) {
              if (window.location.href.includes("/apply/")) {
                await this.handleApplicationPage();
              } else {
                await this.handleJobPage();
              }
            }

            sendResponse({ status: "processed" });
            break;

          default:
            this.logInfo("Unknown message action", message);
            sendResponse({ status: "error", message: "Unknown action" });
        }
      }
    } catch (error) {
      this.logInfo("Error handling message", {
        error: error.toString(),
        stack: error.stack,
      });
      sendResponse({ status: "error", message: error.message });
    }

    return true;
  }

  // Initialize automation with user data
  async initialize(userId, jobsToApply, serverBaseUrl, session) {
    try {
      this.isRunning = true;
      this.jobsToApply = jobsToApply || "";
      this.serverBaseUrl = serverBaseUrl;
      this.session = session;

      this.logInfo("Initializing with data", {
        userId,
        jobsToApply,
        serverBaseUrl: serverBaseUrl ? "provided" : "not provided",
        session: session ? "provided" : "not provided",
      });

      this.sendStatusUpdate(
        "initialized",
        "Workable automation initialized successfully"
      );
    } catch (error) {
      this.logInfo("Initialization error", {
        error: error.toString(),
        stack: error.stack,
      });
      this.sendStatusUpdate("error", "Failed to initialize: " + error.message);
      throw error;
    }
  }

  // Process Google search results for job listings
  async processGoogleSearchResults() {
    try {
      this.logInfo("Processing Google search results");
      this.sendStatusUpdate("searching", "Processing search results");

      // Wait for results to load
      await this.waitForElement(CONFIG.SELECTORS.GOOGLE_RESULTS, 30000);

      // Add a small delay to ensure all results are fully loaded
      await this.sleep(2000);

      // Find all links that could be job postings directly
      const allLinks = Array.from(document.querySelectorAll("a"));
      const jobLinks = [];

      // Log all links for debugging
      this.logInfo(`Found ${allLinks.length} total links on page`);

      // First look for direct workable links
      for (const link of allLinks) {
        const href = link.href || "";

        // Skip already visited links
        if (this.visitedLinks.has(href)) continue;

        // Check if it's a workable job link
        if (href && href.includes("workable.com")) {
          // Verify this is a job posting link, not just any workable.com link
          if (
            href.match(/workable\.com\/(j|jobs|view|company|careers)\//i) ||
            href.includes("apply.workable.com")
          ) {
            // Get any text from the link for better debugging
            const linkText = link.textContent.trim().substring(0, 50);
            this.logInfo(`Found potential job link: ${href}`, {
              text: linkText,
            });

            jobLinks.push({ url: href, element: link });
          }
        }
      }

      // If no links found, try finding result items and extracting links
      if (jobLinks.length === 0) {
        this.logInfo("No direct job links found, searching in result items");

        // Find all Google result items
        const resultItems = Array.from(
          document.querySelectorAll(CONFIG.SELECTORS.GOOGLE_RESULTS)
        );
        this.logInfo(`Found ${resultItems.length} Google result items`);

        // Extract job links from result items
        for (const item of resultItems) {
          const linkElements = item.querySelectorAll("a");

          for (const link of linkElements) {
            const href = link.href || "";

            // Skip already visited links
            if (this.visitedLinks.has(href)) continue;

            if (href && href.includes("workable.com")) {
              // Verify this is a job posting link, not just any workable.com link
              if (
                href.match(/workable\.com\/(j|jobs|view|company|careers)\//i) ||
                href.includes("apply.workable.com")
              ) {
                const linkText = link.textContent.trim().substring(0, 50);
                this.logInfo(
                  `Found potential job link in result item: ${href}`,
                  { text: linkText }
                );

                jobLinks.push({ url: href, element: link });
                break; // Only take the first valid link from each result item
              }
            }
          }
        }
      }

      this.logInfo(`Found ${jobLinks.length} potential job links`);

      if (jobLinks.length === 0) {
        // Add visual indicator for debugging
        const debugMsg = document.createElement("div");
        debugMsg.style.cssText =
          "position:fixed; top:0; left:0; background:red; color:white; padding:10px; z-index:9999;";
        debugMsg.textContent = "No Workable job links found";
        document.body.appendChild(debugMsg);

        this.logInfo("No Workable job links found. Page HTML sample:", {
          htmlSample: document.body.innerHTML.substring(0, 2000),
        });

        this.sendStatusUpdate("complete", "No Workable job links found");
        return;
      }

      // Add visual indicators of found links for debugging
      jobLinks.forEach((jobLink, index) => {
        try {
          const rect = jobLink.element.getBoundingClientRect();
          const highlight = document.createElement("div");
          highlight.style.cssText = `position:absolute; border:3px solid red; background:rgba(255,0,0,0.2); z-index:9999; pointer-events:none; top:${
            rect.top + window.scrollY
          }px; left:${rect.left}px; width:${rect.width}px; height:${
            rect.height
          }px;`;
          highlight.textContent = `Link ${index + 1}`;
          document.body.appendChild(highlight);
        } catch (e) {
          this.logInfo("Error highlighting link", { error: e.toString() });
        }
      });

      // Start applying to the first job
      this.logInfo("Starting to process first job link");
      await this.processJobLink(jobLinks[0]);
    } catch (error) {
      this.logInfo("Error processing search results", {
        error: error.toString(),
        stack: error.stack,
      });
      this.sendStatusUpdate(
        "error",
        "Failed to process search results: " + error.message
      );
    }
  }

  // Process a specific job link
  async processJobLink(jobLink) {
    try {
      const { url, element } = jobLink;

      this.logInfo("Processing job link", { url });
      this.visitedLinks.add(url);
      this.processedLinks.push(url);

      // Extract job details if possible
      let jobTitle = "";
      let companyName = "";

      try {
        // Try to extract job title and company from Google result
        const parentElement = element.closest(CONFIG.SELECTORS.GOOGLE_RESULTS);

        if (parentElement) {
          const headingElement = parentElement.querySelector("h3");
          if (headingElement) {
            jobTitle = headingElement.textContent.trim();
          }

          // Look for company name in the description
          const descElement = parentElement.querySelector(".VwiC3b");
          if (descElement) {
            const text = descElement.textContent;
            const match = text.match(/at\s+([^·]+)/);
            if (match) {
              companyName = match[1].trim();
            }
          }
        }
      } catch (e) {
        this.logInfo("Error extracting job details", { error: e.toString() });
      }

      this.logInfo("Job details", { jobTitle, companyName, url });

      // Scroll to the link to make sure it's visible
      try {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
        await this.sleep(1000);
      } catch (e) {
        this.logInfo("Error scrolling to link", { error: e.toString() });
      }

      // Add a visual indicator before clicking
      try {
        const rect = element.getBoundingClientRect();
        const highlight = document.createElement("div");
        highlight.style.cssText = `position:fixed; border:5px solid green; background:rgba(0,255,0,0.3); z-index:9999; pointer-events:none; top:${rect.top}px; left:${rect.left}px; width:${rect.width}px; height:${rect.height}px;`;
        highlight.textContent = "CLICKING";
        document.body.appendChild(highlight);

        // Give time to see the highlight
        await this.sleep(1000);
      } catch (e) {
        this.logInfo("Error highlighting link for click", {
          error: e.toString(),
        });
      }

      // Try clicking the link directly first
      try {
        this.logInfo("Attempting to click link directly");
        element.click();

        // Wait to see if the click worked
        await this.sleep(2000);

        // If we're still on the same page, the click didn't work
        if (window.location.href.includes("google.com")) {
          this.logInfo(
            "Direct click didn't navigate, trying open in new tab message"
          );

          // Open job in new tab via background script
          await chrome.runtime.sendMessage({
            action: "openJobInNewTab",
            url: url,
            country: this.applicationData.country || "",
            city: this.applicationData.city || "",
            workplace: this.applicationData.workplace || "",
          });
        } else {
          this.logInfo("Direct click worked, navigated to job page");
        }
      } catch (clickError) {
        this.logInfo("Error clicking link directly", {
          error: clickError.toString(),
        });

        // Fallback to opening in new tab
        try {
          this.logInfo("Falling back to openJobInNewTab message");
          this.sendStatusUpdate("applying", `Opening job: ${jobTitle || url}`);

          await chrome.runtime.sendMessage({
            action: "openJobInNewTab",
            url: url,
            country: this.applicationData.country || "",
            city: this.applicationData.city || "",
            workplace: this.applicationData.workplace || "",
          });
        } catch (tabError) {
          this.logInfo("Error opening job in new tab", {
            error: tabError.toString(),
          });
          throw tabError;
        }
      }
    } catch (error) {
      this.logInfo("Error processing job link", {
        error: error.toString(),
        stack: error.stack,
      });
      this.sendStatusUpdate("error", "Failed to process job: " + error.message);

      // Try to move on to the next job
      await this.searchNextJob({
        url,
        status: "ERROR",
        message: error.message,
      });
    }
  }

  // Handle a job details page
  async handleJobPage() {
    try {
      this.logInfo("Handling job page", { url: window.location.href });
      this.sendStatusUpdate("processing", "Processing job page");

      // Extract job details
      const jobData = {
        title:
          document.querySelector("h1, .job-title")?.textContent?.trim() ||
          "Unknown Position",
        company:
          document
            .querySelector(".company-name, .company, [class*='company']")
            ?.textContent?.trim() || "Unknown Company",
        location:
          document
            .querySelector(".location, .job-location, [class*='location']")
            ?.textContent?.trim() || "Unknown Location",
        url: window.location.href,
      };

      this.logInfo("Extracted job details", jobData);

      // Construct apply URL
      let applyUrl = window.location.href;
      if (!applyUrl.endsWith("/apply/")) {
        applyUrl = applyUrl + (!applyUrl.endsWith("/") ? "/" : "") + "apply/";
      }

      this.logInfo("Navigating to application page", { applyUrl });

      // Navigate to application page
      window.location.href = applyUrl;
    } catch (error) {
      this.logInfo("Error handling job page", {
        error: error.toString(),
        stack: error.stack,
      });
      this.sendStatusUpdate(
        "error",
        "Failed to process job page: " + error.message
      );

      // Report error to background script
      await chrome.runtime.sendMessage({
        action: "sendCvTaskError",
        url: window.location.href,
        message: "Error handling job page: " + error.message,
      });
    }
  }

  // Handle an application form page
  async handleApplicationPage() {
    try {
      this.logInfo("Handling application page", { url: window.location.href });
      this.sendStatusUpdate("filling", "Filling application form");

      // Extract job data
      const jobData = {
        title:
          document
            .querySelector(
              "h1, .job-title, .position-title, [class*='title']:not(title)"
            )
            ?.textContent?.trim() || "Unknown Position",
        company:
          document
            .querySelector(".company-name, .company, [class*='company']")
            ?.textContent?.trim() || "Unknown Company",
        location:
          document
            .querySelector(".location, .job-location, [class*='location']")
            ?.textContent?.trim() || "Unknown Location",
        url: window.location.href,
      };

      this.logInfo("Job data for application", jobData);

      // Check if we're on a success page already
      if (await this.checkForSuccessPage()) {
        this.logInfo("Already on success page");
        await this.handleSuccessPage(jobData.url);
        return;
      }

      // Get profile data from server to fill the form
      const profileData = await this.getProfileData(jobData.url);

      if (!profileData) {
        throw new Error("Failed to get profile data from server");
      }

      this.logInfo("Got profile data", {
        hasProfile: !!profileData,
        dataSize: profileData ? JSON.stringify(profileData).length : 0,
      });

      // Start filling the form
      await this.fillApplicationForm(profileData);
    } catch (error) {
      this.logInfo("Error handling application page", {
        error: error.toString(),
        stack: error.stack,
      });
      this.sendStatusUpdate(
        "error",
        "Failed to process application: " + error.message
      );

      // Report error to background script
      await chrome.runtime.sendMessage({
        action: "sendCvTaskError",
        url: window.location.href,
        message: "Error handling application: " + error.message,
      });
    }
  }

  // Fill out an application form
  async fillApplicationForm(profile) {
    try {
      this.logInfo("Starting to fill application form");
      this.sendStatusUpdate("filling", "Filling application form");

      // Process form steps
      let isLastStep = false;
      let stepCount = 0;
      const maxSteps = 10; // Safety limit

      while (!isLastStep && stepCount < maxSteps) {
        stepCount++;
        this.logInfo(`Processing form step ${stepCount}`);

        // Find all form fields on current page
        const formFields = Array.from(
          document.querySelectorAll(CONFIG.SELECTORS.FORM_FIELDS)
        ).filter((field) => this.isElementVisible(field));

        this.logInfo(`Found ${formFields.length} form fields`);

        // Process each field
        for (const field of formFields) {
          await this.fillFormField(field, profile);
          await this.sleep(500);
        }

        // Handle file uploads if present
        const dropzones = Array.from(
          document.querySelectorAll(CONFIG.SELECTORS.DROPZONE)
        ).filter((zone) => this.isElementVisible(zone));

        if (dropzones.length > 0) {
          this.logInfo(`Found ${dropzones.length} file upload areas`);
          this.sendStatusUpdate("uploading", "Uploading resume");

          for (const dropzone of dropzones) {
            // Look for clues in the text to determine what to upload
            const dropzoneText = dropzone.textContent.toLowerCase();
            this.logInfo("Dropzone text", { text: dropzoneText });

            if (
              dropzoneText.includes("resume") ||
              dropzoneText.includes("cv") ||
              dropzoneText.includes("upload") ||
              dropzone.querySelector("input[type='file'][accept*='pdf']")
            ) {
              if (profile.resumeUrl) {
                await this.handleFileUpload(
                  dropzone,
                  profile.resumeUrl,
                  "resume.pdf"
                );
              } else {
                this.logInfo("No resume URL provided", { profile });
              }
            } else if (dropzoneText.includes("cover letter")) {
              // If a cover letter field is found
              if (profile.coverLetter) {
                this.logInfo("Handling cover letter upload");

                // Create a text file with the cover letter content
                const coverLetterBlob = new Blob([profile.coverLetter], {
                  type: "text/plain",
                });

                const coverLetterFile = new File(
                  [coverLetterBlob],
                  "cover_letter.txt",
                  { type: "text/plain" }
                );

                await this.uploadFileToDropzone(dropzone, coverLetterFile);
              }
            }

            await this.sleep(2000);
          }
        }

        // Handle checkbox agreements
        const checkboxContainers = Array.from(
          document.querySelectorAll(CONFIG.SELECTORS.CHECKBOX_CONTAINER)
        ).filter((container) => this.isElementVisible(container));

        this.logInfo(`Found ${checkboxContainers.length} checkbox containers`);

        for (const container of checkboxContainers) {
          const checkbox = container.querySelector('input[type="checkbox"]');

          if (checkbox && !checkbox.checked) {
            const label = container.querySelector("label") || container;
            const labelText = label.textContent.toLowerCase().trim();

            this.logInfo("Processing checkbox", {
              labelText,
              checked: checkbox.checked,
            });

            // If it's likely to be an agreement checkbox, check it
            if (
              labelText.includes("agree") ||
              labelText.includes("consent") ||
              labelText.includes("terms") ||
              labelText.includes("accept") ||
              labelText.includes("confirm") ||
              labelText.includes("privacy")
            ) {
              this.logInfo("Checking agreement checkbox");

              try {
                // Try clicking the label first for better compatibility
                label.click();
              } catch (e) {
                // Fall back to clicking the checkbox directly
                checkbox.click();
              }

              await this.sleep(500);
            }
          }
        }

        // Look for errors that might have appeared
        const errorMessages = document.querySelectorAll(
          CONFIG.SELECTORS.ERROR_MESSAGE
        );
        if (errorMessages.length > 0) {
          const errors = Array.from(errorMessages)
            .filter((el) => this.isElementVisible(el))
            .map((el) => el.textContent.trim())
            .filter((text) => text);

          if (errors.length > 0) {
            this.logInfo("Found form errors", { errors });
          }
        }

        // Look for next/submit button
        const nextButton = this.findButtonToClick();

        if (!nextButton) {
          this.logInfo("No next/submit button found");
          break;
        }

        // Determine if this is the last step
        const buttonText = nextButton.textContent?.toLowerCase() || "";
        this.logInfo("Found button with text", { text: buttonText });

        if (
          buttonText.includes("submit") ||
          buttonText.includes("apply") ||
          buttonText.includes("send") ||
          buttonText.includes("complete") ||
          buttonText.includes("finish")
        ) {
          isLastStep = true;
          this.logInfo("This appears to be the last step");
        }

        // Click the button to continue
        this.logInfo("Clicking button to proceed");
        nextButton.click();

        // Wait longer on the last step
        await this.sleep(isLastStep ? 5000 : 3000);

        // Check for success message
        if (await this.checkForSuccessPage()) {
          this.logInfo("Found success message");
          await this.handleSuccessPage(window.location.href);
          return;
        }
      }

      // If we reach here without finding a success message,
      // check if we've reached the maximum number of steps
      if (stepCount >= maxSteps) {
        this.logInfo("Reached maximum number of steps without success");

        // Check one more time for success page with a longer timeout
        if (await this.checkForSuccessPage(8000)) {
          this.logInfo("Found success message on final check");
          await this.handleSuccessPage(window.location.href);
          return;
        }

        // If still no success, report error
        await chrome.runtime.sendMessage({
          action: "sendCvTaskError",
          url: window.location.href,
          message: "Reached maximum steps without confirmation of submission",
        });

        return;
      }

      // No more buttons to click but no success message either
      this.logInfo("No more steps available but no success confirmation");

      // Check if we've reached an end state that looks successful
      if (
        document.title.toLowerCase().includes("thank") ||
        document.body.textContent
          .toLowerCase()
          .includes("thank you for applying")
      ) {
        this.logInfo("Page indicates success based on content");
        await this.handleSuccessPage(window.location.href);
        return;
      }

      // Report error if we can't determine success
      await chrome.runtime.sendMessage({
        action: "sendCvTaskError",
        url: window.location.href,
        message: "Form completion uncertain - no success confirmation found",
      });
    } catch (error) {
      this.logInfo("Error filling application form", {
        error: error.toString(),
        stack: error.stack,
      });
      this.sendStatusUpdate(
        "error",
        "Failed to fill application form: " + error.message
      );

      // Report error to background script
      await chrome.runtime.sendMessage({
        action: "sendCvTaskError",
        url: window.location.href,
        message: "Error filling form: " + error.message,
      });
    }
  }

  // Fill a specific form field
  async fillFormField(field, profile) {
    try {
      // Skip hidden fields
      if (field.type === "hidden" || !this.isElementVisible(field)) {
        return;
      }

      const fieldInfo = this.getFieldInfo(field);
      if (!fieldInfo.label) {
        this.logInfo("No label found for field", {
          type: field.type,
          name: field.name || "unnamed",
          id: field.id || "no-id",
        });
        return;
      }

      // Get appropriate value for the field
      const value = this.getValueForField(fieldInfo, profile);
      if (!value && value !== false) {
        this.logInfo(`No value found for field: ${fieldInfo.label}`);
        return;
      }

      this.logInfo(`Filling field "${fieldInfo.label}"`, {
        type: field.type,
        value:
          typeof value === "string"
            ? value.substring(0, 20) + (value.length > 20 ? "..." : "")
            : value,
      });

      // Apply value based on field type
      switch (field.type) {
        case "text":
        case "email":
        case "tel":
        case "number":
        case "date":
          await this.fillTextField(field, value);
          break;

        case "select-one":
          await this.handleSelectField(field, value);
          break;

        case "textarea":
          await this.fillTextArea(field, value);
          break;

        case "checkbox":
          await this.handleCheckbox(field, value);
          break;

        case "radio":
          await this.handleRadioButton(field, value);
          break;
      }
    } catch (error) {
      this.logInfo(
        `Error filling field "${field.name || field.id || "unnamed"}"`,
        {
          error: error.toString(),
        }
      );
      // Continue with other fields
    }
  }

  // Fill a text field
  async fillTextField(field, value) {
    try {
      // Clear the field first
      field.value = "";
      field.dispatchEvent(new Event("input", { bubbles: true }));
      await this.sleep(100);

      // Set the new value
      field.focus();
      field.value = value;
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
      field.blur();
    } catch (error) {
      this.logInfo(`Error filling text field`, { error: error.toString() });
    }
  }

  // Fill a textarea
  async fillTextArea(field, value) {
    try {
      // Clear the field first
      field.value = "";
      field.dispatchEvent(new Event("input", { bubbles: true }));
      await this.sleep(100);

      // Set the new value
      field.focus();
      field.value = value;
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
      field.blur();
    } catch (error) {
      this.logInfo(`Error filling textarea`, { error: error.toString() });
    }
  }

  // Handle a checkbox
  async handleCheckbox(field, value) {
    try {
      const shouldBeChecked =
        value === true || value === "yes" || value === "true" || value === "1";

      // Only change if current state doesn't match desired state
      if (shouldBeChecked !== field.checked) {
        field.click();
        await this.sleep(100);
        field.dispatchEvent(new Event("change", { bubbles: true }));
      }
    } catch (error) {
      this.logInfo(`Error handling checkbox`, { error: error.toString() });
    }
  }

  // Handle a radio button
  async handleRadioButton(field, value) {
    try {
      // Get all radio buttons in the same group
      const name = field.name;
      if (!name) return;

      const radioGroup = document.querySelectorAll(
        `input[type="radio"][name="${name}"]`
      );

      // Try to find the best match
      let bestMatch = null;
      let bestScore = 0;

      for (const radio of radioGroup) {
        // Skip invisible options
        if (!this.isElementVisible(radio)) continue;

        const label = this.getRadioLabel(radio);

        if (!label) continue;

        const radioValue = radio.value.toLowerCase();
        const labelText = label.toLowerCase();
        const targetValue = String(value).toLowerCase();

        // Exact matches are best
        if (radioValue === targetValue || labelText === targetValue) {
          bestMatch = radio;
          break;
        }

        // Look for partial matches
        if (
          radioValue.includes(targetValue) ||
          targetValue.includes(radioValue)
        ) {
          bestMatch = radio;
          bestScore = 3;
          continue;
        }

        if (
          labelText.includes(targetValue) ||
          targetValue.includes(labelText)
        ) {
          if (bestScore < 2) {
            bestMatch = radio;
            bestScore = 2;
          }
          continue;
        }

        // Word matches
        const valueWords = targetValue.split(/\s+/);
        for (const word of valueWords) {
          if (
            word.length > 2 &&
            (labelText.includes(word) || radioValue.includes(word))
          ) {
            if (bestScore < 1) {
              bestMatch = radio;
              bestScore = 1;
            }
            break;
          }
        }
      }

      // If we found a match, click it
      if (bestMatch && !bestMatch.checked) {
        bestMatch.click();
        await this.sleep(100);
        bestMatch.dispatchEvent(new Event("change", { bubbles: true }));
      }
    } catch (error) {
      this.logInfo(`Error handling radio button`, { error: error.toString() });
    }
  }

  // Get the label for a radio button
  getRadioLabel(radio) {
    // Direct label
    const id = radio.id;
    if (id) {
      const label = document.querySelector(`label[for="${id}"]`);
      if (label) return label.textContent.trim();
    }

    // Parent label
    const parentLabel = radio.closest("label");
    if (parentLabel) return parentLabel.textContent.trim();

    // Sibling label
    const nextSibling = radio.nextElementSibling;
    if (nextSibling && nextSibling.tagName.toLowerCase() === "label") {
      return nextSibling.textContent.trim();
    }

    // Look for nearby text
    const parent = radio.parentElement;
    if (parent) {
      // Remove all form elements from consideration
      const parentClone = parent.cloneNode(true);
      const formElements = parentClone.querySelectorAll(
        "input, select, button"
      );
      formElements.forEach((el) => el.remove());

      const text = parentClone.textContent.trim();
      if (text) return text;
    }

    return radio.value;
  }

  // Get field information (type, label, etc.)
  getFieldInfo(field) {
    // Start with what we know
    const info = {
      type: field.type,
      name: field.name || "",
      id: field.id || "",
      placeholder: field.placeholder || "",
      label: "",
    };

    // Try to get label from associated label element
    if (field.id) {
      const labelElement = document.querySelector(`label[for="${field.id}"]`);
      if (labelElement) {
        info.label = labelElement.textContent.trim();
        return info;
      }
    }

    // Try to get label from parent label element
    const parentLabel = field.closest("label");
    if (parentLabel) {
      info.label = parentLabel.textContent.trim();
      return info;
    }

    // Try to get label from parent fieldset legend
    const fieldset = field.closest("fieldset");
    if (fieldset) {
      const legend = fieldset.querySelector("legend");
      if (legend) {
        info.label = legend.textContent.trim();
        return info;
      }
    }

    // Try to get label from placeholder
    if (field.placeholder) {
      info.label = field.placeholder;
      return info;
    }

    // Try to get label from name attribute
    if (field.name) {
      // Convert camelCase or snake_case to readable format
      info.label = field.name
        .replace(/([A-Z])/g, " $1")
        .replace(/_/g, " ")
        .trim();
      return info;
    }

    // Try to get label from parent div with a label-like class
    const parentDiv = field.closest(
      "div[class*='label'], div[class*='field'], div.field-type-SingleLine, div.field-type-Email, div[class*='field-'], div[class*='form-']"
    );

    if (parentDiv) {
      const labelDiv = parentDiv.querySelector(
        "div[class*='label'], label, div.field-label, div[class*='label'], span[class*='label']"
      );

      if (labelDiv) {
        info.label = labelDiv.textContent.trim();
        return info;
      }

      // If no explicit label element, use the text content of the parent div
      // First remove any inputs, selects, etc. to avoid getting their text
      const parentClone = parentDiv.cloneNode(true);
      const formElements = parentClone.querySelectorAll(
        "input, select, textarea, button"
      );
      formElements.forEach((el) => el.remove());

      // Now get the text
      const text = parentClone.textContent.trim();
      if (text) {
        info.label = text;
        return info;
      }
    }

    // Last resort - look at aria-label
    if (field.getAttribute("aria-label")) {
      info.label = field.getAttribute("aria-label");
      return info;
    }

    return info;
  }

  // Get the appropriate value for a field based on profile data
  getValueForField(fieldInfo, profile) {
    const { label, type, name, placeholder } = fieldInfo;
    const normalizedLabel = (label || "").toLowerCase().trim();
    const normalizedName = (name || "").toLowerCase().trim();
    const normalizedPlaceholder = (placeholder || "").toLowerCase().trim();

    // Additional field mapping for special cases
    if (
      normalizedLabel.includes("country code") ||
      normalizedLabel.includes("area code") ||
      normalizedName.includes("countrycode")
    ) {
      return "+1"; // Default US country code
    }

    // Look for indicators of what the field is asking for
    const isFirstName = this.matchesPattern(
      normalizedLabel,
      normalizedName,
      normalizedPlaceholder,
      ["first name", "given name", "first_name", "firstname", "fname"]
    );

    const isLastName = this.matchesPattern(
      normalizedLabel,
      normalizedName,
      normalizedPlaceholder,
      ["last name", "surname", "family name", "last_name", "lastname", "lname"]
    );

    const isFullName = this.matchesPattern(
      normalizedLabel,
      normalizedName,
      normalizedPlaceholder,
      ["full name", "name", "your name", "fullname", "full_name"]
    );

    const isEmail = this.matchesPattern(
      normalizedLabel,
      normalizedName,
      normalizedPlaceholder,
      ["email", "e-mail", "email address", "e_mail"]
    );

    const isPhone = this.matchesPattern(
      normalizedLabel,
      normalizedName,
      normalizedPlaceholder,
      [
        "phone",
        "telephone",
        "mobile",
        "cell",
        "phone number",
        "contact number",
        "phonenumber",
      ]
    );

    const isLinkedIn = this.matchesPattern(
      normalizedLabel,
      normalizedName,
      normalizedPlaceholder,
      [
        "linkedin",
        "linked in",
        "linkedin profile",
        "linked-in",
        "linkedin url",
        "linkedin link",
      ]
    );

    const isWebsite = this.matchesPattern(
      normalizedLabel,
      normalizedName,
      normalizedPlaceholder,
      [
        "website",
        "web site",
        "personal website",
        "portfolio",
        "site",
        "homepage",
        "blog",
      ]
    );

    const isGitHub = this.matchesPattern(
      normalizedLabel,
      normalizedName,
      normalizedPlaceholder,
      [
        "github",
        "git hub",
        "github profile",
        "git-hub",
        "github url",
        "github link",
      ]
    );

    const isCoverLetter = this.matchesPattern(
      normalizedLabel,
      normalizedName,
      normalizedPlaceholder,
      [
        "cover letter",
        "coverletter",
        "cover_letter",
        "letter",
        "motivation",
        "introduction",
        "message",
      ]
    );

    const isCompany = this.matchesPattern(
      normalizedLabel,
      normalizedName,
      normalizedPlaceholder,
      [
        "company",
        "employer",
        "current company",
        "organization",
        "current employer",
      ]
    );

    const isLocation = this.matchesPattern(
      normalizedLabel,
      normalizedName,
      normalizedPlaceholder,
      ["location", "city", "region", "area", "state"]
    );

    const isCountry = this.matchesPattern(
      normalizedLabel,
      normalizedName,
      normalizedPlaceholder,
      ["country", "nation"]
    );

    const isWorkAuth = this.matchesPattern(
      normalizedLabel,
      normalizedName,
      normalizedPlaceholder,
      [
        "work authorization",
        "authorized",
        "work permit",
        "legally",
        "authorized to work",
        "eligible to work",
      ]
    );

    const isVisa = this.matchesPattern(
      normalizedLabel,
      normalizedName,
      normalizedPlaceholder,
      ["visa", "sponsor", "sponsorship", "require visa", "visa sponsorship"]
    );

    const isSalary = this.matchesPattern(
      normalizedLabel,
      normalizedName,
      normalizedPlaceholder,
      [
        "salary",
        "compensation",
        "pay",
        "wage",
        "expected salary",
        "salary expectation",
      ]
    );

    const isNotice = this.matchesPattern(
      normalizedLabel,
      normalizedName,
      normalizedPlaceholder,
      [
        "notice period",
        "notice",
        "start date",
        "availability",
        "available",
        "when can you start",
      ]
    );

    const isEducation = this.matchesPattern(
      normalizedLabel,
      normalizedName,
      normalizedPlaceholder,
      [
        "education",
        "degree",
        "qualification",
        "university",
        "college",
        "school",
      ]
    );

    const isExperience = this.matchesPattern(
      normalizedLabel,
      normalizedName,
      normalizedPlaceholder,
      [
        "experience",
        "work experience",
        "years of experience",
        "years",
        "experience in",
        "employment history",
      ]
    );

    // Assign values based on field type
    if (isFirstName) return profile.firstName || "John";
    if (isLastName) return profile.lastName || "Doe";
    if (isFullName)
      return `${profile.firstName || "John"} ${profile.lastName || "Doe"}`;
    if (isEmail) return profile.email || "user@example.com";
    if (isPhone) return profile.phone || "+15555555555";
    if (isLinkedIn)
      return (
        profile.linkedinUrl ||
        profile.linkedin ||
        "https://linkedin.com/in/username"
      );
    if (isWebsite)
      return profile.websiteUrl || profile.website || "https://example.com";
    if (isGitHub)
      return (
        profile.githubUrl || profile.github || "https://github.com/username"
      );
    if (isCoverLetter)
      return (
        profile.coverLetter ||
        "I am very interested in this position and believe my skills and experience make me a great fit."
      );
    if (isCompany)
      return profile.currentCompany || profile.company || "Current Employer";
    if (isLocation) {
      // Try to determine if this is asking about current or preferred location
      if (
        normalizedLabel.includes("current") ||
        normalizedLabel.includes("present")
      ) {
        return (
          profile.currentLocation ||
          profile.location ||
          profile.city ||
          "New York"
        );
      }
      return (
        profile.preferredLocation ||
        profile.location ||
        profile.city ||
        "New York"
      );
    }
    if (isCountry) return profile.country || "United States";
    if (isWorkAuth) return "Yes";
    if (isVisa) {
      const needsVisa =
        profile.visaSponsorship || profile.needsSponsorship || false;
      // Return "No" if they don't need sponsorship, "Yes" if they do
      // (Questions are often phrased as "Do you need sponsorship?")
      return needsVisa ? "Yes" : "No";
    }
    if (isSalary) return profile.expectedSalary || "60000";
    if (isNotice) return profile.noticePeriod || "2 weeks";
    if (isEducation)
      return profile.education || profile.degree || "Bachelor's Degree";
    if (isExperience) {
      // Check if asking for years specifically
      if (normalizedLabel.includes("year") || normalizedName.includes("year")) {
        return profile.yearsOfExperience || "3";
      }
      return profile.experience || "3 years of relevant experience";
    }

    // For checkboxes and radio buttons - special handling for common patterns
    if (type === "checkbox" || type === "radio") {
      if (this.isAgreementField(normalizedLabel, normalizedName)) {
        return true;
      }

      if (this.isRelocationField(normalizedLabel, normalizedName)) {
        return profile.willingToRelocate ? "Yes" : "No";
      }

      if (this.isRemoteField(normalizedLabel, normalizedName)) {
        return profile.preferRemote ? "Yes" : "No";
      }
    }

    // Generic fallback logic
    if (type === "checkbox") {
      // Most standalone checkboxes are agreements that should be checked
      return true;
    }

    // No specific match found
    return null;
  }

  // Helper to check if a field matches any of the patterns
  matchesPattern(label, name, placeholder, patterns) {
    for (const pattern of patterns) {
      if (
        label.includes(pattern) ||
        name.includes(pattern) ||
        placeholder.includes(pattern)
      ) {
        return true;
      }
    }
    return false;
  }

  // Check if a field is asking for agreement to terms
  isAgreementField(label, name) {
    const agreeTerms = [
      "agree",
      "terms",
      "consent",
      "accept",
      "privacy",
      "policy",
      "opt in",
      "subscribe",
      "confirm",
      "acknowledge",
    ];

    for (const term of agreeTerms) {
      if (label.includes(term) || name.includes(term)) {
        return true;
      }
    }

    return false;
  }

  // Check if a field is asking about relocation
  isRelocationField(label, name) {
    const relocateTerms = [
      "relocate",
      "relocation",
      "willing to move",
      "move to",
      "relocating",
    ];

    for (const term of relocateTerms) {
      if (label.includes(term) || name.includes(term)) {
        return true;
      }
    }

    return false;
  }

  // Check if a field is asking about remote work
  isRemoteField(label, name) {
    const remoteTerms = [
      "remote",
      "work from home",
      "wfh",
      "telecommute",
      "remotely",
    ];

    for (const term of remoteTerms) {
      if (label.includes(term) || name.includes(term)) {
        return true;
      }
    }

    return false;
  }

  // Handle select dropdown fields
  async handleSelectField(selectElement, value) {
    try {
      // Get all options
      const options = Array.from(selectElement.options);

      this.logInfo("Select options", {
        options: options.map((o) => o.text).join(", "),
        value: value,
      });

      // Find best match
      let selectedIndex = -1;
      const targetValue = String(value).toLowerCase();

      // Try exact match first
      selectedIndex = options.findIndex(
        (option) =>
          option.text.toLowerCase().trim() === targetValue ||
          option.value.toLowerCase().trim() === targetValue
      );

      // If no exact match, try partial match
      if (selectedIndex === -1) {
        selectedIndex = options.findIndex(
          (option) =>
            option.text.toLowerCase().includes(targetValue) ||
            option.value.toLowerCase().includes(targetValue)
        );
      }

      // If still no match, try partial word match
      if (selectedIndex === -1) {
        const words = targetValue.split(/\s+/);
        for (const word of words) {
          if (word.length <= 2) continue; // Skip short words

          selectedIndex = options.findIndex((option) =>
            option.text.toLowerCase().includes(word)
          );

          if (selectedIndex !== -1) break;
        }
      }

      // Special case for country selection
      if (selectedIndex === -1 && targetValue.includes("united states")) {
        selectedIndex = options.findIndex(
          (option) =>
            option.text.toLowerCase().includes("united states") ||
            option.text.toLowerCase() === "usa" ||
            option.text.toLowerCase() === "us" ||
            option.text.toLowerCase() === "united states of america"
        );
      }

      // If a match was found, select it
      if (selectedIndex !== -1) {
        this.logInfo("Selected option", {
          index: selectedIndex,
          text: options[selectedIndex].text,
        });

        selectElement.selectedIndex = selectedIndex;
        selectElement.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      } else {
        this.logInfo("No matching option found for select field");
        return false;
      }
    } catch (error) {
      this.logInfo("Error handling select field", { error: error.toString() });
      return false;
    }
  }

  // Handle file upload for resumes, etc.
  async handleFileUpload(dropzoneElement, fileUrl, fileName) {
    if (!fileUrl) {
      this.logInfo("No file URL provided for upload");
      return false;
    }

    try {
      this.logInfo("Handling file upload", { fileUrl, fileName });

      // Find the file input
      let fileInput = this.findFileInput(dropzoneElement);

      if (!fileInput) {
        this.logInfo("No file input found");
        return false;
      }

      this.logInfo("Found file input", {
        id: fileInput.id,
        name: fileInput.name,
        accept: fileInput.accept,
      });

      // Fetch the file and upload it
      try {
        const response = await fetch(fileUrl);
        if (!response.ok) {
          throw new Error(
            `Failed to fetch file: ${response.status} ${response.statusText}`
          );
        }

        const blob = await response.blob();

        // Create file and add to input
        const file = new File([blob], fileName, {
          type: blob.type || "application/pdf",
          lastModified: new Date(),
        });

        this.logInfo("File created, uploading", {
          size: file.size,
          type: file.type,
        });

        await this.uploadFileToDropzone(dropzoneElement, file);

        this.logInfo("File upload complete");
        return true;
      } catch (error) {
        this.logInfo("Error fetching or creating file", {
          error: error.toString(),
        });
        return false;
      }
    } catch (error) {
      this.logInfo("Error handling file upload", { error: error.toString() });
      return false;
    }
  }

  // Find a file input element
  findFileInput(dropzone) {
    // Direct child file input
    let fileInput = dropzone.querySelector('input[type="file"]');
    if (fileInput) return fileInput;

    // Look for file input anywhere in the form
    const form = dropzone.closest("form");
    if (form) {
      fileInput = form.querySelector('input[type="file"]');
      if (fileInput) return fileInput;
    }

    // Look for any file input on the page
    fileInput = document.querySelector('input[type="file"]');
    return fileInput;
  }

  // Upload a file to a dropzone
  async uploadFileToDropzone(dropzone, file) {
    try {
      // Find the file input
      const fileInput = this.findFileInput(dropzone);

      if (!fileInput) {
        throw new Error("No file input found");
      }

      // Create a DataTransfer object and add our file
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);

      // Assign the file to the input
      fileInput.files = dataTransfer.files;

      // Dispatch necessary events
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));

      // Try to trigger any click events that might be needed
      const uploadButton = dropzone.querySelector(
        'button, a[class*="upload"], div[class*="upload"]'
      );
      if (uploadButton) {
        uploadButton.click();
      }

      // Wait for upload to complete
      await this.sleep(3000);
      return true;
    } catch (error) {
      this.logInfo("Error uploading file to dropzone", {
        error: error.toString(),
      });
      return false;
    }
  }

  // Find a button to click (next, submit, etc.)
  findButtonToClick() {
    // Look for submit button
    const submitButton = document.querySelector(CONFIG.SELECTORS.SUBMIT_BUTTON);
    if (submitButton && this.isElementVisible(submitButton)) {
      return submitButton;
    }

    // Look for next button
    const nextButtons = Array.from(
      document.querySelectorAll(CONFIG.SELECTORS.NEXT_BUTTON)
    );
    const visibleNextButtons = nextButtons.filter((btn) =>
      this.isElementVisible(btn)
    );

    if (visibleNextButtons.length > 0) {
      // Prioritize buttons with submit/apply/send/next text
      const priorityLabels = [
        "submit",
        "apply",
        "send",
        "next",
        "continue",
        "proceed",
        "save",
      ];

      for (const label of priorityLabels) {
        const matchingButton = visibleNextButtons.find((btn) =>
          btn.textContent.toLowerCase().includes(label)
        );

        if (matchingButton) {
          return matchingButton;
        }
      }

      // If no priority match, return the first visible one
      return visibleNextButtons[0];
    }

    // Look for any button that might be a submit/next button
    const allButtons = Array.from(
      document.querySelectorAll(
        'button, input[type="button"], input[type="submit"], a[class*="button"], a[class*="btn"]'
      )
    );
    const visibleButtons = allButtons.filter((btn) =>
      this.isElementVisible(btn)
    );

    for (const button of visibleButtons) {
      const text = button.textContent.toLowerCase();
      if (
        text.includes("next") ||
        text.includes("continue") ||
        text.includes("submit") ||
        text.includes("apply") ||
        text.includes("send") ||
        text.includes("save")
      ) {
        return button;
      }
    }

    // No suitable button found
    return null;
  }

  // Check if we're on a success page
  async checkForSuccessPage(timeout = 3000) {
    try {
      // Try to find success message with a timeout
      const successElement = await this.waitForElement(
        CONFIG.SELECTORS.SUCCESS_MESSAGE,
        timeout
      );

      if (successElement && this.isElementVisible(successElement)) {
        return true;
      }

      // Check for common success indicators in page content
      const pageContent = document.body.textContent.toLowerCase();

      const successPhrases = [
        "thank you for applying",
        "application submitted",
        "application received",
        "successfully applied",
        "application successful",
        "application complete",
        "successfully submitted",
        "we have received your application",
        "thanks for applying",
      ];

      for (const phrase of successPhrases) {
        if (pageContent.includes(phrase)) {
          return true;
        }
      }

      // Check page title
      const pageTitle = document.title.toLowerCase();

      if (
        pageTitle.includes("thank you") ||
        pageTitle.includes("application submitted") ||
        pageTitle.includes("success") ||
        pageTitle.includes("complete") ||
        pageTitle.includes("confirmation")
      ) {
        return true;
      }

      return false;
    } catch (error) {
      this.logInfo("Error checking for success page", {
        error: error.toString(),
      });
      return false;
    }
  }

  // Handle successful application submission
  async handleSuccessPage(url) {
    try {
      this.logInfo("Application submitted successfully", { url });
      this.sendStatusUpdate("success", "Application submitted successfully");

      // Notify background script
      await chrome.runtime.sendMessage({
        action: "sendCvTaskDone",
        url: url,
      });
    } catch (error) {
      this.logInfo("Error handling success page", { error: error.toString() });

      // Still try to notify background script
      await chrome.runtime.sendMessage({
        action: "sendCvTaskDone",
        url: url,
      });
    }
  }

  // Search for the next job
  async searchNextJob(data) {
    try {
      this.logInfo("Searching for next job", data);

      if (data && data.url) {
        this.visitedLinks.add(data.url);

        if (data.status === "SUCCESS") {
          this.submittedLinks.push(data.url);
          this.logInfo("Added URL to submitted links", { url: data.url });
        }
      }

      // Clear any debug elements from previous runs
      document
        .querySelectorAll(
          'div[style*="position:fixed"], div[style*="position:absolute"][style*="border"]'
        )
        .forEach((el) => {
          if (el.id !== "workable-debug-container") {
            el.remove();
          }
        });

      // If we're not on Google search results, go back
      if (!window.location.hostname.includes("google.com")) {
        this.logInfo("Not on Google search results, going back");
        window.location.href =
          "https://www.google.com/search?q=site:workable.com " +
          (this.jobsToApply || "jobs");
        return;
      }

      // Start looking for the next job link
      await this.processGoogleSearchResults();
    } catch (error) {
      this.logInfo("Error searching for next job", { error: error.toString() });
      this.sendStatusUpdate(
        "error",
        "Error searching for next job: " + error.message
      );
    }
  }

  // Process jobs based on search criteria
  async processJobs(jobsToApply) {
    this.jobsToApply = jobsToApply || "";
    this.isRunning = true;

    if (window.location.hostname.includes("google.com")) {
      await this.processGoogleSearchResults();
    } else if (window.location.hostname.includes("workable.com")) {
      if (window.location.href.includes("/apply/")) {
        await this.handleApplicationPage();
      } else {
        await this.handleJobPage();
      }
    }
  }

  // Get profile data from server
  async getProfileData(url) {
    try {
      this.logInfo("Getting profile data for URL", { url });

      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          {
            action: "getVacancyFieldsValues",
            data: { url },
          },
          (response) => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else {
              resolve(response);
            }
          }
        );
      });

      if (response && response.status === "success" && response.data) {
        this.logInfo("Received profile data from server");
        return response.data;
      } else {
        this.logInfo("Error getting profile data", { response });
        throw new Error(
          "Failed to get profile data: " +
            (response?.message || "Unknown error")
        );
      }
    } catch (error) {
      this.logInfo("Error getting profile data", { error: error.toString() });
      throw error;
    }
  }

  // Start keepalive pings to background script
  startKeepAlive() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
    }

    this.keepAliveInterval = setInterval(() => {
      chrome.runtime.sendMessage({ action: "keepAlive" }).catch((err) => {
        this.logInfo("Keepalive error", { error: err.toString() });
      });
    }, CONFIG.TIMEOUTS.KEEPALIVE_INTERVAL);

    this.logInfo("Started keepalive pings");
  }

  // Stop keepalive pings
  stopKeepAlive() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
      this.logInfo("Stopped keepalive pings");
    }
  }

  // Stop automation
  stop() {
    this.isRunning = false;
    this.stopKeepAlive();
    this.sendStatusUpdate("stopped", "Automation stopped");
    this.logInfo("Automation stopped");
  }

  // Send status update to background script
  sendStatusUpdate(status, message) {
    this.logInfo(`Status update: ${status} - ${message}`);

    chrome.runtime
      .sendMessage({
        action: "statusUpdate",
        status: status,
        message: message,
        platform: "workable",
        timestamp: new Date().toISOString(),
      })
      .catch((err) => {
        this.logInfo("Error sending status update", { error: err.toString() });
      });
  }

  // Check if an element is visible
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

  // Wait for an element to appear
  async waitForElement(selector, timeout = 5000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const element = document.querySelector(selector);
      if (element) {
        return element;
      }
      await this.sleep(100);
    }

    return null;
  }

  // Sleep for a given number of milliseconds
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Initialize the automation handler
const workableAutomation = new WorkableJobAutomation();

// Set up message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  workableAutomation.handleMessage(message, sender, sendResponse);
  return true;
});

// Listen for page load events
document.addEventListener("DOMContentLoaded", () => {
  console.log("Workable content script loaded on:", window.location.href);

  // Signal that the page is loaded
  chrome.runtime.sendMessage({
    action: "pageLoaded",
    url: window.location.href,
    platform: "workable",
  });
});
