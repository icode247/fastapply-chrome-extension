class AdvancedJobApplicationMatcher {
  constructor(userDetails) {
    this.userDetails = userDetails;
    this.cache = new Map();
  }

  patterns = {
    personalInfo: {
      patterns: {
        name: {
          regex: /(?:what(?:'s|\sis)|your|full|complete).*\b(?:name|called)\b/i,
          followUps: ["first name", "last name", "preferred name"],
        },
        firstName: {
          regex: /\b(?:first|given)\s+name\b/i,
          alternates: ["name.first", "given name"],
        },
        lastName: {
          regex: /\b(?:last|family|sur)\s*name\b/i,
          alternates: ["name.last", "surname"],
        },
        email: {
          regex: /\b(?:e-?mail|electronic\s+mail|contact.*email)\b/i,
          followUps: ["alternate email", "backup email"],
        },
        phone: {
          regex:
            /\b(?:phone|mobile|cell|contact|telephone).+?(?:number|#|phone)\b/i,
          alternates: ["contact number", "mobile number"],
        },
        address: {
          regex:
            /\b(?:permanent|current|home|residential|mailing)?\s*(?:address|location)\b/i,
          components: ["street", "city", "state", "zipcode"],
        },
      },
      extract: (match) => {
        const extractors = {
          name: () =>
            this.userDetails.name ||
            `${this.userDetails.firstName} ${this.userDetails.lastName}`,
          firstName: () => this.userDetails.firstName,
          lastName: () => this.userDetails.lastName,
          email: () => this.userDetails.email,
          phone: () =>
            `${this.userDetails.phoneCountryCode}${this.userDetails.phoneNumber}`,
          address: () => {
            const parts = [
              this.userDetails.street,
              this.userDetails.currentCity,
              this.userDetails.state,
              this.userDetails.zipcode,
            ].filter(Boolean);
            return parts.join(", ");
          },
        };
        return extractors[match]?.() || null;
      },
    },

    // location: {
    //   patterns: {
    //     current: {
    //       regex:
    //         /\b(?:where|location|address|city|based).+?(?:live|located|based|now|current)\b/i,
    //       context: "current_location",
    //     },
    //     preferred: {
    //       regex:
    //         /\b(?:preferred|desired|want|looking).+?(?:location|city|place|area|region)\b/i,
    //       context: "job_preference",
    //     },
    //     relocate: {
    //       regex:
    //         /\b(?:willing|able|can|open|consider).+?(?:relocate|move|transfer|relocation)\b/i,
    //       context: "relocation",
    //     },
    //     remote: {
    //       regex:
    //         /\b(?:remote|work\s*from\s*home|wfh|virtual|telecommute)\b.*(?:work|job|position)\b/i,
    //       context: "work_mode",
    //     },
    //     travelRequired: {
    //       regex:
    //         /\b(?:travel|trip|journey).+?(?:required|needed|necessary|involve|include)\b/i,
    //       context: "travel_requirement",
    //     },
    //   },
    //   extract: (match, context) => {
    //     const extractors = {
    //       current: () =>
    //         `${this.userDetails.currentCity}, ${this.userDetails.state}`,
    //       preferred: () =>
    //         this.userDetails.jobPreferences?.location ||
    //         this.userDetails.currentCity,
    //       relocate: () => {
    //         const prefLocation = this.userDetails.jobPreferences?.location;
    //         const currentLocation = this.userDetails.currentCity;
    //         if (!prefLocation || !currentLocation) return "Yes";
    //         return prefLocation !== currentLocation ? "Yes" : "No";
    //       },
    //       remote: () => {
    //         const workModes = this.userDetails.jobPreferences?.workMode || [];
    //         return workModes.includes("Remote") ? "Yes" : "No";
    //       },
    //       travelRequired: () => "Yes", // Default to yes unless specified otherwise
    //     };
    //     return extractors[match]?.() || null;
    //   },
    // },
    location: {
      patterns: {
        current: {
          regex:
            /\b(?:where|location|address|city|based).+?(?:live|located|based|now|current)\b/i,
          context: "current_location",
        },
        preferred: {
          regex:
            /\b(?:preferred|desired|want|looking).+?(?:location|city|place|area|region)\b/i,
          context: "job_preference",
        },
        relocate: {
          regex:
            /\b(?:willing|able|can|open|consider).+?(?:relocate|move|transfer|relocation)\b/i,
          context: "relocation",
        },
        remote: {
          regex:
            /\b(?:remote|work\s*from\s*home|wfh|virtual|telecommute)\b.*(?:work|job|position)\b/i,
          context: "work_mode",
        },
        remoteComfort: {
          regex:
            /\b(?:comfortable|okay|suitable|fine)\b.+?\b(?:remote|work\s*from\s*home|wfh|virtual)\b.+?\b(?:setting|environment|arrangement|work|working)\b/i,
          context: "remote_comfort",
        },
        travelRequired: {
          regex:
            /\b(?:travel|trip|journey).+?(?:required|needed|necessary|involve|include)\b/i,
          context: "travel_requirement",
        },
      },
      extract: (match, context) => {
        const extractors = {
          current: () =>
            `${this.userDetails.currentCity}, ${this.userDetails.state}`,
          preferred: () =>
            this.userDetails.jobPreferences?.location ||
            this.userDetails.currentCity,
          relocate: () => {
            const prefLocation = this.userDetails.jobPreferences?.location;
            const currentLocation = this.userDetails.currentCity;
            if (!prefLocation || !currentLocation) return "Yes";
            return prefLocation !== currentLocation ? "Yes" : "No";
          },
          remote: () => {
            const workModes = this.userDetails.jobPreferences?.workMode || [];
            return workModes.includes("Remote") ? "Yes" : "No";
          },
          remoteComfort: () => {
            const workModes = this.userDetails.jobPreferences?.workMode || [];
            return workModes.includes("Remote") ? "Yes" : "No";
          },
          travelRequired: () => "Yes", // Default to yes unless specified otherwise
        };
        return extractors[match]?.() || null;
      },
    },
    experience: {
      patterns: {
        totalYears: {
          regex:
            /\b(?:how\s+(?:many|much)|total|years?\s+of)\s+(?:experience|work|employment)\b/i,
          context: "total_experience",
        },
        specific: {
          regex: /(?:experience|worked|skill)\s+(?:with|in|using)\s+([^?.,]+)/i,
          context: "specific_skill",
        },
        level: {
          regex:
            /\b(?:experience|skill|seniority)\s*(?:level|position|role)\b/i,
          context: "experience_level",
        },
        leadership: {
          regex:
            /\b(?:lead|manage|supervise|oversee).+?(?:team|group|people|employees)\b/i,
          context: "leadership",
        },
        recentRole: {
          regex:
            /\b(?:current|present|recent|latest).+?(?:role|position|job|title)\b/i,
          context: "current_role",
        },
      },
      extract: (match, captured, context) => {
        const extractors = {
          totalYears: () => this.userDetails.yearsOfExperience || "0",
          specific: () => this.findSpecificExperience(captured),
          level: () => {
            const years = parseInt(this.userDetails.yearsOfExperience) || 0;
            if (years <= 2) return "Entry Level";
            if (years <= 5) return "Mid Level";
            return "Senior Level";
          },
          leadership: () => {
            const hasLeadership = this.userDetails.fullPositions?.some((pos) =>
              /(?:lead|senior|manager|supervisor|head)/i.test(pos.role)
            );
            return hasLeadership ? "Yes" : "No";
          },
          recentRole: () => {
            const positions = this.userDetails.fullPositions || [];
            return positions[0]?.role || this.userDetails.headline || "";
          },
        };
        return extractors[match]?.() || null;
      },
    },

    education: {
      patterns: {
        degree: {
          regex:
            /\b(?:highest|latest|recent|current)?\s*(?:degree|education|qualification)\b/i,
          context: "education_level",
        },
        major: {
          regex:
            /\b(?:major|field|specialization|concentration|subject)\s+(?:of\s+study|studied|in)\b/i,
          context: "study_field",
        },
        graduation: {
          regex:
            /\b(?:when|year|date).+?(?:graduate|completion|finished|completed)\b/i,
          context: "graduation_date",
        },
        gpa: {
          regex: /\b(?:gpa|grade.*average|academic.*performance)\b/i,
          context: "academic_performance",
        },
        institution: {
          regex:
            /\b(?:school|college|university|institute|academy).+?(?:attended|went|studied|name)\b/i,
          context: "institution",
        },
      },
      extract: (match, context) => {
        const edu = this.userDetails.education;
        const extractors = {
          degree: () => edu?.degree || "",
          major: () => edu?.major || "",
          graduation: () =>
            `${edu?.educationEndMonth} ${edu?.educationEndYear}` || "",
          gpa: () => edu?.gpa || "3.5",
          institution: () => edu?.school || "",
        };
        return extractors[match]?.() || null;
      },
    },

    workAuthorization: {
      patterns: {
        citizenship: {
          regex: /\b(?:citizen|citizenship|nationality)\b/i,
          context: "citizenship_status",
        },
        workPermit: {
          regex: /\b(?:legally|authorized|permitted).+?(?:work|employment)\b/i,
          context: "work_authorization",
        },
        sponsorship: {
          regex:
            /\b(?:require|need|want).+?(?:sponsorship|visa|work permit)\b/i,
          context: "visa_requirement",
        },
        visaStatus: {
          regex: /\b(?:current|present).+?(?:visa|immigration|status)\b/i,
          context: "current_visa",
        },
      },
      extract: (match) => {
        const extractors = {
          citizenship: () =>
            this.userDetails.usCitizenship === "citizen"
              ? "US Citizen"
              : "Non-US Citizen",
          workPermit: () => {
            const status = this.userDetails.usCitizenship;
            return ["citizen", "permanent-resident"].includes(status)
              ? "Yes"
              : "No";
          },
          sponsorship: () =>
            this.userDetails.usCitizenship === "citizen" ? "No" : "Yes",
          visaStatus: () => this.userDetails.usCitizenship || "Not Applicable",
        };
        return extractors[match]?.() || null;
      },
    },

    skills: {
      patterns: {
        technical: {
          regex:
            /\b(?:technical|programming|coding|development).+?(?:skills|abilities|expertise)\b/i,
          context: "technical_skills",
        },
        tools: {
          regex:
            /\b(?:tools|software|platforms|technologies).+?(?:used|familiar|experience)\b/i,
          context: "tools_experience",
        },
        proficiency: {
          regex:
            /\b(?:how|level|rate).+?(?:proficient|skilled|experienced).+?(?:in|with|using)\s+([^?.,]+)/i,
          context: "skill_level",
        },
        softSkills: {
          regex:
            /\b(?:soft|interpersonal|communication|leadership).+?(?:skills|abilities)\b/i,
          context: "soft_skills",
        },
      },
      extract: (match, captured) => {
        const extractors = {
          technical: () => {
            const headline = this.userDetails.headline || "";
            const skills = headline
              .split(/,\s*/)
              .filter((s) => /^[A-Za-z0-9\s\+\#\.]+$/.test(s));
            return skills.join(", ") || "Not specified";
          },
          tools: () => {
            const positions = this.userDetails.fullPositions || [];
            const tools = new Set();
            positions.forEach((pos) => {
              pos.responsibilities?.forEach((resp) => {
                const matches = resp.match(
                  /\b(?:using|with)\s+([A-Za-z0-9,\s\+\#\.]+)/i
                );
                if (matches) tools.add(matches[1].trim());
              });
            });
            return Array.from(tools).join(", ") || "Not specified";
          },
          proficiency: (skill) => {
            const years = this.findSpecificExperience(skill);
            if (years >= 3) return "Expert";
            if (years >= 1) return "Intermediate";
            return "Beginner";
          },
          softSkills: () => {
            const summary = this.userDetails.summary || "";
            const softSkills = [
              "communication",
              "leadership",
              "teamwork",
              "problem-solving",
              "analytical",
              "organization",
              "creativity",
              "adaptability",
            ];
            const found = softSkills.filter((skill) =>
              summary.toLowerCase().includes(skill.toLowerCase())
            );
            return found.join(", ") || "Not specified";
          },
        };
        return extractors[match]?.(captured) || null;
      },
    },

    availability: {
      patterns: {
        startDate: {
          regex: /\b(?:when|how\s+soon).+?(?:start|join|begin|available)\b/i,
          context: "start_date",
        },
        noticePeriod: {
          regex: /\b(?:notice|resignation).+?(?:period|time|requirement)\b/i,
          context: "notice_period",
        },
        workSchedule: {
          regex: /\b(?:work|job).+?(?:schedule|hours|timing|shift)\b/i,
          context: "work_schedule",
        },
        immediateJoiner: {
          regex: /\b(?:immediate|instant|quick).+?(?:joiner|joining|start)\b/i,
          context: "immediate_availability",
        },
      },
      extract: (match) => {
        const extractors = {
          startDate: () => {
            const notice = this.userDetails.noticePeriod;
            return notice === "immediate"
              ? "Immediately"
              : `After ${notice} notice period`;
          },
          noticePeriod: () => this.userDetails.noticePeriod || "Immediate",
          workSchedule: () => {
            const jobType =
              this.userDetails.jobPreferences?.jobType?.[0] || "Full-time";
            return jobType === "Full-time"
              ? "Regular business hours"
              : "Flexible";
          },
          immediateJoiner: () =>
            this.userDetails.noticePeriod === "immediate" ? "Yes" : "No",
        };
        return extractors[match]?.() || null;
      },
    },
    compensation: {
      patterns: {
        expectedSalary: {
          regex:
            /\b(?:expected|desired|minimum).+?(?:salary|compensation|pay|package)(?:\s+per\s+(?:month|year|annum))?\b/i,
          context: "expected_salary",
        },
        monthlySalary: {
          regex:
            /\b(?:monthly|per month).+?(?:salary|compensation|pay|package)\b/i,
          context: "monthly_salary",
        },
        yearlySalary: {
          regex:
            /\b(?:yearly|annual|per year|per annum).+?(?:salary|compensation|pay|package)\b/i,
          context: "yearly_salary",
        },
        salaryRange: {
          regex:
            /\b(?:salary|pay).+?(?:range|bracket|band)(?:\s+per\s+(?:month|year|annum))?\b/i,
          context: "salary_range",
        },
        currentSalary: {
          regex:
            /\b(?:current|present).+?(?:salary|compensation|pay|package)(?:\s+per\s+(?:month|year|annum))?\b/i,
          context: "current_salary",
        },
        benefits: {
          regex:
            /\b(?:benefits|perks|advantages).+?(?:expected|looking|want)\b/i,
          context: "benefits_expectations",
        },
        negotiable: {
          regex: /\b(?:salary|compensation).+?(?:negotiable|flexible)\b/i,
          context: "salary_negotiable",
        },
      },
      extract: (match, context) => {
        const getSalaryValue = (amount, isMonthly = false) => {
          if (!amount) return "Negotiable";
          const value = parseInt(amount);
          return isMonthly ? Math.floor(value / 12) : value;
        };

        const extractors = {
          expectedSalary: () => {
            const salary = this.userDetails.desiredSalary;
            const isMonthly = context?.includes("month");
            return getSalaryValue(salary, isMonthly);
          },
          monthlySalary: () => {
            const salary = this.userDetails.desiredSalary;
            return getSalaryValue(salary, true);
          },
          yearlySalary: () => {
            const salary = this.userDetails.desiredSalary;
            return getSalaryValue(salary, false);
          },
          salaryRange: () => {
            const range = this.userDetails.jobPreferences?.salary || [];
            const isMonthly = context?.includes("month");
            if (range.length === 2) {
              const min = getSalaryValue(range[0], isMonthly);
              const max = getSalaryValue(range[1], isMonthly);
              return `${min}-${max}`;
            }
            return "Negotiable";
          },
          currentSalary: () => {
            const salary =
              this.userDetails.currentSalary || this.userDetails.desiredSalary;
            const isMonthly = context?.includes("month");
            return getSalaryValue(salary, isMonthly);
          },
          benefits: () => "Standard benefits package",
          negotiable: () => "Yes",
        };
        return extractors[match]?.() || null;
      },
    },
    //[2]
    // compensation: {
    //   patterns: {
    //     expectedSalary: {
    //       regex: /\b(?:expected|desired|minimum).+?(?:salary|compensation|pay|package)(?:\s+per\s+(?:month|year|annum))?\b/i,
    //       context: "expected_salary"
    //     },
    //     monthlySalary: {
    //       regex: /\b(?:monthly|per month).+?(?:salary|compensation|pay|package)\b/i,
    //       context: "monthly_salary"
    //     },
    //     yearlySalary: {
    //       regex: /\b(?:yearly|annual|per year|per annum).+?(?:salary|compensation|pay|package)\b/i,
    //       context: "yearly_salary"
    //     },
    //     salaryRange: {
    //       regex: /\b(?:salary|pay).+?(?:range|bracket|band)(?:\s+per\s+(?:month|year|annum))?\b/i,
    //       context: "salary_range"
    //     },
    //     currentSalary: {
    //       regex: /\b(?:current|present).+?(?:salary|compensation|pay|package)(?:\s+per\s+(?:month|year|annum))?\b/i,
    //       context: "current_salary"
    //     },
    //     benefits: {
    //       regex: /\b(?:benefits|perks|advantages).+?(?:expected|looking|want)\b/i,
    //       context: "benefits_expectations"
    //     },
    //     negotiable: {
    //       regex: /\b(?:salary|compensation).+?(?:negotiable|flexible)\b/i,
    //       context: "salary_negotiable"
    //     }
    //   },
    //   extract: (match, context) => {
    //     const formatSalary = (amount, isMonthly = false) => {
    //       if (!amount) return "Negotiable";
    //       const value = parseInt(amount);
    //       return isMonthly ? Math.round(value / 12).toLocaleString() : value.toLocaleString();
    //     };

    //     const extractors = {
    //       expectedSalary: () => {
    //         const salary = this.userDetails.desiredSalary;
    //         const isMonthly = context?.includes("month");
    //         return formatSalary(salary, isMonthly);
    //       },
    //       monthlySalary: () => {
    //         const salary = this.userDetails.desiredSalary;
    //         return formatSalary(salary, true);
    //       },
    //       yearlySalary: () => {
    //         const salary = this.userDetails.desiredSalary;
    //         return formatSalary(salary, false);
    //       },
    //       salaryRange: () => {
    //         const range = this.userDetails.jobPreferences?.salary || [];
    //         const isMonthly = context?.includes("month");
    //         if (range.length === 2) {
    //           const min = formatSalary(range[0], isMonthly);
    //           const max = formatSalary(range[1], isMonthly);
    //           return `${min} - ${max}`;
    //         }
    //         return "Negotiable";
    //       },
    //       currentSalary: () => {
    //         const salary = this.userDetails.currentSalary || this.userDetails.desiredSalary;
    //         const isMonthly = context?.includes("month");
    //         return formatSalary(salary, isMonthly);
    //       },
    //       benefits: () => "Standard benefits package",
    //       negotiable: () => "Yes"
    //     };
    //     return extractors[match]?.() || null;
    //   }
    // },
    //[1]
    // compensation: {
    //   patterns: {
    //     expectedSalary: {
    //       regex:
    //         /\b(?:expected|desired|minimum).+?(?:salary|compensation|pay|package)\b/i,
    //       context: "expected_salary",
    //     },
    //     salaryRange: {
    //       regex: /\b(?:salary|pay).+?(?:range|bracket|band)\b/i,
    //       context: "salary_range",
    //     },
    //     benefits: {
    //       regex:
    //         /\b(?:benefits|perks|advantages).+?(?:expected|looking|want)\b/i,
    //       context: "benefits_expectations",
    //     },
    //     negotiable: {
    //       regex: /\b(?:salary|compensation).+?(?:negotiable|flexible)\b/i,
    //       context: "salary_negotiable",
    //     },
    //   },
    //   extract: (match) => {
    //     const extractors = {
    //       expectedSalary: () => {
    //         const salary = this.userDetails.desiredSalary;
    //         // return salary ? `${parseInt(salary).toLocaleString()}` : 'Negotiable';
    //         return salary ? salary : "Negotiable";
    //       },
    //       salaryRange: () => {
    //         const range = this.userDetails.jobPreferences?.salary || [];
    //         return range.length === 2
    //           ? `${range[0].toLocaleString()} - ${range[1].toLocaleString()}`
    //           : "Negotiable";
    //       },
    //       benefits: () => "Standard benefits package",
    //       negotiable: () => "Yes",
    //     };
    //     return extractors[match]?.() || null;
    //   },
    // },

    semanticGroups: {
      experienceLevel: {
        terms: [
          // Core levels
          "junior",
          "senior",
          "lead",
          "entry",
          "mid",
          "expert",
          "principal",
          "architect",
          "head",
          "chief",
          "director",
          // Additional levels
          "associate",
          "staff",
          "distinguished",
          "vp",
          "executive",
          "intern",
          "trainee",
          "graduate",
          "manager",
          "supervisor",
          "team lead",
          "tech lead",
          "specialist",
          "consultant",
        ],
        getValue: (term) => {
          const years = parseInt(this.userDetails.yearsOfExperience) || 0;
          const positions = this.userDetails.fullPositions || [];
          const hasLeadership = positions.some((pos) =>
            pos.role?.toLowerCase().includes(term)
          );

          const levelMap = {
            "intern|trainee|graduate": years <= 1,
            "junior|entry|associate": years <= 2,
            "mid|intermediate": years > 2 && years <= 5,
            "senior|lead": years >= 5 || hasLeadership,
            "staff|specialist": years >= 6,
            "principal|architect": years >= 8,
            "distinguished|expert": years >= 10,
            "head|chief|director|vp|executive": years >= 10 && hasLeadership,
          };

          for (const [pattern, condition] of Object.entries(levelMap)) {
            if (new RegExp(pattern, "i").test(term)) return condition;
          }
          return years >= 3;
        },
      },

      workMode: {
        terms: [
          "remote",
          "onsite",
          "hybrid",
          "office",
          "work from home",
          "telecommute",
          "flexible",
          "in-person",
          "virtual",
          "distributed",
          "fully remote",
          "partially remote",
          "remote first",
          "office first",
          "flexible hours",
          "work from anywhere",
          "satellite office",
          "hub",
        ],
        getValue: (term) => {
          const modes = this.userDetails.jobPreferences?.workMode || [];
          const modeMap = {
            remote: [
              "remote",
              "work from home",
              "virtual",
              "telecommute",
              "distributed",
              "work from anywhere",
            ],
            onsite: ["onsite", "office", "in-person", "office first", "hub"],
            hybrid: ["hybrid", "flexible", "partially remote", "satellite"],
          };

          for (const [key, values] of Object.entries(modeMap)) {
            if (values.some((v) => term.toLowerCase().includes(v))) {
              return modes.includes(key);
            }
          }
          return false;
        },
      },

      employmentType: {
        terms: [
          "full-time",
          "part-time",
          "contract",
          "permanent",
          "temporary",
          "freelance",
          "consulting",
          "internship",
          "volunteer",
          "fixed-term",
          "seasonal",
          "zero-hour",
          "casual",
          "project-based",
          "contract-to-hire",
          "direct hire",
        ],
        getValue: (term) => {
          const types = this.userDetails.jobPreferences?.jobType || [];
          return types.some(
            (type) => type.toLowerCase() === term.toLowerCase()
          );
        },
      },

      industryType: {
        terms: [
          "technology",
          "finance",
          "healthcare",
          "retail",
          "education",
          "manufacturing",
          "consulting",
          "media",
          "automotive",
          "aerospace",
          "government",
          "non-profit",
          "startup",
          "enterprise",
          "agency",
          "telecom",
          "energy",
          "construction",
          "real estate",
          "banking",
          "insurance",
          "pharma",
          "biotech",
          "e-commerce",
          "cybersecurity",
        ],
        getValue: (term) => {
          const targetIndustry =
            this.userDetails.jobPreferences?.industry || "";
          return targetIndustry.toLowerCase().includes(term.toLowerCase());
        },
      },

      technicalSkills: {
        terms: [
          // Programming Languages
          "javascript",
          "python",
          "java",
          "typescript",
          "c++",
          "ruby",
          // Frameworks
          "react",
          "angular",
          "vue",
          "node.js",
          "django",
          "spring",
          // Tools & Platforms
          "aws",
          "azure",
          "gcp",
          "docker",
          "kubernetes",
          "jenkins",
          // Methodologies
          "agile",
          "scrum",
          "devops",
          "ci/cd",
          "tdd",
          "clean code",
          // Database
          "sql",
          "mongodb",
          "postgresql",
          "oracle",
          "redis",
        ],
        getValue: (term) => {
          const skills = this.userDetails.headline?.toLowerCase() || "";
          const positions = this.userDetails.fullPositions || [];
          const hasSkill = positions.some(
            (pos) =>
              pos.role?.toLowerCase().includes(term.toLowerCase()) ||
              pos.responsibilities?.some((r) =>
                r.toLowerCase().includes(term.toLowerCase())
              )
          );
          return hasSkill || skills.includes(term.toLowerCase());
        },
      },

      softSkills: {
        terms: [
          "communication",
          "leadership",
          "teamwork",
          "problem-solving",
          "analytical",
          "organization",
          "creativity",
          "adaptability",
          "negotiation",
          "conflict resolution",
          "time management",
          "critical thinking",
          "emotional intelligence",
          "presentation",
          "mentoring",
          "collaboration",
          "project management",
        ],
        getValue: (term) => {
          const summary = this.userDetails.summary?.toLowerCase() || "";
          const positions = this.userDetails.fullPositions || [];
          return (
            summary.includes(term.toLowerCase()) ||
            positions.some((pos) =>
              pos.responsibilities?.some((r) =>
                r.toLowerCase().includes(term.toLowerCase())
              )
            )
          );
        },
      },

      workEnvironment: {
        terms: [
          "fast-paced",
          "collaborative",
          "innovative",
          "structured",
          "startup culture",
          "corporate",
          "casual",
          "professional",
          "team-oriented",
          "independent",
          "dynamic",
          "creative",
          "results-driven",
          "deadline-oriented",
          "customer-focused",
          "remote",
        ],
        getValue: (term) => {
          const prefs = this.userDetails.jobPreferences?.workMode[0] || [];
          return prefs.some((pref) =>
            pref.toLowerCase().includes(term.toLowerCase())
          );
        },
      },

      benefits: {
        terms: [
          "health insurance",
          "dental",
          "vision",
          "401k",
          "stock options",
          "paid time off",
          "vacation",
          "sick leave",
          "parental leave",
          "professional development",
          "training",
          "education reimbursement",
          "gym membership",
          "mental health",
          "flexible spending account",
        ],
        getValue: (term) => {
          const desiredBenefits =
            this.userDetails.jobPreferences?.benefits || [];
          return desiredBenefits.some((benefit) =>
            benefit.toLowerCase().includes(term.toLowerCase())
          );
        },
      },

      location: {
        terms: [
          "relocation",
          "local",
          "domestic",
          "international",
          "city-based",
          "suburban",
          "rural",
          "metropolitan",
          "region-specific",
          "global",
          "nationwide",
          "cross-border",
        ],
        getValue: (term) => {
          const currentLocation = `${this.userDetails.currentCity}, ${this.userDetails.state}`;
          const preferredLocation = this.userDetails.jobPreferences?.location;
          const willingToRelocate = currentLocation !== preferredLocation;

          const locationMap = {
            relocation: willingToRelocate,
            local: !willingToRelocate,
            international: preferredLocation?.includes("international"),
            domestic: preferredLocation?.includes("domestic"),
          };

          return locationMap[term.toLowerCase()] || false;
        },
      },

      responsibilityLevel: {
        terms: [
          "individual contributor",
          "team lead",
          "manager",
          "department head",
          "executive",
          "mentor",
          "supervisor",
          "project manager",
          "product owner",
          "technical lead",
          "architect",
          "consultant",
          "specialist",
          "coordinator",
        ],
        getValue: (term) => {
          const positions = this.userDetails.fullPositions || [];
          return positions.some((pos) =>
            pos.role?.toLowerCase().includes(term.toLowerCase())
          );
        },
      },

      certification: {
        terms: [
          "certified",
          "licensed",
          "accredited",
          "registered",
          "aws certified",
          "pmp",
          "scrum master",
          "cissp",
          "professional certificate",
          "industry certification",
        ],
        getValue: (term) => {
          const certs = this.userDetails.certifications || [];
          return certs.some((cert) =>
            cert.toLowerCase().includes(term.toLowerCase())
          );
        },
      },
    },
    certifications: {
      patterns: {
        professional: {
          regex:
            /\b(?:professional|industry).+?(?:certification|certificate|credential)\b/i,
          context: "professional_certs",
        },
        technical: {
          regex:
            /\b(?:technical|software|programming).+?(?:certification|certificate)\b/i,
          context: "technical_certs",
        },
        validity: {
          regex:
            /\b(?:valid|current|active|expired).+?(?:certification|certificate)\b/i,
          context: "cert_status",
        },
        specific: {
          regex:
            /\b(?:have|got|earned|received).+?(certification|certificate).+?(?:in|for|from)\s+([^?.,]+)/i,
          context: "specific_cert",
        },
      },
      extract: (match, captured) => {
        const certs = this.userDetails.certifications || [];
        const extractors = {
          professional: () =>
            certs
              .filter(
                (cert) =>
                  !cert.toLowerCase().includes("programming") &&
                  !cert.toLowerCase().includes("software")
              )
              .join(", ") || "None",
          technical: () =>
            certs
              .filter(
                (cert) =>
                  cert.toLowerCase().includes("programming") ||
                  cert.toLowerCase().includes("software")
              )
              .join(", ") || "None",
          validity: () => "Active", // Default to active unless specified
          specific: (cert) => {
            if (!cert) return "None";
            return certs.some((c) =>
              c.toLowerCase().includes(cert.toLowerCase())
            )
              ? "Yes"
              : "No";
          },
        };
        return extractors[match]?.(captured) || "None";
      },
    },

    languages: {
      patterns: {
        english: {
          regex: /\b(?:english|language).+?(?:proficiency|level|fluency)\b/i,
          context: "english_proficiency",
        },
        otherLanguages: {
          regex: /\b(?:other|additional|foreign).+?(?:language|tongue)\b/i,
          context: "other_languages",
        },
        specific: {
          regex: /\b(?:speak|know|understand)\s+([^?.,]+)/i,
          context: "specific_language",
        },
        written: {
          regex: /\b(?:written|write|reading).+?(?:language|communication)\b/i,
          context: "written_proficiency",
        },
        verbal: {
          regex:
            /\b(?:verbal|spoken|speaking|oral).+?(?:language|communication)\b/i,
          context: "verbal_proficiency",
        },
      },
      extract: (match, captured) => {
        const extractors = {
          english: () => {
            const proficiency =
              this.userDetails.languageProficiency?.english.toLowerCase();
            const proficiencyMap = {
              none: "None",
              conversational: "Conversational",
              professional: "Professional",
              bilingual: "Native or bilingual",
            };

            return proficiencyMap[proficiency] || "Professional";
          },
          otherLanguages: () => {
            const languages = Object.entries(
              this.userDetails.languageProficiency || {}
            )
              .filter(([lang]) => lang.toLowerCase() !== "english")
              .map(([lang, level]) => `${lang} (${level})`)
              .join(", ");
            return languages || "Professional";
            // return languages || 'None';
          },
          specific: (language) => {
            if (!language) return "No";
            const proficiency =
              this.userDetails.languageProficiency?.[language.toLowerCase()];
            return proficiency ? `Yes (${proficiency})` : "No";
          },
          written: () =>
            this.userDetails.languageProficiency?.english || "Professional",
          verbal: () =>
            this.userDetails.languageProficiency?.english || "Professional",
        };
        return extractors[match]?.(captured) || null;
      },
    },

    projects: {
      patterns: {
        recent: {
          regex:
            /\b(?:recent|latest|current).+?(?:project|work|development)\b/i,
          context: "recent_projects",
        },
        specific: {
          regex: /\b(?:project|work).+?(?:using|with|in)\s+([^?.,]+)/i,
          context: "specific_project",
        },
        role: {
          regex:
            /\b(?:role|responsibility|contribution).+?(?:project|development)\b/i,
          context: "project_role",
        },
        teamSize: {
          regex: /\b(?:team|group|people).+?(?:size|members|count)\b/i,
          context: "team_size",
        },
        duration: {
          regex:
            /\b(?:how\s+long|duration|time\s+spent).+?(?:project|development)\b/i,
          context: "project_duration",
        },
      },
      extract: (match, captured) => {
        const projects = this.userDetails.projects || [];
        const extractors = {
          recent: () => {
            const project = projects[0];
            return project
              ? `${project.name} - ${project.description}`
              : "No recent projects";
          },
          specific: (technology) => {
            if (!technology) return "None";
            const relevant = projects.filter((p) =>
              p.technologies?.some((tech) =>
                tech.toLowerCase().includes(technology.toLowerCase())
              )
            );
            return relevant.length
              ? relevant.map((p) => p.name).join(", ")
              : "None";
          },
          role: () => {
            const positions = this.userDetails.fullPositions || [];
            return positions[0]?.responsibilities?.[0] || "Developer";
          },
          teamSize: () => "3-5 members", // Default unless specified
          duration: () => "3-6 months", // Default unless specified
        };
        return extractors[match]?.(captured) || null;
      },
    },

    references: {
      patterns: {
        availability: {
          regex:
            /\b(?:reference|referral|recommendation).+?(?:available|provide|give)\b/i,
          context: "ref_availability",
        },
        professional: {
          regex: /\b(?:professional|work|job).+?(?:reference|referral)\b/i,
          context: "prof_references",
        },
        academic: {
          regex: /\b(?:academic|school|university).+?(?:reference|referral)\b/i,
          context: "acad_references",
        },
        contact: {
          regex: /\b(?:reference|referee).+?(?:contact|details|information)\b/i,
          context: "ref_contact",
        },
      },
      extract: (match) => {
        const extractors = {
          availability: () => "Available upon request",
          professional: () => "Available upon request",
          academic: () => "Available upon request",
          contact: () => "Will be provided when needed",
        };
        return extractors[match]?.() || null;
      },
    },
  };

  async getAnswer(question, options = []) {
    try {
      // 1. Cache check
      const cacheKey = this.getCacheKey(question, options);
      if (this.cache.has(cacheKey)) {
        return this.cache.get(cacheKey);
      }

      // 2. Initial question processing
      const processedQuestion = this.processQuestion(question);

      // 3. Try pattern matching
      const patternMatch = this.matchPattern(processedQuestion);
      if (patternMatch) {
        this.cache.set(cacheKey, patternMatch);
        return patternMatch;
      }

      // 4. Try semantic matching if there are options
      if (options.length > 0) {
        const semanticMatch = this.semanticOptionMatch(
          processedQuestion,
          options
        );
        if (semanticMatch) {
          this.cache.set(cacheKey, semanticMatch);
          return semanticMatch;
        }
      }

      // 5. If no match found, use AI
      const aiAnswer = await this.getAIAnswer(question, options);
      this.cache.set(cacheKey, aiAnswer);
      return aiAnswer;
      // return options.length > 0 ? options[0] : "";
    } catch (error) {
      // console.error('Error in getAnswer:', error);
      return options.length > 0 ? options[0] : "";
    }
  }

  processQuestion(question) {
    return {
      original: question,
      normalized: question.toLowerCase().trim(),
      words: question.toLowerCase().split(/\W+/).filter(Boolean),
      type: this.detectQuestionType(question),
    };
  }

  matchPattern(processedQuestion) {
    // Try each pattern category
    for (const [category, categoryData] of Object.entries(this.patterns)) {
      if (category === "semanticGroups") continue;

      // Check each pattern in the category
      for (const [patternKey, patternData] of Object.entries(
        categoryData.patterns
      )) {
        const match = processedQuestion.normalized.match(patternData.regex);

        if (match) {
          // Get captured group if any
          const captured = match[1];
          const context = patternData.context;

          // Use the category's extract function
          const answer = categoryData.extract(patternKey, captured, context);
          if (answer !== null) {
            return answer;
          }
        }
      }
    }
    return null;
  }

  semanticOptionMatch(processedQuestion, options) {
    const scores = options.map((option) => ({
      option,
      score: this.calculateSemanticScore(processedQuestion, option),
    }));

    // Sort by score descending
    scores.sort((a, b) => b.score - a.score);

    // Return best match if score is above threshold
    return scores[0].score > 0.3 ? scores[0].option : null;
  }

  calculateSemanticScore(processedQuestion, option) {
    let score = 0;

    // 1. Direct word match
    const optionWords = option.toLowerCase().split(/\W+/).filter(Boolean);
    const wordMatchScore =
      optionWords.reduce((sum, word) => {
        return sum + (processedQuestion.words.includes(word) ? 1 : 0);
      }, 0) / Math.max(optionWords.length, processedQuestion.words.length);
    score += wordMatchScore;

    // 2. Semantic group match
    for (const group of Object.values(this.patterns.semanticGroups)) {
      const hasMatchingTerm = group.terms.some((term) =>
        processedQuestion.normalized.includes(term.toLowerCase())
      );
      if (hasMatchingTerm) {
        const termMatch = group.getValue(option);
        if (termMatch) score += 0.5;
      }
    }

    // 3. Context match
    const contextScore = this.getContextMatchScore(processedQuestion, option);
    score += contextScore;

    return score;
  }

  getContextMatchScore(processedQuestion, option) {
    let score = 0;
    const context = {
      summary: this.userDetails.summary || "",
      headline: this.userDetails.headline || "",
      experience: parseInt(this.userDetails.yearsOfExperience) || 0,
    };

    // Check if option appears in user's profile context
    if (context.summary.toLowerCase().includes(option.toLowerCase()))
      score += 0.3;
    if (context.headline.toLowerCase().includes(option.toLowerCase()))
      score += 0.3;

    // Check experience level matching
    if (this.matchesExperienceLevel(option, context.experience)) score += 0.2;

    return score;
  }

  matchesExperienceLevel(option, years) {
    const levelMatches = {
      entry: years <= 2,
      junior: years <= 2,
      mid: years > 2 && years <= 5,
      senior: years > 5,
      expert: years > 8,
    };

    return Object.entries(levelMatches).some(
      ([level, matches]) => option.toLowerCase().includes(level) && matches
    );
  }

  detectQuestionType(question) {
    // Map categories to their main keywords
    const categoryKeywords = {
      personalInfo: ["name", "email", "phone", "address"],
      experience: ["experience", "work", "job", "role", "position"],
      education: ["education", "degree", "school", "university", "study"],
      skills: ["skill", "technology", "tool", "programming", "software"],
      availability: ["available", "start", "join", "notice"],
      workAuthorization: ["visa", "sponsor", "authorize", "permit"],
      compensation: ["salary", "compensation", "pay", "package"],
      languages: ["language", "speak", "fluent", "proficiency"],
      projects: ["project", "portfolio", "develop", "build"],
      references: ["reference", "recommendation", "referral"],
    };

    // Find the category with the most keyword matches
    let bestMatch = {
      category: "general",
      matches: 0,
    };

    const questionLower = question.toLowerCase();
    for (const [category, keywords] of Object.entries(categoryKeywords)) {
      const matches = keywords.filter((keyword) =>
        questionLower.includes(keyword)
      ).length;

      if (matches > bestMatch.matches) {
        bestMatch = { category, matches };
      }
    }

    return bestMatch.category;
  }

  async getAIAnswer(question, options) {
    try {
      const response = await fetch("http://localhost:3000/api/ai-answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          options,
          userData: this.userDetails,
          context: {
            questionType: this.detectQuestionType(question),
            matchAttempted: true,
            userProfile: {
              summary: this.userDetails.summary,
              experience: this.userDetails.yearsOfExperience,
              skills: this.userDetails.headline,
            },
          },
        }),
      });
      if (!response.ok) throw new Error("AI service error");
      const data = await response.json();
      return data.answer;
    } catch (error) {
      console.error("AI Answer Error:", error);
      return options.length > 0 ? options[0] : "";
    }
  }

  getCacheKey(question, options) {
    return `${question.toLowerCase().trim()}|${options.join(",")}`;
  }

  // 1. Experience Analysis
  findSpecificExperience(skill) {
    if (!skill) return "0";

    try {
      const positions = this.userDetails.fullPositions || [];

      // First, check exact role matches
      const exactMatch = positions.find(
        (pos) => pos.role?.toLowerCase() === skill.toLowerCase()
      );
      if (exactMatch) {
        return this.formatDuration(exactMatch.duration);
      }

      // Check for partial matches in roles and responsibilities
      const relevantPosition = positions.find((pos) => {
        const roleMatch = pos.role?.toLowerCase().includes(skill.toLowerCase());
        const respMatch = pos.responsibilities?.some((r) =>
          r.toLowerCase().includes(skill.toLowerCase())
        );
        return roleMatch || respMatch;
      });

      if (relevantPosition) {
        return this.formatDuration(relevantPosition.duration);
      }

      // Check headline and summary for skill mentions
      const profileMention = [
        this.userDetails.headline,
        this.userDetails.summary,
      ].some((text) => text?.toLowerCase().includes(skill.toLowerCase()));

      if (profileMention) {
        return this.userDetails.yearsOfExperience || "1";
      }

      return "0";
    } catch (error) {
      console.error("Error finding specific experience:", error);
      return "0";
    }
  }

  // 2. Duration Formatting
  formatDuration(duration) {
    if (!duration) return "0";
    try {
      const months = Math.abs(parseInt(duration));
      if (isNaN(months)) return "0";

      const years = Math.floor(months / 12);
      const remainingMonths = months % 12;

      const yearStr = years > 0 ? `${years} year${years > 1 ? "s" : ""}` : "";
      const monthStr =
        remainingMonths > 0
          ? `${remainingMonths} month${remainingMonths > 1 ? "s" : ""}`
          : "";

      if (yearStr && monthStr) return `${yearStr}, ${monthStr}`;
      return yearStr || monthStr || "0";
    } catch (error) {
      console.error("Error formatting duration:", error);
      return "0";
    }
  }

  // 3. Answer Sanitization
  sanitizeAnswer(answer) {
    if (answer === null || answer === undefined) return null;

    try {
      // Handle different types
      if (typeof answer === "boolean") {
        return answer ? "Yes" : "No";
      }

      if (typeof answer === "number") {
        return answer.toString();
      }

      if (Array.isArray(answer)) {
        return answer.filter(Boolean).join(", ") || null;
      }

      // String processing
      const sanitized = answer
        .toString()
        .trim()
        .replace(/\s+/g, " ")
        .replace(/^\s*-\s*/, "")
        .replace(/\s*\.$/, "");

      return sanitized || null;
    } catch (error) {
      console.error("Error sanitizing answer:", error);
      return null;
    }
  }

  // 4. User Details Validation
  validateUserDetails() {
    const validation = {
      valid: true,
      warnings: [],
      errors: [],
    };

    // Required fields
    const required = ["firstName", "lastName", "email"];
    const missing = required.filter((field) => !this.userDetails[field]);
    if (missing.length) {
      validation.errors.push(`Missing required fields: ${missing.join(", ")}`);
      validation.valid = false;
    }

    // Format validations
    if (this.userDetails.email && !this.isValidEmail(this.userDetails.email)) {
      validation.errors.push("Invalid email format");
      validation.valid = false;
    }

    // Warning checks
    if (!this.userDetails.summary) {
      validation.warnings.push("Missing professional summary");
    }

    if (!this.userDetails.fullPositions?.length) {
      validation.warnings.push("No work experience listed");
    }

    if (parseInt(this.userDetails.yearsOfExperience) === 0) {
      validation.warnings.push("Years of experience is 0");
    }

    return validation;
  }

  // 5. Helper Methods
  isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  processExperienceData() {
    try {
      const positions = this.userDetails.fullPositions || [];
      return positions.map((pos) => ({
        ...pos,
        formattedDuration: this.formatDuration(pos.duration),
        skills: this.extractSkillsFromPosition(pos),
      }));
    } catch (error) {
      console.error("Error processing experience data:", error);
      return [];
    }
  }

  extractSkillsFromPosition(position) {
    const skillSet = new Set();

    // Extract skills from role title
    const roleWords = position.role?.split(/\W+/) || [];
    roleWords.forEach((word) => {
      if (this.isLikelySkill(word)) {
        skillSet.add(word);
      }
    });

    // Extract from responsibilities
    position.responsibilities?.forEach((resp) => {
      const words = resp.split(/\W+/);
      words.forEach((word) => {
        if (this.isLikelySkill(word)) {
          skillSet.add(word);
        }
      });
    });

    return Array.from(skillSet);
  }

  isLikelySkill(word) {
    const commonSkills = new Set([
      "react",
      "javascript",
      "python",
      "java",
      "node",
      "sql",
      "aws",
      "azure",
      "docker",
      "kubernetes",
      "git",
      "agile",
      "typescript",
      "angular",
      "vue",
      "express",
      "mongodb",
    ]);

    return (
      commonSkills.has(word.toLowerCase()) ||
      /^[A-Z][a-z]*(?:\.[A-Z][a-z]*)*$/.test(word)
    ); // CamelCase
  }

  // 6. Enhanced Pattern Matching
  enhancePatternMatch(match, context) {
    try {
      const baseAnswer = this.sanitizeAnswer(match);
      if (!baseAnswer) return null;

      // // Add context-aware prefixes
      // if (context.includes('duration') || context.includes('experience')) {
      //   return this.addExperiencePrefix(baseAnswer);
      // }

      // if (context.includes('proficiency') || context.includes('skill')) {
      //   return this.addProficiencyPrefix(baseAnswer);
      // }

      return baseAnswer;
    } catch (error) {
      console.error("Error enhancing pattern match:", error);
      return match;
    }
  }

  addExperiencePrefix(answer) {
    const prefixes = [
      "I have",
      "My experience includes",
      "I have accumulated",
      "I've gained",
    ];
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    return `${prefix} ${answer}`;
  }

  addProficiencyPrefix(answer) {
    const prefixes = [
      "My proficiency is",
      "I am",
      "I would rate myself as",
      "I consider myself",
    ];
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    return `${prefix} ${answer}`;
  }

  // 7. Update the matchPattern method to use new features
  matchPattern(processedQuestion) {
    for (const [category, categoryData] of Object.entries(this.patterns)) {
      if (category === "semanticGroups") continue;

      for (const [patternKey, patternData] of Object.entries(
        categoryData.patterns
      )) {
        const match = processedQuestion.normalized.match(patternData.regex);

        if (match) {
          const captured = match[1];
          const context = patternData.context;

          try {
            const rawAnswer = categoryData.extract(
              patternKey,
              captured,
              context
            );
            if (rawAnswer !== null) {
              const sanitized = this.sanitizeAnswer(rawAnswer);
              return this.enhancePatternMatch(sanitized, context);
            }
          } catch (error) {
            console.error(`Error in pattern matching for ${category}:`, error);
            continue;
          }
        }
      }
    }
    return null;
  }
}

class StateManager {
  constructor() {
    this.storageKey = "linkedInJobApplyState";
  }

  async saveState(state) {
    try {
      await chrome.storage.local.set({
        [this.storageKey]: state,
      });
    } catch (error) {
      throw new Error("Error saving state:", error);
    }
  }

  async getState() {
    try {
      const result = await chrome.storage.local.get([this.storageKey]);
      return result[this.storageKey] || null;
    } catch (error) {
      throw new Error("Error getting state:", error);
    }
  }

  async updateState(partialState) {
    try {
      const currentState = (await this.getState()) || {};
      const newState = { ...currentState, ...partialState };
      await this.saveState(newState);
      return newState;
    } catch (error) {
      throw new Error("Failed to start job search", error);
    }
  }

  async clearState() {
    try {
      await chrome.storage.local.remove(this.storageKey);
      console.log("State cleared successfully");
    } catch (error) {
      throw error;
    }
  }
}

class LinkedInJobApply {
  PLAN_LIMITS = {
    FREE: 5,
    PRO: 50,
    UNLIMITED: Infinity,
  };

  constructor() {
    this.stateManager = new StateManager();
    this.HOST = "https://fastapply-adbs.vercel.app";
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
      // throw error;
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
          return true;

        case "processJobs":
          this.processJobs({
            jobsToApply: request.jobsToApply || 10, // Default to 10 if not specified
          })
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
        return false;
      }

      await this.clickJobCard(jobCard);
      await this.waitForJobDetailsLoad();

      const jobDetails = await this.getJobProperties();

      const applyButton = await this.findEasyApplyButton();
      if (!applyButton) {
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

  async processJobs({ jobsToApply }) {
    let appliedJobs = 0;
    let processedJobs = new Set();

    try {
      const state = await this.stateManager.getState();
      if (!state || !state.userId) {
        return;
        // throw new Error("No user state found. Please restart the job search.");
      }

      await this.waitForSearchResultsLoad();

      // Continue until we hit the jobsToApply limit or run out of jobs
      while (appliedJobs < jobsToApply) {
        const jobCards = await this.getJobCards();
        let newJobsFound = false;

        for (const jobCard of jobCards) {
          // Stop if we've hit our target
          if (appliedJobs >= jobsToApply) {
            break;
          }

          const jobId = this.getJobIdFromCard(jobCard);
          if (!jobId || processedJobs.has(jobId)) {
            continue; // Skip if already processed or invalid
          }
          processedJobs.add(jobId);
          newJobsFound = true;

          try {
            const success = await this.processJobCard(jobCard, state);
            if (success) {
              appliedJobs++;
            }
          } catch (error) {
            continue; // Continue with next job even if this one fails
          }

          await this.sleep(3000);
        }

        // Break if we've hit our target or can't find more jobs
        if (
          appliedJobs >= jobsToApply ||
          !newJobsFound ||
          !(await this.scrollAndWaitForNewJobs())
        ) {
          break;
        }
      }
    } catch (error) {
      console.error("Error in processJobs:", error);
    }

    // const message = `Finished processing jobs. Applied to ${appliedJobs}/${jobsToApply} jobs`;

    this.sendStatusUpdate("success", message);
    return { status: "completed", message };
  }

  async waitForSearchResultsLoad() {
    await this.waitForElement(".jobs-search-results-list");
  }

  async getJobCards() {
    const jobCards = document.querySelectorAll(
      ".jobs-search-results__list-item"
    );
    // console.log(`Found ${jobCards.length} job cards`);
    return jobCards;
  }

  async clickJobCard(jobCard) {
    try {
      const clickableElement = jobCard.querySelector(
        "a[href*='jobs/view'], .job-card-list__title, .job-card-container__link"
      );

      if (!clickableElement) {
        throw new Error("No clickable element found in job card");
      }

      // Create and dispatch a MouseEvent instead of using click()
      const clickEvent = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
      });

      // Prevent default to avoid link navigation
      clickEvent.preventDefault();
      clickableElement.dispatchEvent(clickEvent);

      await this.waitForJobDetailsLoad();
    } catch (error) {
      console.error("Error clicking job card:", error);
      // throw error;
    }
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
      await this.checkUserRole(userId);

      const state = await this.stateManager.getState();
      if (!this.canApplyMore(state)) {
        const remaining = this.getRemainingApplications(state);
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

      const searchUrl = await this.generateComprehensiveSearchUrl(
        state.preferences
      );

      return {
        status: "ready",
        url: searchUrl,
        userId: userId,
      };
    } catch (error) {
      this.sendStatusUpdate(
        "error",
        "Error starting job search: " + error.message
      );
      // throw error;
    }
  }

  async generateComprehensiveSearchUrl(preferences) {
    const baseUrl = "https://www.linkedin.com/jobs/search/?";

    const joinWithOR = (arr) => (arr ? arr.join(" OR ") : "");

    const params = new URLSearchParams({
      f_AL: "true",
    });

    const titleMap = {
      Writer: "101",
      "Technical Writer": "206",
      "Lead Technical Writer": "6882",
      "Senior Technical Writer": "749",

      "Software Engineer": "9",
      "Back End Developer": "25194",
      "Full Stack Engineer": "25201",
      "Python Developer": "25169",
      "Senior Software Engineer": "39",
      "Frontend Developer": "3172",
      "Solutions Developer": "2850",
      "Javascript Developer": "25170",
      "Artificial Intelligence Engineer": "30128",

      "User Experience Designer": "3114",
      "User Experience Engineer": "16045",
      "User Interface Designer": "1861",
      "Senior User Interface Designer": "6630",
      "Product Designer": "977",
      "Senior Product Designer": "7797",
      "Senior User Experience Designer": "10331",
    };

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
        params.append("f_AL", true);
      } else if (geoIdMap[preferences.location]) {
        params.append("geoId", geoIdMap[preferences.location]);
      } else {
        params.append("location", preferences.location);
      }
    }

    // Handle Work Mode (Remote/Hybrid/On-site)
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

    console.log({
      title,
      jobId,
      company,
      location,
      postedDate,
      applications,
      workplace,
    });
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

  async handleFileUpload(container) {
    try {
      const fileInput = container.querySelector('input[type="file"]');
      if (!fileInput) {
        return;
      }

      const labelText =
        container.querySelector("label span")?.textContent.toLowerCase() || "";

      const userDetails = await this.getUserDetails();
      if (!userDetails) {
        return;
      }

      let fileUrl;
      if (labelText.includes("resume") || labelText.includes("cv")) {
        fileUrl = userDetails.resumeUrl;
      } else if (labelText.includes("cover letter")) {
        fileUrl = userDetails.coverLetterUrl;
      }

      if (!fileUrl) {
        return;
      }

      await this.uploadFileFromURL(fileInput, fileUrl);

      // Wait for the upload to be processed
      await this.waitForUploadProcessing(container);
    } catch (error) {
      // console.error("Error handling file upload:", error);
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
    return result.userDetails;
  };

  async getAnswer(label, options = []) {
    const userDetails = await this.getUserDetails();
    const answerObject = new AdvancedJobApplicationMatcher(userDetails);
    const answer = await answerObject.getAnswer(label, options);
    return answer;
  }

  async uploadFileFromURL(fileInput, fileURL) {
    try {
      const proxyURL = `${this.HOST}/api/proxy-file?url=${encodeURIComponent(
        fileURL
      )}`;
      const response = await fetch(proxyURL);

      if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.statusText}`);
      }

      const blob = await response.blob();
      let filename = "document.pdf";

      // Get filename from Content-Disposition header
      const contentDisposition = response.headers.get("content-disposition");
      if (contentDisposition) {
        const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(
          contentDisposition
        );
        if (matches?.[1]) {
          // Remove any quotes and path information
          filename = matches[1].replace(/['"]/g, "");
        }
      }

      // Create file object with sanitized filename
      const file = new File([blob], filename, {
        type: blob.type || "application/pdf",
        lastModified: Date.now(),
      });
      if (file.size === 0) {
        throw new Error("Created file is empty");
      }

      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInput.files = dataTransfer.files;

      // Dispatch events in sequence with small delays
      await this.sleep(100);
      fileInput.dispatchEvent(new Event("focus", { bubbles: true }));
      await this.sleep(100);
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
      await this.sleep(100);
      fileInput.dispatchEvent(new Event("input", { bubbles: true }));
      await this.waitForUploadProcess(fileInput);
      return true;
    } catch (error) {
      try {
        fileInput.value = "";
      } catch (e) {
        console.error("Could not clear file input:", e);
      }
      return false;
    }
  }

  // Helper method to verify upload success
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
        saveJob: 'button[data-control-name="save_application_btn"]',
        // Add any other possible button selectors here
      };

      // Wait for any button to appear
      await this.waitForAnyElement(Object.values(buttonSelectors));

      // Check for each button in priority order
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

      // console.log("No actionable buttons found");
      return "error";
    } catch (error) {
      // console.error("Error in moveToNextStep:", error);
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

      const response = await fetch(`${this.HOST}/api/applied-jobs`, {
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
      const response = await fetch(`${this.HOST}/api/applications`, {
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
      const response = await fetch(`${this.HOST}/api/user/${userId}`);
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
      // throw error;
    }
  }

  //TODO: check if the logic here is properly checking number of applications by free or pro users

  async checkUserRole(userId) {
    try {
      const response = await fetch(`${this.HOST}/api/user/${userId}/role`);
      if (!response.ok) {
        throw new Error("Failed to fetch user role");
      }
      const data = await response.json();
      // Calculate application limit based on plan
      let applicationLimit;
      switch (data.userRole) {
        case "pro":
          applicationLimit = this.PLAN_LIMITS.PRO;
          break;
        case "unlimited":
          applicationLimit = this.PLAN_LIMITS.UNLIMITED;
          break;
        case "credit":
          applicationLimit = Math.floor(data.credits / 1);
          break;
        default:
          applicationLimit = this.PLAN_LIMITS.FREE;
      }

      await this.stateManager.updateState({
        userRole: data.userRole,
        applicationLimit,
        credits: data.credits || 0,
        subscription: data.subscription,
        applicationsUsed: data.applicationsUsed,
      });
    } catch (error) {
      // throw error;
    }
  }

  canApplyMore(state) {
    if (!state || !state.userRole) return false;

    if (state.subscription) {
      const subscriptionEnd = new Date(state.subscription.currentPeriodEnd);
      if (subscriptionEnd < new Date()) {
        return false;
      }
    }

    switch (state.userRole) {
      case "unlimited":
        return true;

      case "pro":
        return state.applicationsUsed < this.PLAN_LIMITS.PRO;

      case "credit":
        return state.credits >= 1;
      case "free":
        return state.applicationsUsed < this.PLAN_LIMITS.FREE;

      default:
        return false;
    }
  }

  getRemainingApplications(state) {
    if (!state || !state.userRole) return 0;

    switch (state.userRole) {
      case "unlimited":
        return Infinity;

      case "pro":
        return this.PLAN_LIMITS.PRO - (state.applicationsUsed || 0);

      case "credit":
        return Math.floor(state.credits / 1);

      case "free":
        return this.PLAN_LIMITS.FREE - (state.applicationsUsed || 0);

      default:
        return 0;
    }
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
