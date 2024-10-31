import React, { useState } from "react";
import AspectRatio from "@mui/joy/AspectRatio";
import Box from "@mui/joy/Box";
import Button from "@mui/joy/Button";
import Divider from "@mui/joy/Divider";
import FormControl from "@mui/joy/FormControl";
import FormLabel from "@mui/joy/FormLabel";
import FormHelperText from "@mui/joy/FormHelperText";
import Input from "@mui/joy/Input";
import IconButton from "@mui/joy/IconButton";
import Textarea from "@mui/joy/Textarea";
import Stack from "@mui/joy/Stack";
import Select from "@mui/joy/Select";
import Option from "@mui/joy/Option";
import Typography from "@mui/joy/Typography";
import Tabs from "@mui/joy/Tabs";
import TabList from "@mui/joy/TabList";
import Tab, { tabClasses } from "@mui/joy/Tab";
import Breadcrumbs from "@mui/joy/Breadcrumbs";
import Card from "@mui/joy/Card";
import CardActions from "@mui/joy/CardActions";
import CardOverflow from "@mui/joy/CardOverflow";
import { CssVarsProvider } from "@mui/joy/styles";
import CssBaseline from "@mui/joy/CssBaseline";
import HomeRoundedIcon from "@mui/icons-material/HomeRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import EmailRoundedIcon from "@mui/icons-material/EmailRounded";
import AccessTimeFilledRoundedIcon from "@mui/icons-material/AccessTimeFilledRounded";
import VideocamRoundedIcon from "@mui/icons-material/VideocamRounded";
import InsertDriveFileRoundedIcon from "@mui/icons-material/InsertDriveFileRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import DropZone from "../components/DropZone";
import FileUpload from "../components/FileUpload";
import CountrySelector from "../components/CountrySelector";
import EditorToolbar from "../components/EditorToolbar";
import Layout from "../components/Layout";
import Header from "../components/Header";
import PeopleAltRoundedIcon from "@mui/icons-material/PeopleAltRounded";
import FolderRoundedIcon from "@mui/icons-material/FolderRounded";
import { CreditCard, Edit2, CheckCircle, AlertCircle } from "lucide-react";
import { Grid, Chip, Alert } from "@mui/joy";
import { useFormik } from "formik";
import * as Yup from "yup";

const validationSchema = Yup.object({
  firstName: Yup.string().required("First name is required"),
  lastName: Yup.string().required("Last name is required"),
  middleName: Yup.string(),
  email: Yup.string()
    .email("Invalid email address")
    .required("Email is required"),
  phoneNumber: Yup.string().required("Phone number is required"),
  country: Yup.string().required("Country is required"),
  currentCity: Yup.string().required("Current city is required"),
  isProtectedVeteran: Yup.boolean().required("This field is required"),
  hasDisability: Yup.boolean().required("This field is required"),
  requiresH1BSponsorship: Yup.boolean().required("This field is required"),
  gender: Yup.string().required("Gender is required"),
  race: Yup.string().required("Race is required"),
  coverLetter: Yup.string().max(
    1000,
    "Cover letter must be 1000 characters or less"
  ),
});

export default function Settings() {
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  return (
    <CssVarsProvider disableTransitionOnChange>
      <CssBaseline />
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

        <Box sx={{ width: "800px" }}>
          <SettingsPage />
        </Box>
      </Layout.Root>
    </CssVarsProvider>
  );
}

const BillingPage = () => {
  const [isEditing, setIsEditing] = useState(false);
  const [showAlert, setShowAlert] = useState(false);

  const handleEditClick = () => {
    setIsEditing(!isEditing);
  };

  const handleSaveCard = () => {
    setIsEditing(false);
    setShowAlert(true);
    setTimeout(() => setShowAlert(false), 3000);
  };

  return (
    <Stack spacing={4} sx={{ maxWidth: "800px", mx: "auto", width: "100%" }}>
      {showAlert && (
        <Alert
          variant="soft"
          color="success"
          sx={{ mb: 2, fontSize: "0.875rem" }}
          startDecorator={<CheckCircle />}
        >
          Your card information has been updated successfully.
        </Alert>
      )}

      {/* Payment Card Section */}
      <Card>
        <Typography level="h4" sx={{ mb: 2, fontSize: "1.25rem" }}>
          Payment Card
        </Typography>
        {!isEditing ? (
          <Box
            sx={{
              bgcolor: "primary.softBg",
              borderRadius: "md",
              p: 3,
              mb: 2,
              position: "relative",
              overflow: "hidden",
              "&::before": {
                content: '""',
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: "linear-gradient(45deg, #8897a6 0%, #555e68 100%)",
                opacity: 0.8,
              },
            }}
          >
            <Box
              sx={{
                position: "absolute",
                top: 16,
                left: 16,
                width: 50,
                height: 35,
                bgcolor: "warning.300",
                borderRadius: "sm",
              }}
            />
            <Typography
              level="h5"
              sx={{
                position: "absolute",
                top: 16,
                right: 16,
                color: "white",
                fontSize: "1rem",
              }}
            >
              VISA
            </Typography>
            <Typography
              level="h3"
              sx={{
                mt: 5,
                mb: 4,
                color: "white",
                textAlign: "center",
                letterSpacing: 4,
                fontSize: "1.5rem",
              }}
            >
              **** **** **** 1234
            </Typography>
            <Grid container spacing={2} sx={{ color: "white" }}>
              <Grid xs={6}>
                <Typography level="body3" sx={{ fontSize: "0.75rem" }}>
                  Card Holder
                </Typography>
                <Typography level="body1" sx={{ fontSize: "0.875rem" }}>
                  John Doe
                </Typography>
              </Grid>
              <Grid xs={6} sx={{ textAlign: "right" }}>
                <Typography level="body4" sx={{ fontSize: "0.75rem" }}>
                  Expires
                </Typography>
                <Typography level="body1" sx={{ fontSize: "0.875rem" }}>
                  12/25
                </Typography>
              </Grid>
            </Grid>
          </Box>
        ) : (
          <Stack spacing={2} sx={{ mb: 2 }}>
            <Input placeholder="Card Number" startDecorator={<CreditCard />} />
            <Grid container spacing={2}>
              <Grid xs={6}>
                <Input placeholder="MM / YY" />
              </Grid>
              <Grid xs={6}>
                <Input placeholder="CVC" />
              </Grid>
            </Grid>
            <Input placeholder="Name on Card" />
          </Stack>
        )}
        <Button
          variant={isEditing ? "outlined" : "outlined"}
          color={isEditing ? "success" : "primary"}
          startDecorator={isEditing ? <CheckCircle /> : <Edit2 />}
          onClick={isEditing ? handleSaveCard : handleEditClick}
          sx={{ fontSize: "0.875rem" }}
        >
          {isEditing ? "Save Card" : "Change Card"}
        </Button>
        {isEditing && (
          <Button
            variant="plain"
            color="neutral"
            onClick={() => setIsEditing(false)}
            sx={{ ml: 1, fontSize: "0.875rem" }}
          >
            Cancel
          </Button>
        )}
      </Card>

      {/* Current Subscription Section */}
      <Card>
        <Typography level="h4" sx={{ mb: 2, fontSize: "1.25rem" }}>
          Current Subscription
        </Typography>
        <Grid container spacing={2}>
          {[
            { title: "PLAN", value: "Free", action: "Change" },
            { title: "SEATS", value: "1 / 1", action: "Edit" },
            {
              title: "NEXT RENEWAL",
              value: "Mar 1, 2024",
              info: "You will receive a refill.",
            },
          ].map((item, index) => (
            <Grid key={index} xs={12} sm={4}>
              <Card variant="soft">
                <Typography level="body2" sx={{ fontSize: "0.875rem" }}>
                  {item.title}
                </Typography>
                <Typography level="h4" sx={{ my: 1, fontSize: "1.25rem" }}>
                  {item.value}
                </Typography>
                {item.action && (
                  <Button
                    size="sm"
                    variant="outlined"
                    sx={{ mt: 1, fontSize: "0.75rem" }}
                  >
                    {item.action}
                  </Button>
                )}
                {item.info && (
                  <Typography level="body2" sx={{ mt: 1, fontSize: "0.75rem" }}>
                    {item.info}
                  </Typography>
                )}
              </Card>
            </Grid>
          ))}
        </Grid>
      </Card>

      {/* Billing History Section */}
      <Card>
        <Typography level="h4" sx={{ mb: 2, fontSize: "1.25rem" }}>
          Billing History
        </Typography>
        <Box sx={{ overflowX: "auto" }}>
          <Table>
            <thead>
              <tr>
                <th>Description</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Subscription Fee</td>
                <td>$0.00</td>
                <td>
                  <Chip
                    size="sm"
                    variant="soft"
                    color="primary"
                    sx={{ fontSize: "0.75rem" }}
                  >
                    Paid
                  </Chip>
                </td>
                <td>Sep 15, 2023</td>
              </tr>
              {/* Add more rows as needed */}
            </tbody>
          </Table>
        </Box>
      </Card>
    </Stack>
  );
};

const Table = ({ children }) => (
  <Box
    component="table"
    sx={{
      width: "800px",
      borderCollapse: "separate",
      borderSpacing: "0 8px",
    }}
  >
    {children}
  </Box>
);

const SettingsPage = () => {
  const [activeTab, setActiveTab] = useState(0);

  return (
    <Box sx={{ width: "800px" }}>
      <Box
        sx={{
          position: "sticky",
          top: { sm: -100, md: -110 },
          bgcolor: "background.body",
        }}
      >
        <Box sx={{ px: { xs: 2, md: 6 } }}></Box>
        <Tabs
          value={activeTab}
          onChange={(event, newValue) => setActiveTab(newValue)}
          sx={{ bgcolor: "transparent" }}
        >
          <TabList
            tabFlex={1}
            size="sm"
            sx={{
              pl: { xs: 0, md: 4 },
              justifyContent: "left",
              [`&& .${tabClasses.root}`]: {
                fontWeight: "600",
                flex: "initial",
                color: "text.tertiary",
                [`&.${tabClasses.selected}`]: {
                  bgcolor: "transparent",
                  color: "text.primary",
                  "&::after": {
                    height: "2px",
                    bgcolor: "primary.500",
                  },
                },
              },
            }}
          >
            <Tab sx={{ borderRadius: "6px 6px 0 0" }} indicatorInset value={0}>
              Settings
            </Tab>
            <Tab sx={{ borderRadius: "6px 6px 0 0" }} indicatorInset value={1}>
              Billing
            </Tab>
          </TabList>
        </Tabs>
      </Box>
      <Box
        sx={{
          display: "flex",
          maxWidth: "800px",
          mx: "auto",
          px: { xs: 2, md: 6 },
          py: { xs: 2, md: 3 },
        }}
      >
        {activeTab === 0 ? <ProfileSettings /> : <BillingPage />}
      </Box>
    </Box>
  );
};

const ProfileSettings = () => {
  const [apiUrl] = useState("");

  const formik = useFormik({
    initialValues: {
      firstName: "",
      lastName: "",
      middleName: "",
      email: "",
      phoneNumber: "",
      country: "",
      currentCity: "",
      isProtectedVeteran: "",
      hasDisability: "",
      requiresH1BSponsorship: "",
      gender: "",
      race: "",
      coverLetter: "",
    },
    validationSchema: validationSchema,
    onSubmit: (values) => {
      // Here you would typically send the form data to your API
      console.log("Form data:", values);
      // Example API call (uncomment and adjust as needed):
      // fetch(apiUrl, {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify(values),
      // }).then(response => response.json())
      //   .then(data => console.log('Success:', data))
      //   .catch((error) => console.error('Error:', error));
    },
  });
  return (
    <form onSubmit={formik.handleSubmit}>
      <Stack
        spacing={4}
        sx={{
          display: "flex",
          width: "770px",
          mx: "auto",
          px: { xs: 2, md: 12 },
          py: { xs: 2, md: 12 },
        }}
      >
        <Card>
          <Box sx={{ mb: 1 }}>
            <Typography level="title-md">Personal Info</Typography>
            <Typography level="body-sm">
              Please provide your personal information.
            </Typography>
          </Box>
          <Divider />
          <Stack spacing={2} sx={{ my: 1 }}>
            <Stack direction="row" spacing={2}>
              <FormControl fullWidth>
                <FormLabel>First Name</FormLabel>
                <Input
                  name="firstName"
                  value={formik.values.firstName}
                  onChange={formik.handleChange}
                  error={
                    formik.touched.firstName && Boolean(formik.errors.firstName)
                  }
                  helperText={
                    formik.touched.firstName && formik.errors.firstName
                  }
                />
              </FormControl>
              <FormControl fullWidth>
                <FormLabel>Middle Name</FormLabel>
                <Input
                  name="middleName"
                  value={formik.values.middleName}
                  onChange={formik.handleChange}
                />
              </FormControl>
              <FormControl fullWidth>
                <FormLabel>Last Name</FormLabel>
                <Input
                  name="lastName"
                  value={formik.values.lastName}
                  onChange={formik.handleChange}
                  error={
                    formik.touched.lastName && Boolean(formik.errors.lastName)
                  }
                  helperText={formik.touched.lastName && formik.errors.lastName}
                />
              </FormControl>
            </Stack>
            <FormControl fullWidth>
              <FormLabel>Email</FormLabel>
              <Input
                name="email"
                type="email"
                startDecorator={<EmailRoundedIcon />}
                value={formik.values.email}
                onChange={formik.handleChange}
                error={formik.touched.email && Boolean(formik.errors.email)}
                helperText={formik.touched.email && formik.errors.email}
              />
            </FormControl>
            <FormControl fullWidth>
              <FormLabel>Phone Number</FormLabel>
              <Input
                name="phoneNumber"
                value={formik.values.phoneNumber}
                onChange={formik.handleChange}
                error={
                  formik.touched.phoneNumber &&
                  Boolean(formik.errors.phoneNumber)
                }
                helperText={
                  formik.touched.phoneNumber && formik.errors.phoneNumber
                }
              />
            </FormControl>
            <FormControl fullWidth>
              <FormLabel>Country</FormLabel>
              <Input
                name="country"
                value={formik.values.country}
                onChange={formik.handleChange}
                error={formik.touched.country && Boolean(formik.errors.country)}
                helperText={formik.touched.country && formik.errors.country}
              />
            </FormControl>
            <FormControl fullWidth>
              <FormLabel>Current City</FormLabel>
              <Input
                name="currentCity"
                value={formik.values.currentCity}
                onChange={formik.handleChange}
                error={
                  formik.touched.currentCity &&
                  Boolean(formik.errors.currentCity)
                }
                helperText={
                  formik.touched.currentCity && formik.errors.currentCity
                }
              />
            </FormControl>
            <FormControl fullWidth>
              <FormLabel>Gender</FormLabel>
              <Select
                name="gender"
                value={formik.values.gender}
                onChange={(event, value) =>
                  formik.setFieldValue("gender", value)
                }
                // onChange={(event) => formik.setFieldValue("gender", event.target?.value || event.value)}
                error={formik.touched.gender && Boolean(formik.errors.gender)}
              >
                <Option value="male">Male</Option>
                <Option value="female">Female</Option>
                <Option value="other">Other</Option>
                <Option value="preferNotToSay">Prefer not to say</Option>
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <FormLabel>Race</FormLabel>
              <Select
                name="race"
                onChange={(event, value) => formik.setFieldValue("race", value)}
                value={formik.values.race}
                error={formik.touched.race && Boolean(formik.errors.race)}
              >
                <Option value="white">White</Option>
                <Option value="black">Black or African American</Option>
                <Option value="asian">Asian</Option>
                <Option value="hispanic">Hispanic or Latino</Option>
                <Option value="other">Other</Option>
                <Option value="preferNotToSay">Prefer not to say</Option>
              </Select>
            </FormControl>
            <FormControl>
              <FormLabel>Are you a protected veteran?</FormLabel>
              <Select
                name="isProtectedVeteran"
                value={formik.values.isProtectedVeteran}
                onChange={(event, value) =>
                  formik.setFieldValue("isProtectedVetran", value)
                }
                error={
                  formik.touched.isProtectedVeteran &&
                  Boolean(formik.errors.isProtectedVeteran)
                }
              >
                <Option value={true}>Yes</Option>
                <Option value={false}>No</Option>
              </Select>
            </FormControl>
            <FormControl>
              <FormLabel>Do you have any disability?</FormLabel>
              <Select
                name="hasDisability"
                value={formik.values.hasDisability}
                onChange={(event, value) =>
                  formik.setFieldValue("hasDisability", value)
                }
                error={
                  formik.touched.hasDisability &&
                  Boolean(formik.errors.hasDisability)
                }
              >
                <Option value={true}>Yes</Option>
                <Option value={false}>No</Option>
              </Select>
            </FormControl>
            <FormControl>
              <FormLabel>Do you require H1B sponsorship?</FormLabel>
              <Select
                name="requiresH1BSponsorship"
                value={formik.values.requiresH1BSponsorship}
                onChange={(event, value) =>
                  formik.setFieldValue("requiresH1BSponsorship", value)
                }
                error={
                  formik.touched.requiresH1BSponsorship &&
                  Boolean(formik.errors.requiresH1BSponsorship)
                }
              >
                <Option value={true}>Yes</Option>
                <Option value={false}>No</Option>
              </Select>
            </FormControl>
          </Stack>
        </Card>
        <Card>
          <Box sx={{ mb: 1 }}>
            <Typography level="title-md">Cover Letter</Typography>
            <Typography level="body-sm">
              Provide a brief cover letter (optional, max 1000 characters)
            </Typography>
          </Box>
          <Divider />
          <Stack spacing={2} sx={{ my: 1 }}>
            <Textarea
              name="coverLetter"
              minRows={4}
              value={formik.values.coverLetter}
              onChange={formik.handleChange}
              error={
                formik.touched.coverLetter && Boolean(formik.errors.coverLetter)
              }
              helperText={
                formik.touched.coverLetter && formik.errors.coverLetter
              }
            />
            <Divider />
            <Stack spacing={2} sx={{ my: 1 }}>
              <DropZone />
              <FileUpload
                icon={<InsertDriveFileRoundedIcon />}
                fileName="Tech design requirements.pdf"
                fileSize="200 kB"
                progress={100}
              />
              <FileUpload
                icon={<VideocamRoundedIcon />}
                fileName="Dashboard prototype recording.mp4"
                fileSize="16 MB"
                progress={40}
              />
            </Stack>
          </Stack>
        </Card>
        <CardOverflow sx={{ borderTop: "1px solid", borderColor: "divider" }}>
          <CardActions sx={{ alignSelf: "flex-end", pt: 2 }}>
            {/* <Button
              size="sm"
              variant="outlined"
              color="neutral"
              onClick={formik.handleReset}
              sx={{mr:2}}
            >
              Reset
            </Button> */}
            <Button size="sm" variant="solid" type="submit">
              Save
            </Button>
          </CardActions>
        </CardOverflow>
      </Stack>
    </form>
  );
};
