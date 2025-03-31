// Background script for Workable job application automation
import { STATE } from "@shared/constants";

// Configuration constants
const SERVER_PATH = "/api/v1/extension/send-cv/session";
const STORAGE_KEY = "WORKABLE_STORE";
const GET_VACANCY_FIELDS_VALUES_TIMEOUT = 300000;

// Default request headers
const DEFAULT_FETCH_HEADERS = {
  Accept: "application/json",
  "Content-Type": "application/json",
};

// Default state for search task
const SEARCH_TASK_DEFAULT = {
  tabId: null,
  limit: null,
  domain: null,
  current: null,
  searchLinkPattern: null,
};

// Default state for send CV task
const SEND_CV_TASK_DEFAULT = {
  url: null,
  tabId: null,
  active: false,
  finalUrl: null,
};

// Global store for application state
const STORE = {
  currentState: STATE.IDLE,
  tasks: {
    search: {
      ...SEARCH_TASK_DEFAULT,
    },
    sendCv: {
      ...SEND_CV_TASK_DEFAULT,
    },
  },
  userId: null,
  targetTabId: null,
  windowId: null,
  profile: null,
  session: null,
  started: false,
  serverBaseUrl: "",
  submittedLinks: [],
  applyTabOpened: null,
  searchTabTimestamp: null,
  applyTabTimestamp: null,
  windowTimestamp: null,
  failedSubmissions: 0,
  successfulSubmissions: 0,
  finished: false,
  lastError: null,
  debugLogs: [],
};

// Utility function to log debug information
function logDebug(message, data = {}) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    message,
    data,
  };

  console.log(`[DEBUG] ${message}`, data);
  STORE.debugLogs.push(logEntry);

  // Keep only last 100 logs
  if (STORE.debugLogs.length > 100) {
    STORE.debugLogs.shift();
  }

  saveStoreToStorage();
}

// Load store from storage
async function loadStoreFromStorage() {
  try {
    const result = await chrome.storage.local.get([STORAGE_KEY]);
    if (result[STORAGE_KEY]) {
      Object.assign(STORE, result[STORAGE_KEY]);
      logDebug("Store loaded from storage", { store: { ...STORE } });
    } else {
      logDebug("No store found in storage");
    }
    return STORE;
  } catch (error) {
    logDebug("Error loading store from storage", {
      error: errorToString(error),
    });
    sendErrorToServer(
      "Error loading store from storage:",
      errorToString(error)
    );
    return STORE;
  }
}

// Save store to storage
async function saveStoreToStorage() {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: STORE });
    return true;
  } catch (error) {
    console.error("Error saving store to storage:", error);
    sendErrorToServer("Error saving store to storage:", errorToString(error));
    return false;
  }
}

// Convert errors to string for logging
function errorToString(e) {
  if (e instanceof Error) {
    if (e.stack) {
      return e.stack;
    }
    let obj = {};
    Error.captureStackTrace(obj, errorToString);
    return obj.stack;
  }
  return e?.toString() ?? "Unknown error: " + e;
}

// Send error to server
function sendErrorToServer(url, details) {
  if (!STORE || !STORE.serverBaseUrl) {
    console.error("Unable to send error to server: server base URL not found");
    return Promise.reject(new Error("Server base URL not found"));
  }

  return fetchWithRetry(`${buildServerUrl()}/log/error`, {
    body: JSON.stringify({
      url,
      details,
    }),
    method: "POST",
    headers: buildFetchHeaders(),
  })
    .then(handleJsonFetchResponse)
    .then(() => {
      logDebug("Error sent to server");
      return true;
    })
    .catch((error) => {
      console.error("Failed to send error to server:", error);
      return false;
    });
}

// Build server URL
function buildServerUrl() {
  if (!STORE || !STORE.serverBaseUrl) {
    throw new Error("Server base URL not found");
  }

  return (
    (STORE?.serverBaseUrl.endsWith("/")
      ? STORE?.serverBaseUrl.substring(0, STORE?.serverBaseUrl.lastIndexOf("/"))
      : STORE?.serverBaseUrl) + SERVER_PATH
  );
}

// Build fetch headers with authentication if available
function buildFetchHeaders() {
  const headers = {
    ...DEFAULT_FETCH_HEADERS,
  };

  if (STORE.session?.apiKey) {
    headers["Authorization"] = "Bearer " + STORE.session?.apiKey;
  }

  return headers;
}

// Fetch with timeout
async function fetchWithTimeout(url, options = {}, timeout = 15000) {
  const controller = new AbortController();
  const { signal } = controller;

  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    return await fetch(url, { ...options, signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

// Fetch with retry logic
async function fetchWithRetry(
  url,
  options = {},
  totalTimeout = 300000,
  requestTimeout = 15000,
  delay = 5000
) {
  const startTime = Date.now();

  while (Date.now() - startTime < totalTimeout) {
    try {
      const response = await fetchWithTimeout(url, options, requestTimeout);

      if (response.ok || response.status < 500) {
        return response;
      }

      console.log(`Server error: ${response.status}`, url);
      throw new Error(`Server error: ${response.status}`);
    } catch (error) {
      if (error.name === "AbortError") {
        console.error("Request timed out", url);
      } else {
        console.error("Fetch error:", error.message, url);
      }

      if (Date.now() - startTime + delay >= totalTimeout) {
        throw new Error(`Total timeout of ${totalTimeout} ms exceeded`);
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new Error(`Total timeout of ${totalTimeout} ms exceeded`);
}

// Handle text response
function handleTextFetchResponse(resp) {
  if (!resp.ok) {
    throw new Error(`${resp.status} ${resp.statusText}`);
  }
  return resp.text();
}

// Handle JSON response
async function handleJsonFetchResponse(resp) {
  if (!resp.ok) {
    throw new Error(`${resp.url}: ${resp.status} ${await resp.text()}`);
  }
  if (resp.headers.get("content-type")?.includes("application/json")) {
    return resp.json();
  }
  return resp.text();
}

// Clean up resources and reset state
async function cleanup() {
  logDebug("Starting cleanup process");

  if (STORE.windowId) {
    try {
      await chrome.windows.remove(STORE.windowId);
      logDebug("Window removed", { windowId: STORE.windowId });
    } catch (error) {
      console.error("Error removing window:", error);
      logDebug("Error removing window", { error: errorToString(error) });
    }
    STORE.windowId = null;
  }

  STORE.targetTabId = null;
  STORE.currentState = STATE.IDLE;

  // Reset tasks
  STORE.tasks.sendCv = { ...SEND_CV_TASK_DEFAULT };
  STORE.tasks.search = { ...SEARCH_TASK_DEFAULT };

  STORE.started = false;
  STORE.finished = false;

  await saveStoreToStorage();

  await chrome.alarms.clear("workableHeartbeat");
  chrome.power.releaseKeepAwake();

  logDebug("Cleanup completed");
}

// Close send CV tab and search for next job
function closeSendCvTabAndSearchNext(sendResponse, status, message) {
  logDebug("Closing send CV tab and searching next", { status, message });

  STORE.applyTabOpened = null;
  STORE.searchTabTimestamp = Date.now();
  saveStoreToStorage();

  return chrome.tabs
    .remove(STORE.tasks.sendCv.tabId)
    .then(() => {
      logDebug("Send CV tab removed", { tabId: STORE.tasks.sendCv.tabId });

      return chrome.tabs.sendMessage(STORE.tasks.search.tabId, {
        action: "searchNext",
        data: {
          url: STORE.tasks.sendCv.url,
          status: status ?? "SUCCESS",
          message,
        },
      });
    })
    .then(() => {
      STORE.tasks.sendCv = { ...SEND_CV_TASK_DEFAULT };
      saveStoreToStorage();

      if (sendResponse) {
        sendResponse({ status: "success", message: "Searching for next job" });
      }
    })
    .catch((error) => {
      logDebug("Error in closeSendCvTabAndSearchNext", {
        error: errorToString(error),
      });
      logConsoleAndSendToServerAndSendResponseIfNeed(error, sendResponse);
    });
}

// Handle CV not submitted
function cvNotSubmitted(sendResponse, url, type, details) {
  logDebug("CV not submitted", { url, type, details });

  if (type != "SKIP") {
    STORE.failedSubmissions++;
    saveStoreToStorage();
  }

  return fetchWithRetry(`${buildServerUrl()}/cv-not-submitted`, {
    body: JSON.stringify({ url, type, details }),
    method: "PUT",
    headers: buildFetchHeaders(),
  })
    .then(handleJsonFetchResponse)
    .then((data) => {
      const { liftsLimit, liftsCurrent } = data;
      logDebug("CV not submitted response", { liftsLimit, liftsCurrent });

      if (liftsCurrent >= liftsLimit) {
        return finishSuccess("lifts-out").then(() => {
          if (sendResponse) {
            sendResponse({
              status: "success",
              message: "Application limit reached",
            });
          }
        });
      } else {
        return closeSendCvTabAndSearchNext(
          sendResponse,
          "ERROR",
          `${type}: ${details}`
        );
      }
    })
    .catch((error) => {
      logDebug("Error in cvNotSubmitted", { error: errorToString(error) });
      console.error(error);

      if (sendResponse) {
        sendResponse({
          status: "error",
          message: error.message,
        });
      }
    });
}

// Finish automation successfully
async function finishSuccess(reason, status) {
  logDebug("Finishing automation successfully", { reason, status });

  try {
    if (status != "already-stopped") {
      const endpoint =
        status != "stop"
          ? `${buildServerUrl()}/finish`
          : `${buildServerUrl()}/stop`;
      await fetchWithRetry(endpoint, {
        method: "PUT",
        headers: buildFetchHeaders(),
      }).then(handleTextFetchResponse);

      logDebug("Server notified of finish", { endpoint });
    }

    // Notify web app
    const tabs = await chrome.tabs.query({
      url: ["https://app.liftmycv.com/*", "http://localhost:*/*"],
    });

    if (tabs && tabs.length > 0) {
      const event_str = "send-cv-finished-success";

      for (const tab of tabs) {
        await chrome.scripting.executeScript({
          args: [event_str, STORE.session],
          func: (event_str, arg) => {
            window.dispatchEvent(
              new CustomEvent(event_str, {
                detail: arg,
              })
            );
          },
          target: { tabId: tab.id },
        });

        logDebug("Notified web app tab of success", { tabId: tab.id });
      }
    }

    STORE.finished = true;
    saveStoreToStorage();

    if (reason !== "window-closed" && STORE.windowId) {
      await chrome.windows.remove(STORE.windowId);
      logDebug("Removed window after successful finish", {
        windowId: STORE.windowId,
      });
    }

    return true;
  } catch (error) {
    logDebug("Error in finishSuccess", { error: errorToString(error) });
    console.error("Error in finish success:", error);
    sendErrorToServer("Error in finish success", errorToString(error));
    return false;
  }
}

// Finish automation with error
async function finishError(reason) {
  logDebug("Finishing automation with error", { reason });

  try {
    await fetchWithRetry(`${buildServerUrl()}/finish`, {
      method: "PUT",
      headers: buildFetchHeaders(),
    })
      .then(handleTextFetchResponse)
      .then(async (data) => {
        let event_str;
        if (reason === "NotAuthorized") {
          event_str = "not-authorized-error";
        } else {
          event_str = "send-cv-finished-error";
        }

        const tabs = await chrome.tabs.query({
          url: ["https://app.liftmycv.com/*", "http://localhost:*/*"],
        });

        if (tabs && tabs.length > 0) {
          for (const tab of tabs) {
            await chrome.scripting.executeScript({
              args: [event_str],
              func: (event_str) => window.dispatchEvent(new Event(event_str)),
              target: { tabId: tab.id },
            });

            logDebug("Notified web app tab of error", {
              tabId: tab.id,
              event: event_str,
            });
          }
        }

        STORE.finished = true;
        saveStoreToStorage();

        if (STORE.windowId) {
          await chrome.windows.remove(STORE.windowId);
          logDebug("Removed window after error finish", {
            windowId: STORE.windowId,
          });
        }

        return true;
      });
  } catch (error) {
    logDebug("Error in finishError", { error: errorToString(error) });
    console.error("Error in finish error:", error);
    sendErrorToServer("Error in finish error", errorToString(error));
    return false;
  }
}

// Log errors to console, send to server, and send response if needed
function logConsoleAndSendToServerAndSendResponseIfNeed(error, sendResponse) {
  const errorAsString = errorToString(error);
  console.error(errorAsString);

  STORE.lastError = {
    timestamp: new Date().toISOString(),
    message: errorAsString,
  };

  saveStoreToStorage();
  sendErrorToServer("WorkableJobApplyManager error", errorAsString);

  if (typeof sendResponse === "function") {
    sendResponse({
      status: "error",
      message: errorAsString,
    });
  }
}

// Build Google search URL for Workable jobs
function getSearchUrl(request) {
  // Build search URL for Workable
  let query = `site:workable.com ${request.jobsToApply || ""}`;

  if (request.location) {
    query += ` ${request.location}`;
  }

  if (request.workplace === "REMOTE") {
    query += " Remote";
  }

  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

// Main class for managing Workable job applications
const WorkableJobApplyManager = {
  async init() {
    logDebug("Initializing Workable Job Application Manager");

    await loadStoreFromStorage();

    // Reset state if needed
    if (STORE.started && !STORE.finished) {
      await cleanup();
    }

    // Setup message listener - THIS WAS MISSING IN THE ORIGINAL CODE
    chrome.runtime.onMessage.addListener(this.handleMessage.bind(this));
    logDebug("Runtime message listener set up");

    // Setup window removal listener
    chrome.windows.onRemoved.addListener(this.handleWindowRemoved.bind(this));
    logDebug("Window removal listener set up");

    // Setup alarm listener - THIS WAS COMMENTED OUT IN THE ORIGINAL CODE
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === "workableHeartbeat") {
        this.handleAlarm();
      }
    });
    logDebug("Alarm listener set up");

    return this;
  },

  // Handle window removal event
  async handleWindowRemoved(windowId) {
    await loadStoreFromStorage();

    if (!STORE.started || windowId !== STORE.windowId) {
      return;
    }

    logDebug("Window removed", { windowId, windowIdInStore: STORE.windowId });

    try {
      if (!STORE.finished) {
        await finishSuccess("window-closed", "stop");
      }
    } catch (e) {
      logDebug("Error in windows onRemoved handler", {
        error: errorToString(e),
      });
      console.error("Error in windows onRemoved handler", e);
      sendErrorToServer("Error in windows onRemoved handler", errorToString(e));
    }

    await cleanup();
  },

  // Handle heartbeat alarm
  async handleAlarm() {
    logDebug("Workable heartbeat triggered");
    await loadStoreFromStorage();

    if (!STORE.started) {
      logDebug("Automation not started, skipping heartbeat check");
      return;
    }

    try {
      // Check if window still exists
      try {
        const window = await chrome.windows.get(STORE.windowId);
        if (!window) {
          logDebug("Window not found, cleaning up", {
            windowId: STORE.windowId,
          });
          await cleanup();
          return;
        }
      } catch (error) {
        logDebug("Error checking window", { error: errorToString(error) });
        if (error.message.includes("No window with id")) {
          await cleanup();
          return;
        }
      }

      // Check tab status
      const tabs = await chrome.tabs.query({
        windowId: STORE.windowId,
      });

      let isSearchTab = false;
      let isApplyTab = false;
      let hangedApplyTab = false;
      let hangedSearchTab = false;

      for (const tab of tabs) {
        if (STORE.tasks.search.tabId && tab.id === STORE.tasks.search.tabId) {
          isSearchTab = true;
        }

        if (STORE.tasks.sendCv.tabId && tab.id === STORE.tasks.sendCv.tabId) {
          isApplyTab = true;
        }
      }

      logDebug("Tab status", {
        isSearchTab,
        isApplyTab,
        searchTabId: STORE.tasks.search.tabId,
        applyTabId: STORE.tasks.sendCv.tabId,
        applyTabTimestamp: STORE.applyTabTimestamp,
        searchTabTimestamp: STORE.searchTabTimestamp,
        applyTabOpened: STORE.applyTabOpened,
        currentTime: Date.now(),
      });

      if (isApplyTab) {
        if (Date.now() - STORE.applyTabTimestamp > 30_000) {
          logDebug("Apply tab hanged: no keepalive within 30 seconds");
          hangedApplyTab = true;
        }
        if (Date.now() - STORE.applyTabOpened > 60_000 * 8) {
          logDebug("Apply tab hanged: opened more than 8 minutes");
          hangedApplyTab = true;
        }
      } else {
        if (isSearchTab) {
          if (
            Date.now() - STORE.searchTabTimestamp > 30_000 &&
            (!STORE.applyTabOpened ||
              Date.now() - STORE.applyTabOpened > 30_000)
          ) {
            logDebug("Search tab hanged: no requests within 30 seconds");
            hangedSearchTab = true;
          }
        }
      }

      // Handle stalled tabs
      if (hangedSearchTab || !isSearchTab) {
        if (Date.now() - STORE.windowTimestamp > 60_000) {
          logDebug("Restarting search task due to hung search tab");
          await this.startJobApplicationProcess({
            userId: STORE.userId,
            jobsToApply: STORE.session?.role,
            location: STORE.session?.country,
            country: STORE.session?.country,
            workplace: STORE.session?.workplace,
            serverBaseUrl: STORE.serverBaseUrl,
            session: STORE.session,
          });
        } else {
          logDebug("Window is fresh, no restarting needed");
        }
      } else {
        if (hangedApplyTab) {
          // Close any hung tabs except the search tab
          for (const tab of tabs) {
            if (tab.id === STORE.tasks.search.tabId) {
              continue;
            }

            try {
              await chrome.tabs.remove(tab.id);
              logDebug("Closed hanged tab", { tabId: tab.id });
            } catch (error) {
              logDebug("Error closing hanged tab", {
                tabId: tab.id,
                error: errorToString(error),
              });
            }
          }
        }

        if (hangedApplyTab || (STORE.applyTabOpened && !isApplyTab)) {
          logDebug("Searching next due to hanged or missing apply tab");
          const oldSendCvTask = STORE.tasks.sendCv;
          STORE.tasks.sendCv = { ...SEND_CV_TASK_DEFAULT };

          try {
            await chrome.tabs.sendMessage(STORE.tasks.search.tabId, {
              action: "searchNext",
              data: {
                url: oldSendCvTask.url,
                status: "ERROR",
                message: "Hanged tab closed",
              },
            });
            logDebug("Sent searchNext message to search tab");
          } catch (error) {
            logDebug("Error sending searchNext message", {
              tabId: STORE.tasks.search.tabId,
              error: errorToString(error),
            });
          }
        }
      }
    } catch (error) {
      logDebug("Error in alarm handler", { error: errorToString(error) });
      console.error("Error in alarm", error);
      sendErrorToServer("Error in alarm", errorToString(error));
    }
  },

  // Handle messages from content scripts
  async handleMessage(request, sender, sendResponse) {
    logDebug("Received message", {
      action: request.action,
      sender: sender.tab
        ? { tabId: sender.tab.id, url: sender.tab.url }
        : "extension",
    });

    try {
      await loadStoreFromStorage();

      switch (request.action) {
        case "startApplying":
          await this.startJobApplicationProcess(request, sendResponse);
          break;

        case "navigationComplete":
          if (sender.tab?.id === STORE.tasks.search.tabId) {
            STORE.searchTabTimestamp = Date.now();
            saveStoreToStorage();
            sendResponse({ status: "success" });
          }
          break;

        case "statusUpdate":
          // Save status update to store for debugging
          if (!STORE.statusUpdates) {
            STORE.statusUpdates = [];
          }

          STORE.statusUpdates.push({
            timestamp: new Date().toISOString(),
            ...request,
          });

          if (STORE.statusUpdates.length > 50) {
            STORE.statusUpdates.shift();
          }

          saveStoreToStorage();
          sendResponse({ status: "success" });
          break;

        case "processJobs":
          if (sender.tab?.id === STORE.tasks.search.tabId) {
            STORE.searchTabTimestamp = Date.now();
            saveStoreToStorage();

            await chrome.tabs.sendMessage(STORE.tasks.search.tabId, {
              action: "processJobs",
              userId: request.userId,
              jobsToApply: request.jobsToApply,
            });

            sendResponse({ status: "processing" });
          }
          break;

        case "openJobInNewTab":
          const tabId = await this.openJobInNewTab(
            request.url,
            request.country,
            request.city,
            request.workplace
          );

          sendResponse({ status: "success", tabId: tabId });
          break;

        case "closeCurrentTab":
          await this.closeTab(sender.tab.id);
          sendResponse({ status: "success" });
          break;

        case "sendCvTaskSkip":
          logDebug("Skipping job", {
            url: request.url,
            message: request.message,
          });
          await cvNotSubmitted(
            sendResponse,
            request.url,
            "SKIP",
            request.message
          );
          break;

        case "sendCvTaskDone":
          logDebug("CV task completed successfully", { url: request.url });

          STORE.applyTabOpened = null;
          STORE.searchTabTimestamp = Date.now();
          STORE.submittedLinks.push({
            url: request.url,
            details: null,
            status: "SUCCESS",
          });
          STORE.successfulSubmissions++;
          await saveStoreToStorage();

          await fetchWithRetry(`${buildServerUrl()}/cv-submitted`, {
            body: JSON.stringify({ url: request.url }),
            method: "PUT",
            headers: buildFetchHeaders(),
          })
            .then(handleJsonFetchResponse)
            .then(async (data) => {
              // Update session data
              STORE.session = data;
              await saveStoreToStorage();

              await chrome.tabs.remove(sender.tab.id);

              if (sendResponse) {
                sendResponse({ status: "success" });
              }

              STORE.tasks.sendCv = { ...SEND_CV_TASK_DEFAULT };
              await saveStoreToStorage();

              const { liftsLimit, liftsCurrent } = data;
              logDebug("CV submitted response", { liftsLimit, liftsCurrent });

              if (liftsCurrent >= liftsLimit) {
                return finishSuccess("lifts-out");
              } else {
                return chrome.tabs.sendMessage(STORE.tasks.search.tabId, {
                  action: "searchNext",
                  data: { url: request.url, status: "SUCCESS" },
                });
              }
            })
            .catch((error) => {
              logDebug("Error in sendCvTaskDone", {
                error: errorToString(error),
              });
              logConsoleAndSendToServerAndSendResponseIfNeed(
                error,
                sendResponse
              );
            });
          break;

        case "sendCvTaskError":
          logDebug("CV task failed", {
            url: request.url,
            message: request.message,
          });
          await cvNotSubmitted(
            sendResponse,
            request.url,
            "ERROR",
            request.message
          );
          break;

        case "getVacancyFieldsValues":
          logDebug("Getting vacancy fields values", {
            url: request.data?.url || "Unknown URL",
          });

          await fetchWithRetry(
            `${buildServerUrl()}/vacancy-fields-values`,
            {
              body: JSON.stringify(request.data),
              method: "POST",
              headers: buildFetchHeaders(),
            },
            GET_VACANCY_FIELDS_VALUES_TIMEOUT,
            GET_VACANCY_FIELDS_VALUES_TIMEOUT,
            15000
          )
            .then(handleJsonFetchResponse)
            .then((data) => {
              logDebug("Got vacancy fields values", {
                dataSize: JSON.stringify(data).length,
              });

              sendResponse({
                status: "success",
                data,
              });
            })
            .catch((error) => {
              logDebug("Error getting vacancy fields values", {
                error: errorToString(error),
              });

              console.error(error);

              if (error.message.includes("Session reached max lifts limit.")) {
                finishSuccess("lifts-out").catch((err) => {
                  logDebug("Error finishing after limit reached", {
                    error: errorToString(err),
                  });
                });
              }

              sendResponse({
                status: "error",
                message: error.message,
              });
            });
          break;

        case "keepAlive":
          if (sender.tab?.id === STORE.tasks.sendCv.tabId) {
            STORE.applyTabTimestamp = Date.now();
            saveStoreToStorage();
            logDebug("Received keepAlive ping from apply tab", {
              tabId: sender.tab.id,
            });
          }
          sendResponse({ status: "success" });
          break;

        case "getDebugInfo":
          sendResponse({
            status: "success",
            store: { ...STORE },
            timestamp: new Date().toISOString(),
          });
          break;

        default:
          logDebug("Unhandled message type", { action: request.action });
          console.log("Unhandled message type:", request.action);
          sendResponse({ status: "error", message: "Unsupported action" });
      }
    } catch (error) {
      logDebug("Error handling message", {
        action: request.action,
        error: errorToString(error),
      });

      console.error("Error in Workable handler:", error);
      sendErrorToServer("Workable message handler error", errorToString(error));

      if (sendResponse) {
        sendResponse({ status: "error", message: error.message });
      }
    }

    return true;
  },

  // Start the job application process
  async startJobApplicationProcess(request, sendResponse) {
    logDebug("Starting job application process", {
      userId: request.userId,
      jobsToApply: request.jobsToApply,
      location: request.location,
      country: request.country,
      workplace: request.workplace,
    });

    try {
      // Clean up any existing session first
      if (STORE.started && !STORE.finished) {
        await cleanup();
      }

      STORE.userId = request.userId;
      STORE.currentState = STATE.NAVIGATING_TO_JOBS;
      STORE.started = true;
      STORE.windowTimestamp = Date.now();
      STORE.searchTabTimestamp = Date.now();
      STORE.submittedLinks = [];
      STORE.failedSubmissions = 0;
      STORE.successfulSubmissions = 0;
      STORE.debugLogs = [];

      // If serverBaseUrl is not set, get it from the request
      if (!STORE.serverBaseUrl && request.serverBaseUrl) {
        STORE.serverBaseUrl = request.serverBaseUrl;
      }

      // Set session data if available
      if (request.session) {
        STORE.session = request.session;
      }

      await saveStoreToStorage();

      // Create a new window for the job application process
      const searchUrl = getSearchUrl(request);
      logDebug("Creating window with search URL", { searchUrl });

      const window = await chrome.windows.create({
        url: searchUrl,
        type: "normal",
        state: "maximized",
      });

      STORE.windowId = window.id;
      STORE.tasks.search.tabId = window.tabs[0].id;
      await saveStoreToStorage();

      // Request keep awake to prevent system sleep
      chrome.power.requestKeepAwake("system");

      // Setup heartbeat alarm
      await chrome.alarms.create("workableHeartbeat", {
        delayInMinutes: 1,
        periodInMinutes: 1,
      });

      logDebug("Created heartbeat alarm");

      // Wait for the page to load
      logDebug("Waiting for search page to load");
      await new Promise((resolve) => {
        const listener = (tabId, changeInfo) => {
          if (
            tabId === STORE.tasks.search.tabId &&
            changeInfo.status === "complete"
          ) {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);

        // Set a timeout to prevent hanging if page never loads
        setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }, 30000);
      });

      logDebug("Search page loaded, initializing content script");

      // Check if tab still exists
      try {
        await chrome.tabs.get(STORE.tasks.search.tabId);
      } catch (error) {
        logDebug("Search tab no longer exists", {
          error: errorToString(error),
        });
        throw new Error("Search tab was closed");
      }

      // Send initialization message to the content script
      try {
        await chrome.tabs.sendMessage(STORE.tasks.search.tabId, {
          action: "initializeSearch",
          userId: request.userId,
          jobsToApply: request.jobsToApply,
          location: request.location,
          country: request.country,
          workplace: request.workplace,
          serverBaseUrl: STORE.serverBaseUrl,
          session: STORE.session,
        });

        logDebug("Sent initialization message to content script");
      } catch (error) {
        logDebug("Error sending initialization message", {
          error: errorToString(error),
        });
        throw new Error(
          "Failed to initialize content script: " + error.message
        );
      }

      await saveStoreToStorage();

      if (sendResponse) {
        sendResponse({
          status: "started",
          platform: "workable",
          message: "Job search process initiated on Workable",
          jobsToApply: request.jobsToApply,
        });
      }
    } catch (error) {
      logDebug("Error starting job application process", {
        error: errorToString(error),
      });
      console.error("Error starting Workable job application process:", error);
      sendErrorToServer(
        "Error starting Workable job application",
        errorToString(error)
      );

      // Clean up in case of error
      if (STORE.windowId) {
        try {
          await chrome.windows.remove(STORE.windowId);
        } catch (e) {
          console.error("Error cleaning up window:", e);
        }
        STORE.windowId = null;
      }

      await cleanup();

      if (sendResponse) {
        sendResponse({
          status: "error",
          platform: "workable",
          message: "Failed to start job search: " + error.message,
        });
      }
    }
  },

  // Navigate to a specific job URL
  async navigateToJob(url) {
    logDebug("Navigating to job", { url });

    if (!STORE.tasks.search.tabId) {
      throw new Error("No active tab available");
    }

    await chrome.tabs.update(STORE.tasks.search.tabId, { url });

    // Wait for navigation to complete
    await new Promise((resolve) => {
      const listener = (tabId, changeInfo) => {
        if (
          tabId === STORE.tasks.search.tabId &&
          changeInfo.status === "complete"
        ) {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);

      // Set a timeout to prevent hanging
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, 30000);
    });

    await chrome.tabs.sendMessage(STORE.tasks.search.tabId, {
      action: "navigationComplete",
    });

    logDebug("Navigation to job complete");
  },

  // Open a job in a new tab
  async openJobInNewTab(url, country, city, workplace) {
    logDebug("Opening job in new tab", { url, country, city, workplace });

    try {
      // Check if the window still exists
      try {
        await chrome.windows.get(STORE.windowId);
      } catch (error) {
        logDebug("Window not found, recreating", {
          error: errorToString(error),
        });

        // Create a new window
        const window = await chrome.windows.create({
          type: "normal",
          state: "maximized",
        });

        STORE.windowId = window.id;
        await saveStoreToStorage();
      }

      // Append /apply/ to the URL if it doesn't end with it
      let finalUrl = url;
      if (finalUrl.endsWith("/")) {
        finalUrl = finalUrl + "apply/";
      } else if (!finalUrl.endsWith("/apply/")) {
        finalUrl = finalUrl + "/apply/";
      }

      logDebug("Final URL for job tab", { finalUrl });

      // Create a new tab in the same window
      const tab = await chrome.tabs.create({
        url: finalUrl,
        windowId: STORE.windowId,
        active: true, // Make the new tab active
      });

      STORE.tasks.sendCv.url = url;
      STORE.tasks.sendCv.tabId = tab.id;
      STORE.tasks.sendCv.active = true;
      STORE.tasks.sendCv.finalUrl = finalUrl;
      STORE.applyTabOpened = Date.now();
      STORE.applyTabTimestamp = Date.now();

      await saveStoreToStorage();

      logDebug("Created new tab for job", { tabId: tab.id });

      // Wait for the tab to load
      await new Promise((resolve) => {
        const listener = (tabId, changeInfo) => {
          if (tabId === tab.id && changeInfo.status === "complete") {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);

        // Set a timeout to prevent hanging
        setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }, 30000);
      });

      logDebug("Job tab loaded, initializing content script");

      // Check if tab still exists
      try {
        await chrome.tabs.get(tab.id);
      } catch (error) {
        logDebug("Job tab no longer exists", { error: errorToString(error) });
        throw new Error("Job tab was closed");
      }

      // Send initialization data to the new tab
      try {
        await chrome.tabs.sendMessage(tab.id, {
          action: "initializeJobTab",
          userId: STORE.userId,
          country: country,
          city: city,
          workplace: workplace,
          serverBaseUrl: STORE.serverBaseUrl,
          session: STORE.session,
        });

        logDebug("Sent initialization message to job tab");
      } catch (error) {
        logDebug("Error sending initialization message to job tab", {
          error: errorToString(error),
        });
        throw new Error("Failed to initialize job tab: " + error.message);
      }

      return tab.id;
    } catch (error) {
      logDebug("Error opening job in new tab", { error: errorToString(error) });
      console.error("Error opening job in new tab:", error);
      throw error;
    }
  },

  // Close a specific tab
  async closeTab(tabId) {
    logDebug("Closing tab", { tabId });

    try {
      await chrome.tabs.remove(tabId);
      logDebug("Tab closed successfully");
    } catch (error) {
      logDebug("Error closing tab", { error: errorToString(error) });
      console.error("Error closing tab:", error);
    }
  },
};

// Initialize extension
WorkableJobApplyManager.init();

export { WorkableJobApplyManager };
