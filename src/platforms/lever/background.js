// import { HOST } from "@shared/constants";

// console.log("Background Script Initialized");

// /**
//  * LeverJobApplyManager - Background script for managing Lever job applications
//  * Complete robust implementation with all event handlers and error recovery
//  */
// const LeverJobApplyManager = {
//   // Tab and window tracking
//   windowId: null,

//   // Connections map to manage long-lived connections to content scripts
//   connections: {
//     search: null, // Connection to search tab
//     apply: null, // Connection to apply tab
//   },

//   // Active connections by tab ID for quick lookup
//   tabConnections: {},

//   // Status tracking
//   status: {
//     lastActivity: Date.now(),
//     healthCheckInterval: null,
//   },

//   // Store data
//   store: {
//     tasks: {
//       search: {
//         tabId: null,
//         limit: null,
//         domain: null,
//         current: 0,
//         searchLinkPattern: null,
//       },
//       sendCv: {
//         url: null,
//         tabId: null,
//         active: false,
//         finalUrl: null,
//         startTime: null,
//       },
//     },
//     devMode: false,
//     profile: null,
//     session: null,
//     started: false,
//     submittedLinks: [],
//     platformsFlow: [],
//   },

//   /**
//    * Initialize the manager
//    */
//   async init() {
//     console.log("Lever Job Application Manager initialized");

//     // Set up connection listener for long-lived connections
//     chrome.runtime.onConnect.addListener(this.handleConnect.bind(this));

//     // Set up standard message listener for one-off messages
//     chrome.runtime.onMessage.addListener(this.handleMessage.bind(this));

//     // Set up tab removal listener to clean up connections
//     chrome.tabs.onRemoved.addListener(this.handleTabRemoved.bind(this));

//     // Start health check interval
//     this.startHealthCheck();
//   },

//   /**
//    * Start health check interval to detect and recover from stuck states
//    */
//   startHealthCheck() {
//     // Clear any existing interval
//     if (this.status.healthCheckInterval) {
//       clearInterval(this.status.healthCheckInterval);
//     }

//     // Set up new interval
//     this.status.healthCheckInterval = setInterval(() => this.checkHealth(), 60000); // Check every minute
//   },

//   /**
//    * Check the health of the automation system and recover from stuck states
//    */
//   async checkHealth() {
//     const now = Date.now();
//     const inactivityTime = now - this.status.lastActivity;

//     // If we have an active send CV task that's been active for over 5 minutes, it might be stuck
//     if (this.store.tasks.sendCv.active && this.store.tasks.sendCv.startTime) {
//       const taskTime = now - this.store.tasks.sendCv.startTime;

//       // If task has been active for over 5 minutes, it's probably stuck
//       if (taskTime > 5 * 60 * 1000) {
//         console.warn("CV task appears to be stuck for over 5 minutes, attempting recovery");

//         try {
//           // Force close the tab if it exists
//           if (this.store.tasks.sendCv.tabId) {
//             await chrome.tabs.remove(this.store.tasks.sendCv.tabId);
//           }

//           // Mark URL as error
//           const url = this.store.tasks.sendCv.url;
//           if (url) {
//             this.store.submittedLinks.push({
//               url,
//               status: "ERROR",
//               error: "Task timed out after 5 minutes",
//               timestamp: now,
//             });
//           }

//           // Reset task state
//           const oldUrl = this.store.tasks.sendCv.url;
//           this.store.tasks.sendCv = {
//             url: null,
//             tabId: null,
//             active: false,
//             finalUrl: null,
//             startTime: null,
//           };

//           // Notify search tab to continue
//           this.sendSearchNextMessage({
//             url: oldUrl,
//             status: "ERROR",
//             message: "Task timed out after 5 minutes"
//           });

//           console.log("Recovery completed for stuck CV task");
//         } catch (error) {
//           console.error("Error during CV task recovery:", error);
//         }
//       }
//     }

//     // If no activity for 10 minutes but we're supposed to be running, check search tab
//     if (inactivityTime > 10 * 60 * 1000 && this.store.started) {
//       console.warn("No activity for 10 minutes, checking search tab");

//       try {
//         // Check if search tab still exists
//         if (this.store.tasks.search.tabId) {
//           try {
//             const tab = await chrome.tabs.get(this.store.tasks.search.tabId);
//             if (tab) {
//               // Tab exists, try to refresh it
//               await chrome.tabs.reload(this.store.tasks.search.tabId);
//               console.log("Refreshed search tab after inactivity");
//             }
//           } catch (tabError) {
//             // Tab doesn't exist, create a new one
//             console.warn("Search tab no longer exists, creating a new one");
//             this.recreateSearchTab();
//           }
//         } else {
//           // No search tab ID, create a new one
//           this.recreateSearchTab();
//         }
//       } catch (error) {
//         console.error("Error during inactivity recovery:", error);
//       }
//     }

//     // Update last activity time
//     this.status.lastActivity = now;
//   },

//   /**
//    * Recreate search tab if it's missing
//    */
//   async recreateSearchTab() {
//     if (!this.store.started || !this.store.session) return;

//     try {
//       // Build search query
//       let searchQuery = `site:lever.co ${this.store.session.role}`;
//       if (this.store.session.country) {
//         searchQuery += ` ${this.store.session.country}`;
//       }
//       if (this.store.session.city) {
//         searchQuery += ` ${this.store.session.city}`;
//       }
//       if (this.store.session.workplace === "REMOTE") {
//         searchQuery += " Remote";
//       } else if (this.store.session.workplace === "ON_SITE") {
//         searchQuery += " On-site";
//       } else if (this.store.session.workplace === "HYBRID") {
//         searchQuery += " Hybrid";
//       }

//       // Check if window exists
//       if (this.windowId) {
//         try {
//           await chrome.windows.get(this.windowId);
//           // Create tab in existing window
//           const tab = await chrome.tabs.create({
//             url: `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`,
//             windowId: this.windowId,
//           });
//           this.store.tasks.search.tabId = tab.id;
//           console.log("Created new search tab in existing window:", tab.id);
//         } catch (windowError) {
//           // Window doesn't exist, create new one
//           const window = await chrome.windows.create({
//             url: `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`,
//             state: "maximized",
//           });
//           this.windowId = window.id;
//           this.store.tasks.search.tabId = window.tabs[0].id;
//           console.log("Created new window and search tab:", window.tabs[0].id);
//         }
//       } else {
//         // No window, create new one
//         const window = await chrome.windows.create({
//           url: `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`,
//           state: "maximized",
//         });
//         this.windowId = window.id;
//         this.store.tasks.search.tabId = window.tabs[0].id;
//         console.log("Created new window and search tab:", window.tabs[0].id);
//       }
//     } catch (error) {
//       console.error("Error recreating search tab:", error);
//     }
//   },

//   /**
//    * Handle connection request from content scripts
//    */
//   handleConnect(port) {
//     console.log("New connection established:", port.name);
//     this.status.lastActivity = Date.now();

//     // Store connection based on type
//     if (port.name.startsWith("lever-search-")) {
//       // Extract tab ID from port name
//       const tabId = parseInt(port.name.split("-")[2]);

//       this.connections.search = port;
//       this.tabConnections[tabId] = port;

//       // If we're already in a started state, update the search tab ID
//       if (this.store.started && !this.store.tasks.search.tabId) {
//         this.store.tasks.search.tabId = tabId;
//         console.log("Updated search tab ID to:", tabId);
//       }
//     } else if (port.name.startsWith("lever-apply-")) {
//       // Extract tab ID from port name
//       const tabId = parseInt(port.name.split("-")[2]);

//       this.connections.apply = port;
//       this.tabConnections[tabId] = port;

//       // If we have a pending CV task, associate it with this tab
//       if (this.store.tasks.sendCv.active && !this.store.tasks.sendCv.tabId) {
//         this.store.tasks.sendCv.tabId = tabId;
//         console.log("Updated sendCv tab ID to:", tabId);
//       }
//     }

//     // Set up message handler for this port
//     port.onMessage.addListener((message, senderPort) => {
//       console.log("Port message received:", message);
//       this.status.lastActivity = Date.now();
//       this.handlePortMessage(message, senderPort);
//     });

//     // Handle disconnection
//     port.onDisconnect.addListener((disconnectedPort) => {
//       console.log("Port disconnected:", disconnectedPort.name);

//       // Clean up connection references
//       if (disconnectedPort === this.connections.search) {
//         this.connections.search = null;
//       } else if (disconnectedPort === this.connections.apply) {
//         this.connections.apply = null;
//       }

//       // Remove from tab connections
//       Object.keys(this.tabConnections).forEach((tabId) => {
//         if (this.tabConnections[tabId] === disconnectedPort) {
//           delete this.tabConnections[tabId];
//         }
//       });
//     });
//   },

//   /**
//    * Handle messages received through long-lived connections
//    */
//   handlePortMessage(message, port) {
//     try {
//       const type = message.type || message.action;

//       switch (type) {
//         case "GET_SEARCH_TASK":
//           this.handleGetSearchTask(port);
//           break;

//         case "GET_SEND_CV_TASK":
//           this.handleGetSendCvTask(port);
//           break;

//         case "SEND_CV_TASK":
//           this.handleSendCvTask(message.data, port);
//           break;

//         case "SEND_CV_TASK_DONE":
//           this.handleSendCvTaskDone(message.data, port);
//           break;

//         case "SEND_CV_TASK_ERROR":
//           this.handleSendCvTaskError(message.data, port);
//           break;

//         case "SEND_CV_TASK_SKIP":
//           this.handleSendCvTaskSkip(message.data, port);
//           break;

//         case "SEARCH_TASK_DONE":
//           this.handleSearchTaskDone();
//           break;

//         case "SEARCH_TASK_ERROR":
//           this.handleSearchTaskError(message.data);
//           break;

//         case "KEEPALIVE":
//           // Just update the last activity time
//           this.status.lastActivity = Date.now();
//           break;

//         case "SEND_CV_TAB_NOT_RESPOND":
//           this.handleSendCvTabNotRespond();
//           break;

//         default:
//           console.log("Unhandled port message type:", type);
//           this.trySendResponse(port, {
//             type: "ERROR",
//             message: "Unknown message type: " + type,
//           });
//       }
//     } catch (error) {
//       console.error("Error handling port message:", error);
//       this.trySendResponse(port, {
//         type: "ERROR",
//         message: error.message,
//       });
//     }
//   },

//   /**
//    * Safely try to send a response on a port
//    */
//   trySendResponse(port, message) {
//     try {
//       // Check if port is still connected
//       if (port && port.sender) {
//         port.postMessage(message);
//       }
//     } catch (error) {
//       console.warn("Failed to send response:", error);
//     }
//   },

//   /**
//    * Handle one-off messages (not using long-lived connections)
//    */
//   async handleMessage(request, sender, sendResponse) {
//     try {
//       console.log("One-off message received:", request);
//       this.status.lastActivity = Date.now();

//       const type = request.action || request.type;

//       switch (type) {
//         case "startApplying":
//           await this.startJobSearch(request, sendResponse);
//           break;

//         case "checkTabState":
//           sendResponse({
//             type: "SUCCESS",
//             data: {
//               started: this.store.started,
//               searchTabId: this.store.tasks.search.tabId,
//               applyTabId: this.store.tasks.sendCv.tabId,
//             },
//           });
//           break;

//         case "getState":
//           sendResponse({
//             type: "SUCCESS",
//             data: {
//               store: this.store,
//             },
//           });
//           break;

//         case "resetState":
//           // Reset the state and clean up
//           this.resetState();
//           sendResponse({
//             type: "SUCCESS",
//             message: "State has been reset",
//           });
//           break;

//         default:
//           console.log("Unhandled one-off message type:", type);
//           sendResponse({
//             type: "ERROR",
//             message: "Unknown message type: " + type,
//           });
//       }
//     } catch (error) {
//       console.error("Error in handleMessage:", error);
//       sendResponse({
//         type: "ERROR",
//         message: error.message,
//       });
//     }
//     return true; // Keep the message channel open for async response
//   },

//   /**
//    * Reset the state of the automation
//    */
//   async resetState() {
//     try {
//       // Close tab if it exists
//       if (this.store.tasks.sendCv.tabId) {
//         try {
//           await chrome.tabs.remove(this.store.tasks.sendCv.tabId);
//         } catch (e) {
//           console.warn("Error closing CV tab:", e);
//         }
//       }

//       // Restore default state
//       this.store.tasks.sendCv = {
//         url: null,
//         tabId: null,
//         active: false,
//         finalUrl: null,
//         startTime: null,
//       };

//       console.log("State has been reset");
//     } catch (error) {
//       console.error("Error resetting state:", error);
//     }
//   },

//   /**
//    * Handle tab removal to clean up connections
//    */
//   handleTabRemoved(tabId, removeInfo) {
//     console.log("Tab removed:", tabId);
//     this.status.lastActivity = Date.now();

//     // Clean up connections
//     if (this.tabConnections[tabId]) {
//       delete this.tabConnections[tabId];
//     }

//     // Update state if needed
//     if (this.store.tasks.search.tabId === tabId) {
//       this.store.tasks.search.tabId = null;
//     }

//     if (this.store.tasks.sendCv.tabId === tabId) {
//       // If this was the CV tab and task is still active, handle as error
//       if (this.store.tasks.sendCv.active) {
//         const url = this.store.tasks.sendCv.url;

//         // Mark as error in submitted links
//         if (url) {
//           this.store.submittedLinks.push({
//             url,
//             status: "ERROR",
//             error: "Tab was closed before completion",
//             timestamp: Date.now(),
//           });
//         }

//         // Reset task state
//         const oldUrl = url;
//         this.store.tasks.sendCv = {
//           url: null,
//           tabId: null,
//           active: false,
//           finalUrl: null,
//           startTime: null,
//         };

//         // Notify search tab to continue
//         if (oldUrl) {
//           this.sendSearchNextMessage({
//             url: oldUrl,
//             status: "ERROR",
//             message: "Tab was closed before completion",
//           });
//         }
//       } else {
//         // Just clear the state
//         this.store.tasks.sendCv.tabId = null;
//         this.store.tasks.sendCv.active = false;
//       }
//     }
//   },

//   /**
//    * Handler for GET_SEARCH_TASK messages
//    */
//   handleGetSearchTask(port) {
//     // Always respond with the current data, regardless of what tab it's from
//     // This avoids the "message port closed" issue
//     this.trySendResponse(port, {
//       type: "SUCCESS",
//       data: {
//         ...this.store.tasks.search,
//         submittedLinks: this.store.submittedLinks,
//       },
//     });

//     // Extract tab ID from port name
//     const portNameParts = port.name.split("-");
//     if (portNameParts.length >= 3) {
//       const tabId = parseInt(portNameParts[2]);

//       // If this is a Google search tab and we're in started state, update the tab ID
//       if (this.store.started && this.store.tasks.search.tabId !== tabId) {
//         this.store.tasks.search.tabId = tabId;
//         console.log("Updated search tab ID to:", tabId);
//       }
//     }
//   },

//   /**
//    * Handler for GET_SEND_CV_TASK messages
//    */
//   handleGetSendCvTask(port) {
//     // Always respond with the data needed for applications
//     this.trySendResponse(port, {
//       type: "SUCCESS",
//       data: {
//         devMode: this.store.devMode,
//         profile: this.store.profile,
//         session: this.store.session,
//         avatarUrl: this.store.avatarUrl,
//       },
//     });

//     // Extract tab ID from port name
//     const portNameParts = port.name.split("-");
//     if (portNameParts.length >= 3) {
//       const tabId = parseInt(portNameParts[2]);

//       // If we have an active CV task but no tab ID, update it
//       if (this.store.tasks.sendCv.active && !this.store.tasks.sendCv.tabId) {
//         this.store.tasks.sendCv.tabId = tabId;
//         console.log("Updated sendCv tab ID to:", tabId);
//       }
//     }
//   },

//   /**
//    * Start the job search process
//    */
//   async startJobSearch(request, sendResponse) {
//     try {
//       console.log("Starting Lever job search:", request);

//       // CRITICAL FIX: Check if already started to prevent duplicate windows
//       if (this.store.started) {
//         console.log("Job search already started, skipping duplicate start");
//         sendResponse({
//           status: "already_started",
//           platform: "lever",
//           message: "Lever job search already in progress",
//         });
//         return;
//       }

//       // Save data to store
//       this.store.profile = request.profile;
//       this.store.session = request.session;
//       this.store.avatarUrl = request.avatarUrl;
//       this.store.devMode = request.devMode || false;
//       this.store.submittedLinks = request.submittedLinks || [];

//       console.log(request.session);
//       // Build search query for Google
//       let searchQuery = `site:lever.co ${request.session.role}`;
//       if (request.session.country) {
//         searchQuery += ` ${request.session.country}`;
//       }
//       if (request.session.city) {
//         searchQuery += ` ${request.session.city}`;
//       }
//       if (request.session.workplace === "REMOTE") {
//         searchQuery += " Remote";
//       } else if (request.session.workplace === "ON_SITE") {
//         searchQuery += " On-site";
//       } else if (request.session.workplace === "HYBRID") {
//         searchQuery += " Hybrid";
//       }

//       // CRITICAL FIX: Check if window already exists
//       if (this.windowId) {
//         try {
//           const existingWindow = await chrome.windows.get(this.windowId);
//           if (existingWindow) {
//             console.log(
//               "Window already exists, focusing it instead of creating new one"
//             );
//             await chrome.windows.update(this.windowId, { focused: true });

//             // Just update the search tab with the new query
//             if (this.store.tasks.search.tabId) {
//               await chrome.tabs.update(this.store.tasks.search.tabId, {
//                 url: `https://www.google.com/search?q=${encodeURIComponent(
//                   searchQuery
//                 )}`,
//               });

//               sendResponse({
//                 status: "updated",
//                 platform: "lever",
//                 message: "Lever job search updated with new query",
//               });
//               return;
//             }
//           }
//         } catch (err) {
//           // Window doesn't exist anymore, that's ok, we'll create a new one
//           console.log("Previous window no longer exists, creating new one");
//           this.windowId = null;
//         }
//       }

//       // Create window with Google search
//       const window = await chrome.windows.create({
//         url: `https://www.google.com/search?q=${encodeURIComponent(
//           searchQuery
//         )}`,
//         state: "maximized",
//       });

//       this.windowId = window.id;
//       this.store.tasks.search.tabId = window.tabs[0].id;
//       this.store.tasks.search.limit = request.session.liftsLimit || 100;
//       this.store.tasks.search.current = request.session.liftsCurrent || 0;
//       this.store.tasks.search.domain = ["https://jobs.lever.co"];

//       // Regular expression pattern for Lever jobs
//       this.store.tasks.search.searchLinkPattern =
//         /^https:\/\/jobs\.(eu\.)?lever\.co\/([^\/]*)\/([^\/]*)\/?(.*)?$/.toString();

//       this.store.started = true;

//       sendResponse({
//         status: "started",
//         platform: "lever",
//         message: "Lever job search process initiated",
//       });
//     } catch (error) {
//       console.error("Error starting Lever job search:", error);
//       sendResponse({
//         status: "error",
//         platform: "lever",
//         message: "Failed to start Lever job search: " + error.message,
//       });
//     }
//   },

//   /**
//    * Handler for SEND_CV_TASK messages
//    */
//   async handleSendCvTask(data, port) {
//     try {
//       // CRITICAL FIX: Check if we already have an active send CV task
//       if (this.store.tasks.sendCv.active) {
//         console.log("Already have an active CV task, ignoring new request");
//         this.trySendResponse(port, {
//           type: "ERROR",
//           message: "Already processing another job application",
//         });
//         return;
//       }

//       // Check if this URL is already in submitted links to prevent duplicates
//       if (
//         this.store.submittedLinks.some(
//           (link) =>
//             link.url === data.url ||
//             data.url.includes(link.url) ||
//             (link.url && link.url.includes(data.url))
//         )
//       ) {
//         console.log("URL already processed:", data.url);
//         this.trySendResponse(port, {
//           type: "DUPLICATE",
//           message: "This job has already been processed",
//           data: { url: data.url },
//         });
//         return;
//       }

//       const applyUrl = data.url.endsWith("/apply")
//         ? data.url
//         : data.url + "/apply";

//       // Mark this URL as being processed to prevent duplicates
//       this.store.submittedLinks.push({
//         url: data.url,
//         status: "PROCESSING",
//         timestamp: Date.now(),
//       });

//       const tab = await chrome.tabs.create({
//         url: applyUrl,
//         windowId: this.windowId,
//       });

//       this.store.tasks.sendCv.url = data.url;
//       this.store.tasks.sendCv.tabId = tab.id;
//       this.store.tasks.sendCv.active = true;
//       this.store.tasks.sendCv.finalUrl = applyUrl;
//       this.store.tasks.sendCv.startTime = Date.now();

//       this.trySendResponse(port, {
//         type: "SUCCESS",
//         message: "Apply tab created",
//       });
//     } catch (error) {
//       console.error("Error in handleSendCvTask:", error);
//       this.trySendResponse(port, {
//         type: "ERROR",
//         message: error.message,
//       });
//     }
//   },

//   /**
//    * Handler for SEND_CV_TASK_DONE messages
//    */
//   async handleSendCvTaskDone(applicationData, port) {
//     try {
//       // Add to submitted links with success status
//       this.store.submittedLinks.push({
//         url: this.store.tasks.sendCv.url,
//         details: applicationData || null,
//         status: "SUCCESS",
//         timestamp: Date.now(),
//       });

//       const userId = this.store.session?.userId;
//       console.log(userId)

//       // Make API calls but don't let errors stop the process
//       try {
//         if (userId) {
//           await fetch(`${HOST}/api/applications`, {
//             method: "POST",
//             headers: {
//               "Content-Type": "application/json",
//             },
//             body: JSON.stringify({
//               userId,
//             }),
//           });
//         }

//         if (applicationData) {
//           applicationData.userId = userId;
//           await fetch(`${HOST}/api/applied-jobs`, {
//             method: "POST",
//             body: JSON.stringify(applicationData),
//           });
//         }
//       } catch (apiError) {
//         console.error("API error:", apiError);
//         // Continue anyway - API errors shouldn't break the automation
//       }

//       // Try to close the tab but don't let errors stop the process
//       try {
//         if (this.store.tasks.sendCv.tabId) {
//           await chrome.tabs.remove(this.store.tasks.sendCv.tabId);
//         }
//       } catch (tabError) {
//         console.error("Tab removal error:", tabError);
//         // Continue anyway - tab errors shouldn't break the automation
//       }

//       // Try to send success response but don't let errors stop the process
//       try {
//         this.trySendResponse(port, {
//           type: "SUCCESS",
//           message: "Application completed",
//         });
//       } catch (portError) {
//         console.warn("Port error when responding:", portError);
//         // Continue anyway - port errors shouldn't break the automation
//       }

//       // Save old task data before resetting
//       const oldSendCvTask = { ...this.store.tasks.sendCv };

//       // Reset task state
//       this.store.tasks.sendCv = {
//         url: null,
//         tabId: null,
//         active: false,
//         finalUrl: null,
//         startTime: null,
//       };

//       // Increment application counter
//       this.store.tasks.search.current = (this.store.tasks.search.current || 0) + 1;

//       // Log for debugging
//       console.log(`Completed application ${this.store.tasks.search.current} of ${this.store.tasks.search.limit}`);

//       const currentLifts = this.store.tasks.search.current;
//       const maxLifts = this.store.tasks.search.limit || 100;

//       // Check if we've reached the limit
//       if (currentLifts >= maxLifts) {
//         await this.finishSuccess("lifts-out");
//       } else {
//         // Notify search tab to continue to next job using our safer method
//         this.sendSearchNextMessage({
//           url: oldSendCvTask.url,
//           status: "SUCCESS",
//         });
//       }
//     } catch (error) {
//       console.error("Error in handleSendCvTaskDone:", error);

//       // Even on error, try to notify search tab to continue
//       try {
//         const url = this.store.tasks.sendCv.url;

//         // Reset task state
//         this.store.tasks.sendCv = {
//           url: null,
//           tabId: null,
//           active: false,
//           finalUrl: null,
//           startTime: null,
//         };

//         // Notify search tab
//         this.sendSearchNextMessage({
//           url,
//           status: "ERROR",
//           message: error.message,
//         });
//       } catch (notifyError) {
//         console.error("Failed to notify search tab:", notifyError);
//       }
//     }
//   },

//   /**
//    * Safely send SEARCH_NEXT message using all available methods
//    */
//   sendSearchNextMessage(data) {
//     console.log("Sending SEARCH_NEXT message:", data);
//     let sent = false;

//     // Try using the search connection if available
//     if (this.connections.search) {
//       try {
//         this.connections.search.postMessage({
//           type: "SEARCH_NEXT",
//           data,
//         });
//         sent = true;
//         console.log("Sent SEARCH_NEXT via search connection");
//       } catch (searchError) {
//         console.warn("Error sending via search connection:", searchError);
//       }
//     }

//     // If that failed, try using tabs API
//     if (!sent && this.store.tasks.search.tabId) {
//       try {
//         chrome.tabs.sendMessage(this.store.tasks.search.tabId, {
//           type: "SEARCH_NEXT",
//           data,
//         });
//         sent = true;
//         console.log("Sent SEARCH_NEXT via tabs API");
//       } catch (tabError) {
//         console.warn("Error sending via tabs API:", tabError);
//       }
//     }

//     // If still not sent, log warning
//     if (!sent) {
//       console.warn("Failed to send SEARCH_NEXT message. Will rely on timeout recovery.");
//     }

//     return sent;
//   },

//   /**
//    * Handler for SEND_CV_TASK_ERROR messages
//    */
//   async handleSendCvTaskError(errorData, port) {
//     try {
//       console.log("CV task error:", errorData);

//       // Add to submitted links with error status
//       this.store.submittedLinks.push({
//         url: this.store.tasks.sendCv.url,
//         error: errorData,
//         status: "ERROR",
//         timestamp: Date.now(),
//       });

//       // Try to close the tab
//       try {
//         if (this.store.tasks.sendCv.tabId) {
//           await chrome.tabs.remove(this.store.tasks.sendCv.tabId);
//         }
//       } catch (tabError) {
//         console.warn("Error closing tab:", tabError);
//       }

//       // Send response to port
//       this.trySendResponse(port, {
//         type: "SUCCESS",
//         message: "Error acknowledged",
//       });

//       // Save URL before resetting
//       const oldUrl = this.store.tasks.sendCv.url;

//       // Reset task state
//       this.store.tasks.sendCv = {
//         url: null,
//         tabId: null,
//         active: false,
//         finalUrl: null,
//         startTime: null,
//       };

//       // Notify search tab to continue
//       this.sendSearchNextMessage({
//         url: oldUrl,
//         status: "ERROR",
//         message: typeof errorData === "string" ? errorData : "Application error",
//       });
//     } catch (error) {
//       console.error("Error handling CV task error:", error);
//     }
//   },

//   /**
//    * Handler for SEND_CV_TASK_SKIP messages
//    */
//   async handleSendCvTaskSkip(skipReason, port) {
//     try {
//       console.log("CV task skipped:", skipReason);

//       // Add to submitted links with skipped status
//       this.store.submittedLinks.push({
//         url: this.store.tasks.sendCv.url,
//         reason: skipReason,
//         status: "SKIPPED",
//         timestamp: Date.now(),
//       });

//       // Try to close the tab
//       try {
//         if (this.store.tasks.sendCv.tabId) {
//           await chrome.tabs.remove(this.store.tasks.sendCv.tabId);
//         }
//       } catch (tabError) {
//         console.warn("Error closing tab:", tabError);
//       }

//       // Send response to port
//       this.trySendResponse(port, {
//         type: "SUCCESS",
//         message: "Skip acknowledged",
//       });

//       // Save URL before resetting
//       const oldUrl = this.store.tasks.sendCv.url;

//       // Reset task state
//       this.store.tasks.sendCv = {
//         url: null,
//         tabId: null,
//         active: false,
//         finalUrl: null,
//         startTime: null,
//       };

//       // Notify search tab to continue
//       this.sendSearchNextMessage({
//         url: oldUrl,
//         status: "SKIPPED",
//         message: skipReason,
//       });
//     } catch (error) {
//       console.error("Error handling CV task skip:", error);
//     }
//   },

//   /**
//    * Handler for SEARCH_TASK_DONE messages
//    */
//   async handleSearchTaskDone() {
//     try {
//       console.log("Search task completed");

//       // Show completion notification
//       try {
//         chrome.notifications.create({
//           type: "basic",
//           iconUrl: "icon.png", // Update with your extension's icon
//           title: "Lever Job Search Completed",
//           message: `Successfully processed ${this.store.tasks.search.current} job listings.`,
//         });
//       } catch (notificationError) {
//         console.warn("Error showing notification:", notificationError);
//       }

//       // Reset state for next run
//       this.store.started = false;

//       // Keep the window open but mark as completed
//       console.log("Job search automation completed successfully");
//     } catch (error) {
//       console.error("Error in handleSearchTaskDone:", error);
//     }
//   },

//   /**
//    * Handler for SEARCH_TASK_ERROR messages
//    */
//   async handleSearchTaskError(errorData) {
//     try {
//       console.error("Search task error:", errorData);

//       // Show error notification
//       try {
//         chrome.notifications.create({
//           type: "basic",
//           iconUrl: "icon.png", // Update with your extension's icon
//           title: "Lever Job Search Error",
//           message: typeof errorData === "string"
//             ? errorData
//             : "An error occurred during job search.",
//         });
//       } catch (notificationError) {
//         console.warn("Error showing notification:", notificationError);
//       }

//       // Try to reload the search tab
//       try {
//         if (this.store.tasks.search.tabId) {
//           await chrome.tabs.reload(this.store.tasks.search.tabId);
//         }
//       } catch (reloadError) {
//         console.warn("Error reloading search tab:", reloadError);
//       }
//     } catch (error) {
//       console.error("Error handling search task error:", error);
//     }
//   },

//   /**
//    * Handler for when CV tab is not responding
//    */
//   async handleSendCvTabNotRespond() {
//     try {
//       console.warn("CV tab not responding");

//       // Add to submitted links with timeout error
//       this.store.submittedLinks.push({
//         url: this.store.tasks.sendCv.url,
//         error: "Tab not responding timeout",
//         status: "ERROR",
//         timestamp: Date.now(),
//       });

//       // Try to close the tab
//       try {
//         if (this.store.tasks.sendCv.tabId) {
//           await chrome.tabs.remove(this.store.tasks.sendCv.tabId);
//         }
//       } catch (tabError) {
//         console.warn("Error closing tab:", tabError);
//       }

//       // Save URL before resetting
//       const oldUrl = this.store.tasks.sendCv.url;

//       // Reset task state
//       this.store.tasks.sendCv = {
//         url: null,
//         tabId: null,
//         active: false,
//         finalUrl: null,
//         startTime: null,
//       };

//       // Notify search tab to continue
//       this.sendSearchNextMessage({
//         url: oldUrl,
//         status: "ERROR",
//         message: "Tab not responding timeout",
//       });
//     } catch (error) {
//       console.error("Error handling CV tab not respond:", error);
//     }
//   },

//   /**
//    * Handler for successful completion of the automation
//    */
//   async finishSuccess(reason) {
//     try {
//       console.log("Automation completed successfully:", reason);

//       // Show completion notification
//       try {
//         chrome.notifications.create({
//           type: "basic",
//           iconUrl: "icon.png", // Update with your extension's icon
//           title: "Lever Job Search Completed",
//           message: `Successfully completed ${this.store.tasks.search.current} applications.`,
//         });
//       } catch (notificationError) {
//         console.warn("Error showing notification:", notificationError);
//       }

//       // Reset state
//       this.store.started = false;

//       // Keep window open but mark as completed
//       console.log("All tasks completed successfully");
//     } catch (error) {
//       console.error("Error in finishSuccess:", error);
//     }
//   }
// };

// // Initialize the manager
// LeverJobApplyManager.init();

// export { LeverJobApplyManager };

import { HOST } from "@shared/constants";
import { checkIfJobApplied } from "@shared/applicationCheck";
import {
  checkLeverUserLimits,
  canUserApplyMore,
} from "@shared/leverAuthorization";

//@shared/applicationCheck
console.log("Background Script Initialized");

/**
 * LeverJobApplyManager - Background script for managing Lever job applications
 * Complete robust implementation with all event handlers and error recovery
 */
const LeverJobApplyManager = {
  // Tab and window tracking
  windowId: null,
  processingJobRequest: false,
  processingJobUrl: null,

  // Connections map to manage long-lived connections to content scripts
  connections: {
    search: null, // Connection to search tab
    apply: null, // Connection to apply tab
  },

  // Active connections by tab ID for quick lookup
  tabConnections: {},

  // Status tracking
  status: {
    lastActivity: Date.now(),
    healthCheckInterval: null,
  },

  // Store data
  store: {
    tasks: {
      search: {
        tabId: null,
        limit: null,
        domain: null,
        current: 0,
        searchLinkPattern: null,
      },
      sendCv: {
        url: null,
        tabId: null,
        active: false,
        finalUrl: null,
        startTime: null,
      },
    },
    devMode: false,
    profile: null,
    session: null,
    started: false,
    submittedLinks: [],
    platformsFlow: [],
  },

  /**
   * Initialize the manager
   */
  async init() {
    console.log("Lever Job Application Manager initialized");

    // Set up connection listener for long-lived connections
    chrome.runtime.onConnect.addListener(this.handleConnect.bind(this));

    // Set up standard message listener for one-off messages
    chrome.runtime.onMessage.addListener(this.handleMessage.bind(this));

    // Set up tab removal listener to clean up connections
    chrome.tabs.onRemoved.addListener(this.handleTabRemoved.bind(this));

    // Start health check interval
    this.startHealthCheck();
  },

  /**
   * Start health check interval to detect and recover from stuck states
   */
  startHealthCheck() {
    // Clear any existing interval
    if (this.status.healthCheckInterval) {
      clearInterval(this.status.healthCheckInterval);
    }

    // Set up new interval
    this.status.healthCheckInterval = setInterval(
      () => this.checkHealth(),
      60000
    ); // Check every minute
  },

  /**
   * Check the health of the automation system and recover from stuck states
   */
  async checkHealth() {
    const now = Date.now();
    const inactivityTime = now - this.status.lastActivity;

    // If we have an active send CV task that's been active for over 5 minutes, it might be stuck
    if (this.store.tasks.sendCv.active && this.store.tasks.sendCv.startTime) {
      const taskTime = now - this.store.tasks.sendCv.startTime;

      // If task has been active for over 5 minutes, it's probably stuck
      if (taskTime > 5 * 60 * 1000) {
        console.warn(
          "CV task appears to be stuck for over 5 minutes, attempting recovery"
        );

        try {
          // Force close the tab if it exists
          if (this.store.tasks.sendCv.tabId) {
            await chrome.tabs.remove(this.store.tasks.sendCv.tabId);
          }

          // Mark URL as error
          const url = this.store.tasks.sendCv.url;
          if (url) {
            this.store.submittedLinks.push({
              url,
              status: "ERROR",
              error: "Task timed out after 5 minutes",
              timestamp: now,
            });
          }

          // Reset task state
          const oldUrl = this.store.tasks.sendCv.url;
          this.store.tasks.sendCv = {
            url: null,
            tabId: null,
            active: false,
            finalUrl: null,
            startTime: null,
          };

          // Notify search tab to continue
          this.sendSearchNextMessage({
            url: oldUrl,
            status: "ERROR",
            message: "Task timed out after 5 minutes",
          });

          console.log("Recovery completed for stuck CV task");
        } catch (error) {
          console.error("Error during CV task recovery:", error);
        }
      }
    }

    // If no activity for 10 minutes but we're supposed to be running, check search tab
    if (inactivityTime > 10 * 60 * 1000 && this.store.started) {
      console.warn("No activity for 10 minutes, checking search tab");

      try {
        // Check if search tab still exists
        if (this.store.tasks.search.tabId) {
          try {
            const tab = await chrome.tabs.get(this.store.tasks.search.tabId);
            if (tab) {
              // Tab exists, try to refresh it
              await chrome.tabs.reload(this.store.tasks.search.tabId);
              console.log("Refreshed search tab after inactivity");
            }
          } catch (tabError) {
            // Tab doesn't exist, create a new one
            console.warn("Search tab no longer exists, creating a new one");
            this.recreateSearchTab();
          }
        } else {
          // No search tab ID, create a new one
          this.recreateSearchTab();
        }
      } catch (error) {
        console.error("Error during inactivity recovery:", error);
      }
    }

    // Update last activity time
    this.status.lastActivity = now;
  },

  /**
   * Recreate search tab if it's missing
   */
  async recreateSearchTab() {
    if (!this.store.started || !this.store.session) return;

    try {
      // Build search query
      let searchQuery = `site:lever.co ${this.store.session.role}`;
      if (this.store.session.country) {
        searchQuery += ` ${this.store.session.country}`;
      }
      if (this.store.session.city) {
        searchQuery += ` ${this.store.session.city}`;
      }
      if (this.store.session.workplace === "REMOTE") {
        searchQuery += " Remote";
      } else if (this.store.session.workplace === "ON_SITE") {
        searchQuery += " On-site";
      } else if (this.store.session.workplace === "HYBRID") {
        searchQuery += " Hybrid";
      }

      // Check if window exists
      if (this.windowId) {
        try {
          await chrome.windows.get(this.windowId);
          // Create tab in existing window
          const tab = await chrome.tabs.create({
            url: `https://www.google.com/search?q=${encodeURIComponent(
              searchQuery
            )}`,
            windowId: this.windowId,
          });
          this.store.tasks.search.tabId = tab.id;
          console.log("Created new search tab in existing window:", tab.id);
        } catch (windowError) {
          // Window doesn't exist, create new one
          const window = await chrome.windows.create({
            url: `https://www.google.com/search?q=${encodeURIComponent(
              searchQuery
            )}`,
            state: "maximized",
          });
          this.windowId = window.id;
          this.store.tasks.search.tabId = window.tabs[0].id;
          console.log("Created new window and search tab:", window.tabs[0].id);
        }
      } else {
        // No window, create new one
        const window = await chrome.windows.create({
          url: `https://www.google.com/search?q=${encodeURIComponent(
            searchQuery
          )}`,
          state: "maximized",
        });
        this.windowId = window.id;
        this.store.tasks.search.tabId = window.tabs[0].id;
        console.log("Created new window and search tab:", window.tabs[0].id);
      }
    } catch (error) {
      console.error("Error recreating search tab:", error);
    }
  },

  /**
   * Handle connection request from content scripts
   */
  handleConnect(port) {
    console.log("New connection established:", port.name);
    this.status.lastActivity = Date.now();

    // Store connection based on type
    if (port.name.startsWith("lever-search-")) {
      // Extract tab ID from port name
      const tabId = parseInt(port.name.split("-")[2]);

      this.connections.search = port;
      this.tabConnections[tabId] = port;

      // If we're already in a started state, update the search tab ID
      if (this.store.started && !this.store.tasks.search.tabId) {
        this.store.tasks.search.tabId = tabId;
        console.log("Updated search tab ID to:", tabId);
      }
    } else if (port.name.startsWith("lever-apply-")) {
      // Extract tab ID from port name
      const tabId = parseInt(port.name.split("-")[2]);

      this.connections.apply = port;
      this.tabConnections[tabId] = port;

      // If we have a pending CV task, associate it with this tab
      if (this.store.tasks.sendCv.active && !this.store.tasks.sendCv.tabId) {
        this.store.tasks.sendCv.tabId = tabId;
        console.log("Updated sendCv tab ID to:", tabId);
      }
    }

    // Set up message handler for this port
    port.onMessage.addListener((message, senderPort) => {
      console.log("Port message received:", message);
      this.status.lastActivity = Date.now();
      this.handlePortMessage(message, senderPort);
    });

    // Handle disconnection
    port.onDisconnect.addListener((disconnectedPort) => {
      console.log("Port disconnected:", disconnectedPort.name);

      // Clean up connection references
      if (disconnectedPort === this.connections.search) {
        this.connections.search = null;
      } else if (disconnectedPort === this.connections.apply) {
        this.connections.apply = null;
      }

      // Remove from tab connections
      Object.keys(this.tabConnections).forEach((tabId) => {
        if (this.tabConnections[tabId] === disconnectedPort) {
          delete this.tabConnections[tabId];
        }
      });
    });
  },

  /**
   * Handle messages received through long-lived connections
   */
  handlePortMessage(message, port) {
    try {
      const type = message.type || message.action;

      switch (type) {
        case "GET_SEARCH_TASK":
          this.handleGetSearchTask(port);
          break;

        case "GET_SEND_CV_TASK":
          this.handleGetSendCvTask(port);
          break;

        case "SEND_CV_TASK":
          this.handleSendCvTask(message.data, port);
          break;

        case "SEND_CV_TASK_DONE":
          this.handleSendCvTaskDone(message.data, port);
          break;

        case "SEND_CV_TASK_ERROR":
          this.handleSendCvTaskError(message.data, port);
          break;

        case "SEND_CV_TASK_SKIP":
          this.handleSendCvTaskSkip(message.data, port);
          break;

        case "SEARCH_TASK_DONE":
          this.handleSearchTaskDone();
          break;

        case "SEARCH_TASK_ERROR":
          this.handleSearchTaskError(message.data);
          break;

        case "KEEPALIVE":
          // Just update the last activity time
          this.status.lastActivity = Date.now();
          break;

        case "SEND_CV_TAB_NOT_RESPOND":
          this.handleSendCvTabNotRespond();
          break;

        default:
          console.log("Unhandled port message type:", type);
          this.trySendResponse(port, {
            type: "ERROR",
            message: "Unknown message type: " + type,
          });
      }
    } catch (error) {
      console.error("Error handling port message:", error);
      this.trySendResponse(port, {
        type: "ERROR",
        message: error.message,
      });
    }
  },

  /**
   * Safely try to send a response on a port
   */
  trySendResponse(port, message) {
    try {
      // Check if port is still connected
      if (port && port.sender) {
        port.postMessage(message);
      }
    } catch (error) {
      console.warn("Failed to send response:", error);
    }
  },

  /**
   * Handle one-off messages (not using long-lived connections)
   */
  async handleMessage(request, sender, sendResponse) {
    try {
      console.log("One-off message received:", request);
      this.status.lastActivity = Date.now();

      const type = request.action || request.type;

      switch (type) {
        case "startApplying":
          await this.startJobSearch(request, sendResponse);
          break;

        case "checkTabState":
          sendResponse({
            type: "SUCCESS",
            data: {
              started: this.store.started,
              searchTabId: this.store.tasks.search.tabId,
              applyTabId: this.store.tasks.sendCv.tabId,
            },
          });
          break;

        case "getState":
          sendResponse({
            type: "SUCCESS",
            data: {
              store: this.store,
            },
          });
          break;

        case "resetState":
          // Reset the state and clean up
          this.resetState();
          sendResponse({
            type: "SUCCESS",
            message: "State has been reset",
          });
          break;

        default:
          console.log("Unhandled one-off message type:", type);
          sendResponse({
            type: "ERROR",
            message: "Unknown message type: " + type,
          });
      }
    } catch (error) {
      console.error("Error in handleMessage:", error);
      sendResponse({
        type: "ERROR",
        message: error.message,
      });
    }
    return true; // Keep the message channel open for async response
  },

  /**
   * Reset the state of the automation
   */
  async resetState() {
    try {
      // Close tab if it exists
      if (this.store.tasks.sendCv.tabId) {
        try {
          await chrome.tabs.remove(this.store.tasks.sendCv.tabId);
        } catch (e) {
          console.warn("Error closing CV tab:", e);
        }
      }

      // Restore default state
      this.store.tasks.sendCv = {
        url: null,
        tabId: null,
        active: false,
        finalUrl: null,
        startTime: null,
      };

      console.log("State has been reset");
    } catch (error) {
      console.error("Error resetting state:", error);
    }
  },

  /**
   * Handle tab removal to clean up connections
   */
  handleTabRemoved(tabId, removeInfo) {
    console.log("Tab removed:", tabId);
    this.status.lastActivity = Date.now();

    // Clean up connections
    if (this.tabConnections[tabId]) {
      delete this.tabConnections[tabId];
    }

    // Update state if needed
    if (this.store.tasks.search.tabId === tabId) {
      this.store.tasks.search.tabId = null;
    }

    if (this.store.tasks.sendCv.tabId === tabId) {
      // If this was the CV tab and task is still active, handle as error
      if (this.store.tasks.sendCv.active) {
        const url = this.store.tasks.sendCv.url;

        // Mark as error in submitted links
        if (url) {
          this.store.submittedLinks.push({
            url,
            status: "ERROR",
            error: "Tab was closed before completion",
            timestamp: Date.now(),
          });
        }

        // Reset task state
        const oldUrl = url;
        this.store.tasks.sendCv = {
          url: null,
          tabId: null,
          active: false,
          finalUrl: null,
          startTime: null,
        };

        // Notify search tab to continue
        if (oldUrl) {
          this.sendSearchNextMessage({
            url: oldUrl,
            status: "ERROR",
            message: "Tab was closed before completion",
          });
        }
      } else {
        // Just clear the state
        this.store.tasks.sendCv.tabId = null;
        this.store.tasks.sendCv.active = false;
      }
    }
  },

  /**
   * Handler for GET_SEARCH_TASK messages
   */
  handleGetSearchTask(port) {
    // Always respond with the current data, regardless of what tab it's from
    // This avoids the "message port closed" issue
    this.trySendResponse(port, {
      type: "SUCCESS",
      data: {
        ...this.store.tasks.search,
        submittedLinks: this.store.submittedLinks,
      },
    });

    // Extract tab ID from port name
    const portNameParts = port.name.split("-");
    if (portNameParts.length >= 3) {
      const tabId = parseInt(portNameParts[2]);

      // If this is a Google search tab and we're in started state, update the tab ID
      if (this.store.started && this.store.tasks.search.tabId !== tabId) {
        this.store.tasks.search.tabId = tabId;
        console.log("Updated search tab ID to:", tabId);
      }
    }
  },

  /**
   * Handler for GET_SEND_CV_TASK messages
   */
  handleGetSendCvTask(port) {
    // Always respond with the data needed for applications
    this.trySendResponse(port, {
      type: "SUCCESS",
      data: {
        devMode: this.store.devMode,
        profile: this.store.profile,
        session: this.store.session,
        avatarUrl: this.store.avatarUrl,
      },
    });

    // Extract tab ID from port name
    const portNameParts = port.name.split("-");
    if (portNameParts.length >= 3) {
      const tabId = parseInt(portNameParts[2]);

      // If we have an active CV task but no tab ID, update it
      if (this.store.tasks.sendCv.active && !this.store.tasks.sendCv.tabId) {
        this.store.tasks.sendCv.tabId = tabId;
        console.log("Updated sendCv tab ID to:", tabId);
      }
    }
  },

  /**
   * Start the job search process
   */
  async startJobSearch(request, sendResponse) {
    try {
      console.log("Starting Lever job search:", request);

      // CRITICAL FIX: Check if already started to prevent duplicate windows
      if (this.store.started) {
        console.log("Job search already started, skipping duplicate start");
        sendResponse({
          status: "already_started",
          platform: "lever",
          message: "Lever job search already in progress",
        });
        return;
      }

      // Save data to store
      this.store.profile = request.profile;
      this.store.session = request.session;
      this.store.avatarUrl = request.avatarUrl;
      this.store.devMode = request.devMode || false;
      this.store.submittedLinks = request.submittedLinks || [];

      console.log(request.session);
      // Build search query for Google
      let searchQuery = `site:lever.co ${request.session.role}`;
      if (request.session.country) {
        searchQuery += ` ${request.session.country}`;
      }
      if (request.session.city) {
        searchQuery += ` ${request.session.city}`;
      }
      if (request.session.workplace === "REMOTE") {
        searchQuery += " Remote";
      } else if (request.session.workplace === "ON_SITE") {
        searchQuery += " On-site";
      } else if (request.session.workplace === "HYBRID") {
        searchQuery += " Hybrid";
      }

      // CRITICAL FIX: Check if window already exists
      if (this.windowId) {
        try {
          const existingWindow = await chrome.windows.get(this.windowId);
          if (existingWindow) {
            console.log(
              "Window already exists, focusing it instead of creating new one"
            );
            await chrome.windows.update(this.windowId, { focused: true });

            // Just update the search tab with the new query
            if (this.store.tasks.search.tabId) {
              await chrome.tabs.update(this.store.tasks.search.tabId, {
                url: `https://www.google.com/search?q=${encodeURIComponent(
                  searchQuery
                )}`,
              });

              sendResponse({
                status: "updated",
                platform: "lever",
                message: "Lever job search updated with new query",
              });
              return;
            }
          }
        } catch (err) {
          // Window doesn't exist anymore, that's ok, we'll create a new one
          console.log("Previous window no longer exists, creating new one");
          this.windowId = null;
        }
      }

      // Create window with Google search
      const window = await chrome.windows.create({
        url: `https://www.google.com/search?q=${encodeURIComponent(
          searchQuery
        )}`,
        state: "maximized",
      });

      this.windowId = window.id;
      this.store.tasks.search.tabId = window.tabs[0].id;
      this.store.tasks.search.limit = request.session.liftsLimit || 100;
      this.store.tasks.search.current = request.session.liftsCurrent || 0;
      this.store.tasks.search.domain = ["https://jobs.lever.co"];

      // Regular expression pattern for Lever jobs
      this.store.tasks.search.searchLinkPattern =
        /^https:\/\/jobs\.(eu\.)?lever\.co\/([^\/]*)\/([^\/]*)\/?(.*)?$/.toString();

      this.store.started = true;

      sendResponse({
        status: "started",
        platform: "lever",
        message: "Lever job search process initiated",
      });
    } catch (error) {
      console.error("Error starting Lever job search:", error);
      sendResponse({
        status: "error",
        platform: "lever",
        message: "Failed to start Lever job search: " + error.message,
      });
    }
  },

  /**
   * Handler for SEND_CV_TASK messages with added job application checks
   */
  /**
   * Handler for SEND_CV_TASK messages with added job application checks
   */
  async handleSendCvTask(data, port) {
    try {
      // Check if we're currently processing any job request
      if (this.processingJobRequest) {
        console.log(
          `Already processing job request for URL: ${this.processingJobUrl}`
        );

        // If it's the same URL, this is a duplicate request
        if (this.processingJobUrl === data.url) {
          console.log("Ignoring duplicate job request for same URL");
          this.trySendResponse(port, {
            type: "DUPLICATE",
            message: "This job request is already being processed",
            data: { url: data.url },
          });
          return;
        }

        // If it's a different URL, reject it
        console.log("Another job request is in progress, ignoring new request");
        this.trySendResponse(port, {
          type: "ERROR",
          message: "Please wait for the current job request to complete",
        });
        return;
      }

      // Set processing lock and URL
      this.processingJobRequest = true;
      this.processingJobUrl = data.url;

      // CRITICAL FIX: Check if we already have an active send CV task
      if (this.store.tasks.sendCv.active) {
        this.processingJobRequest = false; // Release lock
        console.log("Already have an active CV task, ignoring new request");
        this.trySendResponse(port, {
          type: "ERROR",
          message: "Already processing another job application",
        });
        return;
      }

      // Check if this URL is already in submitted links to prevent duplicates
      if (
        this.store.submittedLinks.some(
          (link) =>
            link.url === data.url ||
            data.url.includes(link.url) ||
            (link.url && link.url.includes(data.url))
        )
      ) {
        this.processingJobRequest = false; // Release lock
        console.log("URL already processed:", data.url);
        this.trySendResponse(port, {
          type: "DUPLICATE",
          message: "This job has already been processed",
          data: { url: data.url },
        });
        return;
      }

      // NEW: Check if job has already been applied for via API and if user has limits
      const userId = this.store.session?.userId;
      if (userId) {
        try {
          // Check if job has already been applied for
          const jobAlreadyApplied = await checkIfJobApplied(
            userId,
            data.url,
            "lever"
          );
          if (jobAlreadyApplied) {
            this.processingJobRequest = false; // Release lock
            console.log("Job already applied for via API check:", data.url);
            this.trySendResponse(port, {
              type: "DUPLICATE",
              message: "You have already applied for this job",
              data: { url: data.url },
            });
            return;
          }

          // Update our store with the latest user data
          const userData = await checkLeverUserLimits(userId, this.store);

          // Check if user has reached their application limit
          if (!canUserApplyMore(userData)) {
            this.processingJobRequest = false; // Release lock
            console.log(
              "User cannot apply to more jobs (limit reached):",
              userId
            );
            this.trySendResponse(port, {
              type: "LIMIT_REACHED",
              message:
                "You have reached your application limit. Please upgrade your plan or wait for your limit to reset.",
              data: { url: data.url },
            });
            return;
          }

          // Log remaining applications
          const remainingApps = this.store.user?.remainingApplications || 0;
          console.log(
            `User has ${
              remainingApps === Infinity ? "unlimited" : remainingApps
            } applications remaining`
          );
        } catch (checkError) {
          console.error("Error during pre-application checks:", checkError);
          // Continue with the application process even if the checks fail
          // This prevents the user from being blocked if our API is down
        }
      }

      const applyUrl = data.url.endsWith("/apply")
        ? data.url
        : data.url + "/apply";

      // Mark this URL as being processed to prevent duplicates
      this.store.submittedLinks.push({
        url: data.url,
        status: "PROCESSING",
        timestamp: Date.now(),
      });

      const tab = await chrome.tabs.create({
        url: applyUrl,
        windowId: this.windowId,
      });

      this.store.tasks.sendCv.url = data.url;
      this.store.tasks.sendCv.tabId = tab.id;
      this.store.tasks.sendCv.active = true;
      this.store.tasks.sendCv.finalUrl = applyUrl;
      this.store.tasks.sendCv.startTime = Date.now();

      // Job is now actively processing in a tab, we can release the request lock
      this.processingJobRequest = false;

      this.trySendResponse(port, {
        type: "SUCCESS",
        message: "Apply tab created",
      });
    } catch (error) {
      // Release lock on error
      this.processingJobRequest = false;
      console.error("Error in handleSendCvTask:", error);
      this.trySendResponse(port, {
        type: "ERROR",
        message: error.message,
      });
    }
  },

  /**
   * Handler for SEND_CV_TASK_DONE messages
   */
  async handleSendCvTaskDone(applicationData, port) {
    try {
      this.processingJobRequest = false;
      // Add to submitted links with success status
      this.store.submittedLinks.push({
        url: this.store.tasks.sendCv.url,
        details: applicationData || null,
        status: "SUCCESS",
        timestamp: Date.now(),
      });

      const userId = this.store.session?.userId;
      console.log(userId);

      // Make API calls but don't let errors stop the process
      try {
        if (userId) {
          await fetch(`${HOST}/api/applications`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              userId,
            }),
          });
        }

        if (applicationData) {
          applicationData.userId = userId;
          await fetch(`${HOST}/api/applied-jobs`, {
            method: "POST",
            body: JSON.stringify(applicationData),
          });
        }
      } catch (apiError) {
        console.error("API error:", apiError);
        // Continue anyway - API errors shouldn't break the automation
      }

      // Try to close the tab but don't let errors stop the process
      try {
        if (this.store.tasks.sendCv.tabId) {
          await chrome.tabs.remove(this.store.tasks.sendCv.tabId);
        }
      } catch (tabError) {
        console.error("Tab removal error:", tabError);
        // Continue anyway - tab errors shouldn't break the automation
      }

      // Try to send success response but don't let errors stop the process
      try {
        this.trySendResponse(port, {
          type: "SUCCESS",
          message: "Application completed",
        });
      } catch (portError) {
        console.warn("Port error when responding:", portError);
        // Continue anyway - port errors shouldn't break the automation
      }

      // Save old task data before resetting
      const oldSendCvTask = { ...this.store.tasks.sendCv };

      // Reset task state
      this.store.tasks.sendCv = {
        url: null,
        tabId: null,
        active: false,
        finalUrl: null,
        startTime: null,
      };

      // Increment application counter
      this.store.tasks.search.current =
        (this.store.tasks.search.current || 0) + 1;

      // Log for debugging
      console.log(
        `Completed application ${this.store.tasks.search.current} of ${this.store.tasks.search.limit}`
      );

      const currentLifts = this.store.tasks.search.current;
      const maxLifts = this.store.tasks.search.limit || 100;

      // Check if we've reached the limit
      if (currentLifts >= maxLifts) {
        await this.finishSuccess("lifts-out");
      } else {
        // Notify search tab to continue to next job using our safer method
        this.sendSearchNextMessage({
          url: oldSendCvTask.url,
          status: "SUCCESS",
        });
      }
    } catch (error) {
      console.error("Error in handleSendCvTaskDone:", error);

      // Even on error, try to notify search tab to continue
      try {
        const url = this.store.tasks.sendCv.url;

        // Reset task state
        this.store.tasks.sendCv = {
          url: null,
          tabId: null,
          active: false,
          finalUrl: null,
          startTime: null,
        };

        // Notify search tab
        this.sendSearchNextMessage({
          url,
          status: "ERROR",
          message: error.message,
        });
      } catch (notifyError) {
        console.error("Failed to notify search tab:", notifyError);
      }
    }
  },

  /**
   * Safely send SEARCH_NEXT message using all available methods
   */
  sendSearchNextMessage(data) {
    console.log("Sending SEARCH_NEXT message:", data);
    let sent = false;

    // Try using the search connection if available
    if (this.connections.search) {
      try {
        this.connections.search.postMessage({
          type: "SEARCH_NEXT",
          data,
        });
        sent = true;
        console.log("Sent SEARCH_NEXT via search connection");
      } catch (searchError) {
        console.warn("Error sending via search connection:", searchError);
      }
    }

    // If that failed, try using tabs API
    if (!sent && this.store.tasks.search.tabId) {
      try {
        chrome.tabs.sendMessage(this.store.tasks.search.tabId, {
          type: "SEARCH_NEXT",
          data,
        });
        sent = true;
        console.log("Sent SEARCH_NEXT via tabs API");
      } catch (tabError) {
        console.warn("Error sending via tabs API:", tabError);
      }
    }

    // If still not sent, log warning
    if (!sent) {
      console.warn(
        "Failed to send SEARCH_NEXT message. Will rely on timeout recovery."
      );
    }

    return sent;
  },

  /**
   * Handler for SEND_CV_TASK_ERROR messages
   */
  async handleSendCvTaskError(errorData, port) {
    try {
      this.processingJobRequest = false;
      console.log("CV task error:", errorData);

      // Add to submitted links with error status
      this.store.submittedLinks.push({
        url: this.store.tasks.sendCv.url,
        error: errorData,
        status: "ERROR",
        timestamp: Date.now(),
      });

      // Try to close the tab
      try {
        if (this.store.tasks.sendCv.tabId) {
          await chrome.tabs.remove(this.store.tasks.sendCv.tabId);
        }
      } catch (tabError) {
        console.warn("Error closing tab:", tabError);
      }

      // Send response to port
      this.trySendResponse(port, {
        type: "SUCCESS",
        message: "Error acknowledged",
      });

      // Save URL before resetting
      const oldUrl = this.store.tasks.sendCv.url;

      // Reset task state
      this.store.tasks.sendCv = {
        url: null,
        tabId: null,
        active: false,
        finalUrl: null,
        startTime: null,
      };

      // Notify search tab to continue
      this.sendSearchNextMessage({
        url: oldUrl,
        status: "ERROR",
        message:
          typeof errorData === "string" ? errorData : "Application error",
      });
    } catch (error) {
      console.error("Error handling CV task error:", error);
    }
  },

  /**
   * Handler for SEND_CV_TASK_SKIP messages
   */
  async handleSendCvTaskSkip(skipReason, port) {
    try {
      this.processingJobRequest = false;
      console.log("CV task skipped:", skipReason);

      // Add to submitted links with skipped status
      this.store.submittedLinks.push({
        url: this.store.tasks.sendCv.url,
        reason: skipReason,
        status: "SKIPPED",
        timestamp: Date.now(),
      });

      // Try to close the tab
      try {
        if (this.store.tasks.sendCv.tabId) {
          await chrome.tabs.remove(this.store.tasks.sendCv.tabId);
        }
      } catch (tabError) {
        console.warn("Error closing tab:", tabError);
      }

      // Send response to port
      this.trySendResponse(port, {
        type: "SUCCESS",
        message: "Skip acknowledged",
      });

      // Save URL before resetting
      const oldUrl = this.store.tasks.sendCv.url;

      // Reset task state
      this.store.tasks.sendCv = {
        url: null,
        tabId: null,
        active: false,
        finalUrl: null,
        startTime: null,
      };

      // Notify search tab to continue
      this.sendSearchNextMessage({
        url: oldUrl,
        status: "SKIPPED",
        message: skipReason,
      });
    } catch (error) {
      console.error("Error handling CV task skip:", error);
    }
  },

  /**
   * Handler for SEARCH_TASK_DONE messages
   */
  async handleSearchTaskDone() {
    try {
      console.log("Search task completed");

      // Show completion notification
      try {
        chrome.notifications.create({
          type: "basic",
          iconUrl: "icon.png", // Update with your extension's icon
          title: "Lever Job Search Completed",
          message: `Successfully processed ${this.store.tasks.search.current} job listings.`,
        });
      } catch (notificationError) {
        console.warn("Error showing notification:", notificationError);
      }

      // Reset state for next run
      this.store.started = false;

      // Keep the window open but mark as completed
      console.log("Job search automation completed successfully");
    } catch (error) {
      console.error("Error in handleSearchTaskDone:", error);
    }
  },

  /**
   * Handler for SEARCH_TASK_ERROR messages
   */
  async handleSearchTaskError(errorData) {
    try {
      console.error("Search task error:", errorData);

      // Show error notification
      try {
        chrome.notifications.create({
          type: "basic",
          iconUrl: "icon.png", // Update with your extension's icon
          title: "Lever Job Search Error",
          message:
            typeof errorData === "string"
              ? errorData
              : "An error occurred during job search.",
        });
      } catch (notificationError) {
        console.warn("Error showing notification:", notificationError);
      }

      // Try to reload the search tab
      try {
        if (this.store.tasks.search.tabId) {
          await chrome.tabs.reload(this.store.tasks.search.tabId);
        }
      } catch (reloadError) {
        console.warn("Error reloading search tab:", reloadError);
      }
    } catch (error) {
      console.error("Error handling search task error:", error);
    }
  },

  /**
   * Handler for when CV tab is not responding
   */
  async handleSendCvTabNotRespond() {
    try {
      console.warn("CV tab not responding");

      // Add to submitted links with timeout error
      this.store.submittedLinks.push({
        url: this.store.tasks.sendCv.url,
        error: "Tab not responding timeout",
        status: "ERROR",
        timestamp: Date.now(),
      });

      // Try to close the tab
      try {
        if (this.store.tasks.sendCv.tabId) {
          await chrome.tabs.remove(this.store.tasks.sendCv.tabId);
        }
      } catch (tabError) {
        console.warn("Error closing tab:", tabError);
      }

      // Save URL before resetting
      const oldUrl = this.store.tasks.sendCv.url;

      // Reset task state
      this.store.tasks.sendCv = {
        url: null,
        tabId: null,
        active: false,
        finalUrl: null,
        startTime: null,
      };

      // Notify search tab to continue
      this.sendSearchNextMessage({
        url: oldUrl,
        status: "ERROR",
        message: "Tab not responding timeout",
      });
    } catch (error) {
      console.error("Error handling CV tab not respond:", error);
    }
  },

  /**
   * Handler for successful completion of the automation
   */
  async finishSuccess(reason) {
    try {
      console.log("Automation completed successfully:", reason);

      // Show completion notification
      try {
        chrome.notifications.create({
          type: "basic",
          iconUrl: "icon.png", // Update with your extension's icon
          title: "Lever Job Search Completed",
          message: `Successfully completed ${this.store.tasks.search.current} applications.`,
        });
      } catch (notificationError) {
        console.warn("Error showing notification:", notificationError);
      }

      // Reset state
      this.store.started = false;

      // Keep window open but mark as completed
      console.log("All tasks completed successfully");
    } catch (error) {
      console.error("Error in finishSuccess:", error);
    }
  },
};

// Initialize the manager
LeverJobApplyManager.init();

export { LeverJobApplyManager };
