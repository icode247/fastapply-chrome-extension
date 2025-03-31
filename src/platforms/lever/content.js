// import { StateManager } from "@shared/stateManager";
// import { canApplyMore } from "@shared/checkAuthorization";
// import { HOST } from "@shared/constants";
// import { LeverFileHandler } from "@shared/linkedInUtils";

// //handleSearchNext
// //searchNext
// //startApplying
// function debugLog(message, ...args) {
//   console.log(`[Lever Debug] ${message}`, ...args);
// }

// // Error logging helper
// function errorLog(message, error) {
//   console.error(`[Lever Error] ${message}`, error);
//   if (error?.stack) {
//     console.error(error.stack);
//   }
// }

// // Immediately log that the script is loaded
// debugLog("Content script loading...");

// // Custom error types
// class SendCvError extends Error {
//   constructor(message, details) {
//     super(message);
//     this.name = "SendCvError";
//     this.details = details;
//   }
// }

// class SendCvSkipError extends SendCvError {
//   constructor(message) {
//     super(message);
//     this.name = "SendCvSkipError";
//   }
// }

// /**
//  * LeverJobAutomation - Content script for automating Lever job applications
//  * Improved with reliable communication system using long-lived connections
//  */
// class LeverJobAutomation {
//   constructor() {
//     debugLog("Initializing LeverJobAutomation");

//     // Initialize state manager
//     this.stateManager = new StateManager();
//     this.processedLinksCount = 0;
//     this.STATUS_BLOCK_POSITION = "top-right";
//     this.sendCvPageNotRespondTimeout = null;
//     this.countDown = null;
//     this.ready = false;
//     this.initialized = false;

//     // CRITICAL FIX: Add flag to track application in progress state
//     this.isApplicationInProgress = false;

//     // CRITICAL FIX: Add local cache for processed URLs to prevent duplicates
//     this.processedUrls = new Set();

//     // Create connection to background script
//     this.initializeConnection();

//     // Initialize search data
//     this.SEARCH_DATA = {
//       tabId: null,
//       limit: null,
//       domain: null,
//       current: null,
//       submittedLinks: [],
//       searchLinkPattern: null,
//     };

//     this.stuckStateTimer = setInterval(() => {
//       if (this.isApplicationInProgress && this.applicationStartTime) {
//         const now = Date.now();
//         const elapsedTime = now - this.applicationStartTime;

//         // If application has been in progress for over 5 minutes, it's probably stuck
//         if (elapsedTime > 5 * 60 * 1000) {
//           debugLog(
//             "Application appears to be stuck for over 5 minutes, forcing reset"
//           );
//           this.isApplicationInProgress = false;
//           this.applicationStartTime = null;
//           this.appendStatusMessage(
//             "Application timeout detected - resetting state"
//           );
//           setTimeout(() => this.searchNext(), 1000);
//         }
//       }
//     }, 60000);

//     // Create status overlay
//     this.createStatusOverlay();

//     // Create file handler for resume uploads
//     this.fileHandler = new LeverFileHandler({
//       show: (message, type) => {
//         debugLog(`[${type || "info"}] ${message}`);
//         this.appendStatusMessage(message);
//       },
//     });

//     // Initialize based on page type
//     this.detectPageTypeAndInitialize();
//   }

//   /**
//    * Create a long-lived connection to the background script
//    */
//   initializeConnection() {
//     try {
//       const tabId = window.name || Math.floor(Math.random() * 1000000);

//       // Create a connection name based on the page type
//       // CORRECTED: Create a connection name based on the page type
//       let connectionName = window.location.href.includes("google.com/search")
//         ? `lever-search-${tabId}`
//         : `lever-apply-${tabId}`;

//       debugLog(`Creating connection: ${connectionName}`);

//       // Create the connection
//       this.port = chrome.runtime.connect({ name: connectionName });

//       // Set up message handler
//       this.port.onMessage.addListener(this.handlePortMessage.bind(this));

//       // Handle disconnection
//       this.port.onDisconnect.addListener(() => {
//         debugLog("Port disconnected. Attempting to reconnect in 1 second...");

//         // Attempt to reconnect after a brief delay
//         setTimeout(() => this.initializeConnection(), 1000);
//       });

//       debugLog("Connection established");
//     } catch (err) {
//       errorLog("Error initializing connection:", err);

//       // Try to reconnect after a delay
//       setTimeout(() => this.initializeConnection(), 2000);
//     }
//   }

//   /**
//    * Handle messages received through the port
//    */
//   handlePortMessage(message) {
//     try {
//       debugLog("Port message received:", message);

//       const type = message.type || message.action;

//       switch (type) {
//         case "SUCCESS":
//           // If this is a response to GET_SEARCH_TASK or GET_SEND_CV_TASK
//           if (message.data) {
//             if (message.data.submittedLinks !== undefined) {
//               debugLog("Processing search task data");
//               this.processSearchTaskData(message.data);
//             } else if (message.data.profile !== undefined) {
//               debugLog("Processing send CV task data");
//               this.processSendCvTaskData(message.data);
//             }
//           }
//           break;

//         case "SEARCH_NEXT":
//           debugLog("Handling search next:", message.data);
//           this.handleSearchNext(message.data);
//           break;

//         case "ERROR":
//           errorLog("Error from background script:", message.message);
//           this.appendStatusErrorMessage("Background error: " + message.message);
//           break;

//         default:
//           debugLog(`Unhandled message type: ${type}`);
//       }
//     } catch (err) {
//       errorLog("Error handling port message:", err);
//     }
//   }

//   /**
//    * Create a status overlay on the page
//    */
//   createStatusOverlay() {
//     try {
//       // Create status block if it doesn't exist
//       if (!document.getElementById("lever-automation-status")) {
//         const statusBlock = document.createElement("div");
//         statusBlock.id = "lever-automation-status";
//         statusBlock.style.cssText = `
//           position: fixed;
//           top: 10px;
//           right: 10px;
//           background-color: rgba(0, 0, 0, 0.8);
//           color: white;
//           padding: 10px;
//           border-radius: 5px;
//           z-index: 9999;
//           max-width: 300px;
//           max-height: 400px;
//           overflow-y: auto;
//           font-family: Arial, sans-serif;
//           font-size: 12px;
//         `;

//         // Add header
//         const header = document.createElement("div");
//         header.textContent = "Lever Job Automation";
//         header.style.cssText = `
//           font-weight: bold;
//           border-bottom: 1px solid white;
//           padding-bottom: 5px;
//           margin-bottom: 5px;
//         `;
//         statusBlock.appendChild(header);

//         // Add content container
//         const content = document.createElement("div");
//         content.id = "lever-automation-status-content";
//         statusBlock.appendChild(content);

//         document.body.appendChild(statusBlock);
//       }
//     } catch (err) {
//       errorLog("Error creating status overlay:", err);
//     }
//   }

//   /**
//    * Detect the page type and initialize accordingly
//    */
//   detectPageTypeAndInitialize() {
//     const url = window.location.href;
//     debugLog("Detecting page type for:", url);

//     // Wait for page to load fully
//     if (document.readyState === "loading") {
//       document.addEventListener("DOMContentLoaded", () =>
//         this.initializeByPageType(url)
//       );
//     } else {
//       this.initializeByPageType(url);
//     }
//   }

//   /**
//    * Initialize based on detected page type
//    */
//   initializeByPageType(url) {
//     debugLog("Initializing by page type:", url);

//     if (url.includes("google.com/search")) {
//       debugLog("On Google search page");
//       this.appendStatusMessage("Google search page detected");
//       this.fetchSearchTaskData();
//     } else if (url.includes("lever.co")) {
//       debugLog("On Lever job page");
//       this.appendStatusMessage("Lever job page detected");
//       this.fetchSendCvTaskData();
//     }
//   }

//   /**
//    * Fetch search task data from background script
//    */
//   fetchSearchTaskData() {
//     try {
//       debugLog("Fetching search task data");
//       this.appendStatusMessage("Fetching search task data...");

//       // Send message through the port
//       this.port.postMessage({
//         type: "GET_SEARCH_TASK",
//       });
//     } catch (err) {
//       errorLog("Error fetching search task data:", err);
//       this.appendStatusErrorMessage(err);

//       // Try again after a delay
//       setTimeout(() => this.fetchSearchTaskData(), 3000);
//     }
//   }

//   /**
//    * Fetch send CV task data from background script
//    */
//   fetchSendCvTaskData() {
//     try {
//       debugLog("Fetching send CV task data");
//       this.appendStatusMessage("Fetching CV task data...");

//       // Send message through the port
//       this.port.postMessage({
//         type: "GET_SEND_CV_TASK",
//       });
//     } catch (err) {
//       errorLog("Error fetching send CV task data:", err);
//       this.appendStatusErrorMessage(err);

//       // Try again after a delay
//       setTimeout(() => this.fetchSendCvTaskData(), 3000);
//     }
//   }

//   /**
//    * Process search task data received from background script
//    */
//   processSearchTaskData(data) {
//     try {
//       debugLog("Processing search task data:", data);

//       if (!data) {
//         debugLog("No search task data provided");
//         return;
//       }

//       const {
//         tabId,
//         limit,
//         current,
//         domain,
//         submittedLinks,
//         searchLinkPattern,
//       } = data;

//       this.SEARCH_DATA.tabId = tabId;
//       this.SEARCH_DATA.limit = limit;
//       this.SEARCH_DATA.domain = domain;
//       this.SEARCH_DATA.current = current;
//       this.SEARCH_DATA.submittedLinks = submittedLinks
//         ? submittedLinks.map((link) => ({ ...link, tries: 0 }))
//         : [];

//       if (searchLinkPattern) {
//         try {
//           // Convert string regex back to RegExp
//           if (typeof searchLinkPattern === "string") {
//             const patternParts =
//               searchLinkPattern.match(/^\/(.*?)\/([gimy]*)$/);
//             if (patternParts) {
//               this.SEARCH_DATA.searchLinkPattern = new RegExp(
//                 patternParts[1],
//                 patternParts[2]
//               );
//             } else {
//               this.SEARCH_DATA.searchLinkPattern = new RegExp(
//                 searchLinkPattern
//               );
//             }
//           } else {
//             this.SEARCH_DATA.searchLinkPattern = searchLinkPattern;
//           }
//         } catch (regexErr) {
//           errorLog("Error parsing search link pattern:", regexErr);
//           this.SEARCH_DATA.searchLinkPattern = null;
//         }
//       } else {
//         this.SEARCH_DATA.searchLinkPattern = null;
//       }

//       debugLog("Search data initialized:", this.SEARCH_DATA);
//       this.ready = true;
//       this.initialized = true;

//       this.appendStatusMessage("Search initialization complete");

//       // Start processing search results
//       setTimeout(() => this.searchNext(), 1000);
//     } catch (err) {
//       errorLog("Error processing search task data:", err);
//       this.appendStatusErrorMessage(err);
//     }
//   }

//   /**
//    * Process send CV task data received from background script
//    */
//   processSendCvTaskData(data) {
//     try {
//       debugLog("Processing send CV task data:", data);

//       if (!data) {
//         debugLog("No send CV task data provided");
//         return;
//       }

//       this.ready = true;
//       this.initialized = true;
//       this.appendStatusMessage("Apply initialization complete");

//       // Start the application process
//       setTimeout(() => this.startApplying(data), 1000);
//     } catch (err) {
//       errorLog("Error processing send CV task data:", err);
//       this.appendStatusErrorMessage(err);
//     }
//   }

//   /**
//    * Handle search next event (after a job application completes)
//    */
//   handleSearchNext(data) {
//     debugLog("Handling search next:", data);

//     try {
//       if (this.sendCvPageNotRespondTimeout) {
//         clearTimeout(this.sendCvPageNotRespondTimeout);
//       }

//       // CRITICAL FIX: Always reset the application in progress flag
//       this.isApplicationInProgress = false;

//       this.processedLinksCount++;

//       if (data && data.status !== "ERROR") {
//         this.appendStatusMessage("Successfully submitted: " + data.url);
//         this.SEARCH_DATA.submittedLinks.push({ ...data });
//       } else if (data) {
//         this.appendStatusMessage(
//           data.message || "Error occurred with: " + data.url
//         );
//         this.SEARCH_DATA.submittedLinks.push({ ...data });
//       }

//       // Continue with next search result
//       setTimeout(() => this.searchNext(), 2500);
//     } catch (err) {
//       errorLog("Error in handleSearchNext:", err);
//       this.appendStatusErrorMessage(err);

//       // CRITICAL FIX: Reset application in progress even on error
//       this.isApplicationInProgress = false;

//       // Try to continue anyway
//       setTimeout(() => this.searchNext(), 5000);
//     }
//   }

//   /**
//    * Start the job application process
//    */
//   async startApplying(data) {
//     try {
//       debugLog("Starting application process with data:", data);
//       this.appendStatusMessage("Starting application process");

//       if (
//         document.body.innerText.includes("Cannot GET") ||
//         document.location.search.includes("not_found=true")
//       ) {
//         throw new SendCvSkipError("Cannot start send cv: Page error");
//       }

//       this.countDown = this.startCountDownInStatusBlock(60 * 5, () => {
//         this.port.postMessage({
//           type: "SEND_CV_TAB_TIMER_ENDED",
//           data: {
//             url: window.location.href,
//           },
//         });
//       });

//       await new Promise((resolve, reject) => {
//         setTimeout(async () => {
//           try {
//             await this.apply(data);
//             resolve();
//           } catch (e) {
//             reject(e);
//           }
//         }, 3000);
//       });

//       this.port.postMessage({
//         type: "SEND_CV_TASK_DONE",
//         data: {
//           jobId,
//           title: "Job on Lever",
//           company: "Company on Lever",
//           location: "Not specified",
//           jobUrl:  window.location.href,
//           salary:  "Not specified",
//           workplace: "Not specified",
//           postedDate: "Not specified",
//           applicants: "Not specified",
//         },

//       });

//       this.isApplicationInProgress = false;

//       debugLog("Application completed successfully");
//     } catch (e) {
//       if (e instanceof SendCvSkipError) {
//         errorLog("Application skipped:", e.message);
//         this.port.postMessage({ type: "SEND_CV_TASK_SKIP", data: e.message });
//       } else {
//         errorLog("SEND CV ERROR", e);
//         this.appendStatusErrorMessage(e);
//         this.port.postMessage({
//           type: "SEND_CV_TASK_ERROR",
//           data: this.errorToString(e),
//         });
//       }
//       this.isApplicationInProgress = false;
//     }
//   }

//   /**
//    * Search for the next job to apply to
//    */
//   async searchNext() {
//     try {
//       debugLog("Executing searchNext");

//       if (!this.ready || !this.initialized) {
//         debugLog("Not ready or initialized yet, delaying search");
//         setTimeout(() => this.searchNext(), 1000);
//         return;
//       }

//       if (this.isApplicationInProgress) {
//         debugLog("Application in progress, not searching for next link");
//         this.appendStatusMessage(
//           "Application in progress, waiting to complete..."
//         );
//         return;
//       }

//       this.appendStatusMessage("Searching for job links...");

//       // Find all matching links
//       let links = this.findAllLinksElements();
//       debugLog(`Found ${links.length} links`);

//       // If no links on page, try to load more
//       if (links.length === 0) {
//         debugLog("No links found, trying to load more");
//         this.appendStatusMessage("No links found, trying to load more...");
//         await this.wait(2000);
//         const loadMoreBtn = this.findLoadMoreElement();
//         if (loadMoreBtn) {
//           this.appendStatusMessage('Clicking "More results" button');
//           loadMoreBtn.click();
//           await this.wait(3000);
//           this.fetchSearchTaskData();
//           return;
//         } else {
//           this.appendStatusMessage("No more results to load");
//           this.port.postMessage({ type: "SEARCH_TASK_DONE" });
//           debugLog("Search task completed");
//           return;
//         }
//       }

//       // Process links one by one - BUT USE URL-BASED TRACKING!
//       let foundUnprocessedLink = false;

//       for (let i = 0; i < links.length; i++) {
//         // Process this link
//         let url = this.normalizeUrl(links[i].href);

//         // Handle special URL patterns for Lever
//         if (
//           /^https:\/\/jobs\.(eu\.)?lever\.co\/([^\/]*)\/([^\/]*)\/?(.*)?$/.test(
//             url
//           )
//         ) {
//           url = url.replace(/\/apply$/, "");
//         }

//         // CRITICAL FIX: Use URL-based tracking instead of index-based
//         const normalizedUrl = url.toLowerCase().trim();

//         // Check if this URL is already in processed links
//         const alreadyProcessed = this.SEARCH_DATA.submittedLinks.some(
//           (link) => {
//             if (!link.url) return false;
//             const normalizedLinkUrl = link.url.toLowerCase().trim();
//             return (
//               normalizedLinkUrl === normalizedUrl ||
//               normalizedUrl.includes(normalizedLinkUrl) ||
//               normalizedLinkUrl.includes(normalizedUrl)
//             );
//           }
//         );

//         // Also check local cache
//         const inLocalCache =
//           this.processedUrls && this.processedUrls.has(normalizedUrl);

//         if (alreadyProcessed || inLocalCache) {
//           // Mark as already processed
//           this.markLinkAsColor(links[i], "orange");
//           this.appendStatusMessage(`Skipping already processed: ${url}`);
//           continue;
//         }

//         // Check if URL matches pattern
//         if (this.SEARCH_DATA.searchLinkPattern) {
//           const pattern =
//             typeof this.SEARCH_DATA.searchLinkPattern === "string"
//               ? new RegExp(
//                   this.SEARCH_DATA.searchLinkPattern.replace(
//                     /^\/|\/[gimy]*$/g,
//                     ""
//                   )
//                 )
//               : this.SEARCH_DATA.searchLinkPattern;

//           if (!pattern.test(url)) {
//             debugLog(`Link ${url} does not match pattern`);
//             this.markLinkAsColor(links[i], "red");
//             this.appendStatusMessage("Link does not match pattern - skipping");
//             continue;
//           }
//         }

//         // Found an unprocessed link
//         foundUnprocessedLink = true;
//         this.appendStatusMessage("Found job to apply: " + url);

//         // Start the CV sending task
//         try {
//           debugLog(`Sending CV task for ${url}`);
//           this.isApplicationInProgress = true;
//           this.applicationStartTime = Date.now();

//           // Add to local cache immediately
//           if (!this.processedUrls) this.processedUrls = new Set();
//           this.processedUrls.add(normalizedUrl);

//           // Send the message
//           this.port.postMessage({
//             type: "SEND_CV_TASK",
//             data: { url },
//           });

//           this.markLinkAsColor(links[i], "green");
//           this.appendStatusMessage("Opening application page...");

//           // Set timeout for unresponsive tabs
//           this.sendCvPageNotRespondTimeout = setTimeout(() => {
//             debugLog("CV page not responding, sending notification");
//             this.port.postMessage({ type: "SEND_CV_TAB_NOT_RESPOND" });
//             clearTimeout(this.sendCvPageNotRespondTimeout);
//             this.isApplicationInProgress = false;
//           }, 60_000 * 5); // 5 minutes

//           // Only process one link at a time
//           break;
//         } catch (err) {
//           errorLog(`Error sending CV task for ${url}:`, err);
//           this.appendStatusErrorMessage(err);
//           this.isApplicationInProgress = false;
//           continue;
//         }
//       }

//       // If no unprocessed links found, try to load more
//       if (!foundUnprocessedLink) {
//         debugLog("No unprocessed links found");
//         this.appendStatusMessage("No new jobs found, checking for more...");

//         const loadMoreBtn = this.findLoadMoreElement();
//         if (loadMoreBtn) {
//           debugLog("Found load more button, clicking it");
//           this.appendStatusMessage("Moving to next page...");
//           await this.wait(2000);
//           loadMoreBtn.click();
//           setTimeout(() => this.fetchSearchTaskData(), 3000);
//         } else {
//           debugLog("No more pages to load");
//           this.appendStatusMessage("All jobs processed");
//           this.port.postMessage({ type: "SEARCH_TASK_DONE" });
//         }
//       }
//     } catch (err) {
//       errorLog("Error in searchNext:", err);
//       this.appendStatusErrorMessage(err);
//       this.isApplicationInProgress = false;

//       try {
//         this.port.postMessage({
//           type: "SEARCH_TASK_ERROR",
//           data: this.errorToString(err),
//         });
//       } catch (sendErr) {
//         errorLog("Error sending error notification:", sendErr);
//       }
//     }
//   }

//   /**
//    * Find all job link elements on the page
//    */
//   findAllLinksElements() {
//     try {
//       const domains = Array.isArray(this.SEARCH_DATA.domain)
//         ? this.SEARCH_DATA.domain
//         : [this.SEARCH_DATA.domain];

//       if (!domains || domains.length === 0) {
//         debugLog("No domains specified for link search");
//         return [];
//       }

//       debugLog("Searching for links with domains:", domains);

//       // Create a combined selector for all domains
//       const selectors = domains.map((domain) => {
//         // Handle missing protocol, clean domain
//         const cleanDomain = domain
//           .replace(/^https?:\/\//, "")
//           .replace(/\/$/, "");
//         return `#rso a[href*="${cleanDomain}"], #botstuff a[href*="${cleanDomain}"]`;
//       });

//       const selector = selectors.join(",");
//       const links = document.querySelectorAll(selector);

//       debugLog(`Found ${links.length} matching links`);
//       return Array.from(links);
//     } catch (err) {
//       errorLog("Error finding links:", err);
//       return [];
//     }
//   }

//   /**
//    * Find the "More results" button
//    */
//   findLoadMoreElement() {
//     try {
//       // If we're on the last page (prev button but no next button)
//       if (
//         document.getElementById("pnprev") &&
//         !document.getElementById("pnnext")
//       ) {
//         return null;
//       }

//       // Method 1: Find "More results" button
//       const moreResultsBtn = Array.from(document.querySelectorAll("a")).find(
//         (a) => a.textContent.includes("More results")
//       );

//       if (moreResultsBtn) {
//         return moreResultsBtn;
//       }

//       // Method 2: Look for "Next" button
//       const nextBtn = document.getElementById("pnnext");
//       if (nextBtn) {
//         return nextBtn;
//       }

//       // Method 3: Try to find any navigation button at the bottom
//       const navLinks = [
//         ...document.querySelectorAll(
//           "#botstuff table a[href^='/search?q=site:']"
//         ),
//       ];
//       debugLog(`Found ${navLinks.length} potential navigation links`);

//       // Return the last one (typically "More results" or similar)
//       return navLinks[navLinks.length - 1];
//     } catch (err) {
//       errorLog("Error finding load more button:", err);
//       return null;
//     }
//   }

//   /**
//    * Mark a link with a color border
//    */
//   markLinkAsColor(linkEl, color) {
//     if (!linkEl) return;

//     try {
//       // Try to find the parent element to highlight
//       const linkWrapperEl =
//         linkEl.closest("div[jscontroller]") ||
//         linkEl.closest("div.g") ||
//         linkEl.parentElement;

//       if (linkWrapperEl) {
//         linkWrapperEl.style.border = `2px ${color} solid`;
//         linkWrapperEl.style.padding = "5px";
//         linkWrapperEl.style.borderRadius = "5px";
//         linkWrapperEl.style.margin = "5px 0";
//       } else {
//         // If no suitable parent, highlight the link itself
//         linkEl.style.border = `2px ${color} solid`;
//         linkEl.style.padding = "5px";
//         linkEl.style.borderRadius = "5px";
//         linkEl.style.display = "inline-block";
//       }
//     } catch (err) {
//       errorLog("Error marking link:", err);
//     }
//   }

//   /**
//    * Handle required checkboxes in application form
//    * Identifies and checks required checkboxes (terms, privacy policy, etc.)
//    */
//   async handleRequiredCheckboxes(form) {
//     try {
//       this.appendStatusMessage("Checking required checkboxes");

//       // Find all checkboxes in the form
//       const checkboxes = form.querySelectorAll('input[type="checkbox"]');
//       if (!checkboxes || checkboxes.length === 0) {
//         this.appendStatusMessage("No checkboxes found in form");
//         return;
//       }

//       debugLog(`Found ${checkboxes.length} checkboxes in form`);

//       // Process each checkbox to determine if it's required
//       for (const checkbox of checkboxes) {
//         // Skip if already checked
//         if (checkbox.checked) {
//           continue;
//         }

//         // Skip if not visible
//         if (
//           checkbox.offsetParent === null ||
//           checkbox.style.display === "none" ||
//           checkbox.style.visibility === "hidden"
//         ) {
//           continue;
//         }

//         // Check if it's required by attributes
//         const isRequired =
//           checkbox.hasAttribute("required") ||
//           checkbox.getAttribute("aria-required") === "true" ||
//           checkbox.classList.contains("required");

//         // Get surrounding label or container text
//         const label =
//           checkbox.closest("label") ||
//           document.querySelector(`label[for="${checkbox.id}"]`);
//         const labelText = label ? label.textContent.toLowerCase() : "";

//         // Check if label text contains required indicators
//         const hasRequiredText =
//           labelText.includes("*") ||
//           labelText.includes("required") ||
//           labelText.includes("agree to");

//         const containerDiv = checkbox.closest("div");
//         const containerText = containerDiv
//           ? containerDiv.textContent.toLowerCase()
//           : "";
//         const hasRequiredInContainer =
//           containerText.includes("*") ||
//           containerText.includes("required") ||
//           containerText.includes("must") ||
//           containerText.includes("agree to");

//         // Check for common terms/privacy checkbox patterns
//         const isTermsCheckbox =
//           labelText.includes("terms") ||
//           labelText.includes("privacy") ||
//           labelText.includes("policy") ||
//           labelText.includes("consent") ||
//           containerText.includes("terms") ||
//           containerText.includes("privacy") ||
//           containerText.includes("policy") ||
//           containerText.includes("consent");

//         // Decide if this checkbox should be checked
//         if (
//           isRequired ||
//           hasRequiredText ||
//           hasRequiredInContainer ||
//           isTermsCheckbox
//         ) {
//           this.appendStatusMessage(
//             `Checking checkbox: ${
//               labelText.slice(0, 50) || "Unlabeled checkbox"
//             }`
//           );

//           // Scroll to the checkbox
//           this.scrollToTargetAdjusted(checkbox, 100);
//           await this.wait(100);

//           // Click the checkbox
//           checkbox.click();
//           await this.wait(200);

//           // If click doesn't work, try setting checked property directly
//           if (!checkbox.checked) {
//             checkbox.checked = true;
//             checkbox.dispatchEvent(new Event("change", { bubbles: true }));
//             checkbox.dispatchEvent(new Event("input", { bubbles: true }));
//           }
//         }
//       }
//     } catch (error) {
//       debugLog("Error handling required checkboxes:", error);
//       this.appendStatusMessage(
//         `Warning: Some required checkboxes may not have been checked - ${error.message}`
//       );
//       // Continue despite errors in checkbox handling
//     }
//   }

//   /**
//    * Utility function to check if any of the field identifiers match any of the provided keywords
//    * Used for identifying form field types based on labels, placeholders, names, etc.
//    *
//    * @param {...string} fields - Variable number of field identifiers (labels, placeholders, etc.)
//    * @param {string[]} keywords - Array of keywords to match against
//    * @returns {boolean} - True if any field matches any keyword
//    */
//   matchesAny(...args) {
//     // Last argument should be the keywords array
//     if (args.length < 1) return false;
//     const keywords = args.pop();

//     if (!Array.isArray(keywords)) {
//       debugLog("matchesAny: keywords not an array");
//       return false;
//     }

//     // Check if any field matches any keyword
//     return args.some((field) => {
//       if (!field) return false;
//       const fieldLower = String(field).toLowerCase();
//       return keywords.some(
//         (keyword) =>
//           fieldLower === keyword.toLowerCase() ||
//           fieldLower.includes(keyword.toLowerCase())
//       );
//     });
//   }

//   /**
//    * Map profile data to fields - more direct approach for Lever
//    */
//   mapProfileToFields(profile) {
//     return {
//       "first name": profile.firstName,
//       "last name": profile.lastName,
//       "full name": `${profile.firstName} ${profile.lastName}`,
//       name: `${profile.firstName} ${profile.lastName}`,
//       email: profile.email,
//       phone: profile.phone || profile.phoneNumber,
//       linkedin: profile.linkedIn || profile.linkedinUrl,
//       github: profile.github || profile.githubUrl,
//       website: profile.website || profile.websiteUrl,
//       portfolio: profile.portfolio || profile.websiteUrl,
//       address: profile.streetAddress,
//       city:
//         profile.city ||
//         (profile.currentCity ? profile.currentCity.split(",")[0].trim() : ""),
//       country: profile.country,
//       company: profile.currentCompany || "Not currently employed",
//       "current company": profile.currentCompany,
//       position: profile.fullPosition,
//       title: profile.fullPosition,
//       experience: profile.yearsOfExperience,
//       salary: profile.desiredSalary,
//       "notice period": profile.noticePeriod || "2 weeks",
//       "cover letter": profile.coverLetter,
//     };
//   }

//   /**
//    * Select option by value or text in a select element
//    * Makes a best effort to find and select the correct option
//    */
//   async selectOptionByValue(select, value) {
//     if (!select || !value) return false;

//     try {
//       this.scrollToTargetAdjusted(select, 100);
//       await this.wait(100);

//       // Try to find the option by exact value first
//       let matchingOption = Array.from(select.options).find(
//         (option) => option.value.toLowerCase() === value.toLowerCase()
//       );

//       // If no exact match, try substring match on value
//       if (!matchingOption) {
//         matchingOption = Array.from(select.options).find((option) =>
//           option.value.toLowerCase().includes(value.toLowerCase())
//         );
//       }

//       // If still no match, try matching by option text
//       if (!matchingOption) {
//         matchingOption = Array.from(select.options).find(
//           (option) =>
//             option.text.toLowerCase() === value.toLowerCase() ||
//             option.text.toLowerCase().includes(value.toLowerCase())
//         );
//       }

//       // If we found a match, select it
//       if (matchingOption) {
//         select.value = matchingOption.value;
//         select.dispatchEvent(new Event("change", { bubbles: true }));
//         this.appendStatusMessage(`Selected option: ${matchingOption.text}`);
//         return true;
//       }

//       debugLog(`No matching option found for value: ${value}`);
//       return false;
//     } catch (error) {
//       debugLog("Error selecting option:", error);
//       return false;
//     }
//   }

//   /**
//    * Utility function to check if a field matches any of the provided regex patterns
//    * More powerful than matchesAny for complex pattern matching
//    *
//    * @param {string} field - Field to check
//    * @param {RegExp[]} patterns - Array of regex patterns to match against
//    * @returns {boolean} - True if field matches any pattern
//    */
//   matchesRegex(field, patterns) {
//     if (!field) return false;

//     if (!Array.isArray(patterns)) {
//       debugLog("matchesRegex: patterns not an array");
//       return false;
//     }

//     const fieldStr = String(field).toLowerCase();

//     return patterns.some((pattern) => {
//       if (pattern instanceof RegExp) {
//         return pattern.test(fieldStr);
//       } else if (typeof pattern === "string") {
//         // Create regex from string pattern
//         try {
//           const regex = new RegExp(pattern, "i");
//           return regex.test(fieldStr);
//         } catch (e) {
//           debugLog(`Invalid regex pattern: ${pattern}`, e);
//           return false;
//         }
//       }
//       return false;
//     });
//   }

//   /**
//    * Check if this is a resume upload field
//    */
//   isResumeField(labelText, container) {
//     const resumeKeywords = [
//       "resume",
//       "cv",
//       "curriculum vitae",
//       "upload resume",
//       "upload cv",
//       "attach resume",
//       "attach cv",
//       "upload your resume",
//       "upload your cv",
//     ];

//     return resumeKeywords.some((keyword) =>
//       labelText.toLowerCase().includes(keyword)
//     );
//   }

//   /**
//    * Normalize URL by removing query parameters and hash
//    */
//   normalizeUrl(link) {
//     try {
//       const url = new URL(link);
//       return url.origin + url.pathname;
//     } catch (e) {
//       errorLog("Error normalizing URL:", e);
//       return link;
//     }
//   }

//   /**
//    * Wait for specified time
//    */
//   wait(timeout) {
//     return new Promise((resolve) => setTimeout(resolve, timeout));
//   }

//   /**
//    * Append status message to overlay
//    */
//   appendStatusMessage(message) {
//     debugLog(`Status: ${message}`);

//     try {
//       const contentElement = document.getElementById(
//         "lever-automation-status-content"
//       );
//       if (contentElement) {
//         const messageElement = document.createElement("div");
//         messageElement.textContent = `${new Date().toLocaleTimeString()}: ${message}`;
//         messageElement.style.marginBottom = "5px";

//         contentElement.appendChild(messageElement);

//         // Auto-scroll to bottom
//         contentElement.scrollTop = contentElement.scrollHeight;
//       }
//     } catch (err) {
//       errorLog("Error appending status message:", err);
//     }
//   }

//   /**
//    * Append error message to overlay
//    */
//   appendStatusErrorMessage(error) {
//     const errorMessage = this.errorToString(error);
//     errorLog("Error status:", errorMessage);

//     try {
//       const contentElement = document.getElementById(
//         "lever-automation-status-content"
//       );
//       if (contentElement) {
//         const messageElement = document.createElement("div");
//         messageElement.textContent = `${new Date().toLocaleTimeString()}: ERROR: ${errorMessage}`;
//         messageElement.style.marginBottom = "5px";
//         messageElement.style.color = "red";
//         messageElement.style.fontWeight = "bold";

//         contentElement.appendChild(messageElement);

//         // Auto-scroll to bottom
//         contentElement.scrollTop = contentElement.scrollHeight;
//       }
//     } catch (err) {
//       errorLog("Error appending error message:", err);
//     }
//   }

//   /**
//    * Convert error to string representation
//    */
//   errorToString(e) {
//     if (!e) return "Unknown error (no details)";

//     if (e instanceof Error) {
//       return e.message + (e.stack ? `\n${e.stack}` : "");
//     }

//     return String(e);
//   }

//   /**
//    * Start countdown timer in status block
//    */
//   startCountDownInStatusBlock(duration, countDownEnded) {
//     this.appendStatusMessage("Timer started");

//     let timer = duration;
//     let timerElement = null;

//     try {
//       // Create timer element
//       const contentElement = document.getElementById(
//         "lever-automation-status-content"
//       );
//       timerElement = document.createElement("div");
//       timerElement.id = "lever-automation-timer";
//       timerElement.style.fontWeight = "bold";
//       timerElement.style.marginTop = "10px";
//       contentElement.appendChild(timerElement);
//     } catch (err) {
//       errorLog("Error creating timer element:", err);
//     }

//     const updateTimerDisplay = () => {
//       const minutes = Math.floor(timer / 60);
//       const seconds = timer % 60;

//       const formattedTime = `${minutes.toString().padStart(2, "0")}:${seconds
//         .toString()
//         .padStart(2, "0")}`;

//       if (timerElement) {
//         timerElement.textContent = `Time remaining: ${formattedTime}`;
//       }

//       debugLog(`Timer: ${formattedTime}`);
//     };

//     updateTimerDisplay();

//     const stop = () => {
//       if (intervalId) {
//         clearInterval(intervalId);
//       }
//     };

//     const addTime = (additionalTime) => {
//       timer += additionalTime;
//       updateTimerDisplay();
//     };

//     const intervalId = setInterval(() => {
//       timer--;

//       updateTimerDisplay();

//       if (timer <= 0) {
//         clearInterval(intervalId);
//         if (typeof countDownEnded === "function") {
//           countDownEnded();
//         }
//       }

//       // Keep the connection alive
//       if (timer % 30 === 0) {
//         try {
//           this.port.postMessage({ type: "KEEPALIVE" });
//         } catch (err) {
//           errorLog("Error sending keepalive:", err);
//         }
//       }
//     }, 1000);

//     return {
//       stop,
//       addTime,
//     };
//   }

//   // REMOVE DUPLICATES LATER ON.

//   /**
//    * Match a field label against common application question patterns
//    */
//   matchesCommonQuestion(label, keywords) {
//     if (!label) return false;

//     // For questions, we need a more flexible matching algorithm
//     // First, check for exact matches
//     for (const keyword of keywords) {
//       if (label.includes(keyword)) {
//         return true;
//       }
//     }

//     // Then, check for semantic matches
//     // e.g., "Tell us about your background" should match "experience"
//     for (const keyword of keywords) {
//       // Create variations of the keyword
//       const variations = [
//         keyword,
//         `your ${keyword}`,
//         `about ${keyword}`,
//         `about your ${keyword}`,
//         `tell us about ${keyword}`,
//         `tell us about your ${keyword}`,
//         `describe ${keyword}`,
//         `describe your ${keyword}`,
//         `share ${keyword}`,
//         `share your ${keyword}`,
//       ];

//       for (const variation of variations) {
//         if (label.includes(variation)) {
//           return true;
//         }
//       }
//     }

//     return false;
//   }

//   /**
//    * Generate a generic answer based on the question content
//    */
//   generateGenericAnswer(question) {
//     const questionLower = question.toLowerCase();

//     // Generic answer based on question type
//     if (
//       questionLower.includes("experience") ||
//       questionLower.includes("background") ||
//       questionLower.includes("tell us about yourself")
//     ) {
//       return "I have extensive experience in my field with a track record of delivering results. My background includes working with diverse teams and stakeholders to achieve business objectives. I continually focus on professional development to stay current with industry trends and best practices.";
//     }

//     if (
//       questionLower.includes("why") ||
//       questionLower.includes("interested") ||
//       questionLower.includes("passion")
//     ) {
//       return "I'm particularly interested in this opportunity because of your company's reputation for innovation and commitment to quality. The position aligns well with my career goals and would allow me to leverage my skills while continuing to grow professionally. I'm excited about the potential to contribute to your team.";
//     }

//     if (
//       questionLower.includes("strengths") ||
//       questionLower.includes("skills") ||
//       questionLower.includes("qualify")
//     ) {
//       return "My key strengths include strong analytical skills, effective communication, and the ability to adapt quickly to new challenges. I excel at problem-solving and collaborating with cross-functional teams to achieve results. My technical expertise combined with my interpersonal skills make me well-suited for this role.";
//     }

//     if (
//       questionLower.includes("weakness") ||
//       questionLower.includes("improve") ||
//       questionLower.includes("development")
//     ) {
//       return "I continuously work on improving my skills in public speaking. I've been taking courses and seeking opportunities to present to groups to build confidence in this area. I believe in honest self-assessment and actively pursue growth in areas where I can improve.";
//     }

//     if (
//       questionLower.includes("challenge") ||
//       questionLower.includes("difficult") ||
//       questionLower.includes("obstacle")
//     ) {
//       return "In a recent project, I faced significant time constraints while managing multiple priorities. I addressed this by implementing a structured planning system, clear communication with stakeholders, and breaking the project into manageable milestones. This approach allowed me to deliver successful results despite the challenges.";
//     }

//     if (
//       questionLower.includes("achievement") ||
//       questionLower.includes("proud") ||
//       questionLower.includes("accomplishment")
//     ) {
//       return "One of my key achievements was leading a cross-functional project that improved operational efficiency by 30%. This required coordinating multiple teams, overcoming technical challenges, and staying focused on business objectives. The success of this initiative was recognized by senior management and implemented across the organization.";
//     }

//     if (
//       questionLower.includes("team") ||
//       questionLower.includes("collaborate") ||
//       questionLower.includes("work with others")
//     ) {
//       return "I thrive in collaborative environments and enjoy working closely with diverse teams. I value different perspectives and believe the best solutions come from open communication and mutual respect. I'm experienced in both contributing as a team member and taking leadership roles when appropriate.";
//     }

//     if (
//       questionLower.includes("values") ||
//       questionLower.includes("culture") ||
//       questionLower.includes("environment")
//     ) {
//       return "I value environments that promote transparency, continuous learning, and mutual respect. I believe in maintaining high ethical standards and taking ownership of my work. I'm most productive in cultures that balance collaboration with individual initiative and provide opportunities for professional growth.";
//     }

//     // Default generic answer for other question types
//     return "I approach this with a combination of strategic thinking and practical experience. My background has prepared me well for handling such situations effectively. I'm confident that my skills and approach would be valuable in this context, and I'm enthusiastic about the opportunity to contribute in this area.";
//   }

//   /**
//    * Check if a label element indicates the field is required
//    */
//   isRequired(labelEl) {
//     if (!labelEl) return false;

//     // Check for asterisk in label or parent containers
//     const hasAsterisk =
//       labelEl.textContent.includes("*") ||
//       labelEl.querySelector("strong")?.textContent?.includes("*") ||
//       labelEl.parentNode?.querySelector("strong")?.textContent?.trim() === "*";

//     // Check for "required" text
//     const hasRequiredText =
//       labelEl.textContent.toLowerCase().includes("required") ||
//       labelEl.parentNode?.textContent.toLowerCase().includes("required");

//     // Check for required attribute in nearby input
//     const nearbyInput =
//       labelEl.parentNode?.querySelector("input, textarea, select") ||
//       document.querySelector(
//         `input[aria-labelledby="${labelEl.id}"], textarea[aria-labelledby="${labelEl.id}"], select[aria-labelledby="${labelEl.id}"]`
//       );

//     const inputHasRequired =
//       nearbyInput?.hasAttribute("required") ||
//       nearbyInput?.getAttribute("aria-required") === "true";

//     return hasAsterisk || hasRequiredText || inputHasRequired;
//   }

//   /**
//    * Parses Lever form questions using the actual HTML structure
//    * This specifically addresses the "cards" fields that use a hidden template with the real questions
//    */

//   /**
//    * Extract all questions from the Lever form including hidden template data
//    * @param {HTMLElement} form - The form element
//    * @returns {Object} - Mapping of field names to their questions
//    */
//   extractLeverFormQuestions(form) {
//     // Store all field name to question mappings
//     const fieldQuestions = {};

//     try {
//       this.appendStatusMessage("Extracting form questions...");

//       // First, look for the hidden template fields that contain question definitions
//       const templateFields = form.querySelectorAll(
//         'input[name*="baseTemplate"]'
//       );

//       templateFields.forEach((templateField) => {
//         try {
//           // Extract the card ID from the name attribute (e.g., cards[UUID][baseTemplate])
//           const cardIdMatch = templateField.name.match(/cards\[(.*?)\]/);
//           if (!cardIdMatch) return;

//           const cardId = cardIdMatch[1];
//           const templateValue = templateField.value;

//           // Parse the JSON template data
//           if (templateValue) {
//             const template = JSON.parse(templateValue.replace(/&quot;/g, '"'));

//             // Check if it has fields defined
//             if (template.fields && Array.isArray(template.fields)) {
//               // Map each field to its corresponding input name
//               template.fields.forEach((field, index) => {
//                 const fieldName = `cards[${cardId}][field${index}]`;
//                 fieldQuestions[fieldName] = field.text;
//                 this.appendStatusMessage(
//                   `Found template question: "${field.text}"`
//                 );
//               });
//             }
//           }
//         } catch (error) {
//           debugLog("Error parsing template field:", error);
//         }
//       });

//       // Now scan all application-question elements to find visible questions
//       const questionElements = form.querySelectorAll(".application-question");

//       questionElements.forEach((questionEl) => {
//         try {
//           // Find the label/question text
//           const labelEl = questionEl.querySelector(".application-label");
//           const textEl = labelEl?.querySelector(".text") || labelEl;

//           if (!textEl) return;

//           // Get the text content without the required asterisk
//           let questionText = textEl.textContent.trim();
//           questionText = questionText.replace(/✱$/, "").trim();

//           // Find the corresponding input/textarea
//           const inputEl = questionEl.querySelector(
//             'input:not([type="hidden"]), textarea'
//           );

//           if (inputEl && questionText) {
//             fieldQuestions[inputEl.name] = questionText;
//             this.appendStatusMessage(
//               `Found visible question: "${questionText}"`
//             );
//           }
//         } catch (error) {
//           debugLog("Error processing question element:", error);
//         }
//       });

//       this.appendStatusMessage(
//         `Extracted ${Object.keys(fieldQuestions).length} questions from form`
//       );
//       return fieldQuestions;
//     } catch (error) {
//       debugLog("Error extracting form questions:", error);
//       return {};
//     }
//   }

//   /**
//    * Enhanced method to match field names to their questions
//    * @param {HTMLElement} element - The form field element
//    * @param {Object} fieldQuestions - Mapping of field names to questions
//    * @returns {String} - The question text or null if not found
//    */
//   getQuestionForField(element, fieldQuestions) {
//     if (!element || !element.name) return null;

//     // Direct lookup by field name
//     if (fieldQuestions[element.name]) {
//       return fieldQuestions[element.name];
//     }

//     // For fields with no direct match, try the closest application-question container
//     const questionContainer = element.closest(".application-question");
//     if (questionContainer) {
//       const labelEl = questionContainer.querySelector(".application-label");
//       const textEl = labelEl?.querySelector(".text") || labelEl;

//       if (textEl) {
//         // Get text without the required asterisk
//         let questionText = textEl.textContent.trim();
//         questionText = questionText.replace(/✱$/, "").trim();

//         if (questionText) {
//           return questionText;
//         }
//       }
//     }

//     return null;
//   }

//   /**
//    * Improved handling for radio buttons and select fields
//    */

//   /**
//    * Enhanced method to handle radio button selection
//    * Uses multiple approaches to ensure the radio button is actually clicked
//    */
//   async handleRadioButtonSelection(radioButtons, value) {
//     if (!radioButtons || !radioButtons.length || !value) {
//       return false;
//     }

//     this.appendStatusMessage(`Selecting radio option: "${value}"`);
//     let selected = false;

//     // First convert boolean values to strings for comparison
//     const valueText =
//       value === true
//         ? "yes"
//         : value === false
//         ? "no"
//         : String(value).toLowerCase();

//     // Try multiple approaches to select the correct radio button
//     for (const radioBtn of radioButtons) {
//       try {
//         // Get label text in various ways
//         const labelEl =
//           radioBtn.closest("label") ||
//           document.querySelector(`label[for="${radioBtn.id}"]`);

//         let labelText = "";

//         if (labelEl) {
//           labelText = labelEl.textContent.trim().toLowerCase();
//         } else {
//           // Try to find text near the radio button
//           const parentEl = radioBtn.parentElement;
//           if (parentEl) {
//             // Get text content but exclude text from child inputs
//             const childInputs = parentEl.querySelectorAll("input");
//             let parentText = parentEl.textContent;
//             childInputs.forEach((input) => {
//               if (input !== radioBtn && input.value) {
//                 parentText = parentText.replace(input.value, "");
//               }
//             });
//             labelText = parentText.trim().toLowerCase();
//           }
//         }

//         // Try to match by value
//         if (
//           radioBtn.value &&
//           (radioBtn.value.toLowerCase() === valueText ||
//             radioBtn.value.toLowerCase().includes(valueText) ||
//             valueText.includes(radioBtn.value.toLowerCase()))
//         ) {
//           this.appendStatusMessage(
//             `Found matching radio button by value: ${radioBtn.value}`
//           );
//           await this.clickRadioButtonEffectively(radioBtn);
//           selected = true;
//           break;
//         }

//         // Try to match by label text
//         if (
//           labelText &&
//           (labelText === valueText ||
//             labelText.includes(valueText) ||
//             valueText.includes(labelText))
//         ) {
//           this.appendStatusMessage(
//             `Found matching radio button by label: ${labelText}`
//           );
//           await this.clickRadioButtonEffectively(radioBtn);
//           selected = true;
//           break;
//         }

//         // Special handling for yes/no options
//         if (
//           (labelText === "yes" &&
//             (valueText === "yes" || valueText === "true")) ||
//           (labelText === "no" && (valueText === "no" || valueText === "false"))
//         ) {
//           this.appendStatusMessage(
//             `Found matching yes/no radio button: ${labelText}`
//           );
//           await this.clickRadioButtonEffectively(radioBtn);
//           selected = true;
//           break;
//         }
//       } catch (error) {
//         debugLog(`Error processing radio button: ${error.message}`);
//         // Continue with next radio button
//       }
//     }

//     // If no match found by specific matching, try to select the first option as fallback
//     if (!selected && radioButtons.length > 0) {
//       this.appendStatusMessage(
//         `No exact match found, selecting first radio option as fallback`
//       );
//       await this.clickRadioButtonEffectively(radioButtons[0]);
//       selected = true;
//     }

//     return selected;
//   }

//   /**
//    * Click a radio button effectively using multiple approaches
//    * This ensures the radio button is actually selected
//    */
//   async clickRadioButtonEffectively(radioBtn) {
//     // First scroll to the element
//     this.scrollToTargetAdjusted(radioBtn, 100);
//     await this.wait(300);

//     // Try several approaches to ensure the radio button is clicked

//     // Approach 1: Standard click
//     radioBtn.click();
//     await this.wait(300);

//     // Check if successful
//     if (radioBtn.checked) {
//       return true;
//     }

//     // Approach 2: Click the label if available
//     const labelEl =
//       radioBtn.closest("label") ||
//       document.querySelector(`label[for="${radioBtn.id}"]`);
//     if (labelEl) {
//       labelEl.click();
//       await this.wait(300);
//     }

//     // Check if successful
//     if (radioBtn.checked) {
//       return true;
//     }

//     // Approach 3: Try setting checked property directly
//     radioBtn.checked = true;
//     radioBtn.dispatchEvent(new Event("change", { bubbles: true }));
//     await this.wait(300);

//     // Approach 4: Click parent element if still not checked
//     if (!radioBtn.checked && radioBtn.parentElement) {
//       radioBtn.parentElement.click();
//       await this.wait(300);
//     }

//     // Approach 5: Try using MouseEvents for more browser compatibility
//     if (!radioBtn.checked) {
//       const mouseDown = new MouseEvent("mousedown", {
//         bubbles: true,
//         cancelable: true,
//         view: window,
//       });

//       const mouseUp = new MouseEvent("mouseup", {
//         bubbles: true,
//         cancelable: true,
//         view: window,
//       });

//       radioBtn.dispatchEvent(mouseDown);
//       await this.wait(50);
//       radioBtn.dispatchEvent(mouseUp);
//       await this.wait(50);
//       radioBtn.click();
//       await this.wait(300);
//     }

//     return radioBtn.checked;
//   }

//   /**
//    * Enhanced method to handle select/dropdown fields
//    * Supports both native select elements and custom dropdown implementations
//    */
//   async handleSelectFieldSelection(selectElement, value) {
//     if (!selectElement || !value) {
//       return false;
//     }

//     this.appendStatusMessage(`Setting select/dropdown field to: "${value}"`);
//     const valueText = String(value).toLowerCase();

//     // Handle native select elements
//     if (selectElement.tagName === "SELECT") {
//       return await this.selectOptionByValueEnhanced(selectElement, value);
//     }

//     // Handle custom dropdown implementations

//     // First scroll to the element
//     this.scrollToTargetAdjusted(selectElement, 100);
//     await this.wait(300);

//     // Click to open the dropdown
//     selectElement.click();
//     await this.wait(700); // Longer wait for dropdown to fully open

//     // Find all possible dropdown containers
//     let dropdownContainer = null;

//     // Try various dropdown container selectors
//     const possibleContainers = [
//       document.querySelector("dialog[open]"),
//       document.querySelector(".dropdown-options"),
//       document.querySelector(".options"),
//       document.querySelector('ul[role="listbox"]'),
//       document.querySelector('div[role="listbox"]'),
//       selectElement
//         .closest('div[data-input-type="select"]')
//         ?.querySelector("ul, .options"),
//       selectElement.closest(".select-container")?.querySelector("ul, .options"),
//       selectElement.parentElement?.querySelector("ul, .options"),
//       document.querySelector(".dropdown-content"),
//       document.querySelector(".select-options"),
//       document.querySelector(".lever-dropdown"),
//     ];

//     for (const container of possibleContainers) {
//       if (container && container.offsetParent !== null) {
//         dropdownContainer = container;
//         break;
//       }
//     }

//     // If we found a dropdown container, look for matching options
//     if (dropdownContainer) {
//       // Find all option elements that might be in the dropdown
//       const options = dropdownContainer.querySelectorAll(
//         'li, .option, .dropdown-item, option, [role="option"]'
//       );

//       this.appendStatusMessage(`Found dropdown with ${options.length} options`);

//       // Try to find and click a matching option
//       let matchFound = false;

//       for (const option of options) {
//         const optionText = option.textContent.trim().toLowerCase();

//         // Match by exact text or partial text
//         if (
//           optionText === valueText ||
//           optionText.includes(valueText) ||
//           valueText.includes(optionText)
//         ) {
//           this.appendStatusMessage(
//             `Selecting dropdown option: "${option.textContent.trim()}"`
//           );
//           this.scrollToTargetAdjusted(option, 100);
//           await this.wait(300);

//           // Try clicking the option
//           option.click();
//           await this.wait(500);

//           // Check if the dropdown is now closed (indication of successful selection)
//           if (dropdownContainer.offsetParent === null) {
//             matchFound = true;
//             break;
//           }

//           // Try clicking again with MouseEvents if still open
//           const mouseDown = new MouseEvent("mousedown", {
//             bubbles: true,
//             cancelable: true,
//             view: window,
//           });

//           const mouseUp = new MouseEvent("mouseup", {
//             bubbles: true,
//             cancelable: true,
//             view: window,
//           });

//           option.dispatchEvent(mouseDown);
//           await this.wait(50);
//           option.dispatchEvent(mouseUp);
//           await this.wait(300);

//           matchFound = true;
//           break;
//         }
//       }

//       // If no match was found, try selecting the first option as fallback
//       if (!matchFound && options.length > 0) {
//         this.appendStatusMessage(
//           `No matching option found, selecting first option as fallback`
//         );
//         options[0].click();
//         await this.wait(500);
//       }

//       // If dropdown is still open, click outside to close it
//       if (dropdownContainer.offsetParent !== null) {
//         document.body.click();
//         await this.wait(300);
//       }

//       return matchFound || options.length > 0;
//     } else {
//       // Dropdown container not found
//       this.appendStatusMessage(
//         `Could not find dropdown container - trying to set value directly`
//       );

//       // Try to set the value directly on the input
//       if (selectElement.tagName === "INPUT") {
//         await this.setAdvancedInputValue(selectElement, value);
//         return true;
//       }

//       return false;
//     }
//   }

//   /**
//    * Enhanced version of selectOptionByValue that uses multiple approaches
//    */
//   async selectOptionByValueEnhanced(select, value) {
//     if (!select || !value) return false;

//     try {
//       this.scrollToTargetAdjusted(select, 100);
//       await this.wait(300);

//       // Convert value to lowercase string for comparison
//       const valueText = String(value).toLowerCase();
//       let matchFound = false;

//       // Try each option to find a match
//       for (let i = 0; i < select.options.length; i++) {
//         const option = select.options[i];
//         const optionText = option.text.toLowerCase();
//         const optionValue = option.value.toLowerCase();

//         // Try to match by text or value
//         if (
//           optionText === valueText ||
//           optionValue === valueText ||
//           optionText.includes(valueText) ||
//           valueText.includes(optionText)
//         ) {
//           // Multiple approaches to set the selected option

//           // Approach 1: Set the selectedIndex
//           select.selectedIndex = i;
//           select.dispatchEvent(new Event("change", { bubbles: true }));
//           await this.wait(300);

//           // Approach 2: Set the value
//           select.value = option.value;
//           select.dispatchEvent(new Event("change", { bubbles: true }));
//           await this.wait(300);

//           // Approach 3: Set the selected property
//           option.selected = true;
//           select.dispatchEvent(new Event("change", { bubbles: true }));

//           this.appendStatusMessage(`Selected option: ${option.text}`);
//           matchFound = true;
//           break;
//         }
//       }

//       // If no match was found, try selecting the first non-placeholder option as fallback
//       if (!matchFound && select.options.length > 0) {
//         // Skip the first option if it looks like a placeholder
//         const startIndex =
//           select.options[0].value === "" ||
//           select.options[0].text.includes("Select") ||
//           select.options[0].text.includes("Choose")
//             ? 1
//             : 0;

//         if (startIndex < select.options.length) {
//           select.selectedIndex = startIndex;
//           select.dispatchEvent(new Event("change", { bubbles: true }));
//           this.appendStatusMessage(
//             `No matching option found, selected: ${select.options[startIndex].text}`
//           );
//           return true;
//         }
//       }

//       return matchFound;
//     } catch (error) {
//       debugLog("Error in selectOptionByValueEnhanced:", error);
//       return false;
//     }
//   }

//   /**
//    * Modified fillApplicationFields function with enhanced radio and select handling
//    */
//   async fillApplicationFields(form, profile) {
//     try {
//       this.appendStatusMessage("Filling form fields...");

//       // Extract all questions from the form first
//       const fieldQuestions = this.extractLeverFormQuestions(form);

//       // Create a comprehensive field mapping from profile data
//       const fieldsValue = this.mapProfileToFields(profile);

//       // More comprehensive field selector similar to the original script
//       const FIELDS_SELECTOR =
//         'fieldset[aria-labelledby], div[role="group"][aria-labelledby], ' +
//         'input[aria-labelledby]:not([aria-hidden="true"],[type="file"]), ' +
//         'textarea[aria-labelledby], input[texts]:not([aria-hidden="true"],[type="file"]), ' +
//         'input[placeholder][inputmode="tel"]:not([aria-hidden="true"],[type="file"]), ' +
//         'input[type="text"], input[type="email"], input[type="tel"], input[type="url"], ' +
//         "textarea, select, div.select-container, " +
//         'fieldset:has(input[type="radio"]), fieldset:has(input[type="checkbox"]), ' +
//         'div:has(input[type="radio"]), div:has(input[type="checkbox"])';

//       // Gather all form fields including complex ones
//       const formElements = [...form.querySelectorAll(FIELDS_SELECTOR)];

//       // Adding debugging information about all form fields
//       debugLog(`Found ${formElements.length} form fields to process`);

//       // Process all form elements
//       for (const el of formElements) {
//         if (
//           el.classList.contains("location-input") ||
//           el.id === "location-input" ||
//           (el.name === "location" &&
//             el.parentElement.querySelector('input[name="selectedLocation"]'))
//         ) {
//           this.appendStatusMessage("Found location autocomplete field");

//           // Get location value from profile
//           let locationValue =
//             profile.currentCity ||
//             profile.city ||
//             profile.location ||
//             `${profile.firstName}'s location`;

//           // Handle the location autocomplete separately
//           await this.handleLocationAutocomplete(el, locationValue);

//           // Skip normal field handling
//           continue;
//         }
//         // Skip hidden elements
//         if (
//           el.style.display === "none" ||
//           el.offsetParent === null ||
//           el.style.visibility === "hidden" ||
//           el.getAttribute("aria-hidden") === "true"
//         ) {
//           continue;
//         }

//         // Create field info object
//         const field = {
//           element: el,
//           type: "",
//           label: "",
//           required: false,
//           options: [],
//         };

//         // IMPROVED APPROACH: First check if we have a question for this field in our extracted questions
//         const questionText = this.getQuestionForField(el, fieldQuestions);

//         if (questionText) {
//           field.label = questionText;
//           debugLog(
//             `Using extracted question: "${questionText}" for field ${
//               el.name || el.id
//             }`
//           );
//         } else {
//           // If no extracted question, fall back to standard label detection
//           const ariaLabelledBy = el.getAttribute("aria-labelledby");
//           const labelEl = ariaLabelledBy
//             ? document.getElementById(ariaLabelledBy)
//             : el.closest("label") ||
//               document.querySelector(`label[for="${el.id}"]`) ||
//               el.parentElement?.querySelector("label");

//           if (labelEl) {
//             field.label = labelEl.textContent.trim();
//             field.required = this.isRequired(labelEl);
//           } else {
//             // Try to get label from container or nearby elements
//             const container =
//               el.closest(".application-field") || el.parentElement;
//             if (container) {
//               const labelText = container
//                 .querySelector("label, .field-label, .label")
//                 ?.textContent.trim();
//               if (labelText) {
//                 field.label = labelText;
//               }
//             }

//             // If still no label, try placeholder, aria-label, or name
//             if (!field.label) {
//               field.label =
//                 el.getAttribute("placeholder") ||
//                 el.getAttribute("aria-label") ||
//                 el.getAttribute("name") ||
//                 el.id ||
//                 "";
//             }
//           }
//         }

//         // Check if required
//         field.required =
//           field.required ||
//           el.hasAttribute("required") ||
//           el.getAttribute("aria-required") === "true" ||
//           field.label.includes("*") ||
//           el.closest(".required-field") !== null;

//         // Clean up label by removing required asterisk if present
//         field.label = field.label.replace(/✱$/, "").trim();

//         // Determine field type and handle different field types
//         switch (el.nodeName) {
//           case "INPUT":
//           case "TEXTAREA":
//             field.type = el.type;
//             if (
//               el.nodeName === "INPUT" &&
//               (el.getAttribute("role") === "combobox" ||
//                 el.parentElement?.querySelector(".dropdown-icon"))
//             ) {
//               field.type = "select";
//               // Try to find and extract options
//               const selectContainer =
//                 el.closest('div[data-input-type="select"]') ||
//                 el.closest(".select-container") ||
//                 el.parentElement;
//               if (selectContainer) {
//                 const optionElements = selectContainer.querySelectorAll(
//                   "dialog ul li, .dropdown-options li, .options li"
//                 );
//                 if (optionElements.length) {
//                   field.options = [...optionElements].map((el) =>
//                     el.textContent.trim()
//                   );
//                 }
//               }
//             }
//             break;

//           case "SELECT":
//             field.type = "select";
//             field.options = [...el.querySelectorAll("option")].map((opt) =>
//               opt.textContent.trim()
//             );
//             break;

//           case "DIV":
//             // Check if this div contains radio or checkbox inputs
//             const inputs = el.querySelectorAll("input");
//             if (inputs.length > 0) {
//               field.type = inputs[0].type;
//               field.element = [...inputs];
//               field.options = [...el.querySelectorAll("label")].map((l) =>
//                 l.textContent.trim()
//               );
//             }
//             break;

//           case "FIELDSET":
//             // Fieldsets often contain radio or checkbox groups
//             const fieldsetInputs = el.querySelectorAll("input");
//             if (fieldsetInputs.length > 0) {
//               field.type = fieldsetInputs[0].type;
//               field.element = [...fieldsetInputs];
//               field.options = [...fieldsetInputs].map(
//                 (input) =>
//                   input.closest("label")?.textContent.trim() ||
//                   document
//                     .querySelector(`label[for="${input.id}"]`)
//                     ?.textContent.trim() ||
//                   ""
//               );
//             }
//             break;
//         }

//         // Get field value from mapping
//         let value = fieldsValue[field.label.toLowerCase()];

//         // Log identified field for debugging
//         debugLog(
//           `Field: "${field.label}" (${field.type}), Value: ${
//             value ? "Found" : "Not found"
//           }`
//         );

//         // If no value found by exact label match, try more flexible matching
//         if (!value) {
//           // Try looking for key terms in the label
//           const labelLower = field.label.toLowerCase();

//           // Standard profile fields
//           if (
//             this.matchesAny(labelLower, [
//               "first name",
//               "given name",
//               "firstname",
//             ])
//           ) {
//             value = profile.firstName;
//           } else if (
//             this.matchesAny(labelLower, ["last name", "surname", "lastname"])
//           ) {
//             value = profile.lastName;
//           } else if (this.matchesAny(labelLower, ["full name", "name"])) {
//             value = `${profile.firstName} ${profile.lastName}`;
//           } else if (this.matchesAny(labelLower, ["email", "e-mail"])) {
//             value = profile.email;
//           } else if (
//             this.matchesAny(labelLower, ["phone", "telephone", "mobile"])
//           ) {
//             value = profile.phone || profile.phoneNumber;
//           } else if (
//             this.matchesAny(labelLower, [
//               "linkedin",
//               "linked in",
//               "inkedin url",
//             ])
//           ) {
//             value = profile.linkedIn || profile.linkedinUrl;
//           } else if (this.matchesAny(labelLower, ["github", "git hub"])) {
//             value = profile.github || profile.githubUrl;
//           } else if (
//             this.matchesAny(labelLower, [
//               "website",
//               "portfolio",
//               "personal site",
//             ])
//           ) {
//             value = profile.website || profile.websiteUrl;
//           } else if (
//             this.matchesAny(labelLower, [
//               "company",
//               "employer",
//               "current company",
//             ])
//           ) {
//             value = profile.currentCompany || "";
//           } else if (
//             this.matchesAny(labelLower, [
//               "location",
//               "city",
//               "address",
//               "current location",
//             ])
//           ) {
//             value = profile.currentCity || profile.city || "";
//           }
//           // Common application questions
//           else if (
//             this.matchesSpecificQuestion(
//               labelLower,
//               "how did you hear about this role"
//             )
//           ) {
//             value = profile.referral || "LinkedIn";
//           } else if (
//             this.matchesSpecificQuestion(
//               labelLower,
//               "why do you want to work at"
//             )
//           ) {
//             value =
//               this.generateWhyCompanyAnswer(labelLower) ||
//               profile.whyJoin ||
//               profile.coverLetter;
//           } else if (
//             this.matchesSpecificQuestion(
//               labelLower,
//               "something impressive you've built or done"
//             )
//           ) {
//             value =
//               this.generateImpressionAnswer() ||
//               profile.achievements ||
//               profile.coverLetter;
//           } else if (
//             this.matchesCommonQuestion(labelLower, [
//               "experience",
//               "tell us about yourself",
//               "background",
//               "introduction",
//             ])
//           ) {
//             value =
//               profile.summary || profile.coverLetter || profile.additionalInfo;
//           } else if (
//             this.matchesCommonQuestion(labelLower, [
//               "why join",
//               "why interested",
//               "why do you want",
//               "why are you interested",
//             ])
//           ) {
//             value = profile.whyJoin || profile.coverLetter;
//           } else if (
//             this.matchesCommonQuestion(labelLower, [
//               "salary",
//               "compensation",
//               "pay",
//               "expect",
//             ])
//           ) {
//             value = profile.desiredSalary || "Negotiable";
//           } else if (
//             this.matchesCommonQuestion(labelLower, [
//               "start",
//               "when can you",
//               "availability",
//               "notice period",
//             ])
//           ) {
//             value = profile.availability || profile.noticePeriod || "2 weeks";
//           } else if (
//             this.matchesCommonQuestion(labelLower, [
//               "years of experience",
//               "how many years",
//               "work experience",
//             ])
//           ) {
//             value = profile.yearsOfExperience || "5+ years";
//           } else if (
//             this.matchesCommonQuestion(labelLower, [
//               "visa",
//               "authorized",
//               "legally",
//               "work authorization",
//             ])
//           ) {
//             value = "Yes"; // Default to yes for work authorization
//           } else if (
//             this.matchesCommonQuestion(labelLower, [
//               "education",
//               "degree",
//               "university",
//               "college",
//             ])
//           ) {
//             value = profile.education || "Bachelor's Degree";
//           } else if (
//             this.matchesCommonQuestion(labelLower, [
//               "skills",
//               "technologies",
//               "programming",
//               "technical",
//             ])
//           ) {
//             value =
//               profile.skills ||
//               "Please see my resume for a comprehensive list of technical skills.";
//           } else if (
//             this.matchesCommonQuestion(labelLower, [
//               "reference",
//               "referral",
//               "how did you hear",
//               "how did you find",
//             ])
//           ) {
//             value = profile.referral || "LinkedIn";
//           } else if (
//             this.matchesCommonQuestion(labelLower, ["cover letter", "cover"])
//           ) {
//             value = profile.coverLetter || "";
//           } else if (
//             this.matchesCommonQuestion(labelLower, [
//               "additional",
//               "comments",
//               "anything else",
//             ])
//           ) {
//             value =
//               profile.additionalInfo ||
//               "Thank you for considering my application. I look forward to discussing how my skills and experience align with your needs.";
//           } else if (
//             labelLower.includes("resume") ||
//             labelLower.includes("cv")
//           ) {
//             // Skip resume fields - handled separately
//             continue;
//           }
//         }

//         // For fields that still have no value, try a generic answer
//         if (!value) {
//           if (
//             el.nodeName === "TEXTAREA" ||
//             (el.nodeName === "INPUT" && el.type === "text")
//           ) {
//             value = this.generateGenericAnswer(field.label);
//             debugLog(`Generated generic answer for "${field.label}"`);
//           }
//         }

//         // Skip if no value to fill
//         if (!value) {
//           debugLog(`No value found for field: "${field.label}"`);
//           continue;
//         }

//         this.appendStatusMessage(
//           `Filling field: ${field.label} (${field.type})`
//         );

//         // Fill the field based on its type with enhanced handling
//         await this.wait(100); // Small wait to prevent race conditions

//         try {
//           // ENHANCED HANDLING FOR DIFFERENT FIELD TYPES
//           if (field.type === "radio" && Array.isArray(field.element)) {
//             // Use our enhanced radio button handling
//             await this.handleRadioButtonSelection(field.element, value);
//           } else if (
//             field.type === "checkbox" &&
//             Array.isArray(field.element)
//           ) {
//             // Handle checkbox groups
//             for (const el of field.element) {
//               this.scrollToTargetAdjusted(el, 100);

//               // For checkboxes, match by label text
//               const labelText =
//                 el.closest("label")?.textContent.trim() ||
//                 document
//                   .querySelector(`label[for="${el.id}"]`)
//                   ?.textContent.trim() ||
//                 el.parentNode?.parentNode?.textContent.trim() ||
//                 "";

//               if (
//                 labelText === value ||
//                 labelText.toLowerCase() === value.toLowerCase() ||
//                 (Array.isArray(value) && value.includes(labelText))
//               ) {
//                 // Try multiple approaches to check the box
//                 el.click();
//                 await this.wait(300);

//                 if (!el.checked) {
//                   const labelEl =
//                     el.closest("label") ||
//                     document.querySelector(`label[for="${el.id}"]`);
//                   if (labelEl) {
//                     labelEl.click();
//                     await this.wait(300);
//                   }
//                 }

//                 if (!el.checked) {
//                   el.checked = true;
//                   el.dispatchEvent(new Event("change", { bubbles: true }));
//                 }
//               }
//             }
//           } else if (field.type === "select") {
//             // Use our enhanced select field handling
//             await this.handleSelectFieldSelection(field.element, value);
//           } else {
//             // Handle text inputs and textareas
//             await this.setAdvancedInputValue(field.element, value);
//           }
//         } catch (inputError) {
//           debugLog(`Error filling field ${field.label}:`, inputError);
//           // Continue with other fields
//         }
//       }

//       // Special handling for phone fields with country code
//       if (profile.phone && profile.phoneCountryCode) {
//         const phoneInput = form.querySelector(
//           'input[type="tel"], input[name="phone"], input[placeholder*="phone"]'
//         );
//         if (phoneInput) {
//           // Handle country code dropdown if present
//           const countryCodeElement =
//             phoneInput.parentElement.querySelector('[role="combobox"]');
//           if (countryCodeElement) {
//             countryCodeElement.click();
//             await this.wait(500);

//             // Find country code dropdown items and click the matching one
//             const countryItems = document.querySelectorAll(
//               ".iti__dropdown-content li.iti__country, .country-code-dropdown li"
//             );
//             for (const item of countryItems) {
//               const dialCode = item.querySelector(
//                 ".iti__dial-code, .dial-code"
//               )?.textContent;
//               if (dialCode === profile.phoneCountryCode) {
//                 item.click();
//                 break;
//               }
//             }

//             // Set phone number without country code
//             const phoneValueWithoutCountry = profile.phone.replace(
//               profile.phoneCountryCode,
//               ""
//             );
//             await this.setAdvancedInputValue(
//               phoneInput,
//               phoneValueWithoutCountry
//             );
//           }
//         }
//       }

//       // Handle GDPR/consent checkboxes
//       await this.handleRequiredCheckboxes(form);
//     } catch (error) {
//       debugLog("Error filling application fields:", error);
//       this.appendStatusMessage(
//         `Warning: Some fields may not have been filled correctly - ${error.message}`
//       );
//       // Continue despite errors in field filling
//     }
//   }

//   /**
//    * Matches a specific question exactly
//    */
//   matchesSpecificQuestion(labelText, questionFragment) {
//     if (!labelText || !questionFragment) return false;

//     const normalizedLabel = labelText.toLowerCase().trim();
//     const normalizedQuestion = questionFragment.toLowerCase().trim();

//     return normalizedLabel.includes(normalizedQuestion);
//   }

//   /**
//    * Creates a custom "Why join this company" answer based on the question
//    */
//   generateWhyCompanyAnswer(question) {
//     // Try to extract company name from the question
//     let companyName = "";
//     const matches = question.match(
//       /why (?:do you want to|would you like to) work at\s+([^?]+)/i
//     );
//     if (matches && matches[1]) {
//       companyName = matches[1].trim();
//     }

//     if (!companyName) {
//       const altMatches = question.match(/why\s+([^?]+)/i);
//       if (
//         altMatches &&
//         altMatches[1] &&
//         (altMatches[1].includes("join") ||
//           altMatches[1].includes("interested") ||
//           altMatches[1].includes("work"))
//       ) {
//         const parts = altMatches[1].split(/\s+/);
//         if (parts.length > 0) {
//           // The last word might be the company name
//           companyName = parts[parts.length - 1];
//         }
//       }
//     }

//     if (companyName) {
//       return `I'm particularly interested in joining ${companyName} because of your reputation for innovation and commitment to excellence. After researching your company, I was impressed by your industry leadership and the positive impact you're making. The values and culture at ${companyName} align well with my own professional approach, and I'm excited about the opportunity to contribute to your continued success. I believe my skills and experiences would allow me to make meaningful contributions while also growing professionally in this role.`;
//     }

//     return null;
//   }

//   /**
//    * Generates an impressive achievement answer
//    */
//   generateImpressionAnswer() {
//     return "One of my most significant accomplishments was leading a cross-functional team on a critical project that faced numerous technical challenges and tight deadlines. Despite these obstacles, I developed a strategic approach that prioritized clear communication and iterative problem-solving. By implementing innovative solutions and fostering a collaborative environment, we not only delivered the project ahead of schedule but also exceeded the initial requirements. This experience reinforced my ability to navigate complex situations, adapt to changing conditions, and deliver meaningful results through both technical expertise and effective leadership.";
//   }

//   //DEBUGING
//   /**
//    * Enhanced debug function that shows the template extraction and question mapping
//    */
//   debugFormFieldsEnhanced(form, profile) {
//     try {
//       this.appendStatusMessage(
//         "🔍 ENHANCED DEBUGGING: Analyzing Lever form with template extraction..."
//       );

//       // Create a debug panel in the UI
//       this.createDebugPanel();
//       const debugPanel = document.getElementById("lever-debug-panel-content");

//       // Clear any existing content
//       if (debugPanel) {
//         debugPanel.innerHTML = "";

//         // Add header
//         const header = document.createElement("div");
//         header.innerHTML = "<strong>Enhanced Lever Form Analysis</strong>";
//         header.style.marginBottom = "10px";
//         debugPanel.appendChild(header);
//       }

//       // Step 1: Extract the template questions
//       const fieldQuestions = this.extractLeverFormQuestions(form);

//       // Display the extracted questions
//       if (debugPanel) {
//         const templateSection = document.createElement("div");
//         templateSection.style.marginBottom = "20px";
//         templateSection.style.padding = "10px";
//         templateSection.style.backgroundColor = "#f0f8ff";
//         templateSection.style.borderRadius = "5px";

//         const templateTitle = document.createElement("div");
//         templateTitle.innerHTML =
//           "<strong>Extracted Questions from Templates:</strong>";
//         templateTitle.style.marginBottom = "8px";
//         templateSection.appendChild(templateTitle);

//         if (Object.keys(fieldQuestions).length > 0) {
//           const questionsList = document.createElement("ul");
//           questionsList.style.margin = "0";
//           questionsList.style.paddingLeft = "20px";

//           Object.entries(fieldQuestions).forEach(
//             ([fieldName, questionText]) => {
//               const item = document.createElement("li");
//               item.innerHTML = `<code>${fieldName}</code>: "${questionText}"`;
//               questionsList.appendChild(item);
//             }
//           );

//           templateSection.appendChild(questionsList);
//         } else {
//           const noTemplates = document.createElement("div");
//           noTemplates.textContent = "No template questions found";
//           noTemplates.style.fontStyle = "italic";
//           templateSection.appendChild(noTemplates);
//         }

//         debugPanel.appendChild(templateSection);
//       }

//       // Use the comprehensive field selector
//       const FIELDS_SELECTOR =
//         'fieldset[aria-labelledby], div[role="group"][aria-labelledby], ' +
//         'input[aria-labelledby]:not([aria-hidden="true"],[type="file"]), ' +
//         'textarea[aria-labelledby], input[texts]:not([aria-hidden="true"],[type="file"]), ' +
//         'input[placeholder][inputmode="tel"]:not([aria-hidden="true"],[type="file"]), ' +
//         'input[type="text"], input[type="email"], input[type="tel"], input[type="url"], ' +
//         "textarea, select, div.select-container, " +
//         'fieldset:has(input[type="radio"]), fieldset:has(input[type="checkbox"]), ' +
//         'div:has(input[type="radio"]), div:has(input[type="checkbox"])';

//       // Find all form elements
//       const formElements = [...form.querySelectorAll(FIELDS_SELECTOR)];

//       // Create field mapping from profile data
//       const fieldsValue = this.mapProfileToFields(profile);

//       // Log to console for reference
//       console.log(`🔍 DEBUG: Found ${formElements.length} form elements`);
//       console.log("Extracted field questions:", fieldQuestions);

//       // Process each element
//       const fieldDetails = [];

//       if (debugPanel) {
//         // Add fields section header
//         const fieldsHeader = document.createElement("div");
//         fieldsHeader.innerHTML = `<strong>Form Fields Analysis (${formElements.length} fields):</strong>`;
//         fieldsHeader.style.marginBottom = "10px";
//         fieldsHeader.style.marginTop = "10px";
//         debugPanel.appendChild(fieldsHeader);
//       }

//       for (let i = 0; i < formElements.length; i++) {
//         const el = formElements[i];

//         // Skip hidden elements
//         if (
//           el.style.display === "none" ||
//           el.offsetParent === null ||
//           el.style.visibility === "hidden" ||
//           el.getAttribute("aria-hidden") === "true"
//         ) {
//           continue;
//         }

//         // Get basic element info
//         const elementType = el.nodeName.toLowerCase();
//         const elementSubType = el.type || "unknown";

//         // Find the question for this field using our new extraction method
//         const extractedQuestion = this.getQuestionForField(el, fieldQuestions);
//         let questionSource = extractedQuestion ? "template extraction" : "none";

//         // Try original label finding methods if not found from template
//         const ariaLabelledBy = el.getAttribute("aria-labelledby");
//         const labelEl = ariaLabelledBy
//           ? document.getElementById(ariaLabelledBy)
//           : el.closest("label") ||
//             document.querySelector(`label[for="${el.id}"]`) ||
//             el.parentElement?.querySelector("label");

//         let labelText = extractedQuestion || "";
//         let labelSource = extractedQuestion ? "template extraction" : "";
//         let isRequired = false;

//         if (!labelText && labelEl) {
//           labelText = labelEl.textContent.trim();
//           labelSource = "explicit label";
//           questionSource = "explicit label";
//           isRequired = this.isRequired(labelEl);
//         } else if (!labelText) {
//           // Try to get label from container or nearby elements
//           const container =
//             el.closest(".application-field") || el.parentElement;
//           if (container) {
//             const containerLabelText = container
//               .querySelector("label, .field-label, .label")
//               ?.textContent.trim();
//             if (containerLabelText) {
//               labelText = containerLabelText;
//               labelSource = "container label";
//               questionSource = "container label";
//             }
//           }

//           // If still no label, try placeholder, aria-label, or name
//           if (!labelText) {
//             if (el.getAttribute("placeholder")) {
//               labelText = el.getAttribute("placeholder");
//               labelSource = "placeholder";
//               questionSource = "placeholder";
//             } else if (el.getAttribute("aria-label")) {
//               labelText = el.getAttribute("aria-label");
//               labelSource = "aria-label";
//               questionSource = "aria-label";
//             } else if (el.getAttribute("name")) {
//               labelText = el.getAttribute("name");
//               labelSource = "name attribute";
//               questionSource = "name attribute";
//             } else if (el.id) {
//               labelText = el.id;
//               labelSource = "id";
//               questionSource = "id";
//             }
//           }

//           // Check if required from other indicators
//           isRequired =
//             el.hasAttribute("required") ||
//             el.getAttribute("aria-required") === "true" ||
//             labelText.includes("*") ||
//             (container?.textContent || "").includes("*required") ||
//             el.closest(".required-field") !== null;
//         }

//         // Clean up label by removing required asterisk if present
//         labelText = labelText.replace(/✱$/, "").trim();

//         // Determine field type and options
//         let fieldType = elementSubType;
//         let options = [];

//         // Special handling for different field types
//         if (
//           elementType === "input" &&
//           (el.getAttribute("role") === "combobox" ||
//             el.parentElement?.querySelector(".dropdown-icon"))
//         ) {
//           fieldType = "select/dropdown";

//           // Try to find and extract options
//           const selectContainer =
//             el.closest('div[data-input-type="select"]') ||
//             el.closest(".select-container") ||
//             el.parentElement;
//           if (selectContainer) {
//             const optionElements = selectContainer.querySelectorAll(
//               "dialog ul li, .dropdown-options li, .options li"
//             );
//             if (optionElements.length) {
//               options = [...optionElements].map((el) => el.textContent.trim());
//             }
//           }
//         } else if (elementType === "select") {
//           fieldType = "select/dropdown";
//           options = [...el.querySelectorAll("option")].map((opt) =>
//             opt.textContent.trim()
//           );
//         } else if (elementType === "div" || elementType === "fieldset") {
//           // Check if contains radio or checkbox inputs
//           const inputs = el.querySelectorAll("input");
//           if (inputs.length > 0) {
//             fieldType = inputs[0].type + " group";
//             options = [...el.querySelectorAll("label")].map((l) =>
//               l.textContent.trim()
//             );
//           }
//         }

//         // Find what value would be used for this field
//         let value = fieldsValue[labelText.toLowerCase()];
//         let valueSource = "direct mapping";

//         // If no value found by direct mapping, try our matching methods
//         if (!value) {
//           const labelLower = labelText.toLowerCase();

//           // Try standard profile fields
//           if (
//             this.matchesAny(labelLower, [
//               "first name",
//               "given name",
//               "firstname",
//             ])
//           ) {
//             value = profile.firstName;
//             valueSource = "first name match";
//           } else if (
//             this.matchesAny(labelLower, ["last name", "surname", "lastname"])
//           ) {
//             value = profile.lastName;
//             valueSource = "last name match";
//           } else if (this.matchesAny(labelLower, ["full name", "name"])) {
//             value = `${profile.firstName} ${profile.lastName}`;
//             valueSource = "full name match";
//           } else if (this.matchesAny(labelLower, ["email", "e-mail"])) {
//             value = profile.email;
//             valueSource = "email match";
//           } else if (
//             this.matchesAny(labelLower, ["phone", "telephone", "mobile"])
//           ) {
//             value = profile.phone || profile.phoneNumber;
//             valueSource = "phone match";
//           } else if (this.matchesAny(labelLower, ["linkedin", "linked in"])) {
//             value = profile.linkedIn || profile.linkedinUrl;
//             valueSource = "linkedin match";
//           } else if (
//             this.matchesAny(labelLower, [
//               "location",
//               "city",
//               "address",
//               "current location",
//             ])
//           ) {
//             value = profile.currentCity || profile.city || "";
//             valueSource = "location match";
//           } else if (
//             this.matchesSpecificQuestion(
//               labelLower,
//               "how did you hear about this role"
//             )
//           ) {
//             value = profile.referral || "LinkedIn";
//             valueSource = "specific question match: referral";
//           } else if (
//             this.matchesSpecificQuestion(
//               labelLower,
//               "why do you want to work at"
//             )
//           ) {
//             value =
//               this.generateWhyCompanyAnswer(labelLower) ||
//               profile.whyJoin ||
//               profile.coverLetter;
//             valueSource = "generated why company answer";
//           } else if (
//             this.matchesSpecificQuestion(
//               labelLower,
//               "something impressive you've built or done"
//             )
//           ) {
//             value =
//               this.generateImpressionAnswer() ||
//               profile.achievements ||
//               profile.coverLetter;
//             valueSource = "generated achievement answer";
//           } else if (
//             el.nodeName === "TEXTAREA" ||
//             (el.nodeName === "INPUT" && el.type === "text")
//           ) {
//             value = this.generateGenericAnswer(labelText);
//             valueSource = "generated generic answer";
//           }
//         }

//         // Add details to array for console logging
//         fieldDetails.push({
//           index: i + 1,
//           elementType,
//           fieldType,
//           label: labelText,
//           labelSource,
//           questionSource,
//           isRequired,
//           options: options.length > 0 ? options : undefined,
//           value: value
//             ? typeof value === "string" && value.length > 50
//               ? value.substring(0, 50) + "..."
//               : value
//             : "N/A",
//           valueSource: value ? valueSource : "N/A",
//           id: el.id || "none",
//           name: el.name || "none",
//           placeholder: el.placeholder || "none",
//         });

//         // Add to debug panel if available
//         if (debugPanel) {
//           const fieldInfo = document.createElement("div");
//           fieldInfo.style.border = "1px solid #ccc";
//           fieldInfo.style.padding = "10px";
//           fieldInfo.style.marginBottom = "12px";
//           fieldInfo.style.borderRadius = "4px";
//           fieldInfo.style.position = "relative";

//           // Color coding based on source and value
//           if (questionSource === "template extraction") {
//             fieldInfo.style.borderLeft = "4px solid #4CAF50"; // Green for template extraction
//           } else if (isRequired) {
//             fieldInfo.style.borderLeft = "4px solid #f44336"; // Red for required
//           }

//           if (value) {
//             fieldInfo.style.backgroundColor = "#f9f9f9"; // Light gray for fields with values
//           }

//           // Create field label
//           const fieldLabel = document.createElement("div");
//           fieldLabel.style.fontWeight = "bold";
//           fieldLabel.style.marginBottom = "5px";
//           fieldLabel.style.fontSize = "14px";
//           fieldLabel.textContent = `${i + 1}. ${labelText || "[NO LABEL]"}`;

//           if (isRequired) {
//             const requiredBadge = document.createElement("span");
//             requiredBadge.textContent = "Required";
//             requiredBadge.style.backgroundColor = "#f44336";
//             requiredBadge.style.color = "white";
//             requiredBadge.style.padding = "2px 6px";
//             requiredBadge.style.borderRadius = "3px";
//             requiredBadge.style.fontSize = "10px";
//             requiredBadge.style.marginLeft = "8px";
//             fieldLabel.appendChild(requiredBadge);
//           }

//           // Create field metadata
//           const fieldMeta = document.createElement("div");
//           fieldMeta.style.fontSize = "12px";
//           fieldMeta.style.color = "#666";
//           fieldMeta.innerHTML =
//             `Type: <code>${elementType} (${fieldType})</code><br>` +
//             `Label Source: <code>${labelSource}</code><br>` +
//             `Question Source: <code>${questionSource}</code><br>` +
//             `Element: <code>${el.name || el.id || elementType}</code>`;

//           // Add value information if available
//           if (value) {
//             const valueInfo = document.createElement("div");
//             valueInfo.style.marginTop = "8px";
//             valueInfo.style.padding = "8px";
//             valueInfo.style.backgroundColor = "#e8f5e9";
//             valueInfo.style.borderRadius = "4px";

//             const valueTitle = document.createElement("div");
//             valueTitle.innerHTML = `<strong>Will fill with:</strong> <span style="color:#2e7d32">(${valueSource})</span>`;
//             valueTitle.style.marginBottom = "4px";
//             valueInfo.appendChild(valueTitle);

//             const valueContent = document.createElement("div");
//             valueContent.style.fontSize = "12px";
//             valueContent.style.maxHeight = "60px";
//             valueContent.style.overflow = "auto";

//             if (typeof value === "string" && value.length > 100) {
//               valueContent.textContent = value.substring(0, 100) + "...";
//               valueContent.title = value; // Full text on hover
//             } else {
//               valueContent.textContent = value;
//             }

//             valueInfo.appendChild(valueContent);
//             fieldMeta.appendChild(valueInfo);
//           } else {
//             const noValueInfo = document.createElement("div");
//             noValueInfo.style.marginTop = "8px";
//             noValueInfo.style.fontStyle = "italic";
//             noValueInfo.style.color = "#999";
//             noValueInfo.textContent = "No value will be filled for this field";
//             fieldMeta.appendChild(noValueInfo);
//           }

//           // Add options if available
//           if (options.length > 0) {
//             const optionsEl = document.createElement("div");
//             optionsEl.style.fontSize = "12px";
//             optionsEl.style.marginTop = "8px";
//             optionsEl.innerHTML = `<strong>Options:</strong> ${options
//               .slice(0, 5)
//               .join(", ")}${options.length > 5 ? "..." : ""}`;
//             fieldMeta.appendChild(optionsEl);
//           }

//           // Append elements
//           fieldInfo.appendChild(fieldLabel);
//           fieldInfo.appendChild(fieldMeta);
//           debugPanel.appendChild(fieldInfo);
//         }
//       }

//       // Log detailed information to console for analysis
//       console.table(fieldDetails);

//       this.appendStatusMessage(
//         `🔍 ENHANCED DEBUG: Found ${fieldDetails.length} form fields with ${
//           Object.keys(fieldQuestions).length
//         } extracted questions`
//       );

//       return fieldDetails;
//     } catch (error) {
//       console.error("Error in debugFormFieldsEnhanced:", error);
//       this.appendStatusMessage(`Error analyzing form fields: ${error.message}`);
//       return [];
//     }
//   }

//   /**
//    * Creates a debug panel on the page
//    */
//   createDebugPanel() {
//     try {
//       // Check if panel already exists
//       if (document.getElementById("lever-debug-panel")) {
//         return;
//       }

//       // Create debug panel
//       const debugPanel = document.createElement("div");
//       debugPanel.id = "lever-debug-panel";
//       debugPanel.style.cssText = `
//         position: fixed;
//         top: 10px;
//         left: 10px;
//         background-color: rgba(255, 255, 255, 0.95);
//         border: 2px solid #007bff;
//         color: #333;
//         padding: 10px;
//         border-radius: 5px;
//         z-index: 10000;
//         width: 350px;
//         max-height: 80vh;
//         overflow-y: auto;
//         font-family: Arial, sans-serif;
//         font-size: 12px;
//         box-shadow: 0 0 10px rgba(0,0,0,0.2);
//       `;

//       // Add header with controls
//       const header = document.createElement("div");
//       header.style.cssText = `
//         display: flex;
//         justify-content: space-between;
//         align-items: center;
//         border-bottom: 1px solid #ccc;
//         padding-bottom: 8px;
//         margin-bottom: 10px;
//       `;

//       // Add title
//       const title = document.createElement("div");
//       title.textContent = "🔍 Form Field Analyzer";
//       title.style.fontWeight = "bold";

//       // Add control buttons
//       const controls = document.createElement("div");

//       // Minimize button
//       const minimizeBtn = document.createElement("button");
//       minimizeBtn.textContent = "_";
//       minimizeBtn.style.cssText = `
//         background: none;
//         border: 1px solid #ccc;
//         border-radius: 3px;
//         margin-left: 5px;
//         cursor: pointer;
//         padding: 0 5px;
//       `;
//       minimizeBtn.onclick = () => {
//         const content = document.getElementById("lever-debug-panel-content");
//         if (content.style.display === "none") {
//           content.style.display = "block";
//           minimizeBtn.textContent = "_";
//         } else {
//           content.style.display = "none";
//           minimizeBtn.textContent = "□";
//         }
//       };

//       // Close button
//       const closeBtn = document.createElement("button");
//       closeBtn.textContent = "X";
//       closeBtn.style.cssText = `
//         background: none;
//         border: 1px solid #ccc;
//         border-radius: 3px;
//         margin-left: 5px;
//         cursor: pointer;
//         padding: 0 5px;
//       `;
//       closeBtn.onclick = () => {
//         document.body.removeChild(debugPanel);
//       };

//       controls.appendChild(minimizeBtn);
//       controls.appendChild(closeBtn);

//       header.appendChild(title);
//       header.appendChild(controls);
//       debugPanel.appendChild(header);

//       // Add content container
//       const content = document.createElement("div");
//       content.id = "lever-debug-panel-content";
//       debugPanel.appendChild(content);

//       // Add to page
//       document.body.appendChild(debugPanel);
//     } catch (error) {
//       console.error("Error creating debug panel:", error);
//     }
//   }

//   /**
//    * Enhanced radio button handling specifically for Lever's format
//    */

//   /**
//    * Process the hidden template data to extract question information
//    * This helps us understand the structure of radio buttons and multi-choice options
//    * @param {HTMLElement} form - The form element
//    * @returns {Object} - Mapping of field names to their questions and options
//    */
//   extractLeverTemplateData(form) {
//     const templateData = {};

//     try {
//       // Find all hidden template fields
//       const templateInputs = form.querySelectorAll(
//         'input[name*="baseTemplate"]'
//       );

//       templateInputs.forEach((input) => {
//         try {
//           // Extract card ID from input name
//           const cardIdMatch = input.name.match(/cards\[(.*?)\]/);
//           if (!cardIdMatch) return;

//           const cardId = cardIdMatch[1];
//           const templateValue = input.value;

//           // Parse the JSON template data
//           if (templateValue) {
//             // Fix escaped quotes
//             const cleanedValue = templateValue.replace(/&quot;/g, '"');
//             const template = JSON.parse(cleanedValue);

//             // Process fields from the template
//             if (template.fields && Array.isArray(template.fields)) {
//               template.fields.forEach((field, index) => {
//                 const fieldName = `cards[${cardId}][field${index}]`;

//                 templateData[fieldName] = {
//                   question: field.text,
//                   type: field.type,
//                   required: field.required,
//                   options: field.options || [],
//                 };

//                 this.appendStatusMessage(
//                   `Found template field: "${field.text}" (${field.type})`
//                 );
//               });
//             }
//           }
//         } catch (error) {
//           debugLog("Error parsing template data:", error);
//         }
//       });

//       debugLog("Extracted template data:", templateData);
//       return templateData;
//     } catch (error) {
//       debugLog("Error extracting template data:", error);
//       return {};
//     }
//   }

//   /**
//    * Enhanced method specifically for handling Lever's radio button fields
//    * @param {HTMLElement} form - The form element containing the radio buttons
//    * @param {Object} profile - The profile data used to determine values
//    */
//   async handleLeverRadioButtons(form, profile) {
//     try {
//       this.appendStatusMessage("Processing radio button fields");

//       // Extract template data for better understanding of radio fields
//       const templateData = this.extractLeverTemplateData(form);

//       // Find all multiple-choice question containers
//       const radioGroups = form.querySelectorAll(
//         '.application-question ul[data-qa="multiple-choice"]'
//       );

//       for (const radioGroup of radioGroups) {
//         // Find the parent question container
//         const questionContainer = radioGroup.closest(".application-question");
//         if (!questionContainer) continue;

//         // Get the question text
//         const questionEl = questionContainer.querySelector(
//           ".application-label .text"
//         );
//         if (!questionEl) continue;

//         // Clean up the question text (remove the required asterisk)
//         const questionText = questionEl.textContent.replace(/✱$/, "").trim();

//         // Find the radio inputs in this group
//         const radioInputs = radioGroup.querySelectorAll('input[type="radio"]');
//         if (!radioInputs.length) continue;

//         // Get the name of the first radio which identifies the group
//         const radioName = radioInputs[0].name;

//         // Decide what value to use for this radio group
//         let selectedValue = null;

//         // Special handling for common questions
//         if (questionText.includes("legally authorized to work")) {
//           selectedValue = "Yes";
//           this.appendStatusMessage(`Setting work authorization to: Yes`);
//         } else if (questionText.includes("require sponsorship")) {
//           selectedValue = "No";
//           this.appendStatusMessage(`Setting visa sponsorship to: No`);
//         } else if (questionText.toLowerCase().includes("authorized")) {
//           selectedValue = "Yes";
//           this.appendStatusMessage(`Setting authorization question to: Yes`);
//         } else if (questionText.toLowerCase().includes("eligible to work")) {
//           selectedValue = "Yes";
//           this.appendStatusMessage(`Setting work eligibility to: Yes`);
//         } else if (
//           questionText.toLowerCase().includes("relocate") ||
//           questionText.toLowerCase().includes("relocation")
//         ) {
//           selectedValue = "Yes";
//           this.appendStatusMessage(`Setting relocation question to: Yes`);
//         } else if (
//           questionText.toLowerCase().includes("remote") ||
//           questionText.toLowerCase().includes("work from home")
//         ) {
//           selectedValue = "Yes";
//           this.appendStatusMessage(`Setting remote work question to: Yes`);
//         } else if (
//           questionText.toLowerCase().includes("background check") ||
//           questionText.toLowerCase().includes("background screening")
//         ) {
//           selectedValue = "Yes";
//           this.appendStatusMessage(`Setting background check consent to: Yes`);
//         } else if (
//           questionText.toLowerCase().includes("privacy") ||
//           questionText.toLowerCase().includes("terms and conditions")
//         ) {
//           selectedValue = "Yes";
//           this.appendStatusMessage(`Setting privacy consent to: Yes`);
//         } else if (questionText.toLowerCase().includes("18 years")) {
//           selectedValue = "Yes";
//           this.appendStatusMessage(`Setting age verification to: Yes`);
//         } else if (
//           questionText.toLowerCase().includes("criminal") ||
//           questionText.toLowerCase().includes("convicted")
//         ) {
//           selectedValue = "No";
//           this.appendStatusMessage(`Setting criminal history to: No`);
//         }
//         // Check template data if we have more info about this field
//         else if (templateData[radioName]) {
//           const fieldInfo = templateData[radioName];

//           // For generic yes/no questions, default to Yes for positive questions
//           // and No for negative questions
//           if (
//             fieldInfo.type === "multiple-choice" &&
//             fieldInfo.options.length === 2 &&
//             fieldInfo.options.some((opt) => opt.text === "Yes") &&
//             fieldInfo.options.some((opt) => opt.text === "No")
//           ) {
//             // Check if question contains negative words
//             const negativeWords = [
//               "not",
//               "criminal",
//               "felony",
//               "misdemeanor",
//               "convict",
//             ];
//             const isNegativeQuestion = negativeWords.some((word) =>
//               questionText.toLowerCase().includes(word)
//             );

//             selectedValue = isNegativeQuestion ? "No" : "Yes";
//             this.appendStatusMessage(
//               `Setting ${questionText} to: ${selectedValue} (default assumption)`
//             );
//           }
//         }

//         // If we couldn't determine a value, default to first option
//         if (!selectedValue && radioInputs.length > 0) {
//           selectedValue = radioInputs[0].value;
//           this.appendStatusMessage(
//             `No rule for "${questionText}" - defaulting to first option: ${selectedValue}`
//           );
//         }

//         // Now find and click the radio button with the selected value
//         if (selectedValue) {
//           let radioClicked = false;

//           for (const radio of radioInputs) {
//             if (radio.value === selectedValue) {
//               // Scroll to the radio
//               this.scrollToTargetAdjusted(radio, 100);
//               await this.wait(300);

//               // Try clicking the label (more reliable in Lever forms)
//               const label = radio.closest("label");
//               if (label) {
//                 label.click();
//                 this.appendStatusMessage(
//                   `Clicked label for option: ${selectedValue}`
//                 );
//               } else {
//                 radio.click();
//                 this.appendStatusMessage(
//                   `Clicked radio button: ${selectedValue}`
//                 );
//               }

//               // Wait for potential UI updates
//               await this.wait(500);

//               // Verify the radio was actually selected
//               if (!radio.checked) {
//                 radio.checked = true;
//                 radio.dispatchEvent(new Event("change", { bubbles: true }));
//                 this.appendStatusMessage(`Set radio checked property directly`);
//               }

//               radioClicked = true;
//               break;
//             }
//           }

//           if (!radioClicked) {
//             this.appendStatusMessage(
//               `Warning: Could not find radio option "${selectedValue}" for question "${questionText}"`
//             );
//           }
//         }
//       }
//     } catch (error) {
//       debugLog("Error handling Lever radio buttons:", error);
//       this.appendStatusMessage(
//         `Warning: Error processing radio buttons - ${error.message}`
//       );
//     }
//   }

//   /**
//    * Enhanced method for handling select fields in Lever forms
//    */
//   async handleLeverSelectFields(form, profile) {
//     try {
//       this.appendStatusMessage("Processing select fields");

//       // Find all select elements
//       const selectElements = form.querySelectorAll("select");

//       for (const select of selectElements) {
//         // Skip hidden selects
//         if (select.offsetParent === null || select.style.display === "none")
//           continue;

//         // Get the question container
//         const questionContainer = select.closest(".application-question");
//         if (!questionContainer) continue;

//         // Get the question text
//         const questionEl = questionContainer.querySelector(
//           ".application-label .text"
//         );
//         if (!questionEl) continue;

//         // Clean up the question text
//         const questionText = questionEl.textContent.replace(/✱$/, "").trim();

//         // Determine a value to select based on the question
//         let selectedValue = null;

//         // Special handling for common dropdown types
//         if (
//           questionText.toLowerCase().includes("university") ||
//           questionText.toLowerCase().includes("school") ||
//           questionText.toLowerCase().includes("college") ||
//           questionText.toLowerCase().includes("education")
//         ) {
//           // If profile has education information, use that
//           if (profile.education) {
//             selectedValue = profile.education;
//           } else {
//             // Otherwise pick a reasonable default
//             selectedValue = "Other - School Not Listed";
//           }

//           this.appendStatusMessage(
//             `Setting university selection to: ${selectedValue}`
//           );
//         } else if (
//           questionText.toLowerCase().includes("gender") ||
//           questionText.toLowerCase().includes("sex")
//         ) {
//           // Default to "Prefer not to say" for gender questions if available
//           const preferOptions = Array.from(select.options).filter(
//             (opt) =>
//               opt.text.toLowerCase().includes("prefer") ||
//               opt.text.toLowerCase().includes("decline")
//           );

//           if (preferOptions.length > 0) {
//             selectedValue = preferOptions[0].value;
//             this.appendStatusMessage(
//               `Setting gender selection to: ${preferOptions[0].text}`
//             );
//           }
//         } else if (
//           questionText.toLowerCase().includes("race") ||
//           questionText.toLowerCase().includes("ethnicity")
//         ) {
//           // Default to "Prefer not to say" for race/ethnicity questions if available
//           const preferOptions = Array.from(select.options).filter(
//             (opt) =>
//               opt.text.toLowerCase().includes("prefer") ||
//               opt.text.toLowerCase().includes("decline")
//           );

//           if (preferOptions.length > 0) {
//             selectedValue = preferOptions[0].value;
//             this.appendStatusMessage(
//               `Setting ethnicity selection to: ${preferOptions[0].text}`
//             );
//           }
//         } else if (
//           questionText.toLowerCase().includes("salary") ||
//           questionText.toLowerCase().includes("compensation")
//         ) {
//           // For salary expectations, pick a mid-range value if available
//           const options = Array.from(select.options);
//           if (options.length > 2) {
//             // Skip first empty option
//             const midIndex = Math.floor(options.length / 2);
//             selectedValue = options[midIndex].value;
//             this.appendStatusMessage(
//               `Setting salary expectation to: ${options[midIndex].text}`
//             );
//           }
//         } else if (
//           questionText.toLowerCase().includes("source") ||
//           questionText.toLowerCase().includes("hear about") ||
//           questionText.toLowerCase().includes("referred")
//         ) {
//           // For referral source, prefer LinkedIn
//           const linkedInOption = Array.from(select.options).find((opt) =>
//             opt.text.toLowerCase().includes("linkedin")
//           );

//           if (linkedInOption) {
//             selectedValue = linkedInOption.value;
//             this.appendStatusMessage(
//               `Setting referral source to: ${linkedInOption.text}`
//             );
//           } else if (select.options.length > 1) {
//             // Pick the second option (first is usually blank)
//             selectedValue = select.options[1].value;
//             this.appendStatusMessage(
//               `Setting referral source to: ${select.options[1].text}`
//             );
//           }
//         }

//         // If we've determined a value to use, select it
//         if (selectedValue) {
//           await this.selectOptionByValueEnhanced(select, selectedValue);
//         } else if (select.options.length > 1) {
//           // Default to selecting the first non-empty option
//           const firstNonEmptyOpt = Array.from(select.options).find(
//             (opt) => opt.value && opt.value !== "" && !opt.disabled
//           );

//           if (firstNonEmptyOpt) {
//             await this.selectOptionByValueEnhanced(
//               select,
//               firstNonEmptyOpt.value
//             );
//             this.appendStatusMessage(
//               `Selected default option for ${questionText}: ${firstNonEmptyOpt.text}`
//             );
//           }
//         }
//       }
//     } catch (error) {
//       debugLog("Error handling Lever select fields:", error);
//       this.appendStatusMessage(
//         `Warning: Error processing select fields - ${error.message}`
//       );
//     }
//   }

//   /**
//    * Improved scrollToTargetAdjusted method that checks if element is valid before scrolling
//    */
//   scrollToTargetAdjusted(element, offset) {
//     if (!element) {
//       debugLog("Warning: Attempted to scroll to null element");
//       return;
//     }

//     try {
//       // Handle case where element might be an array
//       if (Array.isArray(element)) {
//         debugLog("Element is an array, using first element");
//         if (element.length > 0) {
//           element = element[0];
//         } else {
//           debugLog("Empty array provided to scrollToTargetAdjusted");
//           return;
//         }
//       }

//       // Check if element has the necessary methods and properties
//       if (
//         !element.getBoundingClientRect ||
//         typeof element.getBoundingClientRect !== "function"
//       ) {
//         debugLog(`Cannot scroll to element: ${typeof element}, ${element}`);
//         return;
//       }

//       const rect = element.getBoundingClientRect();
//       const scrollTop =
//         window.pageYOffset || document.documentElement.scrollTop;

//       window.scrollTo({
//         top: rect.top + scrollTop - offset,
//         behavior: "smooth",
//       });
//     } catch (err) {
//       debugLog("Error scrolling to element:", err);
//       // Continue execution even if scrolling fails
//     }
//   }

//   /**
//    * Improved setAdvancedInputValue with better error handling
//    */
//   async setAdvancedInputValue(input, value) {
//     if (!input || value === undefined || value === null) return;

//     try {
//       // Handle case where input might be an array
//       if (Array.isArray(input)) {
//         debugLog("Input is an array, using first element");
//         if (input.length > 0) {
//           input = input[0];
//         } else {
//           debugLog("Empty array provided to setAdvancedInputValue");
//           return;
//         }
//       }

//       // Verify input is a proper element with value property
//       if (!input.value && typeof input.value !== "string") {
//         debugLog(`Cannot set value for element: ${typeof input}, ${input}`);
//         return;
//       }

//       // Scroll to the element first (with error handling)
//       try {
//         this.scrollToTargetAdjusted(input, 100);
//       } catch (scrollError) {
//         debugLog(
//           "Error scrolling, but continuing with value setting:",
//           scrollError
//         );
//       }

//       await this.wait(100);

//       // Safely attempt to click and focus
//       try {
//         // Only call methods if they exist
//         if (typeof input.click === "function") {
//           input.click();
//         }

//         if (typeof input.focus === "function") {
//           input.focus();
//         }

//         await this.wait(50);
//       } catch (focusError) {
//         debugLog(
//           "Error clicking/focusing input, continuing anyway:",
//           focusError
//         );
//       }

//       // Clear any existing value first
//       input.value = "";

//       try {
//         input.dispatchEvent(new Event("input", { bubbles: true }));
//       } catch (eventError) {
//         debugLog("Error dispatching input event:", eventError);
//       }

//       // Handle special date inputs
//       if (
//         input.parentElement?.querySelector('[data-ui="calendar-icon"]') ||
//         input.parentElement?.querySelector(".calendar-icon")
//       ) {
//         try {
//           input.click();
//           input.dispatchEvent(new Event("keydown", { bubbles: true }));
//         } catch (calendarError) {
//           debugLog("Error handling date input:", calendarError);
//         }
//       }

//       // Set the value using both direct and native approaches
//       input.value = value;

//       try {
//         this.setNativeValue(input, value);
//       } catch (nativeError) {
//         debugLog("Error setting native value:", nativeError);
//         // Continue anyway since we've already set the value directly
//       }

//       // Dispatch events
//       const events = ["input", "change", "blur"];
//       for (const eventName of events) {
//         try {
//           input.dispatchEvent(new Event(eventName, { bubbles: true }));
//           await this.wait(50);
//         } catch (eventError) {
//           debugLog(`Error dispatching ${eventName} event:`, eventError);
//         }
//       }

//       // Extra check - if value didn't stick
//       if (input.value !== value) {
//         try {
//           if (typeof input.click === "function") {
//             input.click();
//           }
//           await this.wait(50);
//           input.value = value;

//           // Try again with the native approach
//           try {
//             this.setNativeValue(input, value);
//           } catch (retryError) {
//             debugLog("Error in retry of native value setting:", retryError);
//           }

//           // Dispatch events again
//           for (const eventName of events) {
//             try {
//               input.dispatchEvent(new Event(eventName, { bubbles: true }));
//               await this.wait(50);
//             } catch (eventError) {
//               debugLog(
//                 `Error dispatching ${eventName} event on retry:`,
//                 eventError
//               );
//             }
//           }
//         } catch (retryError) {
//           debugLog("Error in value setting retry:", retryError);
//         }
//       }
//     } catch (error) {
//       debugLog(`Error setting value for input:`, error);
//       // We don't throw here to allow the form filling to continue with other fields
//     }
//   }

//   /**
//    * Improved setNativeValue with better error handling
//    */
//   setNativeValue(element, value) {
//     try {
//       // Handle case where element might be an array
//       if (Array.isArray(element)) {
//         if (element.length > 0) {
//           element = element[0];
//         } else {
//           return;
//         }
//       }

//       // Check if element has value property
//       if (typeof element.value === "undefined") {
//         return;
//       }

//       const ownPropertyDescriptor = Object.getOwnPropertyDescriptor(
//         element,
//         "value"
//       );

//       if (!ownPropertyDescriptor) {
//         element.value = value;
//         this.dispatchInputEvent(element);
//         return;
//       }

//       const valueSetter = ownPropertyDescriptor.set;
//       const prototype = Object.getPrototypeOf(element);

//       // Protection against properties not existing
//       if (!prototype) {
//         element.value = value;
//         this.dispatchInputEvent(element);
//         return;
//       }

//       const prototypePropertyDescriptor = Object.getOwnPropertyDescriptor(
//         prototype,
//         "value"
//       );

//       if (!prototypePropertyDescriptor || !prototypePropertyDescriptor.set) {
//         element.value = value;
//         this.dispatchInputEvent(element);
//         return;
//       }

//       const prototypeValueSetter = prototypePropertyDescriptor.set;

//       if (valueSetter && valueSetter !== prototypeValueSetter) {
//         prototypeValueSetter.call(element, value);
//       } else {
//         valueSetter.call(element, value);
//       }

//       this.dispatchInputEvent(element);
//     } catch (error) {
//       debugLog("Error in setNativeValue:", error);
//       // Fallback to direct setting
//       try {
//         element.value = value;
//       } catch (fallbackError) {
//         debugLog("Error in fallback value setting:", fallbackError);
//       }
//     }
//   }

//   /**
//    * Safe dispatch input event
//    */
//   dispatchInputEvent(element) {
//     try {
//       if (element && typeof element.dispatchEvent === "function") {
//         element.dispatchEvent(new Event("input", { bubbles: true }));
//       }
//     } catch (error) {
//       debugLog("Error dispatching input event:", error);
//     }
//   }

//   /**
//    * Apply to the job
//    * This implementation fills out the Lever application form and uploads resume
//    * Now extracts job details and sends them to the background script
//    */
//   async apply(data) {
//     this.appendStatusMessage("Starting job application process");
//     debugLog("Starting application with data:", data);
//     const debugMode = data.debugMode || true;

//     // Wait for page to load completely
//     await this.wait(3000);

//     // Check if we're already on an application page, if not try to navigate to it
//     if (!window.location.href.includes("/apply")) {
//       // Look for an apply button
//       let applyButton = null;

//       // Try different selectors for the apply button
//       const applySelectors = [
//         'a.postings-btn[href*="/apply"]',
//         'a[href*="/apply"]',
//         'a.button[href*="/apply"]',
//         "a.apply-button",
//         'a:contains("Apply")',
//         'button:contains("Apply")',
//         ".apply-button",
//         ".btn-apply",
//       ];

//       for (const selector of applySelectors) {
//         try {
//           // For :contains selector we need a different approach
//           if (selector.includes(":contains")) {
//             const text = selector
//               .match(/:contains\("(.+?)"\)/)[1]
//               .toLowerCase();
//             const elements = Array.from(document.querySelectorAll("a, button"));
//             applyButton = elements.find(
//               (el) =>
//                 el.textContent.toLowerCase().includes(text) &&
//                 (el.href?.includes("/apply") || !el.href)
//             );
//           } else {
//             applyButton = document.querySelector(selector);
//           }

//           if (applyButton) {
//             this.appendStatusMessage(
//               `Found apply button: ${applyButton.textContent || "Apply"}`
//             );
//             break;
//           }
//         } catch (e) {
//           debugLog(`Error finding apply button with selector ${selector}:`, e);
//         }
//       }

//       // Click the apply button or navigate to /apply URL
//       if (applyButton) {
//         this.appendStatusMessage("Clicking apply button");
//         applyButton.click();
//         await this.wait(5000); // Wait for navigation
//       } else {
//         // No button found, try to construct and navigate to the apply URL
//         const applyUrl = window.location.href.endsWith("/")
//           ? window.location.href + "apply"
//           : window.location.href + "/apply";

//         this.appendStatusMessage(
//           `No apply button found, navigating to: ${applyUrl}`
//         );
//         window.location.href = applyUrl;
//         await this.wait(5000); // Wait for navigation
//       }
//     }

//     // Find application form with multiple selectors
//     let applicationForm = null;
//     const formSelectors = [
//       "form.application-form",
//       'form[action*="/apply"]',
//       'form[data-formtype="application"]',
//       "form#application-form",
//       "form.lever-apply-form",
//       "form.lever-job-apply",
//       'form[name="application-form"]',
//       "form", // Last resort - any form
//     ];

//     for (const selector of formSelectors) {
//       applicationForm = document.querySelector(selector);
//       if (applicationForm) {
//         this.appendStatusMessage(
//           `Found application form using selector: ${selector}`
//         );
//         break;
//       }
//     }

//     // If we still don't have a form, try a different approach
//     if (!applicationForm) {
//       debugLog(
//         "No form found with standard selectors, trying alternative detection"
//       );

//       // Check for any form that contains typical application fields
//       const forms = document.querySelectorAll("form");
//       for (const form of forms) {
//         const hasNameField = form.querySelector(
//           'input[name*="name"], input[placeholder*="name"]'
//         );
//         const hasEmailField = form.querySelector(
//           'input[type="email"], input[name*="email"]'
//         );

//         if (hasNameField && hasEmailField) {
//           applicationForm = form;
//           this.appendStatusMessage(
//             "Found application form through field detection"
//           );
//           break;
//         }
//       }

//       // If we still have no form, look for application container and then form
//       if (!applicationForm) {
//         const containers = document.querySelectorAll(
//           ".application-container, .application, #application, .lever-application"
//         );
//         for (const container of containers) {
//           const form = container.querySelector("form");
//           if (form) {
//             applicationForm = form;
//             this.appendStatusMessage(
//               "Found application form through container detection"
//             );
//             break;
//           }
//         }
//       }
//     }

//     if (!applicationForm) {
//       // Try one last check - are there any text inputs and a resume upload field?
//       const textInputs = document.querySelectorAll(
//         'input[type="text"], input[type="email"]'
//       );
//       const fileInputs = document.querySelectorAll('input[type="file"]');

//       if (textInputs.length > 0 && fileInputs.length > 0) {
//         // Assume the closest parent that contains both is the "form"
//         let commonParent = null;
//         for (const input of textInputs) {
//           if (commonParent) break;

//           let parent = input.parentElement;
//           while (parent && parent !== document.body) {
//             if (parent.contains(fileInputs[0])) {
//               commonParent = parent;
//               break;
//             }
//             parent = parent.parentElement;
//           }
//         }

//         if (commonParent) {
//           applicationForm = commonParent;
//           this.appendStatusMessage("Using form container as form element");
//         }
//       }
//     }

//     // If still no form, we can't continue
//     if (!applicationForm) {
//       // Let's log what we found for debugging
//       debugLog(
//         "Page HTML:",
//         document.body.innerHTML.substring(0, 1000) + "..."
//       );
//       throw new SendCvSkipError("Cannot find application form");
//     }

//     this.appendStatusMessage("Form found, filling out fields");

//     // If form found and debug mode enabled, analyze all form fields first
//     if (applicationForm && debugMode) {
//       this.appendStatusMessage("Debug mode enabled - analyzing form fields");
//       this.debugFormFieldsEnhanced(applicationForm, data.profile);
//     }

//     try {
//       // ADDED: First handle specialized Lever field types for radio buttons and selects
//       await this.handleLeverRadioButtons(applicationForm, data.profile);
//       await this.handleLeverSelectFields(applicationForm, data.profile);

//       // Then proceed with standard field filling
//       await this.fillApplicationFields(applicationForm, data.profile);

//       const resumeUploaded = await this.fileHandler.handleResumeUpload(
//         data.profile,
//         applicationForm
//       );

//       if (!resumeUploaded) {
//         this.appendStatusMessage("Resume upload failed through all methods");
//       }

//       // Find and check any required checkboxes (privacy policy, terms, etc.)
//       await this.handleRequiredCheckboxes(applicationForm);

//       // Find submit button
//       const submitButton =
//         applicationForm.querySelector(
//           'button[type="submit"], input[type="submit"], button.submit-button'
//         ) ||
//         document.querySelector(
//           'button[type="submit"], input[type="submit"], button:contains("Submit"), button:contains("Apply")'
//         );

//       if (!submitButton) {
//         throw new SendCvSkipError("Cannot find submit button");
//       }

//       // Scroll to button and click it if not in dev mode
//       this.scrollToTargetAdjusted(submitButton, 100);
//       await this.wait(1000);

//       // Check if we should actually submit or just simulate it
//       if (data.devMode) {
//         this.appendStatusMessage("DEV MODE: Simulating form submission");
//         await this.wait(2000);

//         // Even in dev mode, send the job details to background for tracking
//         this.port.postMessage({
//           type: "SEND_CV_TASK_DONE",
//           data: {
//             jobId,
//             title: "Job on Lever",
//             company: "Company on Lever",
//             location: "Not specified",
//             jobUrl:  window.location.href,
//             salary:  "Not specified",
//             workplace: "Not specified",
//             postedDate: "Not specified",
//             applicants: "Not specified",
//           },
//         });
//       } else {
//         this.appendStatusMessage("Submitting application form");
//         submitButton.click();

//         // Wait for submission to complete
//         await this.wait(5000);

//         // Check for confirmation message
//         const confirmationElement = document.querySelector(
//           ".application-success, .confirmation-page, .thank-you-page"
//         );
//         if (confirmationElement) {
//           this.appendStatusMessage("Application successfully submitted!");

//           // Send job details to background script for tracking
//           this.port.postMessage({
//             type: "SEND_CV_TASK_DONE",
//             data: {
//               jobId,
//               title: "Job on Lever",
//               company: "Company on Lever",
//               location: "Not specified",
//               jobUrl:  window.location.href,
//               salary:  "Not specified",
//               workplace: "Not specified",
//               postedDate: "Not specified",
//               applicants: "Not specified",
//             },
//           });
//         } else {
//           // Check for errors
//           const errorElements = applicationForm.querySelectorAll(
//             ".error-message, .field-error"
//           );
//           if (errorElements.length > 0) {
//             const errors = Array.from(errorElements)
//               .filter((el) => el.offsetParent !== null) // Only visible errors
//               .map((el) => el.textContent.trim())
//               .join(", ");

//             if (errors) {
//               throw new SendCvError(`Form submission failed: ${errors}`);
//             }
//           }

//           // If no confirmation but also no errors, assume success
//           this.appendStatusMessage(
//             "Application submitted, but no confirmation detected"
//           );

//           // Send job details to background script for tracking
//           this.port.postMessage({
//             type: "SEND_CV_TASK_DONE",
//             data: {
//               jobId,
//               title: "Job on Lever",
//               company: "Company on Lever",
//               location: "Not specified",
//               jobUrl:  window.location.href,
//               salary:  "Not specified",
//               workplace: "Not specified",
//               postedDate: "Not specified",
//               applicants: "Not specified",
//             },
//           });
//         }
//       }

//       // Success!
//       return true;
//     } catch (error) {
//       if (error instanceof SendCvSkipError) {
//         throw error;
//       }

//       throw new SendCvError(`Error applying to job: ${error.message}`, error);
//     }
//   }

//   /**
//    * Handle the Lever location autocomplete field with slower, more reliable typing
//    * @param {HTMLElement} locationInput - The location input element
//    * @param {string} locationValue - The location value to set
//    */
//   async handleLocationAutocomplete(locationInput, locationValue) {
//     try {
//       if (!locationInput || !locationValue) return false;

//       this.appendStatusMessage(`Setting location field to: ${locationValue}`);

//       // Scroll to the element and focus it
//       this.scrollToTargetAdjusted(locationInput, 100);
//       await this.wait(500); // Longer initial wait

//       // Focus and click the input
//       locationInput.click();
//       await this.wait(300);
//       locationInput.focus();
//       await this.wait(300);

//       // Clear any existing value
//       locationInput.value = "";
//       locationInput.dispatchEvent(new Event("input", { bubbles: true }));
//       await this.wait(400); // Longer wait after clearing

//       // Type the location value character by character with slower, more deliberate timing
//       let currentText = "";
//       for (let i = 0; i < locationValue.length; i++) {
//         // Add the next character
//         currentText += locationValue[i];
//         locationInput.value = currentText;

//         // Dispatch proper events to ensure the autocomplete is triggered
//         locationInput.dispatchEvent(new Event("input", { bubbles: true }));

//         // Verify the value was set correctly
//         if (locationInput.value !== currentText) {
//           // Try again if the character wasn't added properly
//           locationInput.value = currentText;
//           locationInput.dispatchEvent(new Event("input", { bubbles: true }));
//         }

//         // Slower typing speed - adjust this value as needed (200-300ms is more human-like)
//         await this.wait(250);

//         // Every few characters, give extra time for the API to catch up
//         if (i % 3 === 2) {
//           await this.wait(400);
//         }
//       }

//       // After typing is complete, wait longer for dropdown to appear
//       await this.wait(500);

//       // Try to find the dropdown container
//       const dropdownContainer = locationInput.parentElement.querySelector(
//         ".dropdown-container"
//       );
//       if (!dropdownContainer || dropdownContainer.style.display === "none") {
//         // Try triggering again if dropdown didn't appear
//         this.appendStatusMessage(
//           "Dropdown not visible yet, triggering input event again"
//         );
//         locationInput.dispatchEvent(new Event("input", { bubbles: true }));
//         await this.wait(1200);
//       }

//       // Look for results in the dropdown
//       const resultsContainer = document.querySelector(".dropdown-results");
//       if (resultsContainer) {
//         // Wait for results to load (check if loading spinner is gone)
//         let attempt = 0;
//         const maxAttempts = 15; // More attempts
//         while (attempt < maxAttempts) {
//           const loadingSpinner = document.querySelector(
//             ".dropdown-loading-results"
//           );
//           if (loadingSpinner && loadingSpinner.style.display !== "none") {
//             this.appendStatusMessage("Waiting for location results to load...");
//             await this.wait(500); // Longer wait between loading checks
//             attempt++;
//           } else {
//             break;
//           }
//         }

//         // Find all location options
//         const locationOptions =
//           resultsContainer.querySelectorAll(".dropdown-item");
//         this.appendStatusMessage(
//           `Found ${locationOptions.length} location suggestions`
//         );

//         if (locationOptions.length > 0) {
//           // Wait a moment before selecting
//           await this.wait(500);

//           // Click the first option
//           this.appendStatusMessage(
//             `Selecting location: ${locationOptions[0].textContent.trim()}`
//           );
//           locationOptions[0].click();

//           // Wait for selection to be processed
//           await this.wait(800);
//           return true;
//         } else {
//           // No results found, try typing less specific location
//           if (locationValue.includes(",")) {
//             // Try with just the city part
//             const cityOnly = locationValue.split(",")[0].trim();
//             this.appendStatusMessage(
//               `No results found. Trying with city only: ${cityOnly}`
//             );
//             return await this.handleLocationAutocomplete(
//               locationInput,
//               cityOnly
//             );
//           }
//         }
//       }

//       // If dropdown selection fails, at least set the text value
//       locationInput.value = locationValue;
//       locationInput.dispatchEvent(new Event("change", { bubbles: true }));
//       locationInput.dispatchEvent(new Event("blur", { bubbles: true }));

//       // Try to manually set the hidden field value
//       const hiddenField = locationInput.parentElement.querySelector(
//         'input[type="hidden"]'
//       );
//       if (hiddenField) {
//         hiddenField.value = JSON.stringify({ name: locationValue });
//         hiddenField.dispatchEvent(new Event("change", { bubbles: true }));
//       }

//       return true;
//     } catch (error) {
//       this.appendStatusMessage(`Error setting location: ${error.message}`);
//       return false;
//     }
//   }
// }

// // Initialize the automation
// debugLog("Creating LeverJobAutomation instance");
// const leverAutomation = new LeverJobAutomation();

// // Send a final notification that the script is fully loaded
// debugLog("Lever content script fully loaded");









import { StateManager } from "@shared/stateManager";
import { LeverFileHandler } from "@shared/linkedInUtils";
import { checkIfJobApplied, getJobIDFromURL } from "@shared/applicationCheck";

//handleSearchNext
//searchNext
//startApplying
//checkIfJobApplied
function debugLog(message, ...args) {
  console.log(`[Lever Debug] ${message}`, ...args);
}

// Error logging helper
function errorLog(message, error) {
  console.error(`[Lever Error] ${message}`, error);
  if (error?.stack) {
    console.error(error.stack);
  }
}

// Immediately log that the script is loaded
debugLog("Content script loading...");

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

/**
 * LeverJobAutomation - Content script for automating Lever job applications
 * Improved with reliable communication system using long-lived connections
 */
class LeverJobAutomation {
  constructor() {
    debugLog("Initializing LeverJobAutomation");

    // Initialize state manager
    this.stateManager = new StateManager();
    this.processedLinksCount = 0;
    this.STATUS_BLOCK_POSITION = "top-right";
    this.sendCvPageNotRespondTimeout = null;
    this.countDown = null;
    this.ready = false;
    this.initialized = false;

    // CRITICAL FIX: Add flag to track application in progress state
    this.isApplicationInProgress = false;

    // CRITICAL FIX: Add local cache for processed URLs to prevent duplicates
    this.processedUrls = new Set();

    // Create connection to background script
    this.initializeConnection();

    // Initialize search data
    this.SEARCH_DATA = {
      tabId: null,
      limit: null,
      domain: null,
      current: null,
      submittedLinks: [],
      searchLinkPattern: null,
    };

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

    // Create status overlay
    this.createStatusOverlay();

    // Create file handler for resume uploads
    this.fileHandler = new LeverFileHandler({
      show: (message, type) => {
        debugLog(`[${type || "info"}] ${message}`);
        this.appendStatusMessage(message);
      },
    });

    // Initialize based on page type
    this.detectPageTypeAndInitialize();
  }

  /**
   * Create a long-lived connection to the background script
   */
  initializeConnection() {
    try {
      const tabId = window.name || Math.floor(Math.random() * 1000000);

      // Create a connection name based on the page type
      // CORRECTED: Create a connection name based on the page type
      let connectionName = window.location.href.includes("google.com/search")
        ? `lever-search-${tabId}`
        : `lever-apply-${tabId}`;

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

  /**
   * Create a status overlay on the page
   */
  createStatusOverlay() {
    try {
      // Create status block if it doesn't exist
      if (!document.getElementById("lever-automation-status")) {
        const statusBlock = document.createElement("div");
        statusBlock.id = "lever-automation-status";
        statusBlock.style.cssText = `
          position: fixed;
          top: 10px;
          right: 10px;
          background-color: rgba(0, 0, 0, 0.8);
          color: white;
          padding: 10px;
          border-radius: 5px;
          z-index: 9999;
          max-width: 300px;
          max-height: 400px;
          overflow-y: auto;
          font-family: Arial, sans-serif;
          font-size: 12px;
        `;

        // Add header
        const header = document.createElement("div");
        header.textContent = "Lever Job Automation";
        header.style.cssText = `
          font-weight: bold;
          border-bottom: 1px solid white;
          padding-bottom: 5px;
          margin-bottom: 5px;
        `;
        statusBlock.appendChild(header);

        // Add content container
        const content = document.createElement("div");
        content.id = "lever-automation-status-content";
        statusBlock.appendChild(content);

        document.body.appendChild(statusBlock);
      }
    } catch (err) {
      errorLog("Error creating status overlay:", err);
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
    } else if (url.includes("lever.co")) {
      debugLog("On Lever job page");
      this.appendStatusMessage("Lever job page detected");
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

      this.SEARCH_DATA.tabId = tabId;
      this.SEARCH_DATA.limit = limit;
      this.SEARCH_DATA.domain = domain;
      this.SEARCH_DATA.current = current;
      this.SEARCH_DATA.submittedLinks = submittedLinks
        ? submittedLinks.map((link) => ({ ...link, tries: 0 }))
        : [];

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

  /**
   * Handle search next event (after a job application completes)
   */
  handleSearchNext(data) {
    debugLog("Handling search next:", data);

    try {
      if (this.sendCvPageNotRespondTimeout) {
        clearTimeout(this.sendCvPageNotRespondTimeout);
      }

      // CRITICAL FIX: Always reset the application in progress flag
      this.isApplicationInProgress = false;

      this.processedLinksCount++;

      if (data && data.status !== "ERROR") {
        this.appendStatusMessage("Successfully submitted: " + data.url);
        this.SEARCH_DATA.submittedLinks.push({ ...data });
      } else if (data) {
        this.appendStatusMessage(
          data.message || "Error occurred with: " + data.url
        );
        this.SEARCH_DATA.submittedLinks.push({ ...data });
      }

      // Continue with next search result
      setTimeout(() => this.searchNext(), 2500);
    } catch (err) {
      errorLog("Error in handleSearchNext:", err);
      this.appendStatusErrorMessage(err);

      // CRITICAL FIX: Reset application in progress even on error
      this.isApplicationInProgress = false;

      // Try to continue anyway
      setTimeout(() => this.searchNext(), 5000);
    }
  }

  /**
   * Start the job application process
   */
  async startApplying(data) {
    try {
      debugLog("Starting application process with data:", data);
      this.appendStatusMessage("Starting application process");

      if (
        document.body.innerText.includes("Cannot GET") ||
        document.location.search.includes("not_found=true")
      ) {
        throw new SendCvSkipError("Cannot start send cv: Page error");
      }

      this.countDown = this.startCountDownInStatusBlock(60 * 5, () => {
        this.port.postMessage({
          type: "SEND_CV_TAB_TIMER_ENDED",
          data: {
            url: window.location.href,
          },
        });
      });

      await new Promise((resolve, reject) => {
        setTimeout(async () => {
          try {
            await this.apply(data);
            resolve();
          } catch (e) {
            reject(e);
          }
        }, 3000);
      });

      this.port.postMessage({
        type: "SEND_CV_TASK_DONE",
        data: {
          jobId: getJobIDFromURL(window.location.href),
          title: "Job on Lever",
          company: "Company on Lever",
          location: "Not specified",
          jobUrl: window.location.href,
          salary: "Not specified",
          workplace: "Not specified",
          postedDate: "Not specified",
          applicants: "Not specified",
        },
      });

      this.isApplicationInProgress = false;

      debugLog("Application completed successfully");
    } catch (e) {
      if (e instanceof SendCvSkipError) {
        errorLog("Application skipped:", e.message);
        this.port.postMessage({ type: "SEND_CV_TASK_SKIP", data: e.message });
      } else {
        errorLog("SEND CV ERROR", e);
        this.appendStatusErrorMessage(e);
        this.port.postMessage({
          type: "SEND_CV_TASK_ERROR",
          data: this.errorToString(e),
        });
      }
      this.isApplicationInProgress = false;
    }
  }

  /**
   * Search for the next job to apply to with added limit checking
   */
  async searchNext() {
    try {
      debugLog("Executing searchNext");

      if (!this.ready || !this.initialized) {
        debugLog("Not ready or initialized yet, delaying search");
        setTimeout(() => this.searchNext(), 1000);
        return;
      }

      if (this.isApplicationInProgress) {
        debugLog("Application in progress, not searching for next link");
        this.appendStatusMessage(
          "Application in progress, waiting to complete..."
        );
        return;
      }

      // NEW: Check if user can apply more based on subscription/limits
      try {
        const userId =
          this.stateManager.getState()?.userId ||
          this.stateManager.state?.userId;
        if (userId) {
          // Get the latest user data using our Lever-specific authorization check
          const { checkLeverUserLimits, canUserApplyMore } = await import(
            "@shared/leverAuthorization"
          );

          // Update our local state with user data
          const userData = await checkLeverUserLimits(
            userId,
            this.stateManager.state || {}
          );

          // Check if user has reached their application limit
          if (!canUserApplyMore(userData)) {
            this.appendStatusMessage(
              "You have reached your application limit. Please upgrade your plan or wait for your limit to reset."
            );
            this.port.postMessage({ type: "SEARCH_TASK_DONE" });
            debugLog("User reached application limit, stopping search");
            return;
          }

          // Show remaining applications in status
          const remaining = userData.remainingApplications || 0;
          this.appendStatusMessage(
            `Applications remaining: ${
              remaining === Infinity ? "Unlimited" : remaining
            }`
          );
        }
      } catch (limitCheckError) {
        debugLog("Error checking application limits:", limitCheckError);
        // Continue even if check fails to avoid blocking the user if our API is down
      }

      this.appendStatusMessage("Searching for job links...");

      // Find all matching links
      let links = this.findAllLinksElements();
      debugLog(`Found ${links.length} links`);

      // If no links on page, try to load more
      if (links.length === 0) {
        debugLog("No links found, trying to load more");
        this.appendStatusMessage("No links found, trying to load more...");
        await this.wait(2000);
        const loadMoreBtn = this.findLoadMoreElement();
        if (loadMoreBtn) {
          this.appendStatusMessage('Clicking "More results" button');
          loadMoreBtn.click();
          await this.wait(3000);
          this.fetchSearchTaskData();
          return;
        } else {
          this.appendStatusMessage("No more results to load");
          this.port.postMessage({ type: "SEARCH_TASK_DONE" });
          debugLog("Search task completed");
          return;
        }
      }

      // Process links one by one - BUT USE URL-BASED TRACKING!
      let foundUnprocessedLink = false;

      for (let i = 0; i < links.length; i++) {
        // Process this link
        let url = this.normalizeUrl(links[i].href);

        // Handle special URL patterns for Lever
        if (
          /^https:\/\/jobs\.(eu\.)?lever\.co\/([^\/]*)\/([^\/]*)\/?(.*)?$/.test(
            url
          )
        ) {
          url = url.replace(/\/apply$/, "");
        }

        // CRITICAL FIX: Use URL-based tracking instead of index-based
        const normalizedUrl = url.toLowerCase().trim();

        // Check if this URL is already in processed links
        const alreadyProcessed = this.SEARCH_DATA.submittedLinks.some(
          (link) => {
            if (!link.url) return false;
            const normalizedLinkUrl = link.url.toLowerCase().trim();
            return (
              normalizedLinkUrl === normalizedUrl ||
              normalizedUrl.includes(normalizedLinkUrl) ||
              normalizedLinkUrl.includes(normalizedUrl)
            );
          }
        );

        // Also check local cache
        const inLocalCache =
          this.processedUrls && this.processedUrls.has(normalizedUrl);

        if (alreadyProcessed || inLocalCache) {
          // Mark as already processed
          this.markLinkAsColor(links[i], "orange");
          this.appendStatusMessage(`Skipping already processed: ${url}`);
          continue;
        }

        // NEW: Check if job has been applied for through the API
        try {
          const userId = this.stateManager.getState()?.userId;
          if (userId) {
            const jobApplied = await checkIfJobApplied(userId, links[i]);

            if (jobApplied) {
              this.markLinkAsColor(links[i], "purple");
              this.appendStatusMessage(`Job already applied via API: ${url}`);
              continue;
            }
          }
        } catch (apiCheckError) {
          debugLog("Error checking job application status:", apiCheckError);
          // Continue even if check fails
        }

        // Check if URL matches pattern
        if (this.SEARCH_DATA.searchLinkPattern) {
          const pattern =
            typeof this.SEARCH_DATA.searchLinkPattern === "string"
              ? new RegExp(
                  this.SEARCH_DATA.searchLinkPattern.replace(
                    /^\/|\/[gimy]*$/g,
                    ""
                  )
                )
              : this.SEARCH_DATA.searchLinkPattern;

          if (!pattern.test(url)) {
            debugLog(`Link ${url} does not match pattern`);
            this.markLinkAsColor(links[i], "red");
            this.appendStatusMessage("Link does not match pattern - skipping");
            continue;
          }
        }

        // Found an unprocessed link
        foundUnprocessedLink = true;
        this.appendStatusMessage("Found job to apply: " + url);

        // Start the CV sending task
        try {
          debugLog(`Sending CV task for ${url}`);
          this.isApplicationInProgress = true;
          this.applicationStartTime = Date.now();

          // Add to local cache immediately
          if (!this.processedUrls) this.processedUrls = new Set();
          this.processedUrls.add(normalizedUrl);

          // Send the message
          this.port.postMessage({
            type: "SEND_CV_TASK",
            data: { url },
          });

          this.markLinkAsColor(links[i], "green");
          this.appendStatusMessage("Opening application page...");

          // Set timeout for unresponsive tabs
          this.sendCvPageNotRespondTimeout = setTimeout(() => {
            debugLog("CV page not responding, sending notification");
            this.port.postMessage({ type: "SEND_CV_TAB_NOT_RESPOND" });
            clearTimeout(this.sendCvPageNotRespondTimeout);
            this.isApplicationInProgress = false;
          }, 60_000 * 5); // 5 minutes

          // Only process one link at a time
          break;
        } catch (err) {
          errorLog(`Error sending CV task for ${url}:`, err);
          this.appendStatusErrorMessage(err);
          this.isApplicationInProgress = false;
          continue;
        }
      }

      // If no unprocessed links found, try to load more
      if (!foundUnprocessedLink) {
        debugLog("No unprocessed links found");
        this.appendStatusMessage("No new jobs found, checking for more...");

        const loadMoreBtn = this.findLoadMoreElement();
        if (loadMoreBtn) {
          debugLog("Found load more button, clicking it");
          this.appendStatusMessage("Moving to next page...");
          await this.wait(2000);
          loadMoreBtn.click();
          setTimeout(() => this.fetchSearchTaskData(), 3000);
        } else {
          debugLog("No more pages to load");
          this.appendStatusMessage("All jobs processed");
          this.port.postMessage({ type: "SEARCH_TASK_DONE" });
        }
      }
    } catch (err) {
      errorLog("Error in searchNext:", err);
      this.appendStatusErrorMessage(err);
      this.isApplicationInProgress = false;

      try {
        this.port.postMessage({
          type: "SEARCH_TASK_ERROR",
          data: this.errorToString(err),
        });
      } catch (sendErr) {
        errorLog("Error sending error notification:", sendErr);
      }
    }
  }

  /**
   * Find all job link elements on the page
   */
  findAllLinksElements() {
    try {
      const domains = Array.isArray(this.SEARCH_DATA.domain)
        ? this.SEARCH_DATA.domain
        : [this.SEARCH_DATA.domain];

      if (!domains || domains.length === 0) {
        debugLog("No domains specified for link search");
        return [];
      }

      debugLog("Searching for links with domains:", domains);

      // Create a combined selector for all domains
      const selectors = domains.map((domain) => {
        // Handle missing protocol, clean domain
        const cleanDomain = domain
          .replace(/^https?:\/\//, "")
          .replace(/\/$/, "");
        return `#rso a[href*="${cleanDomain}"], #botstuff a[href*="${cleanDomain}"]`;
      });

      const selector = selectors.join(",");
      const links = document.querySelectorAll(selector);

      debugLog(`Found ${links.length} matching links`);
      return Array.from(links);
    } catch (err) {
      errorLog("Error finding links:", err);
      return [];
    }
  }

  /**
   * Find the "More results" button
   */
  findLoadMoreElement() {
    try {
      // If we're on the last page (prev button but no next button)
      if (
        document.getElementById("pnprev") &&
        !document.getElementById("pnnext")
      ) {
        return null;
      }

      // Method 1: Find "More results" button
      const moreResultsBtn = Array.from(document.querySelectorAll("a")).find(
        (a) => a.textContent.includes("More results")
      );

      if (moreResultsBtn) {
        return moreResultsBtn;
      }

      // Method 2: Look for "Next" button
      const nextBtn = document.getElementById("pnnext");
      if (nextBtn) {
        return nextBtn;
      }

      // Method 3: Try to find any navigation button at the bottom
      const navLinks = [
        ...document.querySelectorAll(
          "#botstuff table a[href^='/search?q=site:']"
        ),
      ];
      debugLog(`Found ${navLinks.length} potential navigation links`);

      // Return the last one (typically "More results" or similar)
      return navLinks[navLinks.length - 1];
    } catch (err) {
      errorLog("Error finding load more button:", err);
      return null;
    }
  }

  /**
   * Mark a link with a color border
   */
  markLinkAsColor(linkEl, color) {
    if (!linkEl) return;

    try {
      // Try to find the parent element to highlight
      const linkWrapperEl =
        linkEl.closest("div[jscontroller]") ||
        linkEl.closest("div.g") ||
        linkEl.parentElement;

      if (linkWrapperEl) {
        linkWrapperEl.style.border = `2px ${color} solid`;
        linkWrapperEl.style.padding = "5px";
        linkWrapperEl.style.borderRadius = "5px";
        linkWrapperEl.style.margin = "5px 0";
      } else {
        // If no suitable parent, highlight the link itself
        linkEl.style.border = `2px ${color} solid`;
        linkEl.style.padding = "5px";
        linkEl.style.borderRadius = "5px";
        linkEl.style.display = "inline-block";
      }
    } catch (err) {
      errorLog("Error marking link:", err);
    }
  }

  /**
   * Handle required checkboxes in application form
   * Identifies and checks required checkboxes (terms, privacy policy, etc.)
   */
  async handleRequiredCheckboxes(form) {
    try {
      this.appendStatusMessage("Checking required checkboxes");

      // Find all checkboxes in the form
      const checkboxes = form.querySelectorAll('input[type="checkbox"]');
      if (!checkboxes || checkboxes.length === 0) {
        this.appendStatusMessage("No checkboxes found in form");
        return;
      }

      debugLog(`Found ${checkboxes.length} checkboxes in form`);

      // Process each checkbox to determine if it's required
      for (const checkbox of checkboxes) {
        // Skip if already checked
        if (checkbox.checked) {
          continue;
        }

        // Skip if not visible
        if (
          checkbox.offsetParent === null ||
          checkbox.style.display === "none" ||
          checkbox.style.visibility === "hidden"
        ) {
          continue;
        }

        // Check if it's required by attributes
        const isRequired =
          checkbox.hasAttribute("required") ||
          checkbox.getAttribute("aria-required") === "true" ||
          checkbox.classList.contains("required");

        // Get surrounding label or container text
        const label =
          checkbox.closest("label") ||
          document.querySelector(`label[for="${checkbox.id}"]`);
        const labelText = label ? label.textContent.toLowerCase() : "";

        // Check if label text contains required indicators
        const hasRequiredText =
          labelText.includes("*") ||
          labelText.includes("required") ||
          labelText.includes("agree to");

        const containerDiv = checkbox.closest("div");
        const containerText = containerDiv
          ? containerDiv.textContent.toLowerCase()
          : "";
        const hasRequiredInContainer =
          containerText.includes("*") ||
          containerText.includes("required") ||
          containerText.includes("must") ||
          containerText.includes("agree to");

        // Check for common terms/privacy checkbox patterns
        const isTermsCheckbox =
          labelText.includes("terms") ||
          labelText.includes("privacy") ||
          labelText.includes("policy") ||
          labelText.includes("consent") ||
          containerText.includes("terms") ||
          containerText.includes("privacy") ||
          containerText.includes("policy") ||
          containerText.includes("consent");

        // Decide if this checkbox should be checked
        if (
          isRequired ||
          hasRequiredText ||
          hasRequiredInContainer ||
          isTermsCheckbox
        ) {
          this.appendStatusMessage(
            `Checking checkbox: ${
              labelText.slice(0, 50) || "Unlabeled checkbox"
            }`
          );

          // Scroll to the checkbox
          this.scrollToTargetAdjusted(checkbox, 100);
          await this.wait(100);

          // Click the checkbox
          checkbox.click();
          await this.wait(200);

          // If click doesn't work, try setting checked property directly
          if (!checkbox.checked) {
            checkbox.checked = true;
            checkbox.dispatchEvent(new Event("change", { bubbles: true }));
            checkbox.dispatchEvent(new Event("input", { bubbles: true }));
          }
        }
      }
    } catch (error) {
      debugLog("Error handling required checkboxes:", error);
      this.appendStatusMessage(
        `Warning: Some required checkboxes may not have been checked - ${error.message}`
      );
      // Continue despite errors in checkbox handling
    }
  }

  /**
   * Utility function to check if any of the field identifiers match any of the provided keywords
   * Used for identifying form field types based on labels, placeholders, names, etc.
   *
   * @param {...string} fields - Variable number of field identifiers (labels, placeholders, etc.)
   * @param {string[]} keywords - Array of keywords to match against
   * @returns {boolean} - True if any field matches any keyword
   */
  matchesAny(...args) {
    // Last argument should be the keywords array
    if (args.length < 1) return false;
    const keywords = args.pop();

    if (!Array.isArray(keywords)) {
      debugLog("matchesAny: keywords not an array");
      return false;
    }

    // Check if any field matches any keyword
    return args.some((field) => {
      if (!field) return false;
      const fieldLower = String(field).toLowerCase();
      return keywords.some(
        (keyword) =>
          fieldLower === keyword.toLowerCase() ||
          fieldLower.includes(keyword.toLowerCase())
      );
    });
  }

  /**
   * Map profile data to fields - more direct approach for Lever
   */
  mapProfileToFields(profile) {
    return {
      "first name": profile.firstName,
      "last name": profile.lastName,
      "full name": `${profile.firstName} ${profile.lastName}`,
      name: `${profile.firstName} ${profile.lastName}`,
      email: profile.email,
      phone: profile.phone || profile.phoneNumber,
      linkedin: profile.linkedIn || profile.linkedinUrl,
      github: profile.github || profile.githubUrl,
      website: profile.website || profile.websiteUrl,
      portfolio: profile.portfolio || profile.websiteUrl,
      address: profile.streetAddress,
      city:
        profile.city ||
        (profile.currentCity ? profile.currentCity.split(",")[0].trim() : ""),
      country: profile.country,
      company: profile.currentCompany || "Not currently employed",
      "current company": profile.currentCompany,
      position: profile.fullPosition,
      title: profile.fullPosition,
      experience: profile.yearsOfExperience,
      salary: profile.desiredSalary,
      "notice period": profile.noticePeriod || "2 weeks",
      "cover letter": profile.coverLetter,
    };
  }

  /**
   * Select option by value or text in a select element
   * Makes a best effort to find and select the correct option
   */
  async selectOptionByValue(select, value) {
    if (!select || !value) return false;

    try {
      this.scrollToTargetAdjusted(select, 100);
      await this.wait(100);

      // Try to find the option by exact value first
      let matchingOption = Array.from(select.options).find(
        (option) => option.value.toLowerCase() === value.toLowerCase()
      );

      // If no exact match, try substring match on value
      if (!matchingOption) {
        matchingOption = Array.from(select.options).find((option) =>
          option.value.toLowerCase().includes(value.toLowerCase())
        );
      }

      // If still no match, try matching by option text
      if (!matchingOption) {
        matchingOption = Array.from(select.options).find(
          (option) =>
            option.text.toLowerCase() === value.toLowerCase() ||
            option.text.toLowerCase().includes(value.toLowerCase())
        );
      }

      // If we found a match, select it
      if (matchingOption) {
        select.value = matchingOption.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        this.appendStatusMessage(`Selected option: ${matchingOption.text}`);
        return true;
      }

      debugLog(`No matching option found for value: ${value}`);
      return false;
    } catch (error) {
      debugLog("Error selecting option:", error);
      return false;
    }
  }

  /**
   * Utility function to check if a field matches any of the provided regex patterns
   * More powerful than matchesAny for complex pattern matching
   *
   * @param {string} field - Field to check
   * @param {RegExp[]} patterns - Array of regex patterns to match against
   * @returns {boolean} - True if field matches any pattern
   */
  matchesRegex(field, patterns) {
    if (!field) return false;

    if (!Array.isArray(patterns)) {
      debugLog("matchesRegex: patterns not an array");
      return false;
    }

    const fieldStr = String(field).toLowerCase();

    return patterns.some((pattern) => {
      if (pattern instanceof RegExp) {
        return pattern.test(fieldStr);
      } else if (typeof pattern === "string") {
        // Create regex from string pattern
        try {
          const regex = new RegExp(pattern, "i");
          return regex.test(fieldStr);
        } catch (e) {
          debugLog(`Invalid regex pattern: ${pattern}`, e);
          return false;
        }
      }
      return false;
    });
  }

  /**
   * Check if this is a resume upload field
   */
  isResumeField(labelText, container) {
    const resumeKeywords = [
      "resume",
      "cv",
      "curriculum vitae",
      "upload resume",
      "upload cv",
      "attach resume",
      "attach cv",
      "upload your resume",
      "upload your cv",
    ];

    return resumeKeywords.some((keyword) =>
      labelText.toLowerCase().includes(keyword)
    );
  }

  /**
   * Normalize URL by removing query parameters and hash
   */
  normalizeUrl(link) {
    try {
      const url = new URL(link);
      return url.origin + url.pathname;
    } catch (e) {
      errorLog("Error normalizing URL:", e);
      return link;
    }
  }

  /**
   * Wait for specified time
   */
  wait(timeout) {
    return new Promise((resolve) => setTimeout(resolve, timeout));
  }

  /**
   * Append status message to overlay
   */
  appendStatusMessage(message) {
    debugLog(`Status: ${message}`);

    try {
      const contentElement = document.getElementById(
        "lever-automation-status-content"
      );
      if (contentElement) {
        const messageElement = document.createElement("div");
        messageElement.textContent = `${new Date().toLocaleTimeString()}: ${message}`;
        messageElement.style.marginBottom = "5px";

        contentElement.appendChild(messageElement);

        // Auto-scroll to bottom
        contentElement.scrollTop = contentElement.scrollHeight;
      }
    } catch (err) {
      errorLog("Error appending status message:", err);
    }
  }

  /**
   * Append error message to overlay
   */
  appendStatusErrorMessage(error) {
    const errorMessage = this.errorToString(error);
    errorLog("Error status:", errorMessage);

    try {
      const contentElement = document.getElementById(
        "lever-automation-status-content"
      );
      if (contentElement) {
        const messageElement = document.createElement("div");
        messageElement.textContent = `${new Date().toLocaleTimeString()}: ERROR: ${errorMessage}`;
        messageElement.style.marginBottom = "5px";
        messageElement.style.color = "red";
        messageElement.style.fontWeight = "bold";

        contentElement.appendChild(messageElement);

        // Auto-scroll to bottom
        contentElement.scrollTop = contentElement.scrollHeight;
      }
    } catch (err) {
      errorLog("Error appending error message:", err);
    }
  }

  /**
   * Convert error to string representation
   */
  errorToString(e) {
    if (!e) return "Unknown error (no details)";

    if (e instanceof Error) {
      return e.message + (e.stack ? `\n${e.stack}` : "");
    }

    return String(e);
  }

  /**
   * Start countdown timer in status block
   */
  startCountDownInStatusBlock(duration, countDownEnded) {
    this.appendStatusMessage("Timer started");

    let timer = duration;
    let timerElement = null;

    try {
      // Create timer element
      const contentElement = document.getElementById(
        "lever-automation-status-content"
      );
      timerElement = document.createElement("div");
      timerElement.id = "lever-automation-timer";
      timerElement.style.fontWeight = "bold";
      timerElement.style.marginTop = "10px";
      contentElement.appendChild(timerElement);
    } catch (err) {
      errorLog("Error creating timer element:", err);
    }

    const updateTimerDisplay = () => {
      const minutes = Math.floor(timer / 60);
      const seconds = timer % 60;

      const formattedTime = `${minutes.toString().padStart(2, "0")}:${seconds
        .toString()
        .padStart(2, "0")}`;

      if (timerElement) {
        timerElement.textContent = `Time remaining: ${formattedTime}`;
      }

      debugLog(`Timer: ${formattedTime}`);
    };

    updateTimerDisplay();

    const stop = () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };

    const addTime = (additionalTime) => {
      timer += additionalTime;
      updateTimerDisplay();
    };

    const intervalId = setInterval(() => {
      timer--;

      updateTimerDisplay();

      if (timer <= 0) {
        clearInterval(intervalId);
        if (typeof countDownEnded === "function") {
          countDownEnded();
        }
      }

      // Keep the connection alive
      if (timer % 30 === 0) {
        try {
          this.port.postMessage({ type: "KEEPALIVE" });
        } catch (err) {
          errorLog("Error sending keepalive:", err);
        }
      }
    }, 1000);

    return {
      stop,
      addTime,
    };
  }

  // REMOVE DUPLICATES LATER ON.

  /**
   * Match a field label against common application question patterns
   */
  matchesCommonQuestion(label, keywords) {
    if (!label) return false;

    // For questions, we need a more flexible matching algorithm
    // First, check for exact matches
    for (const keyword of keywords) {
      if (label.includes(keyword)) {
        return true;
      }
    }

    // Then, check for semantic matches
    // e.g., "Tell us about your background" should match "experience"
    for (const keyword of keywords) {
      // Create variations of the keyword
      const variations = [
        keyword,
        `your ${keyword}`,
        `about ${keyword}`,
        `about your ${keyword}`,
        `tell us about ${keyword}`,
        `tell us about your ${keyword}`,
        `describe ${keyword}`,
        `describe your ${keyword}`,
        `share ${keyword}`,
        `share your ${keyword}`,
      ];

      for (const variation of variations) {
        if (label.includes(variation)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Generate a generic answer based on the question content
   */
  generateGenericAnswer(question) {
    const questionLower = question.toLowerCase();

    // Generic answer based on question type
    if (
      questionLower.includes("experience") ||
      questionLower.includes("background") ||
      questionLower.includes("tell us about yourself")
    ) {
      return "I have extensive experience in my field with a track record of delivering results. My background includes working with diverse teams and stakeholders to achieve business objectives. I continually focus on professional development to stay current with industry trends and best practices.";
    }

    if (
      questionLower.includes("why") ||
      questionLower.includes("interested") ||
      questionLower.includes("passion")
    ) {
      return "I'm particularly interested in this opportunity because of your company's reputation for innovation and commitment to quality. The position aligns well with my career goals and would allow me to leverage my skills while continuing to grow professionally. I'm excited about the potential to contribute to your team.";
    }

    if (
      questionLower.includes("strengths") ||
      questionLower.includes("skills") ||
      questionLower.includes("qualify")
    ) {
      return "My key strengths include strong analytical skills, effective communication, and the ability to adapt quickly to new challenges. I excel at problem-solving and collaborating with cross-functional teams to achieve results. My technical expertise combined with my interpersonal skills make me well-suited for this role.";
    }

    if (
      questionLower.includes("weakness") ||
      questionLower.includes("improve") ||
      questionLower.includes("development")
    ) {
      return "I continuously work on improving my skills in public speaking. I've been taking courses and seeking opportunities to present to groups to build confidence in this area. I believe in honest self-assessment and actively pursue growth in areas where I can improve.";
    }

    if (
      questionLower.includes("challenge") ||
      questionLower.includes("difficult") ||
      questionLower.includes("obstacle")
    ) {
      return "In a recent project, I faced significant time constraints while managing multiple priorities. I addressed this by implementing a structured planning system, clear communication with stakeholders, and breaking the project into manageable milestones. This approach allowed me to deliver successful results despite the challenges.";
    }

    if (
      questionLower.includes("achievement") ||
      questionLower.includes("proud") ||
      questionLower.includes("accomplishment")
    ) {
      return "One of my key achievements was leading a cross-functional project that improved operational efficiency by 30%. This required coordinating multiple teams, overcoming technical challenges, and staying focused on business objectives. The success of this initiative was recognized by senior management and implemented across the organization.";
    }

    if (
      questionLower.includes("team") ||
      questionLower.includes("collaborate") ||
      questionLower.includes("work with others")
    ) {
      return "I thrive in collaborative environments and enjoy working closely with diverse teams. I value different perspectives and believe the best solutions come from open communication and mutual respect. I'm experienced in both contributing as a team member and taking leadership roles when appropriate.";
    }

    if (
      questionLower.includes("values") ||
      questionLower.includes("culture") ||
      questionLower.includes("environment")
    ) {
      return "I value environments that promote transparency, continuous learning, and mutual respect. I believe in maintaining high ethical standards and taking ownership of my work. I'm most productive in cultures that balance collaboration with individual initiative and provide opportunities for professional growth.";
    }

    // Default generic answer for other question types
    return "I approach this with a combination of strategic thinking and practical experience. My background has prepared me well for handling such situations effectively. I'm confident that my skills and approach would be valuable in this context, and I'm enthusiastic about the opportunity to contribute in this area.";
  }

  /**
   * Check if a label element indicates the field is required
   */
  isRequired(labelEl) {
    if (!labelEl) return false;

    // Check for asterisk in label or parent containers
    const hasAsterisk =
      labelEl.textContent.includes("*") ||
      labelEl.querySelector("strong")?.textContent?.includes("*") ||
      labelEl.parentNode?.querySelector("strong")?.textContent?.trim() === "*";

    // Check for "required" text
    const hasRequiredText =
      labelEl.textContent.toLowerCase().includes("required") ||
      labelEl.parentNode?.textContent.toLowerCase().includes("required");

    // Check for required attribute in nearby input
    const nearbyInput =
      labelEl.parentNode?.querySelector("input, textarea, select") ||
      document.querySelector(
        `input[aria-labelledby="${labelEl.id}"], textarea[aria-labelledby="${labelEl.id}"], select[aria-labelledby="${labelEl.id}"]`
      );

    const inputHasRequired =
      nearbyInput?.hasAttribute("required") ||
      nearbyInput?.getAttribute("aria-required") === "true";

    return hasAsterisk || hasRequiredText || inputHasRequired;
  }

  /**
   * Parses Lever form questions using the actual HTML structure
   * This specifically addresses the "cards" fields that use a hidden template with the real questions
   */

  /**
   * Extract all questions from the Lever form including hidden template data
   * @param {HTMLElement} form - The form element
   * @returns {Object} - Mapping of field names to their questions
   */
  extractLeverFormQuestions(form) {
    // Store all field name to question mappings
    const fieldQuestions = {};

    try {
      this.appendStatusMessage("Extracting form questions...");

      // First, look for the hidden template fields that contain question definitions
      const templateFields = form.querySelectorAll(
        'input[name*="baseTemplate"]'
      );

      templateFields.forEach((templateField) => {
        try {
          // Extract the card ID from the name attribute (e.g., cards[UUID][baseTemplate])
          const cardIdMatch = templateField.name.match(/cards\[(.*?)\]/);
          if (!cardIdMatch) return;

          const cardId = cardIdMatch[1];
          const templateValue = templateField.value;

          // Parse the JSON template data
          if (templateValue) {
            const template = JSON.parse(templateValue.replace(/&quot;/g, '"'));

            // Check if it has fields defined
            if (template.fields && Array.isArray(template.fields)) {
              // Map each field to its corresponding input name
              template.fields.forEach((field, index) => {
                const fieldName = `cards[${cardId}][field${index}]`;
                fieldQuestions[fieldName] = field.text;
                this.appendStatusMessage(
                  `Found template question: "${field.text}"`
                );
              });
            }
          }
        } catch (error) {
          debugLog("Error parsing template field:", error);
        }
      });

      // Now scan all application-question elements to find visible questions
      const questionElements = form.querySelectorAll(".application-question");

      questionElements.forEach((questionEl) => {
        try {
          // Find the label/question text
          const labelEl = questionEl.querySelector(".application-label");
          const textEl = labelEl?.querySelector(".text") || labelEl;

          if (!textEl) return;

          // Get the text content without the required asterisk
          let questionText = textEl.textContent.trim();
          questionText = questionText.replace(/✱$/, "").trim();

          // Find the corresponding input/textarea
          const inputEl = questionEl.querySelector(
            'input:not([type="hidden"]), textarea'
          );

          if (inputEl && questionText) {
            fieldQuestions[inputEl.name] = questionText;
            this.appendStatusMessage(
              `Found visible question: "${questionText}"`
            );
          }
        } catch (error) {
          debugLog("Error processing question element:", error);
        }
      });

      this.appendStatusMessage(
        `Extracted ${Object.keys(fieldQuestions).length} questions from form`
      );
      return fieldQuestions;
    } catch (error) {
      debugLog("Error extracting form questions:", error);
      return {};
    }
  }

  /**
   * Enhanced method to match field names to their questions
   * @param {HTMLElement} element - The form field element
   * @param {Object} fieldQuestions - Mapping of field names to questions
   * @returns {String} - The question text or null if not found
   */
  getQuestionForField(element, fieldQuestions) {
    if (!element || !element.name) return null;

    // Direct lookup by field name
    if (fieldQuestions[element.name]) {
      return fieldQuestions[element.name];
    }

    // For fields with no direct match, try the closest application-question container
    const questionContainer = element.closest(".application-question");
    if (questionContainer) {
      const labelEl = questionContainer.querySelector(".application-label");
      const textEl = labelEl?.querySelector(".text") || labelEl;

      if (textEl) {
        // Get text without the required asterisk
        let questionText = textEl.textContent.trim();
        questionText = questionText.replace(/✱$/, "").trim();

        if (questionText) {
          return questionText;
        }
      }
    }

    return null;
  }

  /**
   * Improved handling for radio buttons and select fields
   */

  /**
   * Enhanced method to handle radio button selection
   * Uses multiple approaches to ensure the radio button is actually clicked
   */
  async handleRadioButtonSelection(radioButtons, value) {
    if (!radioButtons || !radioButtons.length || !value) {
      return false;
    }

    this.appendStatusMessage(`Selecting radio option: "${value}"`);
    let selected = false;

    // First convert boolean values to strings for comparison
    const valueText =
      value === true
        ? "yes"
        : value === false
        ? "no"
        : String(value).toLowerCase();

    // Try multiple approaches to select the correct radio button
    for (const radioBtn of radioButtons) {
      try {
        // Get label text in various ways
        const labelEl =
          radioBtn.closest("label") ||
          document.querySelector(`label[for="${radioBtn.id}"]`);

        let labelText = "";

        if (labelEl) {
          labelText = labelEl.textContent.trim().toLowerCase();
        } else {
          // Try to find text near the radio button
          const parentEl = radioBtn.parentElement;
          if (parentEl) {
            // Get text content but exclude text from child inputs
            const childInputs = parentEl.querySelectorAll("input");
            let parentText = parentEl.textContent;
            childInputs.forEach((input) => {
              if (input !== radioBtn && input.value) {
                parentText = parentText.replace(input.value, "");
              }
            });
            labelText = parentText.trim().toLowerCase();
          }
        }

        // Try to match by value
        if (
          radioBtn.value &&
          (radioBtn.value.toLowerCase() === valueText ||
            radioBtn.value.toLowerCase().includes(valueText) ||
            valueText.includes(radioBtn.value.toLowerCase()))
        ) {
          this.appendStatusMessage(
            `Found matching radio button by value: ${radioBtn.value}`
          );
          await this.clickRadioButtonEffectively(radioBtn);
          selected = true;
          break;
        }

        // Try to match by label text
        if (
          labelText &&
          (labelText === valueText ||
            labelText.includes(valueText) ||
            valueText.includes(labelText))
        ) {
          this.appendStatusMessage(
            `Found matching radio button by label: ${labelText}`
          );
          await this.clickRadioButtonEffectively(radioBtn);
          selected = true;
          break;
        }

        // Special handling for yes/no options
        if (
          (labelText === "yes" &&
            (valueText === "yes" || valueText === "true")) ||
          (labelText === "no" && (valueText === "no" || valueText === "false"))
        ) {
          this.appendStatusMessage(
            `Found matching yes/no radio button: ${labelText}`
          );
          await this.clickRadioButtonEffectively(radioBtn);
          selected = true;
          break;
        }
      } catch (error) {
        debugLog(`Error processing radio button: ${error.message}`);
        // Continue with next radio button
      }
    }

    // If no match found by specific matching, try to select the first option as fallback
    if (!selected && radioButtons.length > 0) {
      this.appendStatusMessage(
        `No exact match found, selecting first radio option as fallback`
      );
      await this.clickRadioButtonEffectively(radioButtons[0]);
      selected = true;
    }

    return selected;
  }

  /**
   * Click a radio button effectively using multiple approaches
   * This ensures the radio button is actually selected
   */
  async clickRadioButtonEffectively(radioBtn) {
    // First scroll to the element
    this.scrollToTargetAdjusted(radioBtn, 100);
    await this.wait(300);

    // Try several approaches to ensure the radio button is clicked

    // Approach 1: Standard click
    radioBtn.click();
    await this.wait(300);

    // Check if successful
    if (radioBtn.checked) {
      return true;
    }

    // Approach 2: Click the label if available
    const labelEl =
      radioBtn.closest("label") ||
      document.querySelector(`label[for="${radioBtn.id}"]`);
    if (labelEl) {
      labelEl.click();
      await this.wait(300);
    }

    // Check if successful
    if (radioBtn.checked) {
      return true;
    }

    // Approach 3: Try setting checked property directly
    radioBtn.checked = true;
    radioBtn.dispatchEvent(new Event("change", { bubbles: true }));
    await this.wait(300);

    // Approach 4: Click parent element if still not checked
    if (!radioBtn.checked && radioBtn.parentElement) {
      radioBtn.parentElement.click();
      await this.wait(300);
    }

    // Approach 5: Try using MouseEvents for more browser compatibility
    if (!radioBtn.checked) {
      const mouseDown = new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        view: window,
      });

      const mouseUp = new MouseEvent("mouseup", {
        bubbles: true,
        cancelable: true,
        view: window,
      });

      radioBtn.dispatchEvent(mouseDown);
      await this.wait(50);
      radioBtn.dispatchEvent(mouseUp);
      await this.wait(50);
      radioBtn.click();
      await this.wait(300);
    }

    return radioBtn.checked;
  }

  /**
   * Enhanced method to handle select/dropdown fields
   * Supports both native select elements and custom dropdown implementations
   */
  async handleSelectFieldSelection(selectElement, value) {
    if (!selectElement || !value) {
      return false;
    }

    this.appendStatusMessage(`Setting select/dropdown field to: "${value}"`);
    const valueText = String(value).toLowerCase();

    // Handle native select elements
    if (selectElement.tagName === "SELECT") {
      return await this.selectOptionByValueEnhanced(selectElement, value);
    }

    // Handle custom dropdown implementations

    // First scroll to the element
    this.scrollToTargetAdjusted(selectElement, 100);
    await this.wait(300);

    // Click to open the dropdown
    selectElement.click();
    await this.wait(700); // Longer wait for dropdown to fully open

    // Find all possible dropdown containers
    let dropdownContainer = null;

    // Try various dropdown container selectors
    const possibleContainers = [
      document.querySelector("dialog[open]"),
      document.querySelector(".dropdown-options"),
      document.querySelector(".options"),
      document.querySelector('ul[role="listbox"]'),
      document.querySelector('div[role="listbox"]'),
      selectElement
        .closest('div[data-input-type="select"]')
        ?.querySelector("ul, .options"),
      selectElement.closest(".select-container")?.querySelector("ul, .options"),
      selectElement.parentElement?.querySelector("ul, .options"),
      document.querySelector(".dropdown-content"),
      document.querySelector(".select-options"),
      document.querySelector(".lever-dropdown"),
    ];

    for (const container of possibleContainers) {
      if (container && container.offsetParent !== null) {
        dropdownContainer = container;
        break;
      }
    }

    // If we found a dropdown container, look for matching options
    if (dropdownContainer) {
      // Find all option elements that might be in the dropdown
      const options = dropdownContainer.querySelectorAll(
        'li, .option, .dropdown-item, option, [role="option"]'
      );

      this.appendStatusMessage(`Found dropdown with ${options.length} options`);

      // Try to find and click a matching option
      let matchFound = false;

      for (const option of options) {
        const optionText = option.textContent.trim().toLowerCase();

        // Match by exact text or partial text
        if (
          optionText === valueText ||
          optionText.includes(valueText) ||
          valueText.includes(optionText)
        ) {
          this.appendStatusMessage(
            `Selecting dropdown option: "${option.textContent.trim()}"`
          );
          this.scrollToTargetAdjusted(option, 100);
          await this.wait(300);

          // Try clicking the option
          option.click();
          await this.wait(500);

          // Check if the dropdown is now closed (indication of successful selection)
          if (dropdownContainer.offsetParent === null) {
            matchFound = true;
            break;
          }

          // Try clicking again with MouseEvents if still open
          const mouseDown = new MouseEvent("mousedown", {
            bubbles: true,
            cancelable: true,
            view: window,
          });

          const mouseUp = new MouseEvent("mouseup", {
            bubbles: true,
            cancelable: true,
            view: window,
          });

          option.dispatchEvent(mouseDown);
          await this.wait(50);
          option.dispatchEvent(mouseUp);
          await this.wait(300);

          matchFound = true;
          break;
        }
      }

      // If no match was found, try selecting the first option as fallback
      if (!matchFound && options.length > 0) {
        this.appendStatusMessage(
          `No matching option found, selecting first option as fallback`
        );
        options[0].click();
        await this.wait(500);
      }

      // If dropdown is still open, click outside to close it
      if (dropdownContainer.offsetParent !== null) {
        document.body.click();
        await this.wait(300);
      }

      return matchFound || options.length > 0;
    } else {
      // Dropdown container not found
      this.appendStatusMessage(
        `Could not find dropdown container - trying to set value directly`
      );

      // Try to set the value directly on the input
      if (selectElement.tagName === "INPUT") {
        await this.setAdvancedInputValue(selectElement, value);
        return true;
      }

      return false;
    }
  }

  /**
   * Enhanced version of selectOptionByValue that uses multiple approaches
   */
  async selectOptionByValueEnhanced(select, value) {
    if (!select || !value) return false;

    try {
      this.scrollToTargetAdjusted(select, 100);
      await this.wait(300);

      // Convert value to lowercase string for comparison
      const valueText = String(value).toLowerCase();
      let matchFound = false;

      // Try each option to find a match
      for (let i = 0; i < select.options.length; i++) {
        const option = select.options[i];
        const optionText = option.text.toLowerCase();
        const optionValue = option.value.toLowerCase();

        // Try to match by text or value
        if (
          optionText === valueText ||
          optionValue === valueText ||
          optionText.includes(valueText) ||
          valueText.includes(optionText)
        ) {
          // Multiple approaches to set the selected option

          // Approach 1: Set the selectedIndex
          select.selectedIndex = i;
          select.dispatchEvent(new Event("change", { bubbles: true }));
          await this.wait(300);

          // Approach 2: Set the value
          select.value = option.value;
          select.dispatchEvent(new Event("change", { bubbles: true }));
          await this.wait(300);

          // Approach 3: Set the selected property
          option.selected = true;
          select.dispatchEvent(new Event("change", { bubbles: true }));

          this.appendStatusMessage(`Selected option: ${option.text}`);
          matchFound = true;
          break;
        }
      }

      // If no match was found, try selecting the first non-placeholder option as fallback
      if (!matchFound && select.options.length > 0) {
        // Skip the first option if it looks like a placeholder
        const startIndex =
          select.options[0].value === "" ||
          select.options[0].text.includes("Select") ||
          select.options[0].text.includes("Choose")
            ? 1
            : 0;

        if (startIndex < select.options.length) {
          select.selectedIndex = startIndex;
          select.dispatchEvent(new Event("change", { bubbles: true }));
          this.appendStatusMessage(
            `No matching option found, selected: ${select.options[startIndex].text}`
          );
          return true;
        }
      }

      return matchFound;
    } catch (error) {
      debugLog("Error in selectOptionByValueEnhanced:", error);
      return false;
    }
  }

  /**
   * Modified fillApplicationFields function with enhanced radio and select handling
   */
  async fillApplicationFields(form, profile) {
    try {
      this.appendStatusMessage("Filling form fields...");

      // Extract all questions from the form first
      const fieldQuestions = this.extractLeverFormQuestions(form);

      // Create a comprehensive field mapping from profile data
      const fieldsValue = this.mapProfileToFields(profile);

      // More comprehensive field selector similar to the original script
      const FIELDS_SELECTOR =
        'fieldset[aria-labelledby], div[role="group"][aria-labelledby], ' +
        'input[aria-labelledby]:not([aria-hidden="true"],[type="file"]), ' +
        'textarea[aria-labelledby], input[texts]:not([aria-hidden="true"],[type="file"]), ' +
        'input[placeholder][inputmode="tel"]:not([aria-hidden="true"],[type="file"]), ' +
        'input[type="text"], input[type="email"], input[type="tel"], input[type="url"], ' +
        "textarea, select, div.select-container, " +
        'fieldset:has(input[type="radio"]), fieldset:has(input[type="checkbox"]), ' +
        'div:has(input[type="radio"]), div:has(input[type="checkbox"])';

      // Gather all form fields including complex ones
      const formElements = [...form.querySelectorAll(FIELDS_SELECTOR)];

      // Adding debugging information about all form fields
      debugLog(`Found ${formElements.length} form fields to process`);

      // Process all form elements
      for (const el of formElements) {
        if (
          el.classList.contains("location-input") ||
          el.id === "location-input" ||
          (el.name === "location" &&
            el.parentElement.querySelector('input[name="selectedLocation"]'))
        ) {
          this.appendStatusMessage("Found location autocomplete field");

          // Get location value from profile
          let locationValue =
            profile.currentCity ||
            profile.city ||
            profile.location ||
            `${profile.firstName}'s location`;

          // Handle the location autocomplete separately
          await this.handleLocationAutocomplete(el, locationValue);

          // Skip normal field handling
          continue;
        }
        // Skip hidden elements
        if (
          el.style.display === "none" ||
          el.offsetParent === null ||
          el.style.visibility === "hidden" ||
          el.getAttribute("aria-hidden") === "true"
        ) {
          continue;
        }

        // Create field info object
        const field = {
          element: el,
          type: "",
          label: "",
          required: false,
          options: [],
        };

        // IMPROVED APPROACH: First check if we have a question for this field in our extracted questions
        const questionText = this.getQuestionForField(el, fieldQuestions);

        if (questionText) {
          field.label = questionText;
          debugLog(
            `Using extracted question: "${questionText}" for field ${
              el.name || el.id
            }`
          );
        } else {
          // If no extracted question, fall back to standard label detection
          const ariaLabelledBy = el.getAttribute("aria-labelledby");
          const labelEl = ariaLabelledBy
            ? document.getElementById(ariaLabelledBy)
            : el.closest("label") ||
              document.querySelector(`label[for="${el.id}"]`) ||
              el.parentElement?.querySelector("label");

          if (labelEl) {
            field.label = labelEl.textContent.trim();
            field.required = this.isRequired(labelEl);
          } else {
            // Try to get label from container or nearby elements
            const container =
              el.closest(".application-field") || el.parentElement;
            if (container) {
              const labelText = container
                .querySelector("label, .field-label, .label")
                ?.textContent.trim();
              if (labelText) {
                field.label = labelText;
              }
            }

            // If still no label, try placeholder, aria-label, or name
            if (!field.label) {
              field.label =
                el.getAttribute("placeholder") ||
                el.getAttribute("aria-label") ||
                el.getAttribute("name") ||
                el.id ||
                "";
            }
          }
        }

        // Check if required
        field.required =
          field.required ||
          el.hasAttribute("required") ||
          el.getAttribute("aria-required") === "true" ||
          field.label.includes("*") ||
          el.closest(".required-field") !== null;

        // Clean up label by removing required asterisk if present
        field.label = field.label.replace(/✱$/, "").trim();

        // Determine field type and handle different field types
        switch (el.nodeName) {
          case "INPUT":
          case "TEXTAREA":
            field.type = el.type;
            if (
              el.nodeName === "INPUT" &&
              (el.getAttribute("role") === "combobox" ||
                el.parentElement?.querySelector(".dropdown-icon"))
            ) {
              field.type = "select";
              // Try to find and extract options
              const selectContainer =
                el.closest('div[data-input-type="select"]') ||
                el.closest(".select-container") ||
                el.parentElement;
              if (selectContainer) {
                const optionElements = selectContainer.querySelectorAll(
                  "dialog ul li, .dropdown-options li, .options li"
                );
                if (optionElements.length) {
                  field.options = [...optionElements].map((el) =>
                    el.textContent.trim()
                  );
                }
              }
            }
            break;

          case "SELECT":
            field.type = "select";
            field.options = [...el.querySelectorAll("option")].map((opt) =>
              opt.textContent.trim()
            );
            break;

          case "DIV":
            // Check if this div contains radio or checkbox inputs
            const inputs = el.querySelectorAll("input");
            if (inputs.length > 0) {
              field.type = inputs[0].type;
              field.element = [...inputs];
              field.options = [...el.querySelectorAll("label")].map((l) =>
                l.textContent.trim()
              );
            }
            break;

          case "FIELDSET":
            // Fieldsets often contain radio or checkbox groups
            const fieldsetInputs = el.querySelectorAll("input");
            if (fieldsetInputs.length > 0) {
              field.type = fieldsetInputs[0].type;
              field.element = [...fieldsetInputs];
              field.options = [...fieldsetInputs].map(
                (input) =>
                  input.closest("label")?.textContent.trim() ||
                  document
                    .querySelector(`label[for="${input.id}"]`)
                    ?.textContent.trim() ||
                  ""
              );
            }
            break;
        }

        // Get field value from mapping
        let value = fieldsValue[field.label.toLowerCase()];

        // Log identified field for debugging
        debugLog(
          `Field: "${field.label}" (${field.type}), Value: ${
            value ? "Found" : "Not found"
          }`
        );

        // If no value found by exact label match, try more flexible matching
        if (!value) {
          // Try looking for key terms in the label
          const labelLower = field.label.toLowerCase();

          // Standard profile fields
          if (
            this.matchesAny(labelLower, [
              "first name",
              "given name",
              "firstname",
            ])
          ) {
            value = profile.firstName;
          } else if (
            this.matchesAny(labelLower, ["last name", "surname", "lastname"])
          ) {
            value = profile.lastName;
          } else if (this.matchesAny(labelLower, ["full name", "name"])) {
            value = `${profile.firstName} ${profile.lastName}`;
          } else if (this.matchesAny(labelLower, ["email", "e-mail"])) {
            value = profile.email;
          } else if (
            this.matchesAny(labelLower, ["phone", "telephone", "mobile"])
          ) {
            value = profile.phone || profile.phoneNumber;
          } else if (
            this.matchesAny(labelLower, [
              "linkedin",
              "linked in",
              "inkedin url",
            ])
          ) {
            value = profile.linkedIn || profile.linkedinUrl;
          } else if (this.matchesAny(labelLower, ["github", "git hub"])) {
            value = profile.github || profile.githubUrl;
          } else if (
            this.matchesAny(labelLower, [
              "website",
              "portfolio",
              "personal site",
            ])
          ) {
            value = profile.website || profile.websiteUrl;
          } else if (
            this.matchesAny(labelLower, [
              "company",
              "employer",
              "current company",
            ])
          ) {
            value = profile.currentCompany || "";
          } else if (
            this.matchesAny(labelLower, [
              "location",
              "city",
              "address",
              "current location",
            ])
          ) {
            value = profile.currentCity || profile.city || "";
          }
          // Common application questions
          else if (
            this.matchesSpecificQuestion(
              labelLower,
              "how did you hear about this role"
            )
          ) {
            value = profile.referral || "LinkedIn";
          } else if (
            this.matchesSpecificQuestion(
              labelLower,
              "why do you want to work at"
            )
          ) {
            value =
              this.generateWhyCompanyAnswer(labelLower) ||
              profile.whyJoin ||
              profile.coverLetter;
          } else if (
            this.matchesSpecificQuestion(
              labelLower,
              "something impressive you've built or done"
            )
          ) {
            value =
              this.generateImpressionAnswer() ||
              profile.achievements ||
              profile.coverLetter;
          } else if (
            this.matchesCommonQuestion(labelLower, [
              "experience",
              "tell us about yourself",
              "background",
              "introduction",
            ])
          ) {
            value =
              profile.summary || profile.coverLetter || profile.additionalInfo;
          } else if (
            this.matchesCommonQuestion(labelLower, [
              "why join",
              "why interested",
              "why do you want",
              "why are you interested",
            ])
          ) {
            value = profile.whyJoin || profile.coverLetter;
          } else if (
            this.matchesCommonQuestion(labelLower, [
              "salary",
              "compensation",
              "pay",
              "expect",
            ])
          ) {
            value = profile.desiredSalary || "Negotiable";
          } else if (
            this.matchesCommonQuestion(labelLower, [
              "start",
              "when can you",
              "availability",
              "notice period",
            ])
          ) {
            value = profile.availability || profile.noticePeriod || "2 weeks";
          } else if (
            this.matchesCommonQuestion(labelLower, [
              "years of experience",
              "how many years",
              "work experience",
            ])
          ) {
            value = profile.yearsOfExperience || "5+ years";
          } else if (
            this.matchesCommonQuestion(labelLower, [
              "visa",
              "authorized",
              "legally",
              "work authorization",
            ])
          ) {
            value = "Yes"; // Default to yes for work authorization
          } else if (
            this.matchesCommonQuestion(labelLower, [
              "education",
              "degree",
              "university",
              "college",
            ])
          ) {
            value = profile.education || "Bachelor's Degree";
          } else if (
            this.matchesCommonQuestion(labelLower, [
              "skills",
              "technologies",
              "programming",
              "technical",
            ])
          ) {
            value =
              profile.skills ||
              "Please see my resume for a comprehensive list of technical skills.";
          } else if (
            this.matchesCommonQuestion(labelLower, [
              "reference",
              "referral",
              "how did you hear",
              "how did you find",
            ])
          ) {
            value = profile.referral || "LinkedIn";
          } else if (
            this.matchesCommonQuestion(labelLower, ["cover letter", "cover"])
          ) {
            value = profile.coverLetter || "";
          } else if (
            this.matchesCommonQuestion(labelLower, [
              "additional",
              "comments",
              "anything else",
            ])
          ) {
            value =
              profile.additionalInfo ||
              "Thank you for considering my application. I look forward to discussing how my skills and experience align with your needs.";
          } else if (
            labelLower.includes("resume") ||
            labelLower.includes("cv")
          ) {
            // Skip resume fields - handled separately
            continue;
          }
        }

        // For fields that still have no value, try a generic answer
        if (!value) {
          if (
            el.nodeName === "TEXTAREA" ||
            (el.nodeName === "INPUT" && el.type === "text")
          ) {
            value = this.generateGenericAnswer(field.label);
            debugLog(`Generated generic answer for "${field.label}"`);
          }
        }

        // Skip if no value to fill
        if (!value) {
          debugLog(`No value found for field: "${field.label}"`);
          continue;
        }

        this.appendStatusMessage(
          `Filling field: ${field.label} (${field.type})`
        );

        // Fill the field based on its type with enhanced handling
        await this.wait(100); // Small wait to prevent race conditions

        try {
          // ENHANCED HANDLING FOR DIFFERENT FIELD TYPES
          if (field.type === "radio" && Array.isArray(field.element)) {
            // Use our enhanced radio button handling
            await this.handleRadioButtonSelection(field.element, value);
          } else if (
            field.type === "checkbox" &&
            Array.isArray(field.element)
          ) {
            // Handle checkbox groups
            for (const el of field.element) {
              this.scrollToTargetAdjusted(el, 100);

              // For checkboxes, match by label text
              const labelText =
                el.closest("label")?.textContent.trim() ||
                document
                  .querySelector(`label[for="${el.id}"]`)
                  ?.textContent.trim() ||
                el.parentNode?.parentNode?.textContent.trim() ||
                "";

              if (
                labelText === value ||
                labelText.toLowerCase() === value.toLowerCase() ||
                (Array.isArray(value) && value.includes(labelText))
              ) {
                // Try multiple approaches to check the box
                el.click();
                await this.wait(300);

                if (!el.checked) {
                  const labelEl =
                    el.closest("label") ||
                    document.querySelector(`label[for="${el.id}"]`);
                  if (labelEl) {
                    labelEl.click();
                    await this.wait(300);
                  }
                }

                if (!el.checked) {
                  el.checked = true;
                  el.dispatchEvent(new Event("change", { bubbles: true }));
                }
              }
            }
          } else if (field.type === "select") {
            // Use our enhanced select field handling
            await this.handleSelectFieldSelection(field.element, value);
          } else {
            // Handle text inputs and textareas
            await this.setAdvancedInputValue(field.element, value);
          }
        } catch (inputError) {
          debugLog(`Error filling field ${field.label}:`, inputError);
          // Continue with other fields
        }
      }

      // Special handling for phone fields with country code
      if (profile.phone && profile.phoneCountryCode) {
        const phoneInput = form.querySelector(
          'input[type="tel"], input[name="phone"], input[placeholder*="phone"]'
        );
        if (phoneInput) {
          // Handle country code dropdown if present
          const countryCodeElement =
            phoneInput.parentElement.querySelector('[role="combobox"]');
          if (countryCodeElement) {
            countryCodeElement.click();
            await this.wait(500);

            // Find country code dropdown items and click the matching one
            const countryItems = document.querySelectorAll(
              ".iti__dropdown-content li.iti__country, .country-code-dropdown li"
            );
            for (const item of countryItems) {
              const dialCode = item.querySelector(
                ".iti__dial-code, .dial-code"
              )?.textContent;
              if (dialCode === profile.phoneCountryCode) {
                item.click();
                break;
              }
            }

            // Set phone number without country code
            const phoneValueWithoutCountry = profile.phone.replace(
              profile.phoneCountryCode,
              ""
            );
            await this.setAdvancedInputValue(
              phoneInput,
              phoneValueWithoutCountry
            );
          }
        }
      }

      // Handle GDPR/consent checkboxes
      await this.handleRequiredCheckboxes(form);
    } catch (error) {
      debugLog("Error filling application fields:", error);
      this.appendStatusMessage(
        `Warning: Some fields may not have been filled correctly - ${error.message}`
      );
      // Continue despite errors in field filling
    }
  }

  /**
   * Matches a specific question exactly
   */
  matchesSpecificQuestion(labelText, questionFragment) {
    if (!labelText || !questionFragment) return false;

    const normalizedLabel = labelText.toLowerCase().trim();
    const normalizedQuestion = questionFragment.toLowerCase().trim();

    return normalizedLabel.includes(normalizedQuestion);
  }

  /**
   * Creates a custom "Why join this company" answer based on the question
   */
  generateWhyCompanyAnswer(question) {
    // Try to extract company name from the question
    let companyName = "";
    const matches = question.match(
      /why (?:do you want to|would you like to) work at\s+([^?]+)/i
    );
    if (matches && matches[1]) {
      companyName = matches[1].trim();
    }

    if (!companyName) {
      const altMatches = question.match(/why\s+([^?]+)/i);
      if (
        altMatches &&
        altMatches[1] &&
        (altMatches[1].includes("join") ||
          altMatches[1].includes("interested") ||
          altMatches[1].includes("work"))
      ) {
        const parts = altMatches[1].split(/\s+/);
        if (parts.length > 0) {
          // The last word might be the company name
          companyName = parts[parts.length - 1];
        }
      }
    }

    if (companyName) {
      return `I'm particularly interested in joining ${companyName} because of your reputation for innovation and commitment to excellence. After researching your company, I was impressed by your industry leadership and the positive impact you're making. The values and culture at ${companyName} align well with my own professional approach, and I'm excited about the opportunity to contribute to your continued success. I believe my skills and experiences would allow me to make meaningful contributions while also growing professionally in this role.`;
    }

    return null;
  }

  /**
   * Generates an impressive achievement answer
   */
  generateImpressionAnswer() {
    return "One of my most significant accomplishments was leading a cross-functional team on a critical project that faced numerous technical challenges and tight deadlines. Despite these obstacles, I developed a strategic approach that prioritized clear communication and iterative problem-solving. By implementing innovative solutions and fostering a collaborative environment, we not only delivered the project ahead of schedule but also exceeded the initial requirements. This experience reinforced my ability to navigate complex situations, adapt to changing conditions, and deliver meaningful results through both technical expertise and effective leadership.";
  }

  //DEBUGING
  /**
   * Enhanced debug function that shows the template extraction and question mapping
   */
  debugFormFieldsEnhanced(form, profile) {
    try {
      this.appendStatusMessage(
        "🔍 ENHANCED DEBUGGING: Analyzing Lever form with template extraction..."
      );

      // Create a debug panel in the UI
      this.createDebugPanel();
      const debugPanel = document.getElementById("lever-debug-panel-content");

      // Clear any existing content
      if (debugPanel) {
        debugPanel.innerHTML = "";

        // Add header
        const header = document.createElement("div");
        header.innerHTML = "<strong>Enhanced Lever Form Analysis</strong>";
        header.style.marginBottom = "10px";
        debugPanel.appendChild(header);
      }

      // Step 1: Extract the template questions
      const fieldQuestions = this.extractLeverFormQuestions(form);

      // Display the extracted questions
      if (debugPanel) {
        const templateSection = document.createElement("div");
        templateSection.style.marginBottom = "20px";
        templateSection.style.padding = "10px";
        templateSection.style.backgroundColor = "#f0f8ff";
        templateSection.style.borderRadius = "5px";

        const templateTitle = document.createElement("div");
        templateTitle.innerHTML =
          "<strong>Extracted Questions from Templates:</strong>";
        templateTitle.style.marginBottom = "8px";
        templateSection.appendChild(templateTitle);

        if (Object.keys(fieldQuestions).length > 0) {
          const questionsList = document.createElement("ul");
          questionsList.style.margin = "0";
          questionsList.style.paddingLeft = "20px";

          Object.entries(fieldQuestions).forEach(
            ([fieldName, questionText]) => {
              const item = document.createElement("li");
              item.innerHTML = `<code>${fieldName}</code>: "${questionText}"`;
              questionsList.appendChild(item);
            }
          );

          templateSection.appendChild(questionsList);
        } else {
          const noTemplates = document.createElement("div");
          noTemplates.textContent = "No template questions found";
          noTemplates.style.fontStyle = "italic";
          templateSection.appendChild(noTemplates);
        }

        debugPanel.appendChild(templateSection);
      }

      // Use the comprehensive field selector
      const FIELDS_SELECTOR =
        'fieldset[aria-labelledby], div[role="group"][aria-labelledby], ' +
        'input[aria-labelledby]:not([aria-hidden="true"],[type="file"]), ' +
        'textarea[aria-labelledby], input[texts]:not([aria-hidden="true"],[type="file"]), ' +
        'input[placeholder][inputmode="tel"]:not([aria-hidden="true"],[type="file"]), ' +
        'input[type="text"], input[type="email"], input[type="tel"], input[type="url"], ' +
        "textarea, select, div.select-container, " +
        'fieldset:has(input[type="radio"]), fieldset:has(input[type="checkbox"]), ' +
        'div:has(input[type="radio"]), div:has(input[type="checkbox"])';

      // Find all form elements
      const formElements = [...form.querySelectorAll(FIELDS_SELECTOR)];

      // Create field mapping from profile data
      const fieldsValue = this.mapProfileToFields(profile);

      // Log to console for reference
      console.log(`🔍 DEBUG: Found ${formElements.length} form elements`);
      console.log("Extracted field questions:", fieldQuestions);

      // Process each element
      const fieldDetails = [];

      if (debugPanel) {
        // Add fields section header
        const fieldsHeader = document.createElement("div");
        fieldsHeader.innerHTML = `<strong>Form Fields Analysis (${formElements.length} fields):</strong>`;
        fieldsHeader.style.marginBottom = "10px";
        fieldsHeader.style.marginTop = "10px";
        debugPanel.appendChild(fieldsHeader);
      }

      for (let i = 0; i < formElements.length; i++) {
        const el = formElements[i];

        // Skip hidden elements
        if (
          el.style.display === "none" ||
          el.offsetParent === null ||
          el.style.visibility === "hidden" ||
          el.getAttribute("aria-hidden") === "true"
        ) {
          continue;
        }

        // Get basic element info
        const elementType = el.nodeName.toLowerCase();
        const elementSubType = el.type || "unknown";

        // Find the question for this field using our new extraction method
        const extractedQuestion = this.getQuestionForField(el, fieldQuestions);
        let questionSource = extractedQuestion ? "template extraction" : "none";

        // Try original label finding methods if not found from template
        const ariaLabelledBy = el.getAttribute("aria-labelledby");
        const labelEl = ariaLabelledBy
          ? document.getElementById(ariaLabelledBy)
          : el.closest("label") ||
            document.querySelector(`label[for="${el.id}"]`) ||
            el.parentElement?.querySelector("label");

        let labelText = extractedQuestion || "";
        let labelSource = extractedQuestion ? "template extraction" : "";
        let isRequired = false;

        if (!labelText && labelEl) {
          labelText = labelEl.textContent.trim();
          labelSource = "explicit label";
          questionSource = "explicit label";
          isRequired = this.isRequired(labelEl);
        } else if (!labelText) {
          // Try to get label from container or nearby elements
          const container =
            el.closest(".application-field") || el.parentElement;
          if (container) {
            const containerLabelText = container
              .querySelector("label, .field-label, .label")
              ?.textContent.trim();
            if (containerLabelText) {
              labelText = containerLabelText;
              labelSource = "container label";
              questionSource = "container label";
            }
          }

          // If still no label, try placeholder, aria-label, or name
          if (!labelText) {
            if (el.getAttribute("placeholder")) {
              labelText = el.getAttribute("placeholder");
              labelSource = "placeholder";
              questionSource = "placeholder";
            } else if (el.getAttribute("aria-label")) {
              labelText = el.getAttribute("aria-label");
              labelSource = "aria-label";
              questionSource = "aria-label";
            } else if (el.getAttribute("name")) {
              labelText = el.getAttribute("name");
              labelSource = "name attribute";
              questionSource = "name attribute";
            } else if (el.id) {
              labelText = el.id;
              labelSource = "id";
              questionSource = "id";
            }
          }

          // Check if required from other indicators
          isRequired =
            el.hasAttribute("required") ||
            el.getAttribute("aria-required") === "true" ||
            labelText.includes("*") ||
            (container?.textContent || "").includes("*required") ||
            el.closest(".required-field") !== null;
        }

        // Clean up label by removing required asterisk if present
        labelText = labelText.replace(/✱$/, "").trim();

        // Determine field type and options
        let fieldType = elementSubType;
        let options = [];

        // Special handling for different field types
        if (
          elementType === "input" &&
          (el.getAttribute("role") === "combobox" ||
            el.parentElement?.querySelector(".dropdown-icon"))
        ) {
          fieldType = "select/dropdown";

          // Try to find and extract options
          const selectContainer =
            el.closest('div[data-input-type="select"]') ||
            el.closest(".select-container") ||
            el.parentElement;
          if (selectContainer) {
            const optionElements = selectContainer.querySelectorAll(
              "dialog ul li, .dropdown-options li, .options li"
            );
            if (optionElements.length) {
              options = [...optionElements].map((el) => el.textContent.trim());
            }
          }
        } else if (elementType === "select") {
          fieldType = "select/dropdown";
          options = [...el.querySelectorAll("option")].map((opt) =>
            opt.textContent.trim()
          );
        } else if (elementType === "div" || elementType === "fieldset") {
          // Check if contains radio or checkbox inputs
          const inputs = el.querySelectorAll("input");
          if (inputs.length > 0) {
            fieldType = inputs[0].type + " group";
            options = [...el.querySelectorAll("label")].map((l) =>
              l.textContent.trim()
            );
          }
        }

        // Find what value would be used for this field
        let value = fieldsValue[labelText.toLowerCase()];
        let valueSource = "direct mapping";

        // If no value found by direct mapping, try our matching methods
        if (!value) {
          const labelLower = labelText.toLowerCase();

          // Try standard profile fields
          if (
            this.matchesAny(labelLower, [
              "first name",
              "given name",
              "firstname",
            ])
          ) {
            value = profile.firstName;
            valueSource = "first name match";
          } else if (
            this.matchesAny(labelLower, ["last name", "surname", "lastname"])
          ) {
            value = profile.lastName;
            valueSource = "last name match";
          } else if (this.matchesAny(labelLower, ["full name", "name"])) {
            value = `${profile.firstName} ${profile.lastName}`;
            valueSource = "full name match";
          } else if (this.matchesAny(labelLower, ["email", "e-mail"])) {
            value = profile.email;
            valueSource = "email match";
          } else if (
            this.matchesAny(labelLower, ["phone", "telephone", "mobile"])
          ) {
            value = profile.phone || profile.phoneNumber;
            valueSource = "phone match";
          } else if (this.matchesAny(labelLower, ["linkedin", "linked in"])) {
            value = profile.linkedIn || profile.linkedinUrl;
            valueSource = "linkedin match";
          } else if (
            this.matchesAny(labelLower, [
              "location",
              "city",
              "address",
              "current location",
            ])
          ) {
            value = profile.currentCity || profile.city || "";
            valueSource = "location match";
          } else if (
            this.matchesSpecificQuestion(
              labelLower,
              "how did you hear about this role"
            )
          ) {
            value = profile.referral || "LinkedIn";
            valueSource = "specific question match: referral";
          } else if (
            this.matchesSpecificQuestion(
              labelLower,
              "why do you want to work at"
            )
          ) {
            value =
              this.generateWhyCompanyAnswer(labelLower) ||
              profile.whyJoin ||
              profile.coverLetter;
            valueSource = "generated why company answer";
          } else if (
            this.matchesSpecificQuestion(
              labelLower,
              "something impressive you've built or done"
            )
          ) {
            value =
              this.generateImpressionAnswer() ||
              profile.achievements ||
              profile.coverLetter;
            valueSource = "generated achievement answer";
          } else if (
            el.nodeName === "TEXTAREA" ||
            (el.nodeName === "INPUT" && el.type === "text")
          ) {
            value = this.generateGenericAnswer(labelText);
            valueSource = "generated generic answer";
          }
        }

        // Add details to array for console logging
        fieldDetails.push({
          index: i + 1,
          elementType,
          fieldType,
          label: labelText,
          labelSource,
          questionSource,
          isRequired,
          options: options.length > 0 ? options : undefined,
          value: value
            ? typeof value === "string" && value.length > 50
              ? value.substring(0, 50) + "..."
              : value
            : "N/A",
          valueSource: value ? valueSource : "N/A",
          id: el.id || "none",
          name: el.name || "none",
          placeholder: el.placeholder || "none",
        });

        // Add to debug panel if available
        if (debugPanel) {
          const fieldInfo = document.createElement("div");
          fieldInfo.style.border = "1px solid #ccc";
          fieldInfo.style.padding = "10px";
          fieldInfo.style.marginBottom = "12px";
          fieldInfo.style.borderRadius = "4px";
          fieldInfo.style.position = "relative";

          // Color coding based on source and value
          if (questionSource === "template extraction") {
            fieldInfo.style.borderLeft = "4px solid #4CAF50"; // Green for template extraction
          } else if (isRequired) {
            fieldInfo.style.borderLeft = "4px solid #f44336"; // Red for required
          }

          if (value) {
            fieldInfo.style.backgroundColor = "#f9f9f9"; // Light gray for fields with values
          }

          // Create field label
          const fieldLabel = document.createElement("div");
          fieldLabel.style.fontWeight = "bold";
          fieldLabel.style.marginBottom = "5px";
          fieldLabel.style.fontSize = "14px";
          fieldLabel.textContent = `${i + 1}. ${labelText || "[NO LABEL]"}`;

          if (isRequired) {
            const requiredBadge = document.createElement("span");
            requiredBadge.textContent = "Required";
            requiredBadge.style.backgroundColor = "#f44336";
            requiredBadge.style.color = "white";
            requiredBadge.style.padding = "2px 6px";
            requiredBadge.style.borderRadius = "3px";
            requiredBadge.style.fontSize = "10px";
            requiredBadge.style.marginLeft = "8px";
            fieldLabel.appendChild(requiredBadge);
          }

          // Create field metadata
          const fieldMeta = document.createElement("div");
          fieldMeta.style.fontSize = "12px";
          fieldMeta.style.color = "#666";
          fieldMeta.innerHTML =
            `Type: <code>${elementType} (${fieldType})</code><br>` +
            `Label Source: <code>${labelSource}</code><br>` +
            `Question Source: <code>${questionSource}</code><br>` +
            `Element: <code>${el.name || el.id || elementType}</code>`;

          // Add value information if available
          if (value) {
            const valueInfo = document.createElement("div");
            valueInfo.style.marginTop = "8px";
            valueInfo.style.padding = "8px";
            valueInfo.style.backgroundColor = "#e8f5e9";
            valueInfo.style.borderRadius = "4px";

            const valueTitle = document.createElement("div");
            valueTitle.innerHTML = `<strong>Will fill with:</strong> <span style="color:#2e7d32">(${valueSource})</span>`;
            valueTitle.style.marginBottom = "4px";
            valueInfo.appendChild(valueTitle);

            const valueContent = document.createElement("div");
            valueContent.style.fontSize = "12px";
            valueContent.style.maxHeight = "60px";
            valueContent.style.overflow = "auto";

            if (typeof value === "string" && value.length > 100) {
              valueContent.textContent = value.substring(0, 100) + "...";
              valueContent.title = value; // Full text on hover
            } else {
              valueContent.textContent = value;
            }

            valueInfo.appendChild(valueContent);
            fieldMeta.appendChild(valueInfo);
          } else {
            const noValueInfo = document.createElement("div");
            noValueInfo.style.marginTop = "8px";
            noValueInfo.style.fontStyle = "italic";
            noValueInfo.style.color = "#999";
            noValueInfo.textContent = "No value will be filled for this field";
            fieldMeta.appendChild(noValueInfo);
          }

          // Add options if available
          if (options.length > 0) {
            const optionsEl = document.createElement("div");
            optionsEl.style.fontSize = "12px";
            optionsEl.style.marginTop = "8px";
            optionsEl.innerHTML = `<strong>Options:</strong> ${options
              .slice(0, 5)
              .join(", ")}${options.length > 5 ? "..." : ""}`;
            fieldMeta.appendChild(optionsEl);
          }

          // Append elements
          fieldInfo.appendChild(fieldLabel);
          fieldInfo.appendChild(fieldMeta);
          debugPanel.appendChild(fieldInfo);
        }
      }

      // Log detailed information to console for analysis
      console.table(fieldDetails);

      this.appendStatusMessage(
        `🔍 ENHANCED DEBUG: Found ${fieldDetails.length} form fields with ${
          Object.keys(fieldQuestions).length
        } extracted questions`
      );

      return fieldDetails;
    } catch (error) {
      console.error("Error in debugFormFieldsEnhanced:", error);
      this.appendStatusMessage(`Error analyzing form fields: ${error.message}`);
      return [];
    }
  }

  /**
   * Creates a debug panel on the page
   */
  createDebugPanel() {
    try {
      // Check if panel already exists
      if (document.getElementById("lever-debug-panel")) {
        return;
      }

      // Create debug panel
      const debugPanel = document.createElement("div");
      debugPanel.id = "lever-debug-panel";
      debugPanel.style.cssText = `
        position: fixed;
        top: 10px;
        left: 10px;
        background-color: rgba(255, 255, 255, 0.95);
        border: 2px solid #007bff;
        color: #333;
        padding: 10px;
        border-radius: 5px;
        z-index: 10000;
        width: 350px;
        max-height: 80vh;
        overflow-y: auto;
        font-family: Arial, sans-serif;
        font-size: 12px;
        box-shadow: 0 0 10px rgba(0,0,0,0.2);
      `;

      // Add header with controls
      const header = document.createElement("div");
      header.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid #ccc;
        padding-bottom: 8px;
        margin-bottom: 10px;
      `;

      // Add title
      const title = document.createElement("div");
      title.textContent = "🔍 Form Field Analyzer";
      title.style.fontWeight = "bold";

      // Add control buttons
      const controls = document.createElement("div");

      // Minimize button
      const minimizeBtn = document.createElement("button");
      minimizeBtn.textContent = "_";
      minimizeBtn.style.cssText = `
        background: none;
        border: 1px solid #ccc;
        border-radius: 3px;
        margin-left: 5px;
        cursor: pointer;
        padding: 0 5px;
      `;
      minimizeBtn.onclick = () => {
        const content = document.getElementById("lever-debug-panel-content");
        if (content.style.display === "none") {
          content.style.display = "block";
          minimizeBtn.textContent = "_";
        } else {
          content.style.display = "none";
          minimizeBtn.textContent = "□";
        }
      };

      // Close button
      const closeBtn = document.createElement("button");
      closeBtn.textContent = "X";
      closeBtn.style.cssText = `
        background: none;
        border: 1px solid #ccc;
        border-radius: 3px;
        margin-left: 5px;
        cursor: pointer;
        padding: 0 5px;
      `;
      closeBtn.onclick = () => {
        document.body.removeChild(debugPanel);
      };

      controls.appendChild(minimizeBtn);
      controls.appendChild(closeBtn);

      header.appendChild(title);
      header.appendChild(controls);
      debugPanel.appendChild(header);

      // Add content container
      const content = document.createElement("div");
      content.id = "lever-debug-panel-content";
      debugPanel.appendChild(content);

      // Add to page
      document.body.appendChild(debugPanel);
    } catch (error) {
      console.error("Error creating debug panel:", error);
    }
  }

  /**
   * Enhanced radio button handling specifically for Lever's format
   */

  /**
   * Process the hidden template data to extract question information
   * This helps us understand the structure of radio buttons and multi-choice options
   * @param {HTMLElement} form - The form element
   * @returns {Object} - Mapping of field names to their questions and options
   */
  extractLeverTemplateData(form) {
    const templateData = {};

    try {
      // Find all hidden template fields
      const templateInputs = form.querySelectorAll(
        'input[name*="baseTemplate"]'
      );

      templateInputs.forEach((input) => {
        try {
          // Extract card ID from input name
          const cardIdMatch = input.name.match(/cards\[(.*?)\]/);
          if (!cardIdMatch) return;

          const cardId = cardIdMatch[1];
          const templateValue = input.value;

          // Parse the JSON template data
          if (templateValue) {
            // Fix escaped quotes
            const cleanedValue = templateValue.replace(/&quot;/g, '"');
            const template = JSON.parse(cleanedValue);

            // Process fields from the template
            if (template.fields && Array.isArray(template.fields)) {
              template.fields.forEach((field, index) => {
                const fieldName = `cards[${cardId}][field${index}]`;

                templateData[fieldName] = {
                  question: field.text,
                  type: field.type,
                  required: field.required,
                  options: field.options || [],
                };

                this.appendStatusMessage(
                  `Found template field: "${field.text}" (${field.type})`
                );
              });
            }
          }
        } catch (error) {
          debugLog("Error parsing template data:", error);
        }
      });

      debugLog("Extracted template data:", templateData);
      return templateData;
    } catch (error) {
      debugLog("Error extracting template data:", error);
      return {};
    }
  }

  /**
   * Enhanced method specifically for handling Lever's radio button fields
   * @param {HTMLElement} form - The form element containing the radio buttons
   * @param {Object} profile - The profile data used to determine values
   */
  async handleLeverRadioButtons(form, profile) {
    try {
      this.appendStatusMessage("Processing radio button fields");

      // Extract template data for better understanding of radio fields
      const templateData = this.extractLeverTemplateData(form);

      // Find all multiple-choice question containers
      const radioGroups = form.querySelectorAll(
        '.application-question ul[data-qa="multiple-choice"]'
      );

      for (const radioGroup of radioGroups) {
        // Find the parent question container
        const questionContainer = radioGroup.closest(".application-question");
        if (!questionContainer) continue;

        // Get the question text
        const questionEl = questionContainer.querySelector(
          ".application-label .text"
        );
        if (!questionEl) continue;

        // Clean up the question text (remove the required asterisk)
        const questionText = questionEl.textContent.replace(/✱$/, "").trim();

        // Find the radio inputs in this group
        const radioInputs = radioGroup.querySelectorAll('input[type="radio"]');
        if (!radioInputs.length) continue;

        // Get the name of the first radio which identifies the group
        const radioName = radioInputs[0].name;

        // Decide what value to use for this radio group
        let selectedValue = null;

        // Special handling for common questions
        if (questionText.includes("legally authorized to work")) {
          selectedValue = "Yes";
          this.appendStatusMessage(`Setting work authorization to: Yes`);
        } else if (questionText.includes("require sponsorship")) {
          selectedValue = "No";
          this.appendStatusMessage(`Setting visa sponsorship to: No`);
        } else if (questionText.toLowerCase().includes("authorized")) {
          selectedValue = "Yes";
          this.appendStatusMessage(`Setting authorization question to: Yes`);
        } else if (questionText.toLowerCase().includes("eligible to work")) {
          selectedValue = "Yes";
          this.appendStatusMessage(`Setting work eligibility to: Yes`);
        } else if (
          questionText.toLowerCase().includes("relocate") ||
          questionText.toLowerCase().includes("relocation")
        ) {
          selectedValue = "Yes";
          this.appendStatusMessage(`Setting relocation question to: Yes`);
        } else if (
          questionText.toLowerCase().includes("remote") ||
          questionText.toLowerCase().includes("work from home")
        ) {
          selectedValue = "Yes";
          this.appendStatusMessage(`Setting remote work question to: Yes`);
        } else if (
          questionText.toLowerCase().includes("background check") ||
          questionText.toLowerCase().includes("background screening")
        ) {
          selectedValue = "Yes";
          this.appendStatusMessage(`Setting background check consent to: Yes`);
        } else if (
          questionText.toLowerCase().includes("privacy") ||
          questionText.toLowerCase().includes("terms and conditions")
        ) {
          selectedValue = "Yes";
          this.appendStatusMessage(`Setting privacy consent to: Yes`);
        } else if (questionText.toLowerCase().includes("18 years")) {
          selectedValue = "Yes";
          this.appendStatusMessage(`Setting age verification to: Yes`);
        } else if (
          questionText.toLowerCase().includes("criminal") ||
          questionText.toLowerCase().includes("convicted")
        ) {
          selectedValue = "No";
          this.appendStatusMessage(`Setting criminal history to: No`);
        }
        // Check template data if we have more info about this field
        else if (templateData[radioName]) {
          const fieldInfo = templateData[radioName];

          // For generic yes/no questions, default to Yes for positive questions
          // and No for negative questions
          if (
            fieldInfo.type === "multiple-choice" &&
            fieldInfo.options.length === 2 &&
            fieldInfo.options.some((opt) => opt.text === "Yes") &&
            fieldInfo.options.some((opt) => opt.text === "No")
          ) {
            // Check if question contains negative words
            const negativeWords = [
              "not",
              "criminal",
              "felony",
              "misdemeanor",
              "convict",
            ];
            const isNegativeQuestion = negativeWords.some((word) =>
              questionText.toLowerCase().includes(word)
            );

            selectedValue = isNegativeQuestion ? "No" : "Yes";
            this.appendStatusMessage(
              `Setting ${questionText} to: ${selectedValue} (default assumption)`
            );
          }
        }

        // If we couldn't determine a value, default to first option
        if (!selectedValue && radioInputs.length > 0) {
          selectedValue = radioInputs[0].value;
          this.appendStatusMessage(
            `No rule for "${questionText}" - defaulting to first option: ${selectedValue}`
          );
        }

        // Now find and click the radio button with the selected value
        if (selectedValue) {
          let radioClicked = false;

          for (const radio of radioInputs) {
            if (radio.value === selectedValue) {
              // Scroll to the radio
              this.scrollToTargetAdjusted(radio, 100);
              await this.wait(300);

              // Try clicking the label (more reliable in Lever forms)
              const label = radio.closest("label");
              if (label) {
                label.click();
                this.appendStatusMessage(
                  `Clicked label for option: ${selectedValue}`
                );
              } else {
                radio.click();
                this.appendStatusMessage(
                  `Clicked radio button: ${selectedValue}`
                );
              }

              // Wait for potential UI updates
              await this.wait(500);

              // Verify the radio was actually selected
              if (!radio.checked) {
                radio.checked = true;
                radio.dispatchEvent(new Event("change", { bubbles: true }));
                this.appendStatusMessage(`Set radio checked property directly`);
              }

              radioClicked = true;
              break;
            }
          }

          if (!radioClicked) {
            this.appendStatusMessage(
              `Warning: Could not find radio option "${selectedValue}" for question "${questionText}"`
            );
          }
        }
      }
    } catch (error) {
      debugLog("Error handling Lever radio buttons:", error);
      this.appendStatusMessage(
        `Warning: Error processing radio buttons - ${error.message}`
      );
    }
  }

  /**
   * Enhanced method for handling select fields in Lever forms
   */
  async handleLeverSelectFields(form, profile) {
    try {
      this.appendStatusMessage("Processing select fields");

      // Find all select elements
      const selectElements = form.querySelectorAll("select");

      for (const select of selectElements) {
        // Skip hidden selects
        if (select.offsetParent === null || select.style.display === "none")
          continue;

        // Get the question container
        const questionContainer = select.closest(".application-question");
        if (!questionContainer) continue;

        // Get the question text
        const questionEl = questionContainer.querySelector(
          ".application-label .text"
        );
        if (!questionEl) continue;

        // Clean up the question text
        const questionText = questionEl.textContent.replace(/✱$/, "").trim();

        // Determine a value to select based on the question
        let selectedValue = null;

        // Special handling for common dropdown types
        if (
          questionText.toLowerCase().includes("university") ||
          questionText.toLowerCase().includes("school") ||
          questionText.toLowerCase().includes("college") ||
          questionText.toLowerCase().includes("education")
        ) {
          // If profile has education information, use that
          if (profile.education) {
            selectedValue = profile.education;
          } else {
            // Otherwise pick a reasonable default
            selectedValue = "Other - School Not Listed";
          }

          this.appendStatusMessage(
            `Setting university selection to: ${selectedValue}`
          );
        } else if (
          questionText.toLowerCase().includes("gender") ||
          questionText.toLowerCase().includes("sex")
        ) {
          // Default to "Prefer not to say" for gender questions if available
          const preferOptions = Array.from(select.options).filter(
            (opt) =>
              opt.text.toLowerCase().includes("prefer") ||
              opt.text.toLowerCase().includes("decline")
          );

          if (preferOptions.length > 0) {
            selectedValue = preferOptions[0].value;
            this.appendStatusMessage(
              `Setting gender selection to: ${preferOptions[0].text}`
            );
          }
        } else if (
          questionText.toLowerCase().includes("race") ||
          questionText.toLowerCase().includes("ethnicity")
        ) {
          // Default to "Prefer not to say" for race/ethnicity questions if available
          const preferOptions = Array.from(select.options).filter(
            (opt) =>
              opt.text.toLowerCase().includes("prefer") ||
              opt.text.toLowerCase().includes("decline")
          );

          if (preferOptions.length > 0) {
            selectedValue = preferOptions[0].value;
            this.appendStatusMessage(
              `Setting ethnicity selection to: ${preferOptions[0].text}`
            );
          }
        } else if (
          questionText.toLowerCase().includes("salary") ||
          questionText.toLowerCase().includes("compensation")
        ) {
          // For salary expectations, pick a mid-range value if available
          const options = Array.from(select.options);
          if (options.length > 2) {
            // Skip first empty option
            const midIndex = Math.floor(options.length / 2);
            selectedValue = options[midIndex].value;
            this.appendStatusMessage(
              `Setting salary expectation to: ${options[midIndex].text}`
            );
          }
        } else if (
          questionText.toLowerCase().includes("source") ||
          questionText.toLowerCase().includes("hear about") ||
          questionText.toLowerCase().includes("referred")
        ) {
          // For referral source, prefer LinkedIn
          const linkedInOption = Array.from(select.options).find((opt) =>
            opt.text.toLowerCase().includes("linkedin")
          );

          if (linkedInOption) {
            selectedValue = linkedInOption.value;
            this.appendStatusMessage(
              `Setting referral source to: ${linkedInOption.text}`
            );
          } else if (select.options.length > 1) {
            // Pick the second option (first is usually blank)
            selectedValue = select.options[1].value;
            this.appendStatusMessage(
              `Setting referral source to: ${select.options[1].text}`
            );
          }
        }

        // If we've determined a value to use, select it
        if (selectedValue) {
          await this.selectOptionByValueEnhanced(select, selectedValue);
        } else if (select.options.length > 1) {
          // Default to selecting the first non-empty option
          const firstNonEmptyOpt = Array.from(select.options).find(
            (opt) => opt.value && opt.value !== "" && !opt.disabled
          );

          if (firstNonEmptyOpt) {
            await this.selectOptionByValueEnhanced(
              select,
              firstNonEmptyOpt.value
            );
            this.appendStatusMessage(
              `Selected default option for ${questionText}: ${firstNonEmptyOpt.text}`
            );
          }
        }
      }
    } catch (error) {
      debugLog("Error handling Lever select fields:", error);
      this.appendStatusMessage(
        `Warning: Error processing select fields - ${error.message}`
      );
    }
  }

  /**
   * Improved scrollToTargetAdjusted method that checks if element is valid before scrolling
   */
  scrollToTargetAdjusted(element, offset) {
    if (!element) {
      debugLog("Warning: Attempted to scroll to null element");
      return;
    }

    try {
      // Handle case where element might be an array
      if (Array.isArray(element)) {
        debugLog("Element is an array, using first element");
        if (element.length > 0) {
          element = element[0];
        } else {
          debugLog("Empty array provided to scrollToTargetAdjusted");
          return;
        }
      }

      // Check if element has the necessary methods and properties
      if (
        !element.getBoundingClientRect ||
        typeof element.getBoundingClientRect !== "function"
      ) {
        debugLog(`Cannot scroll to element: ${typeof element}, ${element}`);
        return;
      }

      const rect = element.getBoundingClientRect();
      const scrollTop =
        window.pageYOffset || document.documentElement.scrollTop;

      window.scrollTo({
        top: rect.top + scrollTop - offset,
        behavior: "smooth",
      });
    } catch (err) {
      debugLog("Error scrolling to element:", err);
      // Continue execution even if scrolling fails
    }
  }

  /**
   * Improved setAdvancedInputValue with better error handling
   */
  async setAdvancedInputValue(input, value) {
    if (!input || value === undefined || value === null) return;

    try {
      // Handle case where input might be an array
      if (Array.isArray(input)) {
        debugLog("Input is an array, using first element");
        if (input.length > 0) {
          input = input[0];
        } else {
          debugLog("Empty array provided to setAdvancedInputValue");
          return;
        }
      }

      // Verify input is a proper element with value property
      if (!input.value && typeof input.value !== "string") {
        debugLog(`Cannot set value for element: ${typeof input}, ${input}`);
        return;
      }

      // Scroll to the element first (with error handling)
      try {
        this.scrollToTargetAdjusted(input, 100);
      } catch (scrollError) {
        debugLog(
          "Error scrolling, but continuing with value setting:",
          scrollError
        );
      }

      await this.wait(100);

      // Safely attempt to click and focus
      try {
        // Only call methods if they exist
        if (typeof input.click === "function") {
          input.click();
        }

        if (typeof input.focus === "function") {
          input.focus();
        }

        await this.wait(50);
      } catch (focusError) {
        debugLog(
          "Error clicking/focusing input, continuing anyway:",
          focusError
        );
      }

      // Clear any existing value first
      input.value = "";

      try {
        input.dispatchEvent(new Event("input", { bubbles: true }));
      } catch (eventError) {
        debugLog("Error dispatching input event:", eventError);
      }

      // Handle special date inputs
      if (
        input.parentElement?.querySelector('[data-ui="calendar-icon"]') ||
        input.parentElement?.querySelector(".calendar-icon")
      ) {
        try {
          input.click();
          input.dispatchEvent(new Event("keydown", { bubbles: true }));
        } catch (calendarError) {
          debugLog("Error handling date input:", calendarError);
        }
      }

      // Set the value using both direct and native approaches
      input.value = value;

      try {
        this.setNativeValue(input, value);
      } catch (nativeError) {
        debugLog("Error setting native value:", nativeError);
        // Continue anyway since we've already set the value directly
      }

      // Dispatch events
      const events = ["input", "change", "blur"];
      for (const eventName of events) {
        try {
          input.dispatchEvent(new Event(eventName, { bubbles: true }));
          await this.wait(50);
        } catch (eventError) {
          debugLog(`Error dispatching ${eventName} event:`, eventError);
        }
      }

      // Extra check - if value didn't stick
      if (input.value !== value) {
        try {
          if (typeof input.click === "function") {
            input.click();
          }
          await this.wait(50);
          input.value = value;

          // Try again with the native approach
          try {
            this.setNativeValue(input, value);
          } catch (retryError) {
            debugLog("Error in retry of native value setting:", retryError);
          }

          // Dispatch events again
          for (const eventName of events) {
            try {
              input.dispatchEvent(new Event(eventName, { bubbles: true }));
              await this.wait(50);
            } catch (eventError) {
              debugLog(
                `Error dispatching ${eventName} event on retry:`,
                eventError
              );
            }
          }
        } catch (retryError) {
          debugLog("Error in value setting retry:", retryError);
        }
      }
    } catch (error) {
      debugLog(`Error setting value for input:`, error);
      // We don't throw here to allow the form filling to continue with other fields
    }
  }

  /**
   * Improved setNativeValue with better error handling
   */
  setNativeValue(element, value) {
    try {
      // Handle case where element might be an array
      if (Array.isArray(element)) {
        if (element.length > 0) {
          element = element[0];
        } else {
          return;
        }
      }

      // Check if element has value property
      if (typeof element.value === "undefined") {
        return;
      }

      const ownPropertyDescriptor = Object.getOwnPropertyDescriptor(
        element,
        "value"
      );

      if (!ownPropertyDescriptor) {
        element.value = value;
        this.dispatchInputEvent(element);
        return;
      }

      const valueSetter = ownPropertyDescriptor.set;
      const prototype = Object.getPrototypeOf(element);

      // Protection against properties not existing
      if (!prototype) {
        element.value = value;
        this.dispatchInputEvent(element);
        return;
      }

      const prototypePropertyDescriptor = Object.getOwnPropertyDescriptor(
        prototype,
        "value"
      );

      if (!prototypePropertyDescriptor || !prototypePropertyDescriptor.set) {
        element.value = value;
        this.dispatchInputEvent(element);
        return;
      }

      const prototypeValueSetter = prototypePropertyDescriptor.set;

      if (valueSetter && valueSetter !== prototypeValueSetter) {
        prototypeValueSetter.call(element, value);
      } else {
        valueSetter.call(element, value);
      }

      this.dispatchInputEvent(element);
    } catch (error) {
      debugLog("Error in setNativeValue:", error);
      // Fallback to direct setting
      try {
        element.value = value;
      } catch (fallbackError) {
        debugLog("Error in fallback value setting:", fallbackError);
      }
    }
  }

  /**
   * Safe dispatch input event
   */
  dispatchInputEvent(element) {
    try {
      if (element && typeof element.dispatchEvent === "function") {
        element.dispatchEvent(new Event("input", { bubbles: true }));
      }
    } catch (error) {
      debugLog("Error dispatching input event:", error);
    }
  }

  /**
   * Apply to the job
   * This implementation fills out the Lever application form and uploads resume
   * Now extracts job details and sends them to the background script
   */
  async apply(data) {
    this.appendStatusMessage("Starting job application process");
    debugLog("Starting application with data:", data);
    const debugMode = data.debugMode || true;

    // Wait for page to load completely
    await this.wait(3000);

    // Check if we're already on an application page, if not try to navigate to it
    if (!window.location.href.includes("/apply")) {
      // Look for an apply button
      let applyButton = null;

      // Try different selectors for the apply button
      const applySelectors = [
        'a.postings-btn[href*="/apply"]',
        'a[href*="/apply"]',
        'a.button[href*="/apply"]',
        "a.apply-button",
        'a:contains("Apply")',
        'button:contains("Apply")',
        ".apply-button",
        ".btn-apply",
      ];

      for (const selector of applySelectors) {
        try {
          // For :contains selector we need a different approach
          if (selector.includes(":contains")) {
            const text = selector
              .match(/:contains\("(.+?)"\)/)[1]
              .toLowerCase();
            const elements = Array.from(document.querySelectorAll("a, button"));
            applyButton = elements.find(
              (el) =>
                el.textContent.toLowerCase().includes(text) &&
                (el.href?.includes("/apply") || !el.href)
            );
          } else {
            applyButton = document.querySelector(selector);
          }

          if (applyButton) {
            this.appendStatusMessage(
              `Found apply button: ${applyButton.textContent || "Apply"}`
            );
            break;
          }
        } catch (e) {
          debugLog(`Error finding apply button with selector ${selector}:`, e);
        }
      }

      // Click the apply button or navigate to /apply URL
      if (applyButton) {
        this.appendStatusMessage("Clicking apply button");
        applyButton.click();
        await this.wait(5000); // Wait for navigation
      } else {
        // No button found, try to construct and navigate to the apply URL
        const applyUrl = window.location.href.endsWith("/")
          ? window.location.href + "apply"
          : window.location.href + "/apply";

        this.appendStatusMessage(
          `No apply button found, navigating to: ${applyUrl}`
        );
        window.location.href = applyUrl;
        await this.wait(5000); // Wait for navigation
      }
    }

    // Find application form with multiple selectors
    let applicationForm = null;
    const formSelectors = [
      "form.application-form",
      'form[action*="/apply"]',
      'form[data-formtype="application"]',
      "form#application-form",
      "form.lever-apply-form",
      "form.lever-job-apply",
      'form[name="application-form"]',
      "form", // Last resort - any form
    ];

    for (const selector of formSelectors) {
      applicationForm = document.querySelector(selector);
      if (applicationForm) {
        this.appendStatusMessage(
          `Found application form using selector: ${selector}`
        );
        break;
      }
    }

    // If we still don't have a form, try a different approach
    if (!applicationForm) {
      debugLog(
        "No form found with standard selectors, trying alternative detection"
      );

      // Check for any form that contains typical application fields
      const forms = document.querySelectorAll("form");
      for (const form of forms) {
        const hasNameField = form.querySelector(
          'input[name*="name"], input[placeholder*="name"]'
        );
        const hasEmailField = form.querySelector(
          'input[type="email"], input[name*="email"]'
        );

        if (hasNameField && hasEmailField) {
          applicationForm = form;
          this.appendStatusMessage(
            "Found application form through field detection"
          );
          break;
        }
      }

      // If we still have no form, look for application container and then form
      if (!applicationForm) {
        const containers = document.querySelectorAll(
          ".application-container, .application, #application, .lever-application"
        );
        for (const container of containers) {
          const form = container.querySelector("form");
          if (form) {
            applicationForm = form;
            this.appendStatusMessage(
              "Found application form through container detection"
            );
            break;
          }
        }
      }
    }

    if (!applicationForm) {
      // Try one last check - are there any text inputs and a resume upload field?
      const textInputs = document.querySelectorAll(
        'input[type="text"], input[type="email"]'
      );
      const fileInputs = document.querySelectorAll('input[type="file"]');

      if (textInputs.length > 0 && fileInputs.length > 0) {
        // Assume the closest parent that contains both is the "form"
        let commonParent = null;
        for (const input of textInputs) {
          if (commonParent) break;

          let parent = input.parentElement;
          while (parent && parent !== document.body) {
            if (parent.contains(fileInputs[0])) {
              commonParent = parent;
              break;
            }
            parent = parent.parentElement;
          }
        }

        if (commonParent) {
          applicationForm = commonParent;
          this.appendStatusMessage("Using form container as form element");
        }
      }
    }

    // If still no form, we can't continue
    if (!applicationForm) {
      // Let's log what we found for debugging
      debugLog(
        "Page HTML:",
        document.body.innerHTML.substring(0, 1000) + "..."
      );
      throw new SendCvSkipError("Cannot find application form");
    }

    this.appendStatusMessage("Form found, filling out fields");

    // If form found and debug mode enabled, analyze all form fields first
    if (applicationForm && debugMode) {
      this.appendStatusMessage("Debug mode enabled - analyzing form fields");
      this.debugFormFieldsEnhanced(applicationForm, data.profile);
    }

    try {
      // ADDED: First handle specialized Lever field types for radio buttons and selects
      await this.handleLeverRadioButtons(applicationForm, data.profile);
      await this.handleLeverSelectFields(applicationForm, data.profile);

      // Then proceed with standard field filling
      await this.fillApplicationFields(applicationForm, data.profile);

      const resumeUploaded = await this.fileHandler.handleResumeUpload(
        data.profile,
        applicationForm
      );

      if (!resumeUploaded) {
        this.appendStatusMessage("Resume upload failed through all methods");
      }

      // Find and check any required checkboxes (privacy policy, terms, etc.)
      await this.handleRequiredCheckboxes(applicationForm);

      // Find submit button
      const submitButton =
        applicationForm.querySelector(
          'button[type="submit"], input[type="submit"], button.submit-button'
        ) ||
        document.querySelector(
          'button[type="submit"], input[type="submit"], button:contains("Submit"), button:contains("Apply")'
        );

      if (!submitButton) {
        throw new SendCvSkipError("Cannot find submit button");
      }

      // Scroll to button and click it if not in dev mode
      this.scrollToTargetAdjusted(submitButton, 100);
      await this.wait(1000);

      // Check if we should actually submit or just simulate it
      if (data.devMode) {
        this.appendStatusMessage("DEV MODE: Simulating form submission");
        await this.wait(2000);

        // Even in dev mode, send the job details to background for tracking
        this.port.postMessage({
          type: "SEND_CV_TASK_DONE",
          data: {
            jobId: getJobIDFromURL(window.location.href),
            title: "Job on Lever",
            company: "Company on Lever",
            location: "Not specified",
            jobUrl: window.location.href,
            salary: "Not specified",
            workplace: "Not specified",
            postedDate: "Not specified",
            applicants: "Not specified",
          },
        });
      } else {
        this.appendStatusMessage("Submitting application form");
        submitButton.click();

        // Wait for submission to complete
        await this.wait(5000);

        // Check for confirmation message
        const confirmationElement = document.querySelector(
          ".application-success, .confirmation-page, .thank-you-page"
        );
        if (confirmationElement) {
          this.appendStatusMessage("Application successfully submitted!");

          // Send job details to background script for tracking
          this.port.postMessage({
            type: "SEND_CV_TASK_DONE",
            data: {
              jobId: getJobIDFromURL(window.location.href),
              title: "Job on Lever",
              company: "Company on Lever",
              location: "Not specified",
              jobUrl: window.location.href,
              salary: "Not specified",
              workplace: "Not specified",
              postedDate: "Not specified",
              applicants: "Not specified",
            },
          });
        } else {
          // Check for errors
          const errorElements = applicationForm.querySelectorAll(
            ".error-message, .field-error"
          );
          if (errorElements.length > 0) {
            const errors = Array.from(errorElements)
              .filter((el) => el.offsetParent !== null) // Only visible errors
              .map((el) => el.textContent.trim())
              .join(", ");

            if (errors) {
              throw new SendCvError(`Form submission failed: ${errors}`);
            }
          }

          // If no confirmation but also no errors, assume success
          this.appendStatusMessage(
            "Application submitted, but no confirmation detected"
          );

          // Send job details to background script for tracking
          this.port.postMessage({
            type: "SEND_CV_TASK_DONE",
            data: {
              jobId: getJobIDFromURL(window.location.href),
              title: "Job on Lever",
              company: "Company on Lever",
              location: "Not specified",
              jobUrl: window.location.href,
              salary: "Not specified",
              workplace: "Not specified",
              postedDate: "Not specified",
              applicants: "Not specified",
            },
          });
        }
      }

      // Success!
      return true;
    } catch (error) {
      if (error instanceof SendCvSkipError) {
        throw error;
      }

      throw new SendCvError(`Error applying to job: ${error.message}`, error);
    }
  }

  /**
   * Handle the Lever location autocomplete field with slower, more reliable typing
   * @param {HTMLElement} locationInput - The location input element
   * @param {string} locationValue - The location value to set
   */
  async handleLocationAutocomplete(locationInput, locationValue) {
    try {
      if (!locationInput || !locationValue) return false;

      this.appendStatusMessage(`Setting location field to: ${locationValue}`);

      // Scroll to the element and focus it
      this.scrollToTargetAdjusted(locationInput, 100);
      await this.wait(500); // Longer initial wait

      // Focus and click the input
      locationInput.click();
      await this.wait(300);
      locationInput.focus();
      await this.wait(300);

      // Clear any existing value
      locationInput.value = "";
      locationInput.dispatchEvent(new Event("input", { bubbles: true }));
      await this.wait(400); // Longer wait after clearing

      // Type the location value character by character with slower, more deliberate timing
      let currentText = "";
      for (let i = 0; i < locationValue.length; i++) {
        // Add the next character
        currentText += locationValue[i];
        locationInput.value = currentText;

        // Dispatch proper events to ensure the autocomplete is triggered
        locationInput.dispatchEvent(new Event("input", { bubbles: true }));

        // Verify the value was set correctly
        if (locationInput.value !== currentText) {
          // Try again if the character wasn't added properly
          locationInput.value = currentText;
          locationInput.dispatchEvent(new Event("input", { bubbles: true }));
        }

        // Slower typing speed - adjust this value as needed (200-300ms is more human-like)
        await this.wait(250);

        // Every few characters, give extra time for the API to catch up
        if (i % 3 === 2) {
          await this.wait(400);
        }
      }

      // After typing is complete, wait longer for dropdown to appear
      await this.wait(500);

      // Try to find the dropdown container
      const dropdownContainer = locationInput.parentElement.querySelector(
        ".dropdown-container"
      );
      if (!dropdownContainer || dropdownContainer.style.display === "none") {
        // Try triggering again if dropdown didn't appear
        this.appendStatusMessage(
          "Dropdown not visible yet, triggering input event again"
        );
        locationInput.dispatchEvent(new Event("input", { bubbles: true }));
        await this.wait(1200);
      }

      // Look for results in the dropdown
      const resultsContainer = document.querySelector(".dropdown-results");
      if (resultsContainer) {
        // Wait for results to load (check if loading spinner is gone)
        let attempt = 0;
        const maxAttempts = 15; // More attempts
        while (attempt < maxAttempts) {
          const loadingSpinner = document.querySelector(
            ".dropdown-loading-results"
          );
          if (loadingSpinner && loadingSpinner.style.display !== "none") {
            this.appendStatusMessage("Waiting for location results to load...");
            await this.wait(500); // Longer wait between loading checks
            attempt++;
          } else {
            break;
          }
        }

        // Find all location options
        const locationOptions =
          resultsContainer.querySelectorAll(".dropdown-item");
        this.appendStatusMessage(
          `Found ${locationOptions.length} location suggestions`
        );

        if (locationOptions.length > 0) {
          // Wait a moment before selecting
          await this.wait(500);

          // Click the first option
          this.appendStatusMessage(
            `Selecting location: ${locationOptions[0].textContent.trim()}`
          );
          locationOptions[0].click();

          // Wait for selection to be processed
          await this.wait(800);
          return true;
        } else {
          // No results found, try typing less specific location
          if (locationValue.includes(",")) {
            // Try with just the city part
            const cityOnly = locationValue.split(",")[0].trim();
            this.appendStatusMessage(
              `No results found. Trying with city only: ${cityOnly}`
            );
            return await this.handleLocationAutocomplete(
              locationInput,
              cityOnly
            );
          }
        }
      }

      // If dropdown selection fails, at least set the text value
      locationInput.value = locationValue;
      locationInput.dispatchEvent(new Event("change", { bubbles: true }));
      locationInput.dispatchEvent(new Event("blur", { bubbles: true }));

      // Try to manually set the hidden field value
      const hiddenField = locationInput.parentElement.querySelector(
        'input[type="hidden"]'
      );
      if (hiddenField) {
        hiddenField.value = JSON.stringify({ name: locationValue });
        hiddenField.dispatchEvent(new Event("change", { bubbles: true }));
      }

      return true;
    } catch (error) {
      this.appendStatusMessage(`Error setting location: ${error.message}`);
      return false;
    }
  }
}

// Initialize the automation
debugLog("Creating LeverJobAutomation instance");
const leverAutomation = new LeverJobAutomation();

// Send a final notification that the script is fully loaded
debugLog("Lever content script fully loaded");
