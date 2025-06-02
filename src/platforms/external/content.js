// // content.js
// import ExternalJobAutomation from "./automationHandler";
// import { SELECTORS } from "./selectors";
// //Form detected but no origin platform, waiting...
// class ExternalJobApply {
//   constructor() {
//     this.automation = null;
//     this.initialized = false;
//     this.originPlatform = null;
//     this.formDetected = false;
//     this.checkInterval = null;
    
//     console.log("ExternalJobApply constructor");
    
//     // Setup message listeners immediately
//     this.setupMessageListeners();
    
//     // Start checking for application forms
//     this.startFormDetection();
//   }
  
//   setupMessageListeners() {
//     chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
//       console.log("Content script received message:", message.type);
      
//       // Always respond to these messages even if not initialized
//       if (message.type === "CHECK_APPLICATION_PAGE") {
//         this.handleOriginDetection(message.data, sendResponse);
//         return true;
//       }
      
//       // These messages require initialization
//       if (["INIT_AUTOMATION", "PROCESS_APPLICATION"].includes(message.type)) {
//         this.handleMessageInSequence(message, sender, sendResponse);
//         return true; // Keep message channel open
//       }
//     });
//   }
  
//   handleOriginDetection(data, sendResponse) {
//     // Store origin platform for later use
//     if (data.originPlatform) {
//       this.originPlatform = data.originPlatform;
//       console.log(`Page originated from ${this.originPlatform}`);
      
//       // Check immediately if we already detected a form
//       if (this.formDetected) {
//         this.notifyFormDetection();
//       }
//     }
    
//     sendResponse({ success: true });
//   }

//   isExcludedPlatform() {
//     const hostname = window.location.hostname;
//     const excludedPlatforms = [
//       "linkedin.com", 
//       "indeed.com", 
//       "glassdoor.com", 
//       "workable.com", 
//       "lever.co"
//     ];
    
//     return excludedPlatforms.some(platform => hostname.includes(platform));
//   }
  
//   startFormDetection() {
//     // Don't check on excluded platforms
//     if (this.isExcludedPlatform()) {
//       console.log("On excluded platform, not checking for forms");
//       return;
//     }
    
//     // Initial check
//     this.checkForApplicationForm();
    
//     // Set up interval to check periodically as the page might load dynamically
//     this.checkInterval = setInterval(() => {
//       this.checkForApplicationForm();
//     }, 1500);
    
//     // Clear interval after 10 seconds to prevent continuous checking
//     setTimeout(() => {
//       if (this.checkInterval) {
//         clearInterval(this.checkInterval);
//         this.checkInterval = null;
//       }
//     }, 10000);
//   }
  
//   checkForApplicationForm() {
//     if (this.formDetected) return;
    
//     // Check for forms
//     const forms = document.querySelectorAll('form');
    
//     // Check for apply buttons
//     let hasApplyButton = false;
//     for (const selector of SELECTORS.APPLY_BUTTON) {
//       const buttons = document.querySelectorAll(selector);
//       for (const button of buttons) {
//         const buttonText = button.textContent.toLowerCase();
//         if (buttonText.includes('apply') || buttonText.includes('submit')) {
//           hasApplyButton = true;
//           break;
//         }
//       }
//       if (hasApplyButton) break;
//     }
    
//     // Check for form fields (at least 3 input fields)
//     const inputFields = document.querySelectorAll('input:not([type="hidden"])');
//     const hasInputFields = inputFields.length >= 3;
    
//     // Check for submit buttons in forms
//     let hasSubmitButton = false;
//     const submitButtons = document.querySelectorAll('button[type="submit"], input[type="submit"]');
//     hasSubmitButton = submitButtons.length > 0;
    
//     // If we have forms and either apply buttons or input fields, likely an application page
//     if ((forms.length > 0 && (hasApplyButton || hasInputFields)) || hasSubmitButton) {
//       console.log("Application form detected");
//       this.formDetected = true;
      
//       // Notify background script
//       this.notifyFormDetection();
      
//       // Clear the interval
//       if (this.checkInterval) {
//         clearInterval(this.checkInterval);
//         this.checkInterval = null;
//       }
//     }
//   }
  
//   notifyFormDetection() {
//     // Only notify if we have an origin platform
//     // if (!this.originPlatform) {
//     //   console.log("Form detected but no origin platform, waiting...");
//     //   return;
//     // }
    
//     chrome.runtime.sendMessage({
//       type: "CHECK_FORM_DETECTED",
//       data: {
//         url: window.location.href,
//         pageTitle: document.title,
//         companyName: this.extractCompanyName(),
//         originPlatform: this.originPlatform
//       }
//     });
//   }
  
//   extractCompanyName() {
//     // Try to extract company name from the page
//     // Check meta tags first
//     const companyMeta = document.querySelector('meta[property="og:site_name"], meta[name="author"]');
//     if (companyMeta) {
//       return companyMeta.getAttribute('content');
//     }
    
//     // Try to find company name in the title
//     const title = document.title;
//     const titleParts = title.split(/[|–—-]/);
//     if (titleParts.length > 1) {
//       return titleParts[titleParts.length - 1].trim();
//     }
    
//     // Look for company logo alt text
//     const logos = document.querySelectorAll('img[alt*="logo"], img[src*="logo"]');
//     for (const logo of logos) {
//       if (logo.alt && logo.alt.length > 0) {
//         return logo.alt.replace('logo', '').trim();
//       }
//     }
    
//     return null;
//   }

//   async handleMessageInSequence(message, sender, sendResponse) {
//     // Don't run on excluded platforms
//     if (this.isExcludedPlatform()) {
//       sendResponse({ success: false, error: "Automation not supported on this platform" });
//       return;
//     }

//     try {
//       console.log("Processing message:", message.type);

//       // Ensure initialization happens first
//       if (message.type !== "INIT_AUTOMATION" && !this.initialized) {
//         throw new Error("Automation must be initialized first");
//       }

//       switch (message.type) {
//         case "INIT_AUTOMATION":
//           await this.handleInitialization(message.data, sendResponse);
//           break;

//         case "PROCESS_APPLICATION":
//           await this.handleApplicationProcess(message.data, sendResponse);
//           break;

//         default:
//           throw new Error("Unknown message type");
//       }
//     } catch (error) {
//       console.error(`Error handling message ${message.type}:`, error);
//       sendResponse({ success: false, error: error.message });
//     }
//   }

//   async handleInitialization(data, sendResponse) {
//     try {
//       console.log("Initializing automation with data:", data);
      
//       // Store the origin platform if provided
//       if (data.platform) {
//         this.originPlatform = data.platform;
//       }

//       // Create automation instance
//       this.automation = new ExternalJobAutomation({
//         page: window,
//         host: data.host,
//         userId: data.userId,
//         platform: this.originPlatform
//       });
      
//       await this.automation.initialize();

//       // Mark as initialized
//       this.initialized = true;

//       console.log("Automation initialized successfully");
//       sendResponse({ success: true });
//     } catch (error) {
//       this.initialized = false;
//       this.automation = null;
//       console.error("Initialization error:", error);
//       sendResponse({ success: false, error: error.message });
//     }
//   }

//   async handleApplicationProcess(data, sendResponse) {
//     try {
//       console.log("Processing application:", data);
      
//       if (!this.automation) {
//         throw new Error("Automation not initialized");
//       }

//       // Handle the application
//       const result = await this.automation.handleApplication(data.jobDetails);

//       // Report success
//       sendResponse({ success: true, data: result });

//       // Notify background of completion
//       chrome.runtime.sendMessage({
//         type: "APPLICATION_STATUS",
//         data: { 
//           status: "completed", 
//           jobId: data.jobDetails?.jobId,
//           platform: this.originPlatform
//         }
//       });
//     } catch (error) {
//       console.error("Application process error:", error);
      
//       // Notify background of failure
//       chrome.runtime.sendMessage({
//         type: "APPLICATION_STATUS",
//         data: {
//           status: "failed",
//           error: error.message,
//           jobId: data.jobDetails?.jobId,
//           platform: this.originPlatform
//         }
//       });
      
//       sendResponse({ success: false, error: error.message });
//     }
//   }
// }

// // Initialize the controller
// const controller = new ExternalJobApply();

// // Export for testing
// export default ExternalJobApply;