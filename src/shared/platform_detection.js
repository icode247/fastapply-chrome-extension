// Detection methods for various platforms
const PlatformDetectionUtils = {
  // LinkedIn specific detection
  async detectLinkedInExternalRedirect(page) {
    try {
      // Check for "Apply on company site" button
      const externalButtons = await page.$$(
        '.jobs-apply-button:contains("Apply on company site"), .jobs-apply-button:contains("Easy Apply")'
      );

      if (externalButtons.length > 0) {
        const buttonText = await externalButtons[0].evaluate(
          (el) => el.textContent
        );

        if (buttonText.includes("company site")) {
          return {
            isExternal: true,
            requiresClick: true,
            platform: "linkedin",
          };
        }
      }

      // Check for any "Apply" button that has an external URL
      const applyButtons = await page.$$(
        'a[href*="apply"], a[href*="job-apply"]'
      );
      for (const button of applyButtons) {
        const href = await button.evaluate((el) => el.getAttribute("href"));
        if (href && !href.includes("linkedin.com")) {
          return {
            isExternal: true,
            url: href,
            platform: "linkedin",
          };
        }
      }

      return { isExternal: false };
    } catch (error) {
      console.error("Error detecting LinkedIn external redirect:", error);
      return { isExternal: false, error };
    }
  },

  // Indeed specific detection
  async detectIndeedExternalRedirect(page) {
    try {
      // Check for "Apply on company site" button
      const externalText = await page.$$eval(
        ".jobsearch-IndeedApplyButton-contentWrapper",
        (elements) =>
          elements.some(
            (el) =>
              el.textContent.includes("Apply on company") ||
              el.textContent.includes("Apply directly")
          )
      );

      if (externalText) {
        return {
          isExternal: true,
          requiresClick: true,
          platform: "indeed",
        };
      }

      // Check for any apply button with external URL
      const applyButtons = await page.$$(
        'a[id*="apply-button"], a[data-testid*="apply-button"]'
      );
      for (const button of applyButtons) {
        const href = await button.evaluate((el) => el.getAttribute("href"));
        if (href && !href.includes("indeed.com")) {
          return {
            isExternal: true,
            url: href,
            platform: "indeed",
          };
        }
      }

      return { isExternal: false };
    } catch (error) {
      console.error("Error detecting Indeed external redirect:", error);
      return { isExternal: false, error };
    }
  },

  // Glassdoor specific detection
  async detectGlassdoorExternalRedirect(page) {
    try {
      // Check for external application button text
      const externalButtons = await page.$$(
        '.applyButton, .gd-ui-button:contains("Apply Now")'
      );

      for (const button of externalButtons) {
        const buttonText = await button.evaluate((el) => el.textContent);
        if (
          buttonText.includes("Apply Externally") ||
          buttonText.includes("Apply on")
        ) {
          return {
            isExternal: true,
            requiresClick: true,
            platform: "glassdoor",
          };
        }
      }

      // Check for any apply button with external URL
      const applyButtons = await page.$$(
        'a.applyButton, a[data-test="apply-button"]'
      );
      for (const button of applyButtons) {
        const href = await button.evaluate((el) => el.getAttribute("href"));
        if (href && !href.includes("glassdoor.com")) {
          return {
            isExternal: true,
            url: href,
            platform: "glassdoor",
          };
        }
      }

      return { isExternal: false };
    } catch (error) {
      console.error("Error detecting Glassdoor external redirect:", error);
      return { isExternal: false, error };
    }
  },

  // ZipRecruiter specific detection
  async detectZipRecruiterExternalRedirect(page) {
    try {
      // Check for "Apply Now" button that might redirect
      const externalButtons = await page.$$(
        ".job_apply_button, .apply-now-button"
      );

      for (const button of externalButtons) {
        const buttonText = await button.evaluate((el) => el.textContent);
        const href = await button.evaluate(
          (el) => el.getAttribute("href") || ""
        );

        if (
          !href.includes("ziprecruiter.com") ||
          buttonText.includes("Apply on") ||
          buttonText.includes("company site")
        ) {
          return {
            isExternal: true,
            requiresClick: !href.includes("http"),
            url: href.includes("http") ? href : null,
            platform: "ziprecruiter",
          };
        }
      }

      return { isExternal: false };
    } catch (error) {
      console.error("Error detecting ZipRecruiter external redirect:", error);
      return { isExternal: false, error };
    }
  },

  // Generic external job detection
  detectGenericExternalRedirect(page) {
    // Combine common patterns
    return this.detectCommonExternalPatterns(page);
  },

  // Common patterns that might indicate external redirection
  async detectCommonExternalPatterns(page) {
    try {
      // Check for common external button text patterns
      const buttonSelectors = [
        'a[href*="apply"], button:contains("Apply"), a:contains("Apply")',
        '.apply-button, #apply-button, [data-testid*="apply"]',
        'input[type="submit"][value*="Apply"]',
      ];

      for (const selector of buttonSelectors) {
        const buttons = await page.$$(selector);

        for (const button of buttons) {
          const buttonText = await button.evaluate(
            (el) => el.textContent || el.value || ""
          );
          const href = await button.evaluate(
            (el) => el.getAttribute("href") || ""
          );

          const externalPhrases = [
            "apply on",
            "apply at",
            "apply with",
            "company site",
            "external",
            "website",
            "continue to",
            "proceed to",
          ];

          if (
            externalPhrases.some((phrase) =>
              buttonText.toLowerCase().includes(phrase)
            )
          ) {
            return {
              isExternal: true,
              requiresClick: true,
              buttonText: buttonText,
            };
          }

          // Check if href points to external domain
          if (href && href.startsWith("http")) {
            const currentDomain = window.location.hostname;
            const hrefDomain = new URL(href).hostname;

            if (hrefDomain !== currentDomain) {
              return {
                isExternal: true,
                url: href,
              };
            }
          }
        }
      }

      return { isExternal: false };
    } catch (error) {
      console.error("Error detecting common external patterns:", error);
      return { isExternal: false, error };
    }
  },
};

export default PlatformDetectionUtils;
