/* eslint-disable jsx-a11y/anchor-is-valid */
import * as React from "react";
import Box from "@mui/joy/Box";
import Avatar from "@mui/joy/Avatar";
import Chip from "@mui/joy/Chip";
import Typography from "@mui/joy/Typography";
import List from "@mui/joy/List";
import ListItem from "@mui/joy/ListItem";
import ListItemContent from "@mui/joy/ListItemContent";
import ListItemDecorator from "@mui/joy/ListItemDecorator";
import ListDivider from "@mui/joy/ListDivider";
import IconButton from "@mui/joy/IconButton";
import Dropdown from "@mui/joy/Dropdown";
import MoreHorizRoundedIcon from "@mui/icons-material/MoreHorizRounded";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import BlockIcon from "@mui/icons-material/Block";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import KeyboardArrowLeftIcon from "@mui/icons-material/KeyboardArrowLeft";

const jobList = [
  {
    id: "4036622211",
    appliedDate: "Oct 1, 2024",
    status: "Applied",
    jobDetails: {
      position: "Frontend Developer",
      location: "Mountain View, CA",
    },
    recruiter: {
      initial: "J",
      name: "Google",
    },
  },
  {
    id: "4076621679",
    appliedDate: "Sep 30, 2024",
    status: "Interview",
    jobDetails: {
      position: "Software Engineer",
      location: "Remote",
    },
    recruiter: {
      initial: "M",
      name: "Wazobia Technologies",
    },
  },
  {
    id: "4036621679",
    appliedDate: "Sep 30, 2024",
    status: "Interview",
    jobDetails: {
      position: "Software Engineer",
      location: "Remote",
    },
    recruiter: {
      initial: "M",
      name: "Wazobia Technologies",
    },
  },
  {
    id: "4036626679",
    appliedDate: "Sep 30, 2024",
    status: "Interview",
    jobDetails: {
      position: "Software Engineer",
      location: "Remote",
    },
    recruiter: {
      initial: "M",
      name: "Wazobia Technologies",
    },
  },
  // Add more jobs as needed
];

function RowMenu() {
  return (
    <Dropdown>
      <IconButton variant="plain" color="neutral" size="sm">
        <MoreHorizRoundedIcon />
      </IconButton>
      <List size="sm" sx={{ minWidth: 140 }}>
        <ListItem>Edit</ListItem>
        <ListItem>Share</ListItem>
        <ListDivider />
        <ListItem color="danger">Delete</ListItem>
      </List>
    </Dropdown>
  );
}

export default function JobList() {
  return (
    <Box sx={{ display: { xs: "block", sm: "none" } }}>
      {jobList.map((job) => (
        <List key={job.id} size="sm" sx={{ "--ListItem-paddingX": 0 }}>
          <ListItem
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "start",
            }}
          >
            <ListItemContent sx={{ display: "flex", gap: 2, alignItems: "start" }}>
              <ListItemDecorator>
                <Avatar size="sm">{job.recruiter.initial}</Avatar>
              </ListItemDecorator>
              <div>
                <Typography gutterBottom sx={{ fontWeight: 600 }}>
                  {job.jobDetails.position}
                </Typography>
                <Typography level="body-xs" gutterBottom>
                  {job.recruiter.name} - {job.jobDetails.location}
                </Typography>
                <Typography level="body-xs" sx={{ mb: 1 }}>
                  Applied on {job.appliedDate}
                </Typography>
              </div>
            </ListItemContent>
            <Chip
              variant="soft"
              size="sm"
              startDecorator={
                job.status === "Applied" || job.status === "Interview" ? (
                  <CheckRoundedIcon />
                ) : (
                  <BlockIcon />
                )
              }
              color={job.status === "Applied" || job.status === "Interview" ? "success" : "danger"}
            >
              {job.status}
            </Chip>
          </ListItem>
          <ListDivider />
        </List>
      ))}
      <Box
        className="Pagination-mobile"
        sx={{
          display: { xs: "flex", md: "none" },
          alignItems: "center",
          py: 2,
        }}
      >
        <IconButton
          aria-label="previous page"
          variant="outlined"
          color="neutral"
          size="sm"
        >
          <KeyboardArrowLeftIcon />
        </IconButton>
        <Typography level="body-sm" sx={{ mx: "auto" }}>
          Page 1 of 10
        </Typography>
        <IconButton
          aria-label="next page"
          variant="outlined"
          color="neutral"
          size="sm"
        >
          <KeyboardArrowRightIcon />
        </IconButton>
      </Box>
    </Box>
  );
}
