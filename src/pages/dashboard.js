import React, { useState } from "react";
import { CssVarsProvider } from "@mui/joy/styles";
import CssBaseline from "@mui/joy/CssBaseline";
import Autocomplete from "@mui/joy/Autocomplete";
import Avatar from "@mui/joy/Avatar";
import Box from "@mui/joy/Box";
import Chip from "@mui/joy/Chip";
import ChipDelete from "@mui/joy/ChipDelete";
import Typography from "@mui/joy/Typography";
import Button from "@mui/joy/Button";
import Layout from "../components/Layout";
import Header from "../components/Header";
import OrderList from "../components/OrderList";
import OrderTable from "../components/OrderTable";
import CheckRounded from "@mui/icons-material/CheckRounded";
import { Edit } from "@mui/icons-material";
import { Modal } from "@mui/joy";
import Sheet from "@mui/joy";
import { Grid, TextField, Slider, Card } from "@mui/joy";
import ModalClose from "@mui/joy/ModalClose";
export default function Dashboard() {
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [open, setOpen] = React.useState(false);

  return (
    <CssVarsProvider disableTransitionOnChange>
      <CssBaseline />
      <Modal
        aria-labelledby="modal-title"
        aria-describedby="modal-desc"
        open={open}
        onClose={() => setOpen(false)}
        sx={{ display: { xs: "block", md: "none" } }}
      >
        <SidePane />
      </Modal>
      <Layout.Root
        sx={[
          drawerOpen && {
            height: "100vh",
            overflow: "hidden",
          },
        ]}
      >
        <Layout.Header sx={{ width: "800px" }}>
          <Header />
        </Layout.Header>
        <Box
          component="main"
          className="MainContent"
          sx={{
            px: { xs: 2, md: 6, lg: 6 },
            pt: {
              xs: "calc(12px + var(--Header-height))",
              sm: "calc(12px + var(--Header-height))",
              md: 3,
            },
            pb: { xs: 2, sm: 2, md: 3 },
            flex: 1,
            display: "flex",
            flexDirection: "column",
            width: "800px",
            height: "100vh",
            gap: 1,
          }}
        >
          <Box
            sx={{
              display: "flex",
              mt:1,
              mb: 1,
              gap: 1,
              flexDirection: { xs: "column", sm: "row" },
              alignItems: { xs: "start", sm: "center" },
              flexWrap: "wrap",
              justifyContent: "space-between",
            }}
          >
            <Typography level="h3" component="h3">
              Applied Jobs
            </Typography>
            <Box
              sx={{
                width: "100%",
                display: "flex",
                justifyContent: "flex-end",
              }}
            >
              <Button
                color="primary"
                startDecorator={<CheckRounded />}
                size="sm"
                sx={{ display: { xs: "flex", md: "none" } }}
              >
                Apply Now
              </Button>
              <Button
                variant="outlined"
                onClick={() => setOpen(true)}
                color="primary"
                startDecorator={<Edit />}
                size="sm"
                sx={{ ml: 1,display: { xs: "flex", md: "none" } }}
              >
                Edit Preferences
              </Button>
            </Box>
          </Box>
          <OrderTable />
          <OrderList />
        </Box>
        {/* </Layout.Main> */}
      </Layout.Root>
    </CssVarsProvider>
  );
}

function SidePane() {
  // Form state
  const [formData, setFormData] = useState({
    positions: "",
    location: "",
    salary: 6000,
    experience: "",
    jobType: "",
    workMode: "",
    industry: "",
    company: "",
    datePosted: "",
  });

  // Form validation state
  const [errors, setErrors] = useState({});

  const handleSubmit = () => {
    let validationErrors = {};
    if (!formData.positions)
      validationErrors.positions = "Position is required";
    if (!formData.location) validationErrors.location = "Location is required";
    if (!formData.experience)
      validationErrors.experience = "Experience level is required";
    if (!formData.jobType) validationErrors.jobType = "Job type is required";

    setErrors(validationErrors);
    if (Object.keys(validationErrors).length === 0) {
      console.log("Form submitted successfully", formData);
    }
  };

  return (
    <>
      <Box sx={{ p: 2, width: "500px", margin: "auto" }}>
        <ModalClose />
        <Typography level="h5">Job Filters</Typography>
        <Card sx={{ p: 3 }}>
          <Grid container spacing={2}>
            {/* First row */}
            <Grid display={"flex"} flexDirection={"row"} sx={{ padding: 2, }}>
              <Grid item xs={12} md={6} sx={{ padding: 1 }}>
                <Typography>Positions</Typography>
                <Autocomplete
                  size="small"
                  options={["Frontend Engineer", "Backend Engineer", "Product Manager"]}
                  onChange={(event, value) => setFormData({ ...formData, positions: value || "" })}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      error={!!errors.positions}
                      helperText={errors.positions}
                      placeholder="Select Position"
                      sx={{ }}
                    />
                  )}
                />
              </Grid>
  
              <Grid item xs={12} md={6} sx={{ padding: 1 }}>
                <Typography>Location</Typography>
                <Autocomplete
                  size="small"
                  options={["Remote", "Bangkok", "Chiang Mai", "Chonburi", "Other Cities"]}
                  onChange={(event, value) => setFormData({ ...formData, location: value || "" })}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      error={!!errors.location}
                      helperText={errors.location}
                      placeholder="Country, City"
                      sx={{ }}
                    />
                  )}
                />
              </Grid>
            </Grid>
  
            {/* Second row */}
            <Grid display={"flex"} flexDirection={"row"} sx={{ padding: 2, }}>
              <Grid item xs={12} md={6} sx={{ padding: 1 }}>
                <Typography>Experience Level</Typography>
                <Autocomplete
                  size="small"
                  options={["Entry Level", "Mid-Senior Level", "Director", "Executive"]}
                  onChange={(event, value) => setFormData({ ...formData, experience: value || "" })}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      error={!!errors.experience}
                      helperText={errors.experience}
                      placeholder="Select Experience Level"
                      sx={{ }}
                    />
                  )}
                />
              </Grid>
  
              <Grid item xs={12} md={6} sx={{ padding: 1 }}>
                <Typography>Job Type</Typography>
                <Autocomplete
                  size="small"
                  options={["Full-time", "Part-time", "Contract", "Temporary", "Internship", "Volunteer"]}
                  onChange={(event, value) => setFormData({ ...formData, jobType: value || "" })}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      error={!!errors.jobType}
                      helperText={errors.jobType}
                      placeholder="Select Job Type"
                      sx={{ }}
                    />
                  )}
                />
              </Grid>
            </Grid>
  
            {/* Third row */}
            <Grid display={"flex"} flexDirection={"row"} sx={{ padding: 2, }}>
              <Grid item xs={12} md={6} sx={{ padding: 1 }}>
                <Typography>Work Mode</Typography>
                <Autocomplete
                  size="small"
                  options={["Remote", "Hybrid", "On-Site"]}
                  onChange={(event, value) => setFormData({ ...formData, workMode: value || "" })}
                  renderInput={(params) => (
                    <TextField {...params} placeholder="Select Work Mode" sx={{ }} />
                  )}
                />
              </Grid>
  
              <Grid item xs={12} md={6} sx={{ padding: 1 }}>
                <Typography>Industry</Typography>
                <Autocomplete
                  size="small"
                  options={["Technology", "Finance", "Healthcare", "Education", "Manufacturing"]}
                  onChange={(event, value) => setFormData({ ...formData, industry: value || "" })}
                  renderInput={(params) => (
                    <TextField {...params} placeholder="Select Industry" sx={{ }} />
                  )}
                />
              </Grid>
            </Grid>
  
            {/* Fourth row */}
            <Grid display={"flex"} flexDirection={"row"} sx={{ padding: 2 }}>
              <Grid item xs={12} md={6} sx={{ padding: 1 }}>
                <Typography>Company</Typography>
                <Autocomplete
                  size="small"
                  options={["Google", "Microsoft", "Amazon", "Facebook"]}
                  onChange={(event, value) => setFormData({ ...formData, company: value || "" })}
                  renderInput={(params) => (
                    <TextField {...params} placeholder="Search for Company" sx={{ }} />
                  )}
                />
              </Grid>
  
              <Grid item xs={12} md={6} sx={{ padding: 1 }}>
                <Typography>Date Posted</Typography>
                <Autocomplete
                  size="small"
                  options={["Past 24 hours", "Past week", "Past month"]}
                  onChange={(event, value) => setFormData({ ...formData, datePosted: value || "" })}
                  renderInput={(params) => (
                    <TextField {...params} placeholder="Sort by Date Posted" sx={{ }} />
                  )}
                />
              </Grid>
            </Grid>
          </Grid>
  
          <Box sx={{ mt: 2 }}>
            <Typography>Salary</Typography>
            <Slider
              size="small"
              value={formData.salary}
              onChange={(event, newValue) => setFormData({ ...formData, salary: newValue })}
              min={2000}
              max={500000}
              step={1000}
              valueLabelDisplay="on"
              valueLabelFormat={(value) => `$${value.toLocaleString()}`}
            />
          </Box>
          <Button>Apply Filters</Button>
        </Card>
      </Box>
    </>
  );
  
}
